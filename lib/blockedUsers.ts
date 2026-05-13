import { ensureFavoritesUser } from '@/lib/favorites'
import { supabase } from '@/supabase'

export async function fetchBlockedUserIds(): Promise<string[]> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return []

  const { data, error } = await supabase.from('blocked_users').select('blocked_id').eq('blocker_id', gate.userId)

  if (error) return []
  return (data ?? []).map((r) => String((r as { blocked_id: string }).blocked_id)).filter(Boolean)
}

export type BlockedPlayerRow = {
  blocked_id: string
  display_name: string | null
  username: string | null
  avatar_url: string | null
}

export async function fetchBlockedPlayers(): Promise<{ rows: BlockedPlayerRow[]; error: Error | null }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) {
    return { rows: [], error: new Error(gate.error) }
  }

  const { data: blocks, error: bErr } = await supabase
    .from('blocked_users')
    .select('blocked_id')
    .eq('blocker_id', gate.userId)
    .order('created_at', { ascending: false })

  if (bErr) {
    return { rows: [], error: new Error(bErr.message) }
  }

  const ids = (blocks ?? []).map((r) => String((r as { blocked_id: string }).blocked_id)).filter(Boolean)
  if (ids.length === 0) {
    return { rows: [], error: null }
  }

  const { data: players, error: pErr } = await supabase
    .from('players')
    .select('user_id, display_name, username, avatar_url')
    .in('user_id', ids)

  if (pErr) {
    return { rows: [], error: new Error(pErr.message) }
  }

  const playerById = new Map(
    (players ?? []).map((p) => [String((p as { user_id: string }).user_id), p as Record<string, unknown>]),
  )

  const rows: BlockedPlayerRow[] = ids.map((blocked_id) => {
    const p = playerById.get(blocked_id)
    return {
      blocked_id,
      display_name: p ? (p.display_name as string | null | undefined) ?? null : null,
      username: p ? (p.username as string | null | undefined) ?? null : null,
      avatar_url: p ? (p.avatar_url as string | null | undefined) ?? null : null,
    }
  })

  return { rows, error: null }
}

export async function blockUser(blockedId: string): Promise<{ error: Error | null }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) {
    return { error: new Error(gate.error) }
  }
  if (blockedId === gate.userId) {
    return { error: new Error('You cannot block yourself.') }
  }

  const { error } = await supabase.from('blocked_users').insert({
    blocker_id: gate.userId,
    blocked_id: blockedId,
  })

  if (error && !error.message.includes('duplicate') && error.code !== '23505') {
    return { error: new Error(error.message) }
  }
  return { error: null }
}

export async function unblockUser(blockedId: string): Promise<{ error: Error | null }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) {
    return { error: new Error(gate.error) }
  }

  const { error } = await supabase.from('blocked_users').delete().eq('blocker_id', gate.userId).eq('blocked_id', blockedId)

  if (error) {
    return { error: new Error(error.message) }
  }
  return { error: null }
}
