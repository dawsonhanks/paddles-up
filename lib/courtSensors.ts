import { courtsAvailableToPinStatus } from '@/lib/availability'
import { type CourtStatus } from '@/lib/courts'
import { supabase } from '@/supabase'

export type CourtSensorRow = {
  id: string
  court_id: string
  zone_id: string | null
  is_active: boolean
  last_synced_at: string | null
  last_event_at: string | null
}

export type CourtSensorSummary = {
  hasSensors: boolean
  anyActive: boolean
}

const COURT_ID_IN_CHUNK = 80

function rowFromRecord(raw: Record<string, unknown>): CourtSensorRow | null {
  const courtId = raw.court_id != null ? String(raw.court_id).trim() : ''
  const id = raw.id != null ? String(raw.id).trim() : ''
  if (!courtId || !id) return null
  return {
    id,
    court_id: courtId,
    zone_id: raw.zone_id != null ? String(raw.zone_id).trim() : null,
    is_active: raw.is_active === true,
    last_synced_at: raw.last_synced_at != null ? String(raw.last_synced_at) : null,
    last_event_at: raw.last_event_at != null ? String(raw.last_event_at) : null,
  }
}

export function courtSensorsByZone(sensors: CourtSensorRow[]): Map<string, CourtSensorRow> {
  const out = new Map<string, CourtSensorRow>()
  for (const sensor of sensors) {
    if (sensor.zone_id) out.set(sensor.zone_id, sensor)
  }
  return out
}

/**
 * Facility-level pill when sensors exist: busy if any sensor-linked zone is active
 * OR any non-sensor zone has a recent crowdsourced "busy" report; otherwise open.
 */
export function resolveFacilityCourtStatus(params: {
  sensors: CourtSensorRow[]
  zoneReportsByZone: ReadonlyMap<string, { status: 'open' | 'busy' }>
  courtZones: ReadonlyArray<{ id: string }>
  fallbackStatus: CourtStatus
}): CourtStatus {
  const { sensors, zoneReportsByZone, courtZones, fallbackStatus } = params
  if (sensors.length === 0) return fallbackStatus

  const sensorZones = courtSensorsByZone(sensors)

  if (sensors.some((s) => s.is_active)) return 'busy'

  for (const zone of courtZones) {
    if (sensorZones.has(zone.id)) continue
    if (zoneReportsByZone.get(zone.id)?.status === 'busy') return 'busy'
  }

  return 'open'
}

/** Map/list pin color: active sensor wins; otherwise crowdsourced availability when present. */
export function resolveCourtPinStatus(
  summary: CourtSensorSummary | undefined,
  reportedAvail: number | undefined,
  totalCourts: number,
): CourtStatus {
  if (summary?.hasSensors) {
    if (summary.anyActive) return 'busy'
    if (reportedAvail !== undefined) {
      const total = Math.max(1, totalCourts)
      const clamped = Math.min(Math.max(0, reportedAvail), total)
      return courtsAvailableToPinStatus(clamped, total)
    }
    return 'open'
  }
  if (reportedAvail !== undefined) {
    const total = Math.max(1, totalCourts)
    const clamped = Math.min(Math.max(0, reportedAvail), total)
    return courtsAvailableToPinStatus(clamped, total)
  }
  return 'unknown'
}

export async function fetchCourtSensorsForCourt(courtId: string): Promise<CourtSensorRow[]> {
  const id = courtId.trim()
  if (!id) return []

  const { data, error } = await supabase
    .from('court_sensors')
    .select('id, court_id, zone_id, is_active, last_synced_at, last_event_at')
    .eq('court_id', id)

  if (error) {
    if (__DEV__) console.warn('[courtSensors] fetchCourtSensorsForCourt', error.message)
    return []
  }

  const out: CourtSensorRow[] = []
  for (const raw of data ?? []) {
    const row = rowFromRecord(raw as Record<string, unknown>)
    if (row) out.push(row)
  }
  return out
}

export async function fetchSensorSummaryByCourtIds(
  courtIds: string[],
): Promise<Map<string, CourtSensorSummary>> {
  const out = new Map<string, CourtSensorSummary>()
  if (courtIds.length === 0) return out

  for (let i = 0; i < courtIds.length; i += COURT_ID_IN_CHUNK) {
    const chunk = courtIds.slice(i, i + COURT_ID_IN_CHUNK)
    const { data, error } = await supabase
      .from('court_sensors')
      .select('court_id, is_active')
      .in('court_id', chunk)

    if (error) {
      if (__DEV__) console.warn('[courtSensors] fetchSensorSummaryByCourtIds', error.message)
      continue
    }

    for (const raw of data ?? []) {
      const row = raw as { court_id?: string; is_active?: boolean }
      const courtId = row.court_id != null ? String(row.court_id).trim() : ''
      if (!courtId) continue
      const prev = out.get(courtId) ?? { hasSensors: false, anyActive: false }
      out.set(courtId, {
        hasSensors: true,
        anyActive: prev.anyActive || row.is_active === true,
      })
    }
  }

  return out
}
