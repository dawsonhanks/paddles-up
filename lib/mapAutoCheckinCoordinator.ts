/** Map tab silent auto check-in/session state shared with court detail (manual checkout). */

import { distanceKm, isWithinReportingRadius, REPORTING_RADIUS_KM } from '@/lib/geo'

let suppressManualCheckoutCourtIdUntilExitGeofence: string | null = null
/** Prevents repeating silent upsert while still inside geofence for this court visit. */
let silentVisitCourtId: string | null = null
/** Court row we silently delete once user exits 150m radius. */
let silentManagedCourtId: string | null = null

const listeners = new Set<(detail: { type: string; courtId?: string }) => void>()

export function subscribeMapAutoCheckin(listener: (detail: { type: string; courtId?: string }) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(detail: { type: string; courtId?: string }) {
  for (const l of listeners) l(detail)
}

export function GEO_RADIUS_CHECKIN_KM(): number {
  return REPORTING_RADIUS_KM
}

export function getSilentManagedCourtId(): string | null {
  return silentManagedCourtId
}

/** Call from court detail when user manually checks out. */
export function notifyManualCheckoutFromCourtDetail(courtId: string) {
  suppressManualCheckoutCourtIdUntilExitGeofence = courtId
  if (silentVisitCourtId === courtId) silentVisitCourtId = null
  if (silentManagedCourtId === courtId) silentManagedCourtId = null
  emit({ type: 'manual_checkout', courtId })
}

export function silentAutoCheckInCommitted(courtId: string) {
  silentManagedCourtId = courtId
  silentVisitCourtId = courtId
}

export function shouldSkipSilentUpsert(nearestCourtId: string): boolean {
  return (
    suppressManualCheckoutCourtIdUntilExitGeofence === nearestCourtId || silentVisitCourtId === nearestCourtId
  )
}

type CourtPresenceRow = { id: string; latitude: number; longitude: number }

/**
 * Manual checkout clears `silentManagedCourtId`; we still need to drop suppression once the player
 * leaves that court's geofence so a future arrival can silently check in again.
 */
export function clearManualCheckoutSuppressIfOutsideGeofence(
  lat: number,
  lon: number,
  courts: CourtPresenceRow[],
): void {
  const id = suppressManualCheckoutCourtIdUntilExitGeofence
  if (id == null) return
  const row = courts.find((c) => c.id === id)
  if (row == null) return
  if (!isWithinReportingRadius(distanceKm(lat, lon, row.latitude, row.longitude))) {
    suppressManualCheckoutCourtIdUntilExitGeofence = null
  }
}

/** After silent DB upsert exits geofence, allow a future visit cycle. */
function clearSilentVisitLocksForCourt(courtId: string) {
  if (silentVisitCourtId === courtId) silentVisitCourtId = null
  if (silentManagedCourtId === courtId) silentManagedCourtId = null
  if (suppressManualCheckoutCourtIdUntilExitGeofence === courtId) {
    suppressManualCheckoutCourtIdUntilExitGeofence = null
  }
}

/** Silently exited geofence of our managed court. */
export function notifySilentCheckoutCompleted(courtId: string) {
  clearSilentVisitLocksForCourt(courtId)
  emit({ type: 'silent_exit', courtId })
}

/** User tapped “Check out” on map banner — same bookkeeping as exiting geofence. */
export function notifyBannerSilentCheckoutInitiated(courtId: string) {
  clearSilentVisitLocksForCourt(courtId)
  emit({ type: 'banner_checkout', courtId })
}
