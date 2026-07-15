import { supabase } from '@/supabase'
import { type CourtStatus } from '@/lib/courts'

export type CourtZoneRow = {
  id: string
  court_id: string
  zone_name: string
  display_order: number
}

export type ZoneLatestReport = {
  status: 'open' | 'busy'
  reported_at: string
}

/** Per-zone: sensor wins; else live report; else unknown (no data ≠ open). */
export type ZoneStatus = 'open' | 'busy' | 'unknown'

/** Venue rollup for map pin + list badge (same rules as court-detail rows). */
export type VenueZoneSummary = {
  open: number
  busy: number
  /** Zones with neither sensor nor live report. */
  unknown: number
  total: number
}

/** @deprecated Prefer VenueZoneSummary — kept as alias for open-count call sites. */
export type VenueOpenCount = VenueZoneSummary

const ZONE_REPORT_TTL_MS = 30 * 60 * 1000
const COURT_ID_IN_CHUNK = 80

/**
 * Same Open/Busy/Unknown rule as court-detail zone rows:
 * sensor wins when present; otherwise latest zone report; no data → unknown.
 */
export function resolveZoneStatus(
  sensor: { is_active: boolean } | null | undefined,
  report: { status: 'open' | 'busy' } | null | undefined,
): ZoneStatus {
  if (sensor != null) return sensor.is_active ? 'busy' : 'open'
  if (report?.status === 'busy') return 'busy'
  if (report?.status === 'open') return 'open'
  return 'unknown'
}

export function isZoneCurrentlyOpen(
  sensor: { is_active: boolean } | null | undefined,
  report: { status: 'open' | 'busy' } | null | undefined,
): boolean {
  return resolveZoneStatus(sensor, report) === 'open'
}

export function summarizeVenueZones(
  zones: ReadonlyArray<{ id: string }>,
  sensorsByZone: ReadonlyMap<string, { is_active: boolean }>,
  reportsByZone: ReadonlyMap<string, { status: 'open' | 'busy' }>,
): VenueZoneSummary {
  let open = 0
  let busy = 0
  let unknown = 0
  for (const z of zones) {
    const st = resolveZoneStatus(sensorsByZone.get(z.id), reportsByZone.get(z.id))
    if (st === 'busy') busy += 1
    else if (st === 'open') open += 1
    else unknown += 1
  }
  return { open, busy, unknown, total: zones.length }
}

/** Open-count helper used by detail headline. */
export function countOpenZones(
  zones: ReadonlyArray<{ id: string }>,
  sensorsByZone: ReadonlyMap<string, { is_active: boolean }>,
  reportsByZone: ReadonlyMap<string, { status: 'open' | 'busy' }>,
): VenueZoneSummary {
  return summarizeVenueZones(zones, sensorsByZone, reportsByZone)
}

/**
 * Facility pin / badge color from zone rollup (same function for map + list):
 * - green/open: every zone confirmed open
 * - red/full: every zone confirmed busy
 * - orange/busy: any confirmed-busy mix that is not all-busy (open+busy, busy+unknown, …)
 * - grey/unknown: no confirmed busy, but unknowns present (all unknown, or open+unknown)
 */
export function venueSummaryToCourtStatus(summary: VenueZoneSummary): CourtStatus {
  const { busy, unknown, total } = summary
  if (total <= 0) return 'unknown'
  if (busy === 0 && unknown === 0) return 'open'
  if (busy === total) return 'full'
  if (busy === 0) return 'unknown'
  return 'busy'
}

/** List-badge / headline copy aligned with venueSummaryToCourtStatus. */
export function venueSummaryBadgeLabel(summary: VenueZoneSummary): string {
  if (summary.total <= 0) return 'No report'
  const st = venueSummaryToCourtStatus(summary)
  if (st === 'unknown') {
    if (summary.unknown === summary.total) return 'No data'
    return 'Partial'
  }
  return `${summary.open} of ${summary.total} open`
}

/** Detail-screen headline — same rollup rules as the list badge. */
export function venueSummaryHeadline(summary: VenueZoneSummary): string {
  if (summary.total <= 0) return 'No report'
  const st = venueSummaryToCourtStatus(summary)
  if (st === 'unknown') {
    if (summary.unknown === summary.total) return 'No live court data'
    return `${summary.open} of ${summary.total} courts open · partial`
  }
  return `${summary.open} of ${summary.total} courts open`
}

export async function fetchZonesForCourt(courtId: string): Promise<CourtZoneRow[]> {
  const { data, error } = await supabase
    .from('zones')
    .select('id, court_id, zone_name, display_order')
    .eq('court_id', courtId)
    .order('display_order', { ascending: true })

  if (error) {
    if (__DEV__) console.warn('[zones] fetchZonesForCourt', courtId, error.message)
    return []
  }
  if (!data) return []
  return data as CourtZoneRow[]
}

