import {
  MapTabGestureRoot,
  matchesListFilter,
  NearbyCourtsSheet,
  type CourtWithDistance,
  type ListFilter,
} from '@/components/nearby-courts-sheet'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { courtFromRow, type Court } from '@/lib/courts'
import { fetchLatestAvailabilityVenueStatusByCourtIds } from '@/lib/availability'
import { fetchFavoriteCourtIds } from '@/lib/favorites'
import { distanceKm } from '@/lib/geo'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect, useIsFocused } from '@react-navigation/native'
import NetInfo from '@react-native-community/netinfo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { Redirect, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CourtMap } from '../../components/court-map'
import { OfflineBanner } from '@/components/offline-banner'
import { TOUR_COMPLETED_STORAGE_KEY, useGuidedTour } from '@/components/guided-tour'

import { supabase } from '@/supabase'

const AUTO_NAVIGATE_RADIUS_KM = 0.15
const AUTO_NAVIGATE_DELAY_MS = 10000
const AREA_HALF_DELTA_DEG = 0.5
const SIGNIFICANT_PAN_KM = 32.2 // ~20 miles
const SEARCH_BUTTON_PAN_KM = 1.6 // ~1 mile
const TOUR_START_DELAY_MS = 1000
const CACHED_COURTS_KEY = 'cached_courts'

