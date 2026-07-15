import { courtsAvailableToPinStatus } from '@/lib/availability'
import { type CourtStatus } from '@/lib/courts'
import { supabase } from '@/supabase'
import {
  summarizeVenueZones,
  venueSummaryToCourtStatus,
  type VenueZoneSummary,
} from '@/lib/zones'

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

/** Parse a Realtime `payload.new` / `payload.old` row into a CourtSensorRow. */
export function courtSensorFromRealtimePayload(raw: unknown): CourtSensorRow | null {
  if (raw == null || typeof raw !== 'object') return null
  return rowFromRecord(raw as Record<string, unknown>)
}

/**
 * Apply a Realtime INSERT/UPDATE/DELETE for court_sensors into a local list.
 * Returns the next list (same reference if unchanged).
 */
export function applyCourtSensorRealtimeChange(
  prev: CourtSensorRow[],
  eventType: string,
  nextRow: CourtSensorRow | null,
  oldId: string | null,
): CourtSensorRow[] {
  if (eventType === 'DELETE') {
    if (!oldId) return prev
    const filtered = prev.filter((s) => s.id !== oldId)
    return filtered.length === prev.length ? prev : filtered
  }
  if (!nextRow) return prev
  const idx = prev.findIndex((s) => s.id === nextRow.id)
  if (idx < 0) return [...prev, nextRow]
  const existing = prev[idx]
  if (
    existing.is_active === nextRow.is_active &&
    existing.last_synced_at === nextRow.last_synced_at &&
    existing.last_event_at === nextRow.last_event_at &&
    existing.zone_id === nextRow.zone_id
  ) {
    return prev
  }
  const out = prev.slice()
  out[idx] = nextRow
  return out
}

export function courtSensorsByZone(sensors: CourtSensorRow[]): Map<string, CourtSensorRow> {
  const out = new Map<string, CourtSensorRow>()
  for (const sensor of sensors) {
    if (sensor.zone_id) out.set(sensor.zone_id, sensor)
  }
  return out
}

/**
 * Facility-level status from zones (sensor + reports), same three-state rollup as the map pin.
 * Falls back when this venue has no zone rows / no sensors yet.
 */
export function resolveFacilityCourtStatus(params: {
  sensors: CourtSensorRow[]
  zoneReportsByZone: ReadonlyMap<string, { status: 'open' | 'busy' }>
  courtZones: ReadonlyArray<{ id: string }>
  fallbackStatus: CourtStatus
}): CourtStatus {
  const { sensors, zoneReportsByZone, courtZones, fallbackStatus } = params
  if (courtZones.length === 0) return fallbackStatus

  const sensorZones = courtSensorsByZone(sensors)
  const summary = summarizeVenueZones(courtZones, sensorZones, zoneReportsByZone)
  return venueSummaryToCourtStatus(summary)
}

/** Map/list pin color from open-court count (crowdsourced fallback only). */
export function resolveCourtPinStatus(
  openCount: number | null | undefined,
  totalCourts: number,
): CourtStatus {
  if (openCount == null || !Number.isFinite(openCount)) return 'unknown'
  const total = Math.max(1, totalCourts)
  const clamped = Math.min(Math.max(0, Math.floor(openCount)), total)
  return courtsAvailableToPinStatus(clamped, total)
}

/**
 * Prefer zone-derived three-state summary; else crowdsourced availability_reports; else unknown.
 */
export function resolveVenuePinStatus(params: {
  venueOpen: VenueZoneSummary | undefined
  reportedAvail: number | undefined
  courtCount: number
}): CourtStatus {
  const { venueOpen, reportedAvail, courtCount } = params
  if (venueOpen != null && venueOpen.total > 0) {
    return venueSummaryToCourtStatus(venueOpen)
  }
  if (reportedAvail !== undefined) {
    return resolveCourtPinStatus(reportedAvail, Math.max(1, courtCount))
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