/** Most recent non-expired report per zone (by `reported_at`). */
export async function fetchLatestZoneReportsForCourt(
  courtId: string
): Promise<Map<string, ZoneLatestReport>> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('zone_reports')
    .select('zone_id, status, reported_at')
    .eq('court_id', courtId)
    .gt('expires_at', nowIso)
    .order('reported_at', { ascending: false })
    .limit(500)

  const latest = new Map<string, ZoneLatestReport>()
  if (error || !data) return latest

  for (const raw of data) {
    const row = raw as { zone_id?: string; status?: string; reported_at?: string }
    const zid = row.zone_id != null ? String(row.zone_id) : ''
    if (!zid || latest.has(zid)) continue
    const st = row.status === 'open' || row.status === 'busy' ? row.status : null
    if (!st || !row.reported_at) continue
    latest.set(zid, { status: st, reported_at: row.reported_at })
  }
  return latest
}

export async function insertZoneReport(input: {
  courtId: string
  zoneId: string
  userId: string
  status: 'open' | 'busy'
}): Promise<{ error: Error | null }> {
  const now = Date.now()
  const reportedAt = new Date(now).toISOString()
  const expiresAt = new Date(now + ZONE_REPORT_TTL_MS).toISOString()
  const { error } = await supabase.from('zone_reports').insert({
    court_id: input.courtId,
    zone_id: input.zoneId,
    user_id: input.userId,
    status: input.status,
    reported_at: reportedAt,
    expires_at: expiresAt,
  })
  if (error) return { error: new Error(error.message) }
  return { error: null }
}

/**
 * Batch zone summaries for map/list: sensors + live zone_reports per zone,
 * matching court-detail open / busy / unknown (unreported → unknown).
 */
export async function fetchVenueOpenCountsByCourtIds(
  courtIds: string[],
): Promise<Map<string, VenueZoneSummary>> {
  const out = new Map<string, VenueZoneSummary>()
  if (courtIds.length === 0) return out

  const zonesByCourt = new Map<string, { id: string }[]>()
  const sensorByZone = new Map<string, { is_active: boolean }>()
  const reportByZone = new Map<string, { status: 'open' | 'busy' }>()

  for (let i = 0; i < courtIds.length; i += COURT_ID_IN_CHUNK) {
    const chunk = courtIds.slice(i, i + COURT_ID_IN_CHUNK)
    const nowIso = new Date().toISOString()

    const [zonesRes, sensorsRes, reportsRes] = await Promise.all([
      supabase.from('zones').select('id, court_id').in('court_id', chunk),
      supabase.from('court_sensors').select('zone_id, is_active').in('court_id', chunk),
      supabase
        .from('zone_reports')
        .select('zone_id, status, reported_at')
        .in('court_id', chunk)
        .gt('expires_at', nowIso)
        .order('reported_at', { ascending: false })
        .limit(2000),
    ])

    if (zonesRes.error) {
      if (__DEV__) console.warn('[zones] fetchVenueOpenCounts zones', zonesRes.error.message)
    } else {
      for (const raw of zonesRes.data ?? []) {
        const row = raw as { id?: string; court_id?: string }
        const zid = row.id != null ? String(row.id).trim() : ''
        const cid = row.court_id != null ? String(row.court_id).trim() : ''
        if (!zid || !cid) continue
        const list = zonesByCourt.get(cid) ?? []
        list.push({ id: zid })
        zonesByCourt.set(cid, list)
      }
    }

    if (sensorsRes.error) {
      if (__DEV__) console.warn('[zones] fetchVenueOpenCounts sensors', sensorsRes.error.message)
    } else {
      for (const raw of sensorsRes.data ?? []) {
        const row = raw as { zone_id?: string | null; is_active?: boolean }
        const zid = row.zone_id != null ? String(row.zone_id).trim() : ''
        if (!zid) continue
        sensorByZone.set(zid, { is_active: row.is_active === true })
      }
    }

    if (reportsRes.error) {
      if (__DEV__) console.warn('[zones] fetchVenueOpenCounts reports', reportsRes.error.message)
    } else {
      for (const raw of reportsRes.data ?? []) {
        const row = raw as { zone_id?: string; status?: string }
        const zid = row.zone_id != null ? String(row.zone_id).trim() : ''
        if (!zid || reportByZone.has(zid)) continue
        if (row.status === 'open' || row.status === 'busy') {
          reportByZone.set(zid, { status: row.status })
        }
      }
    }
  }

  for (const cid of courtIds) {
    const key = String(cid).trim()
    const zones = zonesByCourt.get(key)
    if (!zones || zones.length === 0) continue
    out.set(key, summarizeVenueZones(zones, sensorByZone, reportByZone))
  }

  return out
}
