import { supabase } from '@/supabase'

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

const ZONE_REPORT_TTL_MS = 30 * 60 * 1000

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
