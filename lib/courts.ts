export type CourtStatus = 'open' | 'busy' | 'full' | 'unknown'

export type Court = {
  id: string
  name: string
  latitude: number
  longitude: number
  status: CourtStatus
  /** Active check-ins at venue when fetched for map/list. */
  liveCheckins?: number
  /** Latest unexpired venue-wide availability report, when present. */
  liveCourtsAvailable?: number | null
  /** Number of courts at the venue (for lists / pins). */
  courtCount: number
  /** Human-readable venue type, e.g. Indoor / Outdoor. */
  indoorOutdoor: string | null
}

export type CourtAmenities = {
  parking: boolean
  restrooms: boolean
  lighting: boolean
}

export type CourtDetail = Court & {
  address: string | null
  surfaceType: string | null
  fee: string | null
  hours: string | null
  rating: number | null
  amenities: CourtAmenities
}

export const STATUS_PIN_COLOR: Record<CourtStatus, string> = {
  open: '#22c55e',
  busy: '#f59e0b',
  full: '#ef4444',
  unknown: '#9ca3af',
}

export function parseCourtStatus(value: string | null | undefined): CourtStatus {
  const s = (value ?? '').toLowerCase().trim()
  if (s === 'open' || s === 'busy' || s === 'full') return s
  return 'unknown'
}

/** Coerce Postgres/PostgREST numeric or string values to a finite number. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function pickString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const n = toNumber(row[k])
    if (n != null) return n
  }
  return null
}

type Pointish = {
  type?: string
  coordinates?: unknown
}

function lonLatFromGeoJsonPoint(obj: unknown): { lat: number; lon: number } | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Pointish & { geometry?: unknown }
  const t = String(o.type).toLowerCase()
  if (t === 'feature' && o.geometry) return lonLatFromGeoJsonPoint(o.geometry)
  if (t !== 'point' || !Array.isArray(o.coordinates)) return null
  const c = o.coordinates
  const lon = toNumber(c[0])
  const lat = toNumber(c[1])
  if (lat == null || lon == null) return null
  return { lat, lon }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const s = value.trim()
  if (!s.startsWith('{') && !s.startsWith('[')) return value
  try {
    return JSON.parse(s) as unknown
  } catch {
    return value
  }
}

/** GeoJSON / PostGIS-style location on a row, or [lon, lat] array. */
function coordinatesFromRow(row: Record<string, unknown>): { lat: number; lon: number } | null {
  const directLat =
    toNumber(row.latitude) ?? toNumber(row.lat) ?? toNumber(row.y)
  const directLon =
    toNumber(row.longitude) ??
    toNumber(row.lng) ??
    toNumber(row.lon) ??
    toNumber(row.long) ??
    toNumber(row.x)
  if (directLat != null && directLon != null) return { lat: directLat, lon: directLon }

  const nestedKeys = ['location', 'geom', 'geometry', 'geo', 'coordinates', 'point', 'centroid']
  for (const key of nestedKeys) {
    const raw = row[key]
    const v = parseMaybeJson(raw)
    const fromObj = lonLatFromGeoJsonPoint(v)
    if (fromObj) return fromObj
    if (Array.isArray(v) && v.length >= 2) {
      const lon = toNumber(v[0])
      const lat = toNumber(v[1])
      if (lat != null && lon != null) return { lat, lon }
    }
  }

  return null
}

function statusFromRow(row: Record<string, unknown>): CourtStatus {
  const statusRaw =
    typeof row.status === 'string'
      ? row.status
      : typeof row.availability === 'string'
        ? row.availability
        : typeof row.availability_status === 'string'
          ? row.availability_status
          : undefined
  return parseCourtStatus(statusRaw)
}

