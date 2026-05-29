import type { Court } from '@/lib/courts'

export type MapRegion = {
  latitude: number
  longitude: number
  latitudeDelta: number
  longitudeDelta: number
}

export function mapRegionQueryBounds(region: MapRegion): {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
} {
  const halfLat = region.latitudeDelta / 2
  const halfLon = region.longitudeDelta / 2
  return {
    minLat: region.latitude - halfLat,
    maxLat: region.latitude + halfLat,
    minLon: region.longitude - halfLon,
    maxLon: region.longitude + halfLon,
  }
}

/** Cache key for a visible viewport (coarse buckets so small pans do not refetch). */
export function viewportCacheKey(region: MapRegion): string {
  const { minLat, maxLat, minLon, maxLon } = mapRegionQueryBounds(region)
  const bucket = (value: number, step: number) => Math.round(value / step) * step
  const latStep = Math.max(0.025, region.latitudeDelta / 3)
  const lonStep = Math.max(0.025, region.longitudeDelta / 3)
  return `vp:${bucket(minLat, latStep)}:${bucket(minLon, lonStep)}:${bucket(maxLat, latStep)}:${bucket(maxLon, lonStep)}`
}

export function courtsInMapRegion(courts: Court[], region: MapRegion): Court[] {
  const { minLat, maxLat, minLon, maxLon } = mapRegionQueryBounds(region)
  return courts.filter(
    (c) =>
      c.latitude >= minLat &&
      c.latitude <= maxLat &&
      c.longitude >= minLon &&
      c.longitude <= maxLon,
  )
}

export function mergeCourtIdSet(prev: Set<string>, ids: Iterable<string>): Set<string> {
  let changed = false
  const next = new Set(prev)
  for (const id of ids) {
    if (!next.has(id)) {
      next.add(id)
      changed = true
    }
  }
  return changed ? next : prev
}
