import * as Notifications from 'expo-notifications'
import { SchedulableTriggerInputTypes } from 'expo-notifications'
import { supabase } from '@/supabase'

const REMINDER_BEFORE_MS = 10 * 60 * 1000

export type ScheduledSessionRow = {
  id: string
  user_id: string
  court_id: string
  court_name: string
  session_date: string
  notes: string | null
  reminder_sent: boolean
  notification_id: string | null
  created_at: string
}

export type CourtPickerRow = { id: string; name: string }

/** Upcoming sessions (session strictly in the future). */
export async function fetchUpcomingScheduledSessions(userId: string): Promise<ScheduledSessionRow[]> {
  const { data, error } = await supabase
    .from('scheduled_sessions')
    .select('*')
    .eq('user_id', userId)
    .gt('session_date', new Date().toISOString())
    .order('session_date', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ScheduledSessionRow[]
}

export async function fetchCourtRowsForPicker(): Promise<CourtPickerRow[]> {
  const { data, error } = await supabase.from('courts').select('id, name').order('name').limit(1000)
  if (error) throw new Error(error.message)
  return ((data ?? []) as { id: string; name: string | null }[])
    .map((r) => ({ id: String(r.id), name: typeof r.name === 'string' && r.name.trim() ? r.name : 'Court' }))
    .filter((r) => r.id.length > 0)
}

export async function ensureLocalNotificationPermissions(): Promise<boolean> {
  try {
    const prev = await Notifications.getPermissionsAsync()
    if (prev.granted) return true
    const next = await Notifications.requestPermissionsAsync()
    return !!next.granted
  } catch {
    return false
  }
}

/** Expo local reminder 10 minutes before session. Returns identifier or null when skipped/failed/unavailable. */
export async function scheduleSessionTenMinuteReminder(params: {
  courtId: string
  courtName: string
  sessionDate: Date
}): Promise<string | null> {
  const sessionMs = params.sessionDate.getTime()
  if (!Number.isFinite(sessionMs)) return null
  const remindAtMs = sessionMs - REMINDER_BEFORE_MS
  if (remindAtMs <= Date.now() + 2000) return null

  const ok = await ensureLocalNotificationPermissions()
  if (!ok) return null

  try {
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Court session',
        body: `You're playing at ${params.courtName} in 10 minutes — tap to check in! 🏓`,
        data: { type: 'session_reminder', courtId: params.courtId },
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DATE,
        date: new Date(remindAtMs),
      },
    })
    return identifier
  } catch {
    return null
  }
}

export async function cancelScheduledSessionReminder(notificationId: string | null | undefined): Promise<void> {
  const id = typeof notificationId === 'string' && notificationId.trim() ? notificationId.trim() : null
  if (!id) return
  try {
    await Notifications.cancelScheduledNotificationAsync(id)
  } catch {
    /* id may already have fired */
  }
}

/** Insert session, schedule reminder, persist notification identifier. */
export async function insertScheduledSessionWithReminder(params: {
  userId: string
  courtId: string
  courtName: string
  sessionDate: Date
  notes?: string
}): Promise<{ row: ScheduledSessionRow | null; error?: string }> {
  const notesTrim = typeof params.notes === 'string' ? params.notes.trim() : ''
  const { data: inserted, error: insErr } = await supabase
    .from('scheduled_sessions')
    .insert({
      user_id: params.userId,
      court_id: params.courtId,
      court_name: params.courtName.trim(),
      session_date: params.sessionDate.toISOString(),
      notes: notesTrim.length > 0 ? notesTrim : null,
      reminder_sent: false,
      notification_id: null,
    })
    .select('*')
    .single()

  if (insErr || !inserted) {
    return { row: null, error: insErr?.message ?? 'Could not save session' }
  }

  let row = inserted as ScheduledSessionRow
  const notifId = await scheduleSessionTenMinuteReminder({
    courtId: params.courtId,
    courtName: params.courtName,
    sessionDate: params.sessionDate,
  })

  const { error: upErr } = await supabase
    .from('scheduled_sessions')
    .update({
      notification_id: notifId ?? null,
      reminder_sent: notifId != null,
    })
    .eq('id', row.id)
    .eq('user_id', params.userId)

  if (!upErr) {
    row = {
      ...row,
      notification_id: notifId ?? null,
      reminder_sent: notifId != null,
    }
  }

  return { row }
}