function indoorOutdoorLabel(row: Record<string, unknown>): string | null {
  const explicit = pickString(row, ['indoor_outdoor', 'venue_type', 'environment', 'setting'])
  if (explicit) {
    const lower = explicit.toLowerCase()
    if (lower.includes('indoor') && lower.includes('outdoor')) return 'Indoor & outdoor'
    if (lower.includes('indoor')) return 'Indoor'
    if (lower.includes('outdoor')) return 'Outdoor'
    return explicit
  }
  if (typeof row.is_indoor === 'boolean') return row.is_indoor ? 'Indoor' : 'Outdoor'
  const indoor = toNumber(row.indoor)
  if (indoor === 1) return 'Indoor'
  if (indoor === 0) return 'Outdoor'
  return null
}

function courtCountFromRow(row: Record<string, unknown>): number {
  const n = pickNumber(row, [
    'court_count',
    'number_of_courts',
    'num_courts',
    'courts_count',
    'courts',
    'total_courts',
  ])
  if (n != null && n >= 1 && n <= 200) return Math.floor(n)
  return 1
}

function ratingFromRow(row: Record<string, unknown>): number | null {
  const r = pickNumber(row, ['rating', 'star_rating', 'stars', 'avg_rating'])
  if (r == null) return null
  const clamped = Math.min(5, Math.max(0, r))
  return clamped
}

function truthyFlag(row: Record<string, unknown>, keys: string[]): boolean {
  for (const k of keys) {
    const v = row[k]
    if (v === true || v === 1) return true
    if (typeof v === 'string') {
      const s = v.toLowerCase().trim()
      if (s === 'yes' || s === 'true' || s === 'y' || s === '1') return true
    }
  }
  return false
}

function amenitiesFromRow(row: Record<string, unknown>): CourtAmenities {
  const out: CourtAmenities = {
    parking: truthyFlag(row, ['has_parking', 'parking', 'parking_available', 'parking_lot']),
    restrooms: truthyFlag(row, ['has_restrooms', 'restrooms', 'restroom', 'bathrooms', 'bathroom']),
    lighting: truthyFlag(row, ['has_lighting', 'lighting', 'lights', 'lit', 'night_lights', 'night_lighting']),
  }
  const raw = row.amenities
  const parsedList = typeof raw === 'string' ? parseMaybeJson(raw) : raw
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(parsedList) ? parsedList : []
  if (list.length > 0) {
    for (const item of list) {
      const s = String(item).toLowerCase()
      if (s.includes('park')) out.parking = true
      if (s.includes('restroom') || s.includes('bathroom') || s.includes('toilet')) out.restrooms = true
      if (s.includes('light') || s.includes('lit')) out.lighting = true
    }
  }
  return out
}

function parseCourtBase(row: Record<string, unknown>): Court | null {
  const id = String(row.id ?? row.uuid ?? '')
  const name = String(row.name ?? row.title ?? 'Court')
  const pos = coordinatesFromRow(row)
  if (!pos) return null

  return {
    id: id || `${pos.lat},${pos.lon}`,
    name,
    latitude: pos.lat,
    longitude: pos.lon,
    status: statusFromRow(row),
    courtCount: courtCountFromRow(row),
    indoorOutdoor: indoorOutdoorLabel(row),
  }
}

/** Map / list pin row. */
export function courtFromRow(row: Record<string, unknown>): Court | null {
  return parseCourtBase(row)
}

/** Full venue row for the detail screen. */
export function courtDetailFromRow(row: Record<string, unknown>): CourtDetail | null {
  const base = parseCourtBase(row)
  if (!base) return null

  const feeNum = pickNumber(row, ['fee_usd', 'fee_amount', 'price'])
  const feeStr = pickString(row, ['fee', 'cost', 'price_text', 'pricing'])
  const fee =
    feeStr ??
    (feeNum != null ? `$${feeNum % 1 === 0 ? feeNum.toFixed(0) : feeNum.toFixed(2)}` : null)

  return {
    ...base,
    address: pickString(row, ['address', 'full_address', 'street_address', 'formatted_address']),
    surfaceType: pickString(row, ['surface_type', 'surface', 'court_surface']),
    fee,
    hours: pickString(row, ['hours', 'operating_hours', 'open_hours']),
    rating: ratingFromRow(row),
    amenities: amenitiesFromRow(row),
  }
}
