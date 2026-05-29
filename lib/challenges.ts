import { ensureFavoritesUser } from '@/lib/favorites'
import { normalizeUsername } from '@/lib/profileValidation'
import { sendPushNotification } from '@/lib/push'
import { supabase } from '@/supabase'

export type ChallengeOpponent =
  | { kind: 'username'; username: string }
  | { kind: 'friend'; userId: string }

export type ChallengeInput = {
  opponent: ChallengeOpponent
  proposedTime: string
  courtId: string | null
  courtName: string | null
}

export type ChallengeResult =
  | { ok: true; opponentName: string }
  | { ok: false; error: string }

export async function submitChallenge(input: ChallengeInput): Promise<ChallengeResult> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { ok: false, error: gate.error }

  let player: { user_id: string; display_name: string | null; username: string | null } | null = null

  if (input.opponent.kind === 'friend') {
    const { data } = await supabase
      .from('players')
      .select('user_id, display_name, username')
      .eq('user_id', input.opponent.userId)
      .maybeSingle()
    player = data ?? null
    if (!player) return { ok: false, error: 'Could not load that player.' }
  } else {
    const rawUsername = normalizeUsername(input.opponent.username)
    if (!rawUsername) return { ok: false, error: "Enter your opponent's username." }
    const { data } = await supabase
      .from('players')
      .select('user_id, display_name, username')
      .eq('username', rawUsername)
      .maybeSingle()
    player = data ?? null
    if (!player) return { ok: false, error: `No player with username @${rawUsername} found.` }
  }

  if (player.user_id === gate.userId) return { ok: false, error: "You can't challenge yourself!" }

  const { data: me } = await supabase
    .from('players')
    .select('display_name')
    .eq('user_id', gate.userId)
    .maybeSingle()

  const { error } = await supabase.from('challenges').insert({
    challenger_id: gate.userId,
    challenged_id: player.user_id,
    challenger_name: me?.display_name ?? 'A player',
    challenged_name: player.display_name,
    court_id: input.courtId,
    proposed_time: input.proposedTime.trim() || null,
    status: 'pending',
  })

  if (error) return { ok: false, error: error.message }

  const { data: tokenRow } = await supabase
    .from('notification_tokens')
    .select('push_token')
    .eq('user_id', player.user_id)
    .maybeSingle()

  if (tokenRow?.push_token) {
    const courtText = input.courtName ? ` at ${input.courtName}` : ''
    const timeText = input.proposedTime.trim() ? ` · ${input.proposedTime.trim()}` : ''
    await sendPushNotification(
      tokenRow.push_token,
      'Match Challenge',
      `${me?.display_name ?? 'Someone'} challenged you${courtText}${timeText}`,
    )
  }

  return { ok: true, opponentName: player.display_name ?? player.username ?? 'Player' }
}