export default function MapScreen() {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const router = useRouter()
  const isMapScreenFocused = useIsFocused()
  const { startTour } = useGuidedTour()

  const [onboarded, setOnboarded] = useState<boolean | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [locationLoading, setLocationLoading] = useState(true)
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLon, setUserLon] = useState<number | null>(null)

  const [courtsLoading, setCourtsLoading] = useState(true)
  const [areaLoading, setAreaLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [courtsError, setCourtsError] = useState<string | null>(null)
  const [courts, setCourts] = useState<Court[]>([])
  const [isOffline, setIsOffline] = useState(false)
  const [offlineBannerDismissed, setOfflineBannerDismissed] = useState(false)
  const [cachedCourtsAt, setCachedCourtsAt] = useState<string | null>(null)
  const [showSearchAreaButton, setShowSearchAreaButton] = useState(false)
  const [pendingSearchCenter, setPendingSearchCenter] = useState<{ lat: number; lon: number } | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [listFilter, setListFilter] = useState<ListFilter>('all')
  const [favoriteCourtIds, setFavoriteCourtIds] = useState<string[]>([])
  const [favoritesLoaded, setFavoritesLoaded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const autoNavigated = useRef(false)
  const tourStarted = useRef(false)
  /** After first successful courts+live merge; tab refocus uses quiet background refetch. */
  const courtsHydratedRef = useRef(false)
  const loadedAreaKeysRef = useRef<Set<string>>(new Set())
  const mergedCourtsByIdRef = useRef<Map<string, Court>>(new Map())
  const initialAreaCenterRef = useRef<{ lat: number; lon: number } | null>(null)
  const lastFetchedCenterRef = useRef<{ lat: number; lon: number } | null>(null)

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
    AsyncStorage.getItem('onboarded').then((val) => {
      setOnboarded(val === 'true')
    })
  }, [])

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const offline = !(state.isConnected ?? false)
      setIsOffline(offline)
      if (!offline) setOfflineBannerDismissed(false)
    })
    return () => unsub()
  }, [])

  const openCourtDetail = useCallback(
    (id: string) => {
      setSelectedId(id)
      router.push(`/court/${encodeURIComponent(id)}`)
    },
    [router]
  )

  const areaKeyFor = useCallback((lat: number, lon: number) => {
    const latBucket = Math.round(lat * 2) / 2
    const lonBucket = Math.round(lon * 2) / 2
    return `${latBucket.toFixed(1)}:${lonBucket.toFixed(1)}`
  }, [])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      setLocationLoading(true)
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (cancelled) return
      if (status !== 'granted') {
        setPermissionDenied(true)
        setLocationLoading(false)
        return
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
      if (cancelled) return
      setUserLat(pos.coords.latitude)
      setUserLon(pos.coords.longitude)
      setLocationLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const loadCourtsWithLiveStatus = useCallback(async (
    center: { lat: number; lon: number },
    opts?: { background?: boolean; force?: boolean }
  ) => {
    const background = opts?.background === true
    const force = opts?.force === true
    const areaKey = areaKeyFor(center.lat, center.lon)
    const alreadyLoaded = loadedAreaKeysRef.current.has(areaKey)

    if (!force && alreadyLoaded) {
      lastFetchedCenterRef.current = center
      return
    }

    if (!background && courts.length === 0) setCourtsLoading(true)
    if (background || courts.length > 0) setAreaLoading(true)
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

      const { data, error } = await supabase
        .from('courts')
        .select('*')
        .gte('latitude', center.lat - AREA_HALF_DELTA_DEG)
        .lte('latitude', center.lat + AREA_HALF_DELTA_DEG)
        .gte('longitude', center.lon - AREA_HALF_DELTA_DEG)
        .lte('longitude', center.lon + AREA_HALF_DELTA_DEG)
        .limit(500)

      if (error) {
        setCourtsError(error.message)
        return
      }

      const parsed = (data ?? [])
        .map((row) => courtFromRow(row as Record<string, unknown>))
        .filter((c): c is Court => c != null)

      const ids = parsed.map((c) => c.id)
      const liveById = await fetchLatestAvailabilityVenueStatusByCourtIds(ids)
      const nextAreaCourts = parsed.map((c) => {
        const key = String(c.id).trim()
        const live = liveById.get(key)
        return { ...c, status: live ?? 'unknown' }
      })

      const merged = new Map(mergedCourtsByIdRef.current)
      for (const c of nextAreaCourts) merged.set(c.id, c)
      mergedCourtsByIdRef.current = merged
      setCourts(Array.from(merged.values()))

      loadedAreaKeysRef.current.add(areaKey)
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
    } finally {
      setAreaLoading(false)
      if (!background) setCourtsLoading(false)
      courtsHydratedRef.current = true
    }
  }, [areaKeyFor, courts.length, isOffline])

  useEffect(() => {
    if (userLat == null || userLon == null) return
    if (!initialAreaCenterRef.current) initialAreaCenterRef.current = { lat: userLat, lon: userLon }
    void loadCourtsWithLiveStatus({ lat: userLat, lon: userLon }, { background: false, force: true })
  }, [userLat, userLon, loadCourtsWithLiveStatus])

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
    if (wasOfflineRef.current && !isOffline) void loadFavoriteCourtIds()
    wasOfflineRef.current = isOffline
  }, [isOffline, loadFavoriteCourtIds])

  useFocusEffect(
    useCallback(() => {
      void loadFavoriteCourtIds()
      if (userLat == null || userLon == null) return
      if (!courtsHydratedRef.current) return
      const center = lastFetchedCenterRef.current ?? { lat: userLat, lon: userLon }
      void loadCourtsWithLiveStatus(center, { background: true })
    }, [userLat, userLon, loadCourtsWithLiveStatus, loadFavoriteCourtIds])
  )

  useEffect(() => {
    if (isOffline) return
    if (userLat == null || userLon == null) return
    const center = lastFetchedCenterRef.current ?? { lat: userLat, lon: userLon }
    void loadCourtsWithLiveStatus(center, { background: true, force: true })
  }, [isOffline, userLat, userLon, loadCourtsWithLiveStatus])

  const onRefreshCourts = useCallback(async () => {
    if (userLat == null || userLon == null) return
    setRefreshing(true)
    try {
      const center = pendingSearchCenter ?? lastFetchedCenterRef.current ?? { lat: userLat, lon: userLon }
      await loadCourtsWithLiveStatus(center, { background: true, force: true })
      await loadFavoriteCourtIds()
      setShowSearchAreaButton(false)
    } finally {
      setRefreshing(false)
    }
  }, [userLat, userLon, pendingSearchCenter, loadCourtsWithLiveStatus, loadFavoriteCourtIds])

  const onMapRegionChangeComplete = useCallback((region: {
    latitude: number
    longitude: number
    latitudeDelta: number
    longitudeDelta: number
  }) => {
    const center = { lat: region.latitude, lon: region.longitude }
    const lastCenter = lastFetchedCenterRef.current
    if (lastCenter) {
      const movedKm = distanceKm(lastCenter.lat, lastCenter.lon, center.lat, center.lon)
      if (movedKm > SEARCH_BUTTON_PAN_KM) {
        setPendingSearchCenter(center)
        setShowSearchAreaButton(true)
      }
    }

    const initialCenter = initialAreaCenterRef.current
    if (!initialCenter || isOffline || areaLoading) return
    const fromInitialKm = distanceKm(initialCenter.lat, initialCenter.lon, center.lat, center.lon)
    if (fromInitialKm > SIGNIFICANT_PAN_KM) {
      void loadCourtsWithLiveStatus(center, { background: true })
      setShowSearchAreaButton(false)
    }
  }, [isOffline, areaLoading, loadCourtsWithLiveStatus])

  const courtsWithDistance: CourtWithDistance[] = useMemo(() => {
    if (userLat == null || userLon == null) return []
    return courts
      .map((c) => ({
        ...c,
        distanceKm: distanceKm(userLat, userLon, c.latitude, c.longitude),
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
    if (nearest.distanceKm > AUTO_NAVIGATE_RADIUS_KM) return

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

  const filteredCourts = useMemo(
    () => searchFilteredCourts.filter((c) => matchesListFilter(c, listFilter, favoriteIdSet)),
    [searchFilteredCourts, listFilter, favoriteIdSet]
  )

  const showNoFavoritesYetHint =
    listFilter === 'favorites' && favoritesLoaded && favoriteCourtIds.length === 0

  const blockingForLocation = locationLoading || userLat == null || userLon == null
  const blockingForCourts = !blockingForLocation && courtsLoading
  const loading = blockingForLocation || blockingForCourts

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

  if (onboarded === null) return null
  if (!onboarded) return <Redirect href="/onboarding" />

  if (permissionDenied) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]} edges={['top']}>
        <Text style={[styles.message, { color: theme.text }]}>
          Location permission is required to sort courts by distance and show them on the map. You can enable it in Settings.
        </Text>
      </SafeAreaView>
    )
  }

  if (userLat != null && userLon != null && courtsError) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]} edges={['top']}>
        <Text style={[styles.message, { color: theme.text }]}>Could not load courts.</Text>
        <Text style={[styles.subMessage, { color: theme.icon }]}>{courtsError}</Text>
      </SafeAreaView>
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]} edges={['top']}>
        <ActivityIndicator size="large" color={theme.tint} />
        <Text style={[styles.hint, { color: theme.icon }]}>
          {blockingForLocation ? 'Finding your location…' : 'Loading courts…'}
        </Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <MapTabGestureRoot>
        <View style={styles.mapStack}>
          <View style={styles.searchAndMap}>
            {isOffline && !offlineBannerDismissed ? (
              <View style={styles.offlineBannerWrap}>
                <OfflineBanner
                  text="You are offline — showing cached courts"
                  subtext={offlineCacheAgeLabel}
                  onDismiss={() => setOfflineBannerDismissed(true)}
                />
              </View>
            ) : null}
            {isOffline ? (
              <Text style={[styles.offlineLiveNotice, { color: isDark ? '#FCD34D' : '#92400E' }]}>
                Live data unavailable offline
              </Text>
            ) : null}
            <View
              style={[
                styles.searchBar,
                {
                  backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
                  borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)',
                },
              ]}>
              <MaterialIcons name="search" size={22} color={theme.icon} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search courts by name"
                placeholderTextColor={theme.icon}
                style={[styles.searchInput, { color: theme.text }]}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="words"
                clearButtonMode="while-editing"
              />
            </View>
            <View style={styles.mapArea}>
              <CourtMap
                userLat={userLat}
                userLon={userLon}
                courts={filteredCourts}
                selectedId={selectedId}
                onSelectCourt={openCourtDetail}
                onRegionChangeComplete={onMapRegionChangeComplete}
              />
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
              {showSearchAreaButton && !areaLoading && !isOffline ? (
                <View style={styles.searchAreaWrap}>
                  <Pressable style={({ pressed }) => [styles.searchAreaBtn, { opacity: pressed ? 0.9 : 1 }]} onPress={() => void onRefreshCourts()}>
                    <MaterialIcons name="search" size={16} color="#FFFFFF" />
                    <Text style={styles.searchAreaBtnText}>Search this area</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
          <NearbyCourtsSheet
            courts={filteredCourts}
            filter={listFilter}
            onFilterChange={setListFilter}
            onCourtPress={openCourtDetail}
            selectedId={selectedId}
            isDark={isDark}
            refreshing={refreshing}
            onRefresh={onRefreshCourts}
            showNoFavoritesYetHint={showNoFavoritesYetHint}
          />
        </View>
      </MapTabGestureRoot>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapStack: { flex: 1 },
  searchAndMap: { flex: 1 },
  offlineBannerWrap: {
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 4,
  },
  offlineLiveNotice: {
    marginHorizontal: 14,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
    paddingVertical: 0,
  },
  mapArea: { flex: 1 },
  mapLoadingPill: {
    position: 'absolute',
    top: 10,
    right: 10,
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
  searchAreaWrap: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
  },
  searchAreaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1D9E75',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  searchAreaBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
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
})