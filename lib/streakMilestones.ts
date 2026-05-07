import { Alert } from 'react-native'

import { supabase } from '@/supabase'

export const STREAK_MILESTONES = [7, 30, 100] as const

export type StreakMilestone = (typeof STREAK_MILESTONES)[number]

const MILESTONE_SET = new Set<number>(STREAK_MILESTONES)

export function parseCelebrated(raw: string | null | undefined): Set<number> {
  const s = new Set<number>()
  if (!raw?.trim()) return s
  for (const part of raw.split(',')) {
    const n = Number.parseInt(part.trim(), 10)
    if (MILESTONE_SET.has(n)) s.add(n)
  }
  return s
}

/** Next milestone (7 / 30 / 100) worth celebrating for this streak count and stored flag string. */
export function nextMilestoneToCelebrate(
  currentStreak: number,
  raw: string | null | undefined,
): StreakMilestone | null {
  if (currentStreak <= 0) return null
  const done = parseCelebrated(raw)
  for (const m of STREAK_MILESTONES) {
    if (currentStreak >= m && !done.has(m)) return m
  }
  return null
}

export function appendMilestoneCelebrated(raw: string | null | undefined, m: number): string {
  const merged = [...parseCelebrated(raw), m].filter((x) => MILESTONE_SET.has(x))
  merged.sort((a, b) => a - b)
  return merged.join(',')
}

export function milestoneAlertCopy(m: StreakMilestone): { title: string; message: string } {
  switch (m) {
    case 7:
      return {
        title: '🔥 One week streak!',
        message: 'Seven days of showing up — your streak is officially on fire.',
      }
    case 30:
      return {
        title: '🔥🔥 30-day legend!',
        message: 'A full month of court check-ins. That kind of consistency deserves a celebration!',
      }
    case 100:
      return {
        title: '🔥🔥🔥 Triple digits!',
        message: '100 days of checking in. You are carrying the torch for every pickleball grinder out there!',
      }
    default:
      return { title: 'Nice streak!', message: 'Keep it going!' }
  }
}

export type StreakSummary = {
  current_streak: number
  longest_streak: number
  milestone_celebrated: string | null
}

/** Show one-time alerts for 7 / 30 / 100 day milestones; persists via streaks.milestone_celebrated. */
export async function celebrateStreakMilestonesIfNeeded(
  userId: string,
  row: StreakSummary | null,
  onMerged: (merged: string) => void,
): Promise<void> {
  if (!row || row.current_streak <= 0) return

  const current = row.current_streak
  let raw = row.milestone_celebrated ?? ''

  while (true) {
    const next = nextMilestoneToCelebrate(current, raw)
    if (next == null) break

    const copy = milestoneAlertCopy(next)
    await new Promise<void>((resolve) => {
      Alert.alert(copy.title, copy.message, [{ text: 'Awesome!', onPress: () => resolve() }], {
        cancelable: true,
        onDismiss: () => resolve(),
      })
    })

    raw = appendMilestoneCelebrated(raw, next)
    const { error } = await supabase.from('streaks').update({ milestone_celebrated: raw }).eq('user_id', userId)
    if (error) break
    onMerged(raw)
  }
}
