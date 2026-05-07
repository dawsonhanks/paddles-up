import { ensureFavoritesUser } from '@/lib/favorites'
import { supabase } from '@/supabase'

const CHECKIN_EXPIRY_MS = 2 * 60 * 60 * 1000

/** Matches court detail sheet: upsert court_checkins with 2h expiry. */
export async function upsertActiveCourtCheckIn(courtId: string): Promise<{
  ok: boolean
  error?: string
  displayName?: string
}> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { ok: false, error: gate.error }

  const { data: playerData } = await supabase
    .from('players')
    .select('display_name')
    .eq('user_id', gate.userId)
    .maybeSingle()

  const displayName = playerData?.display_name ?? 'Anonymous'

  const { error } = await supabase.from('court_checkins').upsert(
    {
      user_id: gate.userId,
      court_id: courtId,
      display_name: displayName,
      checked_in_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + CHECKIN_EXPIRY_MS).toISOString(),
    },
    { onConflict: 'user_id,court_id' },
  )

  if (error) return { ok: false, error: error.message }
  return { ok: true, displayName }
}

export async function deleteCourtCheckIn(courtId: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { ok: false, error: gate.error }

  const { error } = await supabase
    .from('court_checkins')
    .delete()
    .eq('user_id', gate.userId)
    .eq('court_id', courtId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
