import {
  MapTabGestureRoot,
  MAP_NEARBY_SHEET_COLLAPSED_BASE_PX,
  matchesListFilter,
  NearbyCourtsSheet,
  type CourtWithDistance,
  type ListFilter,
} from '@/components/nearby-courts-sheet'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { courtsAvailableToPinStatus, fetchLatestCourtsAvailableByCourtIds } from '@/lib/availability'
import { fetchActiveCheckinCountsByCourtIds } from '@/lib/checkins'
import { courtFromRow, STATUS_PIN_COLOR, type Court, type CourtStatus } from '@/lib/courts'
import { deleteCourtCheckIn, upsertActiveCourtCheckIn } from '@/lib/courtPresenceCheckin'
import { fetchFavoriteCourtIds } from '@/lib/favorites'
import {
  distanceKm,
  isWithinMapInitialPinRadius,
  isWithinNearbyListRadius,
  isWithinReportingRadius,
} from '@/lib/geo'
import {
  courtsInMapRegion,
  mapRegionQueryBounds,
  mergeCourtIdSet,
  viewportCacheKey,
  type MapRegion,
} from '@/lib/mapRegion'
import {
  clearManualCheckoutSuppressIfOutsideGeofence,
  getSilentManagedCourtId,
  notifyBannerSilentCheckoutInitiated,
  notifySilentCheckoutCompleted,
  silentAutoCheckInCommitted,
  shouldSkipSilentUpsert,
  subscribeMapAutoCheckin,
} from '@/lib/mapAutoCheckinCoordinator'
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect, useIsFocused } from '@react-navigation/native'
import { useNetworkOffline } from '@/contexts/network-status-context'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { openIOSAppSettingsDeepLink } from '@/lib/open-settings'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { Redirect, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { ErrorScreen } from '@/components/error-screen'
import { LocationPurposeModal } from '@/components/location-purpose-modal'
import {
  LOCATION_PURPOSE_DEFERRED_KEY,
  LOCATION_PURPOSE_MODAL_SEEN_KEY,
} from '@/lib/location-permissions'
import { CourtMap } from '../../components/court-map'
import { TOUR_COMPLETED_STORAGE_KEY, useGuidedTour } from '@/components/guided-tour'

import { supabase } from '@/supabase'

const AUTO_NAVIGATE_DELAY_MS = 10000
/** Avoid refetching courts on every GPS tick when user moves within this radius of last fetch center. */
const AREA_RELOAD_THRESHOLD_KM = 0.8
/** Throttle map user marker / distance sort updates while still firing silent check-in on each GPS callback. */
const USER_POSITION_UI_THROTTLE_KM = 0.05
const AREA_HALF_DELTA_DEG = 0.5
/** User panned away from the initial map center — enables debounced area search. */
const MANUAL_PAN_THRESHOLD_KM = 1.6
const TOUR_START_DELAY_MS = 1000
const CACHED_COURTS_KEY = 'cached_courts'
const LIVE_REFRESH_POLL_MS = 60000
const LIVE_REFRESH_DEBOUNCE_MS = 500
/** After the user stops panning, reveal additional map pins in the viewport. */
const MAP_PIN_REVEAL_DEBOUNCE_MS = 2500
/** After the user stops panning, refresh the nearby list for the map center. */
const MAP_LIST_UPDATE_DEBOUNCE_MS = 5000

/** Default map zoom in `court-map.native` — used for initial pin size. */
const MAP_NEIGHBORHOOD_LONGITUDE_DELTA = 0.06
const MARKER_PIN_SIZE_MIN = 20
/** Fully zoomed in — larger than the original 16px pin, but not oversized. */
const MARKER_PIN_SIZE_MAX = 28
/** longitudeDelta at max zoom (pins largest). */
const MARKER_ZOOM_DELTA_IN = 0.02
/** longitudeDelta at min zoom (pins smallest). */
const MARKER_ZOOM_DELTA_OUT = 0.45

function courtStatusLabel(status: CourtStatus): string {
  switch (status) {
    case 'open':
      return 'Open'
    case 'busy':
      return 'Busy'
    case 'full':
      return 'Full'
    default:
      return 'Unknown'
  }
}

function markerPinSizeFromLongitudeDelta(longitudeDelta: number): number {
  const span = MARKER_ZOOM_DELTA_OUT - MARKER_ZOOM_DELTA_IN
  const t = (longitudeDelta - MARKER_ZOOM_DELTA_IN) / span
  const clamped = Math.min(1, Math.max(0, t))
  return MARKER_PIN_SIZE_MAX - clamped * (MARKER_PIN_SIZE_MAX - MARKER_PIN_SIZE_MIN)
}

/** Utah County — map & court list fallback when GPS is unavailable. */
const FALLBACK_MAP_LAT = 40.3916
const FALLBACK_MAP_LON = -111.8533

export default function MapScreen() {
  const insets = useSafeAreaInsets()
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const router = useRouter()
  const isMapScreenFocused = useIsFocused()
  const { startTour } = useGuidedTour()

  const [onboarded, setOnboarded] = useState<boolean | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [showLocationPurposeModal, setShowLocationPurposeModal] = useState(false)
  const [locationLoading, setLocationLoading] = useState(true)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [locationRetryKey, setLocationRetryKey] = useState(0)
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLon, setUserLon] = useState<number | null>(null)

  const [courtsLoading, setCourtsLoading] = useState(true)
  const [areaLoading, setAreaLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [courtsError, setCourtsError] = useState<string | null>(null)
  const [courts, setCourts] = useState<Court[]>([])
  const isOffline = useNetworkOffline()
  const [cachedCourtsAt, setCachedCourtsAt] = useState<string | null>(null)
  const [listAreaLoading, setListAreaLoading] = useState(false)
  const [listDistanceMode, setListDistanceMode] = useState<'gps' | 'mapCenter'>('gps')
  const [listMapCenter, setListMapCenter] = useState<{ lat: number; lon: number } | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedCourt, setSelectedCourt] = useState<Court | null>(null)
  const [listFilter, setListFilter] = useState<ListFilter>('all')
  const [favoriteCourtIds, setFavoriteCourtIds] = useState<string[]>([])
  const [favoritesLoaded, setFavoritesLoaded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false)
  const [silentCheckInBanner, setSilentCheckInBanner] = useState<{ id: string; name: string } | null>(null)
  const [markerPinSize, setMarkerPinSize] = useState(() =>
    markerPinSizeFromLongitudeDelta(MAP_NEIGHBORHOOD_LONGITUDE_DELTA),
  )
  const searchInputRef = useRef<TextInput>(null)
  const bottomSheetRef = useRef<BottomSheet>(null)
  const searchSlideY = useRef(new Animated.Value(-120)).current

  const autoNavigated = useRef(false)
  const tourStarted = useRef(false)
  /** After first successful courts+live merge; tab refocus uses quiet background refetch. */
  const courtsHydratedRef = useRef(false)
  const loadedAreaKeysRef = useRef<Set<string>>(new Set())
  const mergedCourtsByIdRef = useRef<Map<string, Court>>(new Map())
  const initialAreaCenterRef = useRef<{ lat: number; lon: number } | null>(null)
  const lastFetchedCenterRef = useRef<{ lat: number; lon: number } | null>(null)

  const courtsRef = useRef<Court[]>([])
  useEffect(() => {
    courtsRef.current = courts
  }, [courts])

  const isMapFocusedRef = useRef(isMapScreenFocused)
  useEffect(() => {
    isMapFocusedRef.current = isMapScreenFocused
  }, [isMapScreenFocused])

  const isOfflineRef = useRef(isOffline)
  useEffect(() => {
    isOfflineRef.current = isOffline
  }, [isOffline])

  const silentUpsertBusyRef = useRef(false)
  const liveRefreshBusyRef = useRef(false)
  const liveRefreshQueuedRef = useRef(false)
  const liveRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mapPinRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mapListUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const regionChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mapRegionRef = useRef<MapRegion | null>(null)
  const mapPinExpandActiveRef = useRef(false)
  const userHasManuallyPannedRef = useRef(false)
  const mapRevealedIdsRef = useRef<Set<string>>(new Set())
  const lastThinUserPosRef = useRef<{ lat: number; lon: number } | null>(null)
  const [mapRevealedIds, setMapRevealedIds] = useState<Set<string>>(() => new Set())
  const [mapFadeInCourtIds, setMapFadeInCourtIds] = useState<Set<string>>(() => new Set())
  /** Latest known user position without re-subscribing the location watcher each tick */
  const userPosLatestRef = useRef<{ lat: number; lon: number } | null>(null)

  const offlineCacheAgeLabel = useMemo(() => {
    if (!cachedCourtsAt) return undefined
    const ms = Date.now() - new Date(cachedCourtsAt).getTime()
    if (!Number.isFinite(ms) || ms < 0) return undefined
    const mins = Math.floor(ms / 60000)
    if (mins < 1) return 'Last updated just now'
    if (mins < 60) return `Last updated ${mins} min ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `Last updated ${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `Last updated ${days}d ago`
  }, [cachedCourtsAt])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const val = await AsyncStorage.getItem('onboarded')
        if (!cancelled) setOnboarded(val === 'true')
      } catch {
        if (!cancelled) setOnboarded(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const openCourtDetail = useCallback(
    (id: string) => {
      setSelectedId(id)
      router.push(`/court/${encodeURIComponent(id)}`)
    },
    [router]
  )

  const courtPreviewSnapPoints = useMemo(() => ['40%', '75%'], [])

  const onMapCourtPinPress = useCallback(
    (id: string) => {
      const court = courts.find((c) => c.id === id) ?? null
      if (!court) return
      setSelectedId(id)
      setSelectedCourt(court)
      bottomSheetRef.current?.expand()
    },
    [courts],
  )

  const areaKeyFor = useCallback((lat: number, lon: number) => {
    const latBucket = Math.round(lat * 2) / 2
    const lonBucket = Math.round(lon * 2) / 2
    return `${latBucket.toFixed(1)}:${lonBucket.toFixed(1)}`
  }, [])

  const onLocationPurposeAllow = useCallback(async () => {
    try {
      await AsyncStorage.multiSet([
        [LOCATION_PURPOSE_MODAL_SEEN_KEY, 'yes'],
        [LOCATION_PURPOSE_DEFERRED_KEY, ''],
      ])
    } catch {
      /* ignore */
    }
    setShowLocationPurposeModal(false)
    setLocationLoading(true)
    setLocationError(null)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== Location.PermissionStatus.GRANTED) {
        setPermissionDenied(status === Location.PermissionStatus.DENIED)
        setUserLat(null)
        setUserLon(null)
        return
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
      const initLat = pos.coords.latitude
      const initLon = pos.coords.longitude
      userPosLatestRef.current = { lat: initLat, lon: initLon }
      setUserLat(initLat)
      setUserLon(initLon)
      setPermissionDenied(false)
    } catch (e) {
      setLocationError(userFriendlyFromUnknown(e))
      setUserLat(null)
      setUserLon(null)
    } finally {
      setLocationLoading(false)
    }
  }, [])

  const onLocationPurposeLater = useCallback(async () => {
    try {
      await AsyncStorage.multiSet([
        [LOCATION_PURPOSE_MODAL_SEEN_KEY, 'yes'],
        [LOCATION_PURPOSE_DEFERRED_KEY, 'yes'],
      ])
    } catch {
      /* ignore */
    }
    setShowLocationPurposeModal(false)
  }, [])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        setLocationLoading(true)
        setLocationError(null)
        setPermissionDenied(false)

        let deferredStored = false
        try {
          deferredStored = (await AsyncStorage.getItem(LOCATION_PURPOSE_DEFERRED_KEY)) === 'yes'
        } catch {
          deferredStored = false
        }
        const perm = await Location.getForegroundPermissionsAsync()
        if (cancelled) return

        if (perm.status === Location.PermissionStatus.GRANTED) {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          })
          if (cancelled) return
          const initLat = pos.coords.latitude
          const initLon = pos.coords.longitude
          userPosLatestRef.current = { lat: initLat, lon: initLon }
          setUserLat(initLat)
          setUserLon(initLon)
          setPermissionDenied(false)
          return
        }

        if (perm.status === Location.PermissionStatus.DENIED) {
          setPermissionDenied(true)
          setUserLat(null)
          setUserLon(null)
          return
        }

        let seen = false
        try {
          seen = (await AsyncStorage.getItem(LOCATION_PURPOSE_MODAL_SEEN_KEY)) === 'yes'
        } catch {
          seen = false
        }
        if (!seen) {
          setShowLocationPurposeModal(true)
          setUserLat(null)
          setUserLon(null)
          return
        }

        if (deferredStored) {
          setUserLat(null)
          setUserLon(null)
          return
        }

        const { status } = await Location.requestForegroundPermissionsAsync()
        if (cancelled) return
        if (status !== Location.PermissionStatus.GRANTED) {
          setPermissionDenied(status === Location.PermissionStatus.DENIED)
          setUserLat(null)
          setUserLon(null)
          return
        }

        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
        if (cancelled) return
        const initLat = pos.coords.latitude
        const initLon = pos.coords.longitude
        userPosLatestRef.current = { lat: initLat, lon: initLon }
        setUserLat(initLat)
        setUserLon(initLon)
        setPermissionDenied(false)
      } catch (e) {
        if (!cancelled) {
          setLocationError(userFriendlyFromUnknown(e))
          setUserLat(null)
          setUserLon(null)
        }
      } finally {
        if (!cancelled) setLocationLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [locationRetryKey])

  const loadCourtsWithLiveStatus = useCallback(async (
    center: { lat: number; lon: number },
    opts?: { background?: boolean; force?: boolean; silent?: boolean; bounds?: MapRegion },
  ) => {
    const background = opts?.background === true
    const force = opts?.force === true
    const silent = opts?.silent === true
    const bounds = opts?.bounds
    const cacheKey = bounds ? viewportCacheKey(bounds) : areaKeyFor(center.lat, center.lon)
    const alreadyLoaded = loadedAreaKeysRef.current.has(cacheKey)

    if (!force && alreadyLoaded) {
      lastFetchedCenterRef.current = center
      return
    }

    if (!background && courts.length === 0) setCourtsLoading(true)
    if ((background || courts.length > 0) && !silent) setAreaLoading(true)
    setCourtsError(null)
    try {
      if (isOffline) {
        const raw = await AsyncStorage.getItem(CACHED_COURTS_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as { courts?: Court[]; cachedAt?: string }
          setCourts(parsed.courts ?? [])
          setCachedCourtsAt(parsed.cachedAt ?? null)
          mergedCourtsByIdRef.current = new Map((parsed.courts ?? []).map((c) => [c.id, c]))
        } else {
          setCourts([])
          setCachedCourtsAt(null)
        }
        return
      }

      const queryBounds = bounds ? mapRegionQueryBounds(bounds) : null
      let query = supabase.from('courts').select('*')
      if (queryBounds) {
        query = query
          .gte('latitude', queryBounds.minLat)
          .lte('latitude', queryBounds.maxLat)
          .gte('longitude', queryBounds.minLon)
          .lte('longitude', queryBounds.maxLon)
      } else {
        query = query
          .gte('latitude', center.lat - AREA_HALF_DELTA_DEG)
          .lte('latitude', center.lat + AREA_HALF_DELTA_DEG)
          .gte('longitude', center.lon - AREA_HALF_DELTA_DEG)
          .lte('longitude', center.lon + AREA_HALF_DELTA_DEG)
      }
      const { data, error } = await query.limit(500)

      if (error) {
        setCourtsError(error.message)
        return
      }

      const parsed = (data ?? [])
        .map((row) => courtFromRow(row as Record<string, unknown>))
        .filter((c): c is Court => c != null)

      const ids = parsed.map((c) => c.id)
      const [countsByCourt, availByCourt] = await Promise.all([
        fetchActiveCheckinCountsByCourtIds(ids),
        fetchLatestCourtsAvailableByCourtIds(ids),
      ])
      const nextAreaCourts = parsed.map((c) => {
        const key = String(c.id).trim()
        const n = countsByCourt.get(key) ?? 0
        const reportedAvail = availByCourt.get(key)
        const total = Math.max(1, c.courtCount)
        let status: CourtStatus = 'unknown'
        let liveCourtsAvailable: number | null = null
        if (reportedAvail !== undefined) {
          liveCourtsAvailable = reportedAvail
          const clamped = Math.min(Math.max(0, reportedAvail), total)
          status = courtsAvailableToPinStatus(clamped, total)
        }
        return {
          ...c,
          liveCheckins: n,
          liveCourtsAvailable,
          status,
        }
      })

      const merged = new Map(mergedCourtsByIdRef.current)
      for (const c of nextAreaCourts) merged.set(c.id, c)
      mergedCourtsByIdRef.current = merged
      setCourts(Array.from(merged.values()))

      loadedAreaKeysRef.current.add(cacheKey)
      lastFetchedCenterRef.current = center

      const cachedAt = new Date().toISOString()
      await AsyncStorage.setItem(
        CACHED_COURTS_KEY,
        JSON.stringify({
          cachedAt,
          courts: Array.from(merged.values()),
        })
      )
      setCachedCourtsAt(cachedAt)
    } catch (e) {
      setCourtsError(userFriendlyFromUnknown(e))
    } finally {
      if (!silent) setAreaLoading(false)
      if (!background) setCourtsLoading(false)
      courtsHydratedRef.current = true
    }
  }, [areaKeyFor, courts.length, isOffline])

  const refreshLiveCourtData = useCallback(async () => {
    if (!isMapFocusedRef.current) return
    if (isOfflineRef.current) return

    if (liveRefreshBusyRef.current) {
      liveRefreshQueuedRef.current = true
      return
    }

    liveRefreshBusyRef.current = true
    try {
      do {
        liveRefreshQueuedRef.current = false
        const center =
          lastFetchedCenterRef.current ??
          userPosLatestRef.current ??
          (userLat != null && userLon != null ? { lat: userLat, lon: userLon } : null)
        if (!center) break

        await loadCourtsWithLiveStatus(center, {
          background: true,
          force: true,
          silent: true,
        })
      } while (liveRefreshQueuedRef.current)
    } finally {
      liveRefreshBusyRef.current = false
    }
  }, [loadCourtsWithLiveStatus, userLat, userLon])

  const scheduleLiveCourtRefresh = useCallback(() => {
    if (liveRefreshDebounceRef.current != null) {
      clearTimeout(liveRefreshDebounceRef.current)
    }
    liveRefreshDebounceRef.current = setTimeout(() => {
      liveRefreshDebounceRef.current = null
      void refreshLiveCourtData()
    }, LIVE_REFRESH_DEBOUNCE_MS)
  }, [refreshLiveCourtData])

  const evaluateSilentPresence = useCallback(async (lat: number, lon: number) => {
    try {
      if (!isMapFocusedRef.current) return
      if (isOfflineRef.current) return

      const list = courtsRef.current

      clearManualCheckoutSuppressIfOutsideGeofence(lat, lon, list)

      const managed = getSilentManagedCourtId()
      if (managed) {
        const row = list.find((c) => c.id === managed)
        if (
          row != null &&
          !isWithinReportingRadius(distanceKm(lat, lon, row.latitude, row.longitude))
        ) {
          const rm = await deleteCourtCheckIn(managed)
          if (rm.ok) notifySilentCheckoutCompleted(managed)
        }
      }

      let nearestId: string | null = null
      let nearestName = ''
      let best = Infinity
      for (const c of list) {
        const dk = distanceKm(lat, lon, c.latitude, c.longitude)
        if (dk < best) {
          best = dk
          nearestId = c.id
          nearestName = c?.name ?? 'Court'
        }
      }
      if (nearestId == null || !isWithinReportingRadius(best)) return
      if (shouldSkipSilentUpsert(nearestId)) return

      if (silentUpsertBusyRef.current) return
      silentUpsertBusyRef.current = true
      try {
        const r = await upsertActiveCourtCheckIn(nearestId)
        if (r.ok) {
          silentAutoCheckInCommitted(nearestId)
          setSilentCheckInBanner({ id: nearestId, name: nearestName })
        }
      } finally {
        silentUpsertBusyRef.current = false
      }
    } catch (e) {
      if (__DEV__) console.warn('[Map] evaluateSilentPresence', e)
    }
  }, [])

  useEffect(() => {
    return subscribeMapAutoCheckin((evt) => {
      setSilentCheckInBanner((prev) => {
        if (!prev) return prev
        if (
          (evt.type === 'manual_checkout' ||
            evt.type === 'silent_exit' ||
            evt.type === 'banner_checkout') &&
          evt.courtId === prev.id
        ) {
          return null
        }
        return prev
      })
    })
  }, [])

  useEffect(() => {
    if (userLat == null || userLon == null) return
    if (!initialAreaCenterRef.current) initialAreaCenterRef.current = { lat: userLat, lon: userLon }

    const target = { lat: userLat, lon: userLon }
    const last = lastFetchedCenterRef.current
    if (
      courtsHydratedRef.current &&
      last != null &&
      distanceKm(last.lat, last.lon, userLat, userLon) < AREA_RELOAD_THRESHOLD_KM
    ) {
      return
    }

    void loadCourtsWithLiveStatus(target, {
      background: courtsHydratedRef.current,
      force: !courtsHydratedRef.current,
    })
  }, [userLat, userLon, loadCourtsWithLiveStatus])

  useEffect(() => {
    if (locationLoading) return
    if (userLat != null && userLon != null) return
    if (!initialAreaCenterRef.current) {
      initialAreaCenterRef.current = { lat: FALLBACK_MAP_LAT, lon: FALLBACK_MAP_LON }
    }
    const target = { lat: FALLBACK_MAP_LAT, lon: FALLBACK_MAP_LON }
    void loadCourtsWithLiveStatus(target, {
      background: courtsHydratedRef.current,
      force: !courtsHydratedRef.current,
    })
  }, [locationLoading, userLat, userLon, loadCourtsWithLiveStatus])

  const userCoordsReady = userLat != null && userLon != null
  useEffect(() => {
    if (!userCoordsReady || !isMapScreenFocused) return

    let cancelled = false
    let subscription: Location.LocationSubscription | undefined

    void (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync()
        if (cancelled || status !== Location.PermissionStatus.GRANTED) return
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 25,
            timeInterval: 4000,
          },
          (pos) => {
            const plat = pos.coords.latitude
            const plon = pos.coords.longitude
            userPosLatestRef.current = { lat: plat, lon: plon }
            void evaluateSilentPresence(plat, plon)

            const prevThin = lastThinUserPosRef.current
            const moved =
              prevThin == null ||
              distanceKm(prevThin.lat, prevThin.lon, plat, plon) >= USER_POSITION_UI_THROTTLE_KM
            if (moved) {
              lastThinUserPosRef.current = { lat: plat, lon: plon }
              setUserLat(plat)
              setUserLon(plon)
            }
          },
        )

        const boot = userPosLatestRef.current
        if (!cancelled && boot != null) void evaluateSilentPresence(boot.lat, boot.lon)
      } catch (e) {
        if (!cancelled) setLocationError(userFriendlyFromUnknown(e))
      }
    })()

    return () => {
      cancelled = true
      subscription?.remove()
    }
  }, [userCoordsReady, isMapScreenFocused, evaluateSilentPresence])

  const loadFavoriteCourtIds = useCallback(async () => {
    if (isOffline) {
      setFavoritesLoaded(true)
      return
    }
    const { ids } = await fetchFavoriteCourtIds()
    setFavoriteCourtIds(ids)
    setFavoritesLoaded(true)
  }, [isOffline])

  const wasOfflineRef = useRef(isOffline)
  useEffect(() => {
    if (wasOfflineRef.current && !isOffline) {
      void loadFavoriteCourtIds()
      const lat = userLat ?? FALLBACK_MAP_LAT
      const lon = userLon ?? FALLBACK_MAP_LON
      const center = lastFetchedCenterRef.current ?? { lat, lon }
      void loadCourtsWithLiveStatus(center, { background: true, force: true })
    }
    wasOfflineRef.current = isOffline
  }, [isOffline, loadFavoriteCourtIds, userLat, userLon, loadCourtsWithLiveStatus])

  useFocusEffect(
    useCallback(() => {
      void loadFavoriteCourtIds()
      if (!courtsHydratedRef.current) return
      const lat = userLat ?? FALLBACK_MAP_LAT
      const lon = userLon ?? FALLBACK_MAP_LON
      const center = lastFetchedCenterRef.current ?? { lat, lon }
      void loadCourtsWithLiveStatus(center, { background: true })
    }, [userLat, userLon, loadCourtsWithLiveStatus, loadFavoriteCourtIds])
  )

  useEffect(() => {
    if (!isMapScreenFocused || isOffline) return

    const channel = supabase
      .channel(`map-live-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'court_checkins' },
        () => scheduleLiveCourtRefresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'availability_reports' },
        () => scheduleLiveCourtRefresh()
      )
      .subscribe()

    const pollTimer = setInterval(() => {
      void refreshLiveCourtData()
    }, LIVE_REFRESH_POLL_MS)

    void refreshLiveCourtData()

    return () => {
      clearInterval(pollTimer)
      if (liveRefreshDebounceRef.current != null) {
        clearTimeout(liveRefreshDebounceRef.current)
        liveRefreshDebounceRef.current = null
      }
      void supabase.removeChannel(channel)
    }
  }, [isMapScreenFocused, isOffline, refreshLiveCourtData, scheduleLiveCourtRefresh])

  const onRefreshCourts = useCallback(async () => {
    setRefreshing(true)
    try {
      const region = mapRegionRef.current
      const center =
        lastFetchedCenterRef.current ??
        (region ? { lat: region.latitude, lon: region.longitude } : null) ??
        (userLat != null && userLon != null ? { lat: userLat, lon: userLon } : { lat: FALLBACK_MAP_LAT, lon: FALLBACK_MAP_LON })
      await loadCourtsWithLiveStatus(center, {
        background: true,
        force: true,
        bounds: region ?? undefined,
      })
      await loadFavoriteCourtIds()
    } finally {
      setRefreshing(false)
    }
  }, [userLat, userLon, loadCourtsWithLiveStatus, loadFavoriteCourtIds])

  const onSilentBannerCheckOut = useCallback(async () => {
    if (silentCheckInBanner == null || isOffline) return
    const id = silentCheckInBanner.id
    const rm = await deleteCourtCheckIn(id)
    if (!rm.ok) return
    notifyBannerSilentCheckoutInitiated(id)
  }, [silentCheckInBanner, isOffline])

  const onMapRegionChangeComplete = useCallback((region: MapRegion) => {
    mapRegionRef.current = region
    Keyboard.dismiss()
    setMarkerPinSize(markerPinSizeFromLongitudeDelta(region.longitudeDelta))
  }, [])

  useEffect(() => {
    return () => {
      if (regionChangeTimer.current) clearTimeout(regionChangeTimer.current)
    }
  }, [])

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss()
  }, [])

  const closeSearchOverlay = useCallback(() => {
    Keyboard.dismiss()
    Animated.timing(searchSlideY, {
      toValue: -120,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setSearchOverlayOpen(false)
    })
  }, [searchSlideY])

  useEffect(() => {
    if (!searchOverlayOpen) return
    searchSlideY.setValue(-120)
    Animated.timing(searchSlideY, {
      toValue: 0,
      duration: 260,
      useNativeDriver: true,
    }).start()
    const t = setTimeout(() => searchInputRef.current?.focus(), 280)
    return () => clearTimeout(t)
  }, [searchOverlayOpen, searchSlideY])

  const searchFilterActive = searchQuery.trim().length > 0

  const courtsWithDistance: CourtWithDistance[] = useMemo(() => {
    if (courts.length === 0) return []
    const lat = userLat ?? FALLBACK_MAP_LAT
    const lon = userLon ?? FALLBACK_MAP_LON
    return courts
      .map((c) => ({
        ...c,
        distanceKm: distanceKm(lat, lon, c.latitude, c.longitude),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
  }, [courts, userLat, userLon])

  // Only schedule auto-navigate while this tab is focused (not on Play/Record/etc. or court detail stack).
  // Clearing the timer on blur is handled by this effect's cleanup when isMapScreenFocused becomes false.
  useEffect(() => {
    if (!isMapScreenFocused) return
    if (autoNavigated.current) return
    if (courtsWithDistance.length === 0) return
    if (userLat == null || userLon == null) return

    const nearest = courtsWithDistance[0]
    if (!isWithinReportingRadius(nearest.distanceKm)) return

    const timer = setTimeout(() => {
      if (autoNavigated.current) return
      autoNavigated.current = true
      openCourtDetail(nearest.id)
    }, AUTO_NAVIGATE_DELAY_MS)

    return () => clearTimeout(timer)
  }, [isMapScreenFocused, courtsWithDistance, userLat, userLon, openCourtDetail])

  const favoriteIdSet = useMemo(() => new Set(favoriteCourtIds), [favoriteCourtIds])

  const searchFilteredCourts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return courtsWithDistance
    return courtsWithDistance.filter((c) => c.name.toLowerCase().includes(q))
  }, [courtsWithDistance, searchQuery])

  /** Map pins — not limited to the 5 mi list radius. */
  const filteredCourts = useMemo(
    () => searchFilteredCourts.filter((c) => matchesListFilter(c, listFilter, favoriteIdSet)),
    [searchFilteredCourts, listFilter, favoriteIdSet]
  )

  const mergeMapRevealedIds = useCallback((ids: string[], opts?: { fadeIn?: boolean }) => {
    if (ids.length === 0) return
    setMapRevealedIds((prev) => {
      const next = mergeCourtIdSet(prev, ids)
      mapRevealedIdsRef.current = next
      return next
    })
    if (opts?.fadeIn) {
      setMapFadeInCourtIds((prev) => mergeCourtIdSet(prev, ids))
    }
  }, [])

  const revealDebouncedMapPins = useCallback(
    (region: MapRegion) => {
      const inViewport = courtsInMapRegion(filteredCourts, region)
      if (userLat == null || userLon == null) {
        mergeMapRevealedIds(inViewport.map((c) => c.id))
        return
      }
      const outside2mi = inViewport.filter((c) =>
        !isWithinMapInitialPinRadius(distanceKm(userLat, userLon, c.latitude, c.longitude)),
      )
      mergeMapRevealedIds(
        outside2mi.map((c) => c.id).filter((id) => !mapRevealedIdsRef.current.has(id)),
        { fadeIn: true },
      )
    },
    [filteredCourts, mergeMapRevealedIds, userLat, userLon],
  )

  const runMapPinReveal = useCallback(
    async (region: MapRegion) => {
      if (isOffline) return
      mapPinExpandActiveRef.current = true
      revealDebouncedMapPins(region)
      await loadCourtsWithLiveStatus(
        { lat: region.latitude, lon: region.longitude },
        { background: true, silent: true, bounds: region },
      )
    },
    [isOffline, loadCourtsWithLiveStatus, revealDebouncedMapPins],
  )

  const scheduleMapPinReveal = useCallback(() => {
    if (isOffline) return
    if (mapPinRevealTimerRef.current != null) {
      clearTimeout(mapPinRevealTimerRef.current)
    }
    mapPinRevealTimerRef.current = setTimeout(() => {
      mapPinRevealTimerRef.current = null
      const latest = mapRegionRef.current
      if (latest) void runMapPinReveal(latest)
    }, MAP_PIN_REVEAL_DEBOUNCE_MS)
  }, [isOffline, runMapPinReveal])

  const runMapListUpdate = useCallback(
    async (region: MapRegion) => {
      if (isOffline) return
      setListAreaLoading(true)
      try {
        await loadCourtsWithLiveStatus(
          { lat: region.latitude, lon: region.longitude },
          { background: true, silent: true, bounds: region },
        )
        setListMapCenter({ lat: region.latitude, lon: region.longitude })
        setListDistanceMode('mapCenter')
      } finally {
        setListAreaLoading(false)
      }
    },
    [isOffline, loadCourtsWithLiveStatus],
  )

  const scheduleMapListUpdate = useCallback(() => {
    if (isOffline) return
    if (mapListUpdateTimerRef.current != null) {
      clearTimeout(mapListUpdateTimerRef.current)
    }
    mapListUpdateTimerRef.current = setTimeout(() => {
      mapListUpdateTimerRef.current = null
      const latest = mapRegionRef.current
      if (latest) void runMapListUpdate(latest)
    }, MAP_LIST_UPDATE_DEBOUNCE_MS)
  }, [isOffline, runMapListUpdate])

  const onMapRegionChange = useCallback(
    (region: MapRegion) => {
      mapRegionRef.current = region

      const initial = initialAreaCenterRef.current
      if (initial && !userHasManuallyPannedRef.current) {
        const movedKm = distanceKm(initial.lat, initial.lon, region.latitude, region.longitude)
        if (movedKm < MANUAL_PAN_THRESHOLD_KM) {
          if (userLat == null || userLon == null) {
            mergeMapRevealedIds(courtsInMapRegion(filteredCourts, region).map((c) => c.id))
          }
          return
        }
        userHasManuallyPannedRef.current = true
      }

      if (!userHasManuallyPannedRef.current) return

      if (userLat == null || userLon == null) {
        mergeMapRevealedIds(courtsInMapRegion(filteredCourts, region).map((c) => c.id))
      }

      scheduleMapPinReveal()
      scheduleMapListUpdate()
    },
    [filteredCourts, mergeMapRevealedIds, scheduleMapListUpdate, scheduleMapPinReveal, userLat, userLon],
  )

  useEffect(() => {
    return () => {
      if (mapPinRevealTimerRef.current != null) {
        clearTimeout(mapPinRevealTimerRef.current)
      }
      if (mapListUpdateTimerRef.current != null) {
        clearTimeout(mapListUpdateTimerRef.current)
      }
      setListAreaLoading(false)
    }
  }, [])

  /** Staged map pins: within 2 mi first, then viewport pins after pan debounce (ids never removed). */
  const mapVisibleCourts = useMemo(
    () => filteredCourts.filter((c) => mapRevealedIds.has(c.id)),
    [filteredCourts, mapRevealedIds],
  )

  useEffect(() => {
    if (userLat == null || userLon == null) return
    const ids = filteredCourts
      .filter((c) =>
        isWithinMapInitialPinRadius(distanceKm(userLat, userLon, c.latitude, c.longitude)),
      )
      .map((c) => c.id)
    mergeMapRevealedIds(ids)
  }, [filteredCourts, mergeMapRevealedIds, userLat, userLon])

  useEffect(() => {
    if (userLat != null || userLon != null) return
    const region = mapRegionRef.current
    if (!region) return
    mergeMapRevealedIds(courtsInMapRegion(filteredCourts, region).map((c) => c.id))
  }, [filteredCourts, mergeMapRevealedIds, userLat, userLon])

  useEffect(() => {
    if (!mapPinExpandActiveRef.current) return
    const region = mapRegionRef.current
    if (!region || userLat == null || userLon == null) return
    const outside2mi = courtsInMapRegion(filteredCourts, region).filter((c) =>
      !isWithinMapInitialPinRadius(distanceKm(userLat, userLon, c.latitude, c.longitude)),
    )
    const newIds = outside2mi.map((c) => c.id).filter((id) => !mapRevealedIdsRef.current.has(id))
    if (newIds.length > 0) {
      mergeMapRevealedIds(newIds, { fadeIn: true })
    }
  }, [filteredCourts, mergeMapRevealedIds, userLat, userLon])

  const listDistanceAnchor = useMemo(() => {
    if (listDistanceMode === 'mapCenter' && listMapCenter != null) return listMapCenter
    if (userLat != null && userLon != null) return { lat: userLat, lon: userLon }
    return { lat: FALLBACK_MAP_LAT, lon: FALLBACK_MAP_LON }
  }, [listDistanceMode, listMapCenter, userLat, userLon])

  const courtsWithDistanceForList: CourtWithDistance[] = useMemo(() => {
    if (courts.length === 0) return []
    const { lat, lon } = listDistanceAnchor
    return courts
      .map((c) => ({
        ...c,
        distanceKm: distanceKm(lat, lon, c.latitude, c.longitude),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
  }, [courts, listDistanceAnchor])

  /** Bottom sheet list — within 5 mi of GPS on first load; map center after user pans. */
  const courtsWithin5Miles = useMemo(() => {
    if (listDistanceMode === 'gps' && userLat == null && userLon == null) {
      return courtsWithDistanceForList
    }
    return courtsWithDistanceForList.filter((c) => isWithinNearbyListRadius(c.distanceKm))
  }, [courtsWithDistanceForList, listDistanceMode, userLat, userLon])

  const searchFilteredListCourts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return courtsWithin5Miles
    return courtsWithin5Miles.filter((c) => c.name.toLowerCase().includes(q))
  }, [courtsWithin5Miles, searchQuery])

  const filteredListCourts = useMemo(
    () => searchFilteredListCourts.filter((c) => matchesListFilter(c, listFilter, favoriteIdSet)),
    [searchFilteredListCourts, listFilter, favoriteIdSet]
  )

  const showNoFavoritesYetHint =
    listFilter === 'favorites' && favoritesLoaded && favoriteCourtIds.length === 0

  const showNoCourtsWithin5MilesHint =
    !listAreaLoading &&
    courts.length > 0 &&
    courtsWithin5Miles.length === 0 &&
    (listDistanceMode === 'mapCenter' || (userLat != null && userLon != null))

  const blockingForLocation = locationLoading
  const blockingForCourts = !blockingForLocation && courtsLoading
  const loading = blockingForLocation || blockingForCourts

  const mapDisplayLat = userLat ?? FALLBACK_MAP_LAT
  const mapDisplayLon = userLon ?? FALLBACK_MAP_LON
  const hasRealUserGps = userLat != null && userLon != null

  useEffect(() => {
    if (!isMapScreenFocused) return
    if (onboarded !== true) return
    if (loading) return
    if (tourStarted.current) return

    let cancelled = false
    const timer = setTimeout(async () => {
      const completed = await AsyncStorage.getItem(TOUR_COMPLETED_STORAGE_KEY)
      if (cancelled || completed === 'true') return
      tourStarted.current = true
      startTour()
    }, TOUR_START_DELAY_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isMapScreenFocused, onboarded, loading, startTour])

  if (onboarded === null) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]} edges={['top']}>
        <ActivityIndicator size="large" color={theme.tint} />
        <Text style={[styles.bootHint, { color: theme.icon }]}>Loading…</Text>
      </SafeAreaView>
    )
  }
  if (!onboarded) return <Redirect href="/onboarding" />

  if (locationError) {
    return (
      <ErrorScreen
        emoji="📍"
        title="Could not get your location"
        subtitle={locationError}
        onRetry={() => {
          setLocationError(null)
          setLocationRetryKey((k) => k + 1)
        }}
      />
    )
  }

  if (!locationLoading && courtsError) {
    const retryLat = userLat ?? FALLBACK_MAP_LAT
    const retryLon = userLon ?? FALLBACK_MAP_LON
    return (
      <ErrorScreen
        emoji="🏓"
        title="Could not load courts — check your connection and try again."
        subtitle={userFriendlyFromUnknown(courtsError)}
        onRetry={() => {
          void loadCourtsWithLiveStatus({ lat: retryLat, lon: retryLon }, { force: true })
        }}
      />
    )
  }

  const coordsReady = !locationLoading
  const sheetListLoading = loading
  /** Align map insets (and Apple/Google legal watermark) with the collapsed bottom sheet + a sliver for the label. */
  const mapBottomPadding = Math.round(MAP_NEARBY_SHEET_COLLAPSED_BASE_PX + insets.bottom + 14)

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <MapTabGestureRoot>
        <View style={styles.mapStack}>
          <View style={styles.searchAndMap}>
            {isOffline ? (
              <Text style={[styles.offlineCacheHint, { color: isDark ? '#FCD34D' : '#92400E' }]}>
                {(offlineCacheAgeLabel ? `${offlineCacheAgeLabel}. ` : '') + 'Showing saved courts; live pins wait until you reconnect.'}
              </Text>
            ) : null}
            {silentCheckInBanner != null ? (
              <View style={styles.silentBannerWrap}>
                <Pressable
                  disabled={isOffline}
                  style={({ pressed }) => [
                    styles.silentBanner,
                    {
                      backgroundColor: isDark ? 'rgba(34,197,94,0.12)' : 'rgba(29,158,117,0.12)',
                      borderColor: isDark ? 'rgba(74,222,128,0.35)' : 'rgba(29,158,117,0.28)',
                      opacity: isOffline ? 0.55 : pressed ? 0.92 : 1,
                    },
                  ]}
                  onPress={() => void onSilentBannerCheckOut()}
                  accessibilityRole="button"
                  accessibilityLabel={`Checked in at ${silentCheckInBanner.name}. Tap to check out`}
                >
                  <Text
                    style={[styles.silentBannerText, { color: isDark ? '#86EFAC' : '#0F6E56' }]}
                    numberOfLines={1}>
                    Checked in at {silentCheckInBanner.name}
                  </Text>
                  <Text style={[styles.silentBannerAction, { color: isDark ? '#BBF7D0' : '#1D9E75' }]}>
                    Check out
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {permissionDenied ? (
              <View style={styles.silentBannerWrap}>
                <Pressable
                  onPress={() => {
                    openIOSAppSettingsDeepLink()
                    setLocationRetryKey((k) => k + 1)
                  }}
                  style={({ pressed }) => [
                    styles.locationDeniedBanner,
                    {
                      backgroundColor: isDark ? 'rgba(251,191,36,0.12)' : 'rgba(251,191,36,0.2)',
                      borderColor: isDark ? 'rgba(252,211,77,0.45)' : 'rgba(217,119,6,0.35)',
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Open Settings to enable location for nearby courts">
                  <MaterialIcons name="location-off" size={20} color={isDark ? '#FCD34D' : '#92400E'} />
                  <Text style={[styles.locationDeniedBannerText, { color: isDark ? '#FDE68A' : '#78350F' }]}>
                    Location access needed to show nearby courts — tap here to enable in Settings
                  </Text>
                  <MaterialIcons name="chevron-right" size={22} color={isDark ? '#FCD34D' : '#92400E'} />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.mapArea}>
              {coordsReady ? (
                <CourtMap
                  userLat={mapDisplayLat}
                  userLon={mapDisplayLon}
                  showUserLocation={hasRealUserGps}
                  courts={mapVisibleCourts}
                  fadeInCourtIds={mapFadeInCourtIds}
                  selectedId={selectedId}
                  markerPinSize={markerPinSize}
                  onSelectCourt={onMapCourtPinPress}
                  mapBottomPadding={mapBottomPadding}
                  onMapPress={dismissKeyboard}
                  onRegionChange={onMapRegionChange}
                  onRegionChangeComplete={(region) => {
                    if (regionChangeTimer.current) clearTimeout(regionChangeTimer.current)
                    regionChangeTimer.current = setTimeout(() => {
                      onMapRegionChangeComplete(region)
                    }, 300)
                  }}
                />
              ) : (
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: isDark ? '#1a1b1e' : '#E8EDF3' },
                  ]}
                />
              )}
              {areaLoading ? (
                <View
                  style={[
                    styles.mapLoadingPill,
                    {
                      backgroundColor: isDark ? 'rgba(28,28,30,0.92)' : 'rgba(255,255,255,0.92)',
                      borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.1)',
                    },
                  ]}>
                  <ActivityIndicator size="small" color="#1D9E75" />
                  <Text style={[styles.mapLoadingText, { color: isDark ? '#86EFAC' : '#0F6E56' }]}>Loading courts…</Text>
                </View>
              ) : null}
              {!searchOverlayOpen ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    searchFilterActive
                      ? 'Search courts, filtered by name — tap to edit'
                      : 'Search courts'
                  }
                  hitSlop={6}
                  onPress={() => setSearchOverlayOpen(true)}
                  style={({ pressed }) => [styles.mapSearchFab, { opacity: pressed ? 0.9 : 1 }]}>
                  <MaterialIcons name="search" size={24} color={theme.icon} />
                  {searchFilterActive ? <View style={styles.mapSearchFabDot} /> : null}
                </Pressable>
              ) : null}
              {searchOverlayOpen ? (
                <View style={styles.searchOverlayRoot} pointerEvents="box-none">
                  <Pressable style={styles.searchOverlayBackdrop} onPress={closeSearchOverlay} />
                  <Animated.View
                    style={[
                      styles.searchOverlaySheet,
                      {
                        backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
                        borderBottomColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)',
                        paddingTop: 12,
                        transform: [{ translateY: searchSlideY }],
                        shadowOpacity: isDark ? 0.35 : 0.12,
                      },
                    ]}>
                    <View style={styles.searchOverlayRow}>
                      <MaterialIcons name="search" size={22} color={theme.icon} />
                      <TextInput
                        ref={searchInputRef}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder="Search courts by name"
                        placeholderTextColor={theme.icon}
                        style={[styles.searchOverlayInput, { color: theme.text }]}
                        returnKeyType="done"
                        autoCorrect={false}
                        autoCapitalize="words"
                        clearButtonMode="while-editing"
                        onSubmitEditing={closeSearchOverlay}
                      />
                      <Pressable
                        hitSlop={10}
                        onPress={closeSearchOverlay}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel search">
                        <Text style={[styles.searchOverlayCancel, { color: theme.tint }]}>Cancel</Text>
                      </Pressable>
                    </View>
                  </Animated.View>
                </View>
              ) : null}
            </View>
          </View>
          <NearbyCourtsSheet
            courts={filteredListCourts}
            filter={listFilter}
            onFilterChange={setListFilter}
            onCourtPress={openCourtDetail}
            selectedId={selectedId}
            isDark={isDark}
            refreshing={refreshing}
            onRefresh={onRefreshCourts}
            showNoFavoritesYetHint={showNoFavoritesYetHint}
            showNoCourtsWithin5MilesHint={showNoCourtsWithin5MilesHint}
            listLoading={sheetListLoading}
            listFindingCourts={listAreaLoading}
          />
          <BottomSheet
            ref={bottomSheetRef}
            index={-1}
            snapPoints={courtPreviewSnapPoints}
            enablePanDownToClose
            onChange={(index) => {
              if (index === -1) setSelectedCourt(null)
            }}
            backgroundStyle={{
              backgroundColor: isDark ? '#18181B' : '#FFFFFF',
            }}
            handleIndicatorStyle={{
              backgroundColor: isDark ? '#52525B' : '#CBD5E1',
              width: 40,
            }}
            style={styles.courtPreviewSheet}>
            <BottomSheetView style={[styles.courtPreviewContent, { paddingBottom: insets.bottom + 16 }]}>
              {selectedCourt ? (
                <>
                  <Text style={[styles.courtPreviewName, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
                    {selectedCourt.name}
                  </Text>
                  <Text style={[styles.courtPreviewAddress, { color: isDark ? '#A1A1AA' : '#64748B' }]}>
                    {[
                      selectedCourt.indoorOutdoor?.trim(),
                      `${selectedCourt.courtCount} court${selectedCourt.courtCount === 1 ? '' : 's'}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <View style={styles.courtPreviewStatusRow}>
                    {selectedCourt.liveCourtsAvailable != null &&
                    Number.isFinite(selectedCourt.liveCourtsAvailable) ? (
                      <View
                        style={[
                          styles.courtPreviewStatusPill,
                          {
                            backgroundColor: STATUS_PIN_COLOR[
                              courtsAvailableToPinStatus(
                                Math.min(
                                  Math.max(0, Math.floor(selectedCourt.liveCourtsAvailable)),
                                  Math.max(1, selectedCourt.courtCount),
                                ),
                                Math.max(1, selectedCourt.courtCount),
                              )
                            ],
                          },
                        ]}>
                        <Text style={styles.courtPreviewStatusPillText}>
                          {`${Math.min(
                            Math.max(0, Math.floor(selectedCourt.liveCourtsAvailable)),
                            Math.max(1, selectedCourt.courtCount),
                          )} of ${Math.max(1, selectedCourt.courtCount)} open`}
                        </Text>
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.courtPreviewStatusPill,
                          { backgroundColor: isDark ? '#374151' : '#E5E7EB' },
                        ]}>
                        <Text
                          style={[
                            styles.courtPreviewStatusPillText,
                            { color: isDark ? '#9CA3AF' : '#6B7280' },
                          ]}>
                          {courtStatusLabel(selectedCourt.status)} · No report
                        </Text>
                      </View>
                    )}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="View full court details"
                    onPress={() => openCourtDetail(selectedCourt.id)}
                    style={({ pressed }) => [
                      styles.courtPreviewDetailsBtn,
                      { backgroundColor: '#1D9E75', opacity: pressed ? 0.9 : 1 },
                    ]}>
                    <Text style={styles.courtPreviewDetailsBtnText}>View Full Details</Text>
                  </Pressable>
                </>
              ) : null}
            </BottomSheetView>
          </BottomSheet>
        </View>
      </MapTabGestureRoot>
      <LocationPurposeModal
        visible={showLocationPurposeModal}
        onAllow={onLocationPurposeAllow}
        onMaybeLater={onLocationPurposeLater}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapStack: { flex: 1 },
  searchAndMap: { flex: 1 },
  offlineCacheHint: {
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  locationSettingsPress: {
    padding: 12,
    maxWidth: 320,
  },
  silentBannerWrap: {
    marginHorizontal: 12,
    marginTop: 2,
    marginBottom: 4,
  },
  silentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  silentBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  silentBannerAction: {
    fontSize: 12,
    fontWeight: '700',
  },
  locationDeniedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  locationDeniedBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  mapSearchFab: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
    zIndex: 12,
  },
  mapSearchFabDot: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1D9E75',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  searchOverlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },
  searchOverlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  searchOverlaySheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: 12,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  searchOverlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
  },
  searchOverlayInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    paddingVertical: 8,
  },
  searchOverlayCancel: {
    fontSize: 17,
    fontWeight: '600',
  },
  mapArea: { flex: 1 },
  mapLoadingPill: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  mapLoadingText: {
    fontSize: 12,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  bootHint: {
    marginTop: 12,
    fontSize: 15,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  subMessage: {
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
  },
  hint: {
    marginTop: 12,
    fontSize: 15,
  },
  courtPreviewSheet: {
    zIndex: 30,
  },
  courtPreviewContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    gap: 10,
  },
  courtPreviewName: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  courtPreviewAddress: {
    fontSize: 15,
    lineHeight: 21,
  },
  courtPreviewStatusRow: {
    marginTop: 4,
  },
  courtPreviewStatusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  courtPreviewStatusPillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  courtPreviewDetailsBtn: {
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  courtPreviewDetailsBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
})