/** Update session fields, cancel old local reminder, schedule a new one, persist notification_id. */
export async function updateScheduledSessionWithReminder(params: {
  sessionId: string
  userId: string
  courtId: string
  courtName: string
  sessionDate: Date
  notes?: string
  previousNotificationId: string | null
}): Promise<{ row: ScheduledSessionRow | null; error?: string }> {
  await cancelScheduledSessionReminder(params.previousNotificationId)

  const notesTrim = typeof params.notes === 'string' ? params.notes.trim() : ''
  const { data: updated, error: upErr } = await supabase
    .from('scheduled_sessions')
    .update({
      court_id: params.courtId.trim(),
      court_name: params.courtName.trim(),
      session_date: params.sessionDate.toISOString(),
      notes: notesTrim.length > 0 ? notesTrim : null,
      reminder_sent: false,
      notification_id: null,
    })
    .eq('id', params.sessionId)
    .eq('user_id', params.userId)
    .select('*')
    .single()

  if (upErr || !updated) {
    return { row: null, error: upErr?.message ?? 'Could not update session' }
  }

  let row = updated as ScheduledSessionRow
  const notifId = await scheduleSessionTenMinuteReminder({
    courtId: params.courtId.trim(),
    courtName: params.courtName.trim(),
    sessionDate: params.sessionDate,
  })

  const { error: nErr } = await supabase
    .from('scheduled_sessions')
    .update({
      notification_id: notifId ?? null,
      reminder_sent: notifId != null,
    })
    .eq('id', params.sessionId)
    .eq('user_id', params.userId)

  if (!nErr) {
    row = {
      ...row,
      notification_id: notifId ?? null,
      reminder_sent: notifId != null,
    }
  }

  return { row }
}

export async function deleteScheduledSessionById(sessionId: string, userId: string, notificationId: string | null): Promise<{ ok: boolean; error?: string }> {
  await cancelScheduledSessionReminder(notificationId ?? undefined)

  const { error } = await supabase.from('scheduled_sessions').delete().eq('id', sessionId).eq('user_id', userId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export function formatSessionHumanDate(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d.getTime())
  x.setHours(0, 0, 0, 0)
  return x
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return startOfLocalDay(a).getTime() === startOfLocalDay(b).getTime()
}

/** Human countdown for listing cards. */
export function scheduledSessionRelativeLabel(sessionDate: Date): string {
  const t = sessionDate.getTime()
  const now = Date.now()
  const diff = t - now
  if (!Number.isFinite(diff)) return ''
  if (diff <= 0) return 'Starting now'

  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Starts soon'
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`

  const tomorrow = startOfLocalDay(new Date(now + 86400000))
  if (isSameLocalDay(sessionDate, tomorrow)) return 'tomorrow'

  const hours = Math.floor(diff / 3600000)
  if (hours < 48) return `in ${hours} hour${hours === 1 ? '' : 's'}`

  const days = Math.ceil(diff / 86400000)
  return `in ${days} day${days === 1 ? '' : 's'}`
}

/** Badge: upcoming sessions happening on the device's local calendar day (today only). */
export function countSessionsTodayUpcoming(rows: Pick<ScheduledSessionRow, 'session_date'>[]): number {
  const now = Date.now()
  const today = startOfLocalDay(new Date(now))
  return rows.filter((r) => {
    const d = new Date(r.session_date)
    const t = d.getTime()
    if (!Number.isFinite(t) || t <= now) return false
    return isSameLocalDay(d, today)
  }).length
}
