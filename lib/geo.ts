/** Great-circle distance in kilometers (WGS84 haversine). */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371
  const dLat = deg2rad(lat2 - lat1)
  const dLon = deg2rad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

function deg2rad(d: number) {
  return (d * Math.PI) / 180
}

export function formatDistanceMiles(km: number): string {
  const mi = km * 0.621371
  if (mi < 0.05) return 'Nearby'
  if (mi < 10) return `${mi.toFixed(1)} mi`
  return `${Math.round(mi)} mi`
}

/** Human-readable distance for detail rows (feet when close). */
export function formatDistanceDetail(km: number): string {
  const mi = km * 0.621371
  const ft = mi * 5280
  if (ft < 500) return `${Math.round(ft)} ft away`
  if (mi < 10) return `${mi.toFixed(1)} mi away`
  return `${Math.round(mi)} mi away`
}

/** Max distance (km) at which availability reports are accepted — 150 m. */
export const REPORTING_RADIUS_KM = 0.15

export function isWithinReportingRadius(distanceKm: number): boolean {
  return distanceKm <= REPORTING_RADIUS_KM
}
