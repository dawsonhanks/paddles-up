import { ensureFavoritesUser } from '@/lib/favorites'
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
  linkStatus: 'none' | 'friends' | 'they_added_you'
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

/** Friends of the current user with win/loss aggregates. */
export async function fetchFriendsWithStats(): Promise<{ friends: FriendPlayerWithRecord[]; error?: string }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { friends: [], error: gate.error }

  const { data: rows, error } = await supabase.from('friendships').select('friend_id').eq('user_id', gate.userId)

  if (error) return { friends: [], error: error.message }

  const ids = rows?.map(r => r.friend_id) ?? []
  if (ids.length === 0) return { friends: [] }

  const [{ data: players, error: pErr }, { data: matchRows }] = await Promise.all([
    supabase
      .from('players')
      .select('user_id, display_name, username, avatar_url, skill_rating')
      .in('user_id', ids),
    supabase.from('matches').select('user_id, result').in('user_id', ids),
  ])

  if (pErr) return { friends: [], error: pErr.message }

  const wl = aggregateWinsLosses(matchRows as { user_id: string; result: string }[])
  const friends: FriendPlayerWithRecord[] =
    (players as FriendPlayer[])?.map((p) => ({
      ...p,
      wins: wl.get(p.user_id)?.wins ?? 0,
      losses: wl.get(p.user_id)?.losses ?? 0,
    })) ?? []

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

  const { data: results, error } = await supabase
    .from('players')
    .select('user_id, display_name, username, avatar_url, skill_rating')
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .neq('user_id', myId)
    .limit(24)

  if (error) return { results: [], error: error.message }

  const ids = (results ?? []).map((r) => r.user_id as string)
  if (ids.length === 0) return { results: [] }

  const [{ data: iFollow }, { data: theyFollow }] = await Promise.all([
    supabase.from('friendships').select('friend_id').eq('user_id', myId).in('friend_id', ids),
    supabase.from('friendships').select('user_id').eq('friend_id', myId).in('user_id', ids),
  ])

  const iFollowSet = new Set(iFollow?.map((r) => r.friend_id) ?? [])
  const theyFollowSet = new Set(theyFollow?.map((r) => r.user_id) ?? [])

  const enriched: FriendSearchResult[] = (results as FriendPlayer[]).map((p) => {
    let linkStatus: FriendSearchResult['linkStatus'] = 'none'
    if (iFollowSet.has(p.user_id)) linkStatus = 'friends'
    else if (theyFollowSet.has(p.user_id)) linkStatus = 'they_added_you'
    return { ...p, linkStatus }
  })

  return { results: enriched }
}
