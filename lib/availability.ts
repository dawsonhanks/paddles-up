import { type CourtStatus, STATUS_PIN_COLOR } from '@/lib/courts'
import { supabase } from '@/supabase'

/** How long a community report counts as “live” (matches receptionist tooling). */
const REPORT_TTL_MS = 30 * 60 * 1000

const COURT_ID_IN_CHUNK = 80

/** Map pin / list status from courts_available vs venue court_count. */
export function courtsAvailableToPinStatus(available: number, totalCourts: number): CourtStatus {
  const total = Math.max(1, Math.floor(totalCourts))
  const clamped = Math.min(Math.max(0, Math.floor(available)), total)
  if (clamped <= 0) return 'full'
  if (clamped > total / 2) return 'open'
  return 'busy'
}

export function courtsAvailabilityHeadlineColors(
  available: number,
  totalCourts: number,
  isDark: boolean,
): { dot: string; text: string } {
  const total = Math.max(1, Math.floor(totalCourts))
  const clamped = Math.min(Math.max(0, Math.floor(available)), total)
  const st = courtsAvailableToPinStatus(clamped, total)
  return courtStatusHeadlineColors(st, isDark)
}

/** Headline text/dot colors for a resolved CourtStatus (three-state zone rollup). */
export function courtStatusHeadlineColors(
  status: CourtStatus,
  isDark: boolean,
): { dot: string; text: string } {
  const dot = STATUS_PIN_COLOR[status]
  if (!isDark) {
    if (status === 'full') return { dot, text: '#B91C1C' }
    if (status === 'open') return { dot, text: '#166534' }
    if (status === 'busy') return { dot, text: '#B45309' }
    return { dot, text: '#64748B' }
  }
  if (status === 'full') return { dot, text: '#FECACA' }
  if (status === 'open') return { dot, text: '#86EFAC' }
  if (status === 'busy') return { dot, text: '#FCD34D' }
  return { dot, text: '#94A3B8' }
}

export type CourtsAvailabilityInsert = {
  court_id: string
  courts_available: number
  reporter_lat: number
  reporter_lng: number
}

export async function insertCourtsAvailabilityReport(
  row: CourtsAvailabilityInsert,
): Promise<{ error: Error | null }> {
  const expiresAt = new Date(Date.now() + REPORT_TTL_MS).toISOString()
  const { data, error } = await supabase
    .from('availability_reports')
    .insert({
      court_id: row.court_id,
      courts_available: row.courts_available,
      reporter_lat: row.reporter_lat,
      reporter_lng: row.reporter_lng,
      expires_at: expiresAt,
    })
    .select('id')
    .maybeSingle()

  if (error) return { error: new Error(error.message) }
  if (!data)
    return {
      error: new Error('Report was not saved (no row returned). Check RLS policies on availability_reports.'),
    }
  return { error: null }
}

export async function fetchLatestCourtsAvailableReport(
  courtId: string,
): Promise<{ courts_available: number; created_at: string } | null> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('availability_reports')
    .select('courts_available, created_at')
    .eq('court_id', courtId)
    .gt('expires_at', nowIso)
    .not('courts_available', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (__DEV__) console.warn('[availability] fetchLatestCourtsAvailableReport', courtId, error.message)
    return null
  }
  if (!data) return null
  const raw = data as { courts_available?: unknown; created_at?: unknown }
  const n =
    typeof raw.courts_available === 'number'
      ? raw.courts_available
      : Number(raw.courts_available)
  if (!Number.isFinite(n)) return null
  const createdAt = typeof raw.created_at === 'string' ? raw.created_at : ''
  return { courts_available: Math.floor(n), created_at: createdAt }
}

/** Latest venue-wide count per court_id (unexpired rows only). */
export async function fetchLatestCourtsAvailableByCourtIds(
  courtIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (courtIds.length === 0) return out

  const nowIso = new Date().toISOString()

  for (let i = 0; i < courtIds.length; i += COURT_ID_IN_CHUNK) {
    const chunk = courtIds.slice(i, i + COURT_ID_IN_CHUNK)
    const { data, error } = await supabase
      .from('availability_reports')
      .select('court_id, courts_available, created_at')
      .in('court_id', chunk)
      .gt('expires_at', nowIso)
      .not('courts_available', 'is', null)
      .order('created_at', { ascending: false })
      .limit(400)

    if (error) {
      if (__DEV__) console.warn('[availability] fetchLatestCourtsAvailableByCourtIds chunk', error.message)
      continue
    }
    if (!data) continue

    for (const raw of data) {
      const row = raw as { court_id?: string; courts_available?: unknown }
      const cid = row.court_id != null ? String(row.court_id).trim() : ''
      if (!cid || out.has(cid)) continue
      const n =
        typeof row.courts_available === 'number'
          ? row.courts_available
          : Number(row.courts_available)
      if (!Number.isFinite(n)) continue
      out.set(cid, Math.floor(n))
    }
  }

  return out
}
