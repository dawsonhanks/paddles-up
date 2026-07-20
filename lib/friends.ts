import { fetchBlockedUserIds } from '@/lib/blockedUsers'
import { ensureFavoritesUser } from '@/lib/favorites'
import { isValidUsername, normalizeUsername } from '@/lib/profileValidation'
import { supabase } from '@/supabase'

export type FriendPlayer = {
  user_id: string
  display_name: string | null
  username: string | null
  avatar_url: string | null
  skill_rating?: number | null
}

export type FriendPlayerWithRecord = FriendPlayer & { wins: number; losses: number }

export type FriendSearchResult = FriendPlayer & {
  linkStatus: 'none' | 'friends' | 'outgoing_pending' | 'they_added_you'
  /** Present when linkStatus is outgoing_pending or they_added_you */
  requestId?: string
}

export type FriendRequestItem = {
  id: string
  from_user: string
  to_user: string
  created_at: string
  player: FriendPlayer
}

function aggregateWinsLosses(rows: { user_id: string; result: string }[] | null) {
  const byUser = new Map<string, { wins: number; losses: number }>()
  for (const r of rows ?? []) {
    const cur = byUser.get(r.user_id) ?? { wins: 0, losses: 0 }
    if (r.result === 'win') cur.wins++
    else if (r.result === 'loss') cur.losses++
    byUser.set(r.user_id, cur)
  }
  return byUser
}

async function loadPlayersByUserIds(ids: string[]): Promise<{ players: FriendPlayer[]; error?: string }> {
  if (ids.length === 0) return { players: [] }
  const { data, error } = await supabase
    .from('players')
    .select('user_id, display_name, username, avatar_url, skill_rating')
    .in('user_id', ids)
  if (error) return { players: [], error: error.message }
  return { players: (data as FriendPlayer[]) ?? [] }
}

/** Friends of the current user with win/loss aggregates. */
export async function fetchFriendsWithStats(): Promise<{ friends: FriendPlayerWithRecord[]; error?: string }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { friends: [], error: gate.error }

  const { data: rows, error } = await supabase.from('friendships').select('friend_id').eq('user_id', gate.userId)

  if (error) return { friends: [], error: error.message }

  const ids = rows?.map(r => r.friend_id) ?? []
  if (ids.length === 0) return { friends: [] }

  const blocked = new Set(await fetchBlockedUserIds())

  const [{ data: players, error: pErr }, { data: matchRows }] = await Promise.all([
    supabase
      .from('players')
      .select('user_id, display_name, username, avatar_url, skill_rating')
      .in('user_id', ids),
    supabase.from('matches').select('user_id, result').in('user_id', ids),
  ])

  if (pErr) return { friends: [], error: pErr.message }

  const wl = aggregateWinsLosses(matchRows as { user_id: string; result: string }[])
  const friendRows = (players as FriendPlayer[]) ?? []
  const friends: FriendPlayerWithRecord[] = friendRows
    .filter((p) => !blocked.has(p.user_id))
    .map((p) => ({
      ...p,
      wins: wl.get(p.user_id)?.wins ?? 0,
      losses: wl.get(p.user_id)?.losses ?? 0,
    }))

  return { friends }
}

/** @deprecated prefer fetchFriendsWithStats */
export async function fetchFriends(): Promise<{ friends: FriendPlayer[]; error?: string }> {
  const { friends, error } = await fetchFriendsWithStats()
  return { friends: friends.map(({ wins: _w, losses: _l, ...f }) => f), error }
}

export async function removeFriendship(friendUserId: string): Promise<{ error?: string }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { error: gate.error }
  const { error } = await supabase
    .from('friendships')
    .delete()
    .eq('user_id', gate.userId)
    .eq('friend_id', friendUserId)
  if (error) return { error: error.message }
  return {}
}

/**
 * Ensures a `friendships` row exists from the current user to `friendUserId`.
 * Used after unblock when an older app version removed the friendship on block.
 */
export async function addFriendshipIfAbsent(friendUserId: string): Promise<{ error?: string }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { error: gate.error }
  const { data: existing } = await supabase
    .from('friendships')
    .select('friend_id')
    .eq('user_id', gate.userId)
    .eq('friend_id', friendUserId)
    .maybeSingle()
  if (existing) return {}
  const { error } = await supabase.from('friendships').insert({ user_id: gate.userId, friend_id: friendUserId })
  if (error) return { error: error.message }
  return {}
}

export async function fetchPendingFriendRequests(): Promise<{
  incoming: FriendRequestItem[]
  outgoing: FriendRequestItem[]
  error?: string
}> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { incoming: [], outgoing: [], error: gate.error }
  const myId = gate.userId

  const { data: rows, error } = await supabase
    .from('friend_requests')
    .select('id, from_user, to_user, created_at')
    .eq('status', 'pending')
    .or(`from_user.eq.${myId},to_user.eq.${myId}`)
    .order('created_at', { ascending: false })

  if (error) return { incoming: [], outgoing: [], error: error.message }

  const list = rows ?? []
  if (list.length === 0) return { incoming: [], outgoing: [] }

  const otherIds = list.map((r) => (r.from_user === myId ? r.to_user : r.from_user))
  const { players, error: pErr } = await loadPlayersByUserIds(otherIds)
  if (pErr) return { incoming: [], outgoing: [], error: pErr }

  const byId = new Map(players.map((p) => [p.user_id, p]))
  const blocked = new Set(await fetchBlockedUserIds())

  const incoming: FriendRequestItem[] = []
  const outgoing: FriendRequestItem[] = []

  for (const r of list) {
    const otherId = r.from_user === myId ? r.to_user : r.from_user
    if (blocked.has(otherId)) continue
    const player = byId.get(otherId) ?? {
      user_id: otherId,
      display_name: null,
      username: null,
      avatar_url: null,
    }
    const item: FriendRequestItem = {
      id: r.id,
      from_user: r.from_user,
      to_user: r.to_user,
      created_at: r.created_at,
      player,
    }
    if (r.to_user === myId) incoming.push(item)
    else outgoing.push(item)
  }

  return { incoming, outgoing }
}

/**
 * Accept a pending request: insert mutual friendships (A↔B), then delete the request.
 * Reciprocal insert relies on friendships_insert_reciprocal_on_accept while the row is still pending.
 */
export async function acceptFriendRequest(requestId: string): Promise<{ error?: string }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { error: gate.error }
  const myId = gate.userId

  const { data: req, error: fetchErr } = await supabase
    .from('friend_requests')
    .select('id, from_user, to_user, status')
    .eq('id', requestId)
    .maybeSingle()

  if (fetchErr) return { error: fetchErr.message }
  if (!req || req.status !== 'pending') return { error: 'Request not found' }
  if (req.to_user !== myId) return { error: 'Only the recipient can accept this request' }

  const fromUser = req.from_user as string

  const { data: existingMine } = await supabase
    .from('friendships')
    .select('id')
    .eq('user_id', myId)
    .eq('friend_id', fromUser)
    .maybeSingle()

  if (!existingMine) {
    const { error: insMine } = await supabase.from('friendships').insert({ user_id: myId, friend_id: fromUser })
    if (insMine) return { error: insMine.message }
  }

  // Reciprocal row: RLS blocks SELECT on their side, so insert and treat unique as already present.
  // Must happen while the friend_requests row is still pending (reciprocal insert policy).
  const { error: insTheirs } = await supabase
    .from('friendships')
    .insert({ user_id: fromUser, friend_id: myId })
  if (insTheirs && insTheirs.code !== '23505') return { error: insTheirs.message }

  const { error: delErr } = await supabase.from('friend_requests').delete().eq('id', requestId)
  if (delErr) return { error: delErr.message }
  return {}
}

export async function declineFriendRequest(requestId: string): Promise<{ error?: string }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { error: gate.error }

  const { data: req, error: fetchErr } = await supabase
    .from('friend_requests')
    .select('id, to_user, status')
    .eq('id', requestId)
    .maybeSingle()

  if (fetchErr) return { error: fetchErr.message }
  if (!req || req.status !== 'pending') return { error: 'Request not found' }
  if (req.to_user !== gate.userId) return { error: 'Only the recipient can decline this request' }

  const { error } = await supabase.from('friend_requests').delete().eq('id', requestId)
  if (error) return { error: error.message }
  return {}
}

export async function cancelFriendRequest(requestId: string): Promise<{ error?: string }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { error: gate.error }

  const { data: req, error: fetchErr } = await supabase
    .from('friend_requests')
    .select('id, from_user, status')
    .eq('id', requestId)
    .maybeSingle()

  if (fetchErr) return { error: fetchErr.message }
  if (!req || req.status !== 'pending') return { error: 'Request not found' }
  if (req.from_user !== gate.userId) return { error: 'Only the sender can cancel this request' }

  const { error } = await supabase.from('friend_requests').delete().eq('id', requestId)
  if (error) return { error: error.message }
  return {}
}

/**
 * Send a friend request. If the other user already has a pending request to you, auto-accept instead.
 */
export async function sendFriendRequest(
  toUserId: string,
): Promise<{ error?: string; autoAccepted?: boolean; alreadyPending?: boolean; requestId?: string }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { error: gate.error }
  const myId = gate.userId

  if (toUserId === myId) return { error: 'You cannot add yourself' }

  const { data: alreadyFriend } = await supabase
    .from('friendships')
    .select('friend_id')
    .eq('user_id', myId)
    .eq('friend_id', toUserId)
    .maybeSingle()
  if (alreadyFriend) return { error: 'Already friends' }

  const { data: outgoing } = await supabase
    .from('friend_requests')
    .select('id')
    .eq('status', 'pending')
    .eq('from_user', myId)
    .eq('to_user', toUserId)
    .maybeSingle()
  if (outgoing) return { alreadyPending: true, requestId: outgoing.id }

  const { data: incoming } = await supabase
    .from('friend_requests')
    .select('id')
    .eq('status', 'pending')
    .eq('from_user', toUserId)
    .eq('to_user', myId)
    .maybeSingle()

  if (incoming?.id) {
    const accepted = await acceptFriendRequest(incoming.id)
    if (accepted.error) return { error: accepted.error }
    return { autoAccepted: true }
  }

  const { data: inserted, error } = await supabase
    .from('friend_requests')
    .insert({
      from_user: myId,
      to_user: toUserId,
      status: 'pending',
    })
    .select('id')
    .maybeSingle()
  if (error) return { error: error.message }
  return { requestId: inserted?.id }
}

export async function fetchFriendProfileBundle(friendUserId: string): Promise<
  | {
      ok: true
      player: FriendPlayer
      wins: number
      losses: number
      recentMatches: Array<{
        id: string
        opponent_name: string
        result: string
        user_score: number | null
        opponent_score: number | null
        played_at: string
      }>
    }
  | { ok: false; error: 'not_friend' | 'not_found'; message?: string }
> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { ok: false, error: 'not_found', message: gate.error }

  const { data: link } = await supabase
    .from('friendships')
    .select('friend_id')
    .eq('user_id', gate.userId)
    .eq('friend_id', friendUserId)
    .maybeSingle()

  if (!link) return { ok: false, error: 'not_friend' }

  const [{ data: player, error: pErr }, { data: matchAgg }, { data: recent }] = await Promise.all([
    supabase
      .from('players')
      .select('user_id, display_name, username, avatar_url, skill_rating')
      .eq('user_id', friendUserId)
      .maybeSingle(),
    supabase.from('matches').select('result').eq('user_id', friendUserId),
    supabase
      .from('matches')
      .select('id, opponent_name, result, user_score, opponent_score, played_at')
      .eq('user_id', friendUserId)
      .order('played_at', { ascending: false })
      .limit(5),
  ])

  if (pErr || !player) return { ok: false, error: 'not_found', message: pErr?.message }

  const aggRows = (matchAgg ?? []) as { result: string }[]
  const wins = aggRows.filter((m) => m.result === 'win').length
  const losses = aggRows.filter((m) => m.result === 'loss').length

  return {
    ok: true,
    player: player as FriendPlayer,
    wins,
    losses,
    recentMatches: (recent ?? []) as Array<{
      id: string
      opponent_name: string
      result: string
      user_score: number | null
      opponent_score: number | null
      played_at: string
    }>,
  }
}

export async function searchPlayersFriendshipAware(
  rawQuery: string,
): Promise<{ results: FriendSearchResult[]; error?: string }> {
  const q = rawQuery.trim()
  if (!q) return { results: [] }

  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { results: [], error: gate.error }
  const myId = gate.userId

  const normalized = normalizeUsername(q)
  const safeQ = q.replace(/[%_]/g, '')
  const orFilter =
    normalized.length >= 3 && isValidUsername(normalized)
      ? `username.eq.${normalized},username.ilike.%${normalized}%,display_name.ilike.%${safeQ}%`
      : `username.ilike.%${safeQ}%,display_name.ilike.%${safeQ}%`

  const { data: results, error } = await supabase
    .from('players')
    .select('user_id, display_name, username, avatar_url, skill_rating')
    .or(orFilter)
    .neq('user_id', myId)
    .limit(24)

  if (error) return { results: [], error: error.message }

  const ids = (results ?? []).map((r) => r.user_id as string)
  if (ids.length === 0) return { results: [] }

  const [{ data: iFollow }, { data: outgoingReqs }, { data: incomingReqs }] = await Promise.all([
    supabase.from('friendships').select('friend_id').eq('user_id', myId).in('friend_id', ids),
    supabase
      .from('friend_requests')
      .select('id, to_user')
      .eq('status', 'pending')
      .eq('from_user', myId)
      .in('to_user', ids),
    supabase
      .from('friend_requests')
      .select('id, from_user')
      .eq('status', 'pending')
      .eq('to_user', myId)
      .in('from_user', ids),
  ])

  const friendSet = new Set(iFollow?.map((r) => r.friend_id) ?? [])
  const outgoingByUser = new Map((outgoingReqs ?? []).map((r) => [r.to_user as string, r.id as string]))
  const incomingByUser = new Map((incomingReqs ?? []).map((r) => [r.from_user as string, r.id as string]))

  const enriched: FriendSearchResult[] = (results as FriendPlayer[]).map((p) => {
    let linkStatus: FriendSearchResult['linkStatus'] = 'none'
    let requestId: string | undefined
    if (friendSet.has(p.user_id)) {
      linkStatus = 'friends'
    } else if (outgoingByUser.has(p.user_id)) {
      linkStatus = 'outgoing_pending'
      requestId = outgoingByUser.get(p.user_id)
    } else if (incomingByUser.has(p.user_id)) {
      linkStatus = 'they_added_you'
      requestId = incomingByUser.get(p.user_id)
    }
    return { ...p, linkStatus, requestId }
  })

  const blocked = new Set(await fetchBlockedUserIds())
  const filtered = enriched.filter((p) => !blocked.has(p.user_id))

  return { results: filtered }
}
