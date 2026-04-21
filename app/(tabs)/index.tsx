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
import { distanceKm } from '@/lib/geo'
import { MaterialIcons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { Redirect, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CourtMap } from '../../components/court-map'

import { supabase } from '@/supabase'

const AUTO_NAVIGATE_RADIUS_KM = 0.15
const AUTO_NAVIGATE_DELAY_MS = 10000

export default function MapScreen() {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const router = useRouter()

  const [onboarded, setOnboarded] = useState<boolean | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [locationLoading, setLocationLoading] = useState(true)
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLon, setUserLon] = useState<number | null>(null)

  const [courtsLoading, setCourtsLoading] = useState(true)
  const [courtsError, setCourtsError] = useState<string | null>(null)
  const [courts, setCourts] = useState<Court[]>([])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [listFilter, setListFilter] = useState<ListFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const autoNavigated = useRef(false)

  useEffect(() => {
    AsyncStorage.getItem('onboarded').then((val) => {
      setOnboarded(val === 'true')
    })
  }, [])

  const openCourtDetail = useCallback(
    (id: string) => {
      setSelectedId(id)
      router.push(`/court/${encodeURIComponent(id)}`)
    },
    [router]
  )

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

  useEffect(() => {
    if (userLat == null || userLon == null) return

    let cancelled = false
    ;(async () => {
      setCourtsLoading(true)
      setCourtsError(null)

      const { data, error } = await supabase.from('courts').select('*').limit(500)

      if (cancelled) return
      if (error) {
        setCourtsError(error.message)
        setCourts([])
      } else {
        const parsed = (data ?? [])
          .map((row) => courtFromRow(row as Record<string, unknown>))
          .filter((c): c is Court => c != null)
        setCourts(parsed)
      }
      setCourtsLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [userLat, userLon])

  const courtsWithDistance: CourtWithDistance[] = useMemo(() => {
    if (userLat == null || userLon == null) return []
    return courts
      .map((c) => ({
        ...c,
        distanceKm: distanceKm(userLat, userLon, c.latitude, c.longitude),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
  }, [courts, userLat, userLon])

  useEffect(() => {
    if (autoNavigated.current) return
    if (courtsWithDistance.length === 0) return
    if (userLat == null || userLon == null) return

    const nearest = courtsWithDistance[0]
    if (nearest.distanceKm <= AUTO_NAVIGATE_RADIUS_KM) {
      const timer = setTimeout(() => {
        if (autoNavigated.current) return
        autoNavigated.current = true
        openCourtDetail(nearest.id)
      }, AUTO_NAVIGATE_DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [courtsWithDistance, userLat, userLon, openCourtDetail])

  const searchFilteredCourts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return courtsWithDistance
    return courtsWithDistance.filter((c) => c.name.toLowerCase().includes(q))
  }, [courtsWithDistance, searchQuery])

  const filteredCourts = useMemo(
    () => searchFilteredCourts.filter((c) => matchesListFilter(c, listFilter)),
    [searchFilteredCourts, listFilter]
  )

  const loading = locationLoading || (userLat != null && courtsLoading)

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

  if (loading || userLat == null || userLon == null) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]} edges={['top']}>
        <ActivityIndicator size="large" color={theme.tint} />
        <Text style={[styles.hint, { color: theme.icon }]}>Finding your location…</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <MapTabGestureRoot>
        <View style={styles.mapStack}>
          <View style={styles.searchAndMap}>
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
              />
            </View>
          </View>
          <NearbyCourtsSheet
            courts={filteredCourts}
            filter={listFilter}
            onFilterChange={setListFilter}
            onCourtPress={openCourtDetail}
            selectedId={selectedId}
            isDark={isDark}
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