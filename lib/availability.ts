import type { CourtStatus } from '@/lib/courts'
import { supabase } from '@/supabase'

/** How long a community report counts as “live” (matches receptionist tooling). */
const REPORT_TTL_MS = 30 * 60 * 1000

export type ReportableStatus = Extract<CourtStatus, 'open' | 'busy' | 'full'>

export type LatestAvailabilityByCourtResult =
  | { ok: true; byCourt: Map<number, ReportableStatus> }
  | { ok: false }

/** Worst-case across numbered courts at a venue: full > busy > open. */
export function aggregateVenueLiveStatus(latest: Map<number, ReportableStatus>): CourtStatus {
  if (latest.size === 0) return 'unknown'
  const vals = [...latest.values()]
  if (vals.includes('full')) return 'full'
  if (vals.includes('busy')) return 'busy'
  if (vals.includes('open')) return 'open'
  return 'unknown'
}

/** Matches `availability_reports` — adjust in Supabase if your columns differ. */
export type AvailabilityReportRow = {
  court_id: string
  court_number: number
  status: ReportableStatus
  reporter_lat: number
  reporter_lng: number
}

export async function insertAvailabilityReport(row: AvailabilityReportRow): Promise<{ error: Error | null }> {
  const expiresAt = new Date(Date.now() + REPORT_TTL_MS).toISOString()
  const { data, error } = await supabase
    .from('availability_reports')
    .insert({
      court_id: row.court_id,
      court_number: row.court_number,
      status: row.status,
      reporter_lat: row.reporter_lat,
      reporter_lng: row.reporter_lng,
      expires_at: expiresAt,
    })
    .select('id')
    .maybeSingle()

  if (error) return { error: new Error(error.message) }
  if (!data) return { error: new Error('Report was not saved (no row returned). Check RLS policies on availability_reports.') }
  return { error: null }
}

/** Latest status per numbered court (most recent `created_at` wins). */
export async function fetchLatestAvailabilityByCourt(
  courtId: string
): Promise<LatestAvailabilityByCourtResult> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('availability_reports')
    .select('court_number, status, created_at')
    .eq('court_id', courtId)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(400)

  if (error) {
    if (__DEV__) console.warn('[availability] fetchLatestAvailabilityByCourt', courtId, error.message)
    return { ok: false }
  }
  if (!data) return { ok: true, byCourt: new Map() }

  const latest = new Map<number, ReportableStatus>()
  for (const raw of data) {
    const row = raw as { court_number?: number; status?: string }
    const n = typeof row.court_number === 'number' ? row.court_number : Number(row.court_number)
    if (!Number.isFinite(n) || n < 1 || latest.has(n)) continue
    const s = row.status
    if (s === 'open' || s === 'busy' || s === 'full') latest.set(n, s)
  }
  return { ok: true, byCourt: latest }
}

/**
 * Latest community-reported status per venue for map pins (one query).
 * For each court_id, takes the newest row per court_number, then aggregates across numbers.
 */
const COURT_ID_IN_CHUNK = 80

export async function fetchLatestAvailabilityVenueStatusByCourtIds(
  courtIds: string[]
): Promise<Map<string, CourtStatus>> {
  const out = new Map<string, CourtStatus>()
  if (courtIds.length === 0) return out

  const byVenue = new Map<string, Map<number, ReportableStatus>>()

  for (let i = 0; i < courtIds.length; i += COURT_ID_IN_CHUNK) {
    const chunk = courtIds.slice(i, i + COURT_ID_IN_CHUNK)
    const nowIso = new Date().toISOString()
    const { data, error } = await supabase
      .from('availability_reports')
      .select('court_id, court_number, status, created_at')
      .in('court_id', chunk)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(2000)

    if (error) {
      if (__DEV__) console.warn('[availability] fetchLatestAvailabilityVenueStatusByCourtIds chunk', error.message)
      continue
    }
    if (!data) continue

    for (const raw of data) {
      const row = raw as { court_id?: string; court_number?: number; status?: string }
      const cid = row.court_id != null ? String(row.court_id).trim() : ''
      const n = typeof row.court_number === 'number' ? row.court_number : Number(row.court_number)
      if (!cid || !Number.isFinite(n) || n < 1) continue
      const s = row.status
      if (s !== 'open' && s !== 'busy' && s !== 'full') continue
      if (!byVenue.has(cid)) byVenue.set(cid, new Map())
      const m = byVenue.get(cid)!
      if (!m.has(n)) m.set(n, s)
    }
  }

  for (const [cid, perNum] of byVenue) {
    const agg = aggregateVenueLiveStatus(perNum)
    if (agg !== 'unknown') out.set(cid, agg)
  }
  return out
}
