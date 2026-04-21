import { ensureFavoritesUser } from '@/lib/favorites'
import { supabase } from '@/supabase'

async function sendPushNotification(token: string, title: string, body: string) {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default' }),
    })
  } catch {}
}

export type ChallengeInput = {
  username: string
  proposedTime: string
  courtId: string | null
  courtName: string | null
}

export type ChallengeResult =
  | { ok: true; opponentName: string }
  | { ok: false; error: string }

export async function submitChallenge(input: ChallengeInput): Promise<ChallengeResult> {
  const rawUsername = input.username.trim().replace(/^@/, '')

  const gate = await ensureFavoritesUser()
  if ('error' in gate) return { ok: false, error: gate.error }

  const { data: player } = await supabase
    .from('players')
    .select('user_id, display_name, username')
    .eq('username', rawUsername)
    .maybeSingle()

  if (!player) return { ok: false, error: `No player with username @${rawUsername} found.` }
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
      '🏓 Match Challenge!',
      `${me?.display_name ?? 'Someone'} challenged you${courtText}${timeText}`,
    )
  }

  return { ok: true, opponentName: player.display_name ?? rawUsername }
}
