import { Colors, Fonts } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import {
  aggregateVenueLiveStatus,
  fetchLatestAvailabilityByCourt,
  insertAvailabilityReport,
  type ReportableStatus,
} from '@/lib/availability'
import {
  courtDetailFromRow,
  STATUS_PIN_COLOR,
  type CourtAmenities,
  type CourtDetail,
  type CourtStatus,
} from '@/lib/courts'
import { addFavorite, ensureFavoritesUser, isCourtFavorite, removeFavorite } from '@/lib/favorites'
import { distanceKm, formatDistanceDetail, isWithinReportingRadius, REPORTING_RADIUS_KM } from '@/lib/geo'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import * as Device from 'expo-device'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { ComponentProps } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { supabase } from '@/supabase'

const OPEN_BTN = '#16a34a'
const BUSY_BTN = '#ea580c'
const FULL_BTN = '#dc2626'

/** Defer success alerts so they run after notify spinner / state updates settle (avoids swallowed alerts and stuck alert chrome). */
const NOTIFY_SUCCESS_ALERT_DELAY_MS = 300

const cardShadow =
  Platform.OS === 'ios'
    ? { shadowColor: '#0f172a', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 20 }
    : { elevation: 6 }

function openMapsDirections(lat: number, lon: number) {
  const url = Platform.OS === 'ios'
    ? `http://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
  Linking.openURL(url).catch(() => Linking.openURL(`https://maps.apple.com/?daddr=${lat},${lon}`))
}

function parseHoursLines(hours: string | null): string[] {
  if (!hours?.trim()) return []
  let lines = hours.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 1) {
    const one = lines[0]
    if (one.includes(';')) lines = one.split(';').map((s) => s.trim()).filter(Boolean)
    else if (one.includes('|')) lines = one.split('|').map((s) => s.trim()).filter(Boolean)
  }
  return lines
}

function statusBadgeColors(status: CourtStatus): { bg: string; text: string } {
  switch (status) {
    case 'open': return { bg: '#DCFCE7', text: '#166534' }
    case 'busy': return { bg: '#FEF3C7', text: '#B45309' }
    case 'full': return { bg: '#FEE2E2', text: '#B91C1C' }
    default: return { bg: '#F3F4F6', text: '#4B5563' }
  }
}

function statusLabel(status: CourtStatus): string {
  switch (status) {
    case 'open': return 'Open'
    case 'busy': return 'Busy'
    case 'full': return 'Full'
    default: return 'Unknown'
  }
}

function StarRow({ rating, filledColor, emptyColor }: { rating: number; filledColor: string; emptyColor: string }) {
  const filled = Math.min(5, Math.max(0, Math.round(rating)))
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Text key={i} style={[styles.starGlyph, { color: i <= filled ? filledColor : emptyColor }]}>★</Text>
      ))}
      <Text style={[styles.ratingNum, { color: filledColor }]}>{rating.toFixed(1)}</Text>
    </View>
  )
}

function InfoTile({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  return (
    <View style={[styles.infoTile, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC', borderColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0' }]}>
      <Text style={[styles.infoTileLabel, { color: isDark ? '#94A3B8' : '#64748B' }]}>{label}</Text>
      <Text style={[styles.infoTileValue, { color: isDark ? '#F1F5F9' : '#0F172A' }]} numberOfLines={2}>{value}</Text>
    </View>
  )
}

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name']

function AmenityChip({ icon, label, isDark }: { icon: MaterialIconName; label: string; isDark: boolean }) {
  return (
    <View style={[styles.amenityChip, { backgroundColor: isDark ? 'rgba(34,197,94,0.12)' : '#ECFDF5', borderColor: isDark ? 'rgba(34,197,94,0.25)' : '#BBF7D0' }]}>
      <MaterialIcons name={icon} size={16} color="#16a34a" />
      <Text style={[styles.amenityChipText, { color: isDark ? '#86EFAC' : '#166534' }]}>{label}</Text>
    </View>
  )
}

async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null
  const { status: existing } = await Notifications.getPermissionsAsync()
  let finalStatus = existing
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  if (finalStatus !== 'granted') return null
  return (await Notifications.getExpoPushTokenAsync({ projectId: '5b08d659-3160-45f5-b63f-3ecd0fe3eddc' })).data
}

export default function CourtDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>()
  const courtId = (() => {
    const v = Array.isArray(rawId) ? rawId[0] : rawId
    if (v == null || v === '') return ''
    try {
      return decodeURIComponent(String(v)).trim()
    } catch {
      return String(v).trim()
    }
  })()
  const router = useRouter()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const theme = Colors[colorScheme ?? 'light']

  const screenBg = isDark ? '#0C0C0E' : '#E8EDF3'
  const cardBg = isDark ? '#161618' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15, 23, 42, 0.06)'
  const muted = isDark ? '#94A3B8' : '#64748B'
  const subtle = isDark ? '#CBD5E1' : '#475569'

  const [court, setCourt] = useState<CourtDetail | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLon, setUserLon] = useState<number | null>(null)
  const [latest, setLatest] = useState<Map<number, ReportableStatus>>(new Map())
  const [saving, setSaving] = useState<{ courtNum: number; status: ReportableStatus } | null>(null)
  const [isFavorite, setIsFavorite] = useState(false)
  const [favoriteReady, setFavoriteReady] = useState(false)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [notifyBusy, setNotifyBusy] = useState(false)
  const [isCheckedIn, setIsCheckedIn] = useState(false)
  const [checkinBusy, setCheckinBusy] = useState(false)
  const [checkinCount, setCheckinCount] = useState(0)
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [pendingRating, setPendingRating] = useState(0)
  const [ratingBusy, setRatingBusy] = useState(false)

  const notifySuccessAlertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleNotifySuccessAlert = useCallback((title: string, message: string) => {
    if (notifySuccessAlertTimeoutRef.current != null) {
      clearTimeout(notifySuccessAlertTimeoutRef.current)
    }
    notifySuccessAlertTimeoutRef.current = setTimeout(() => {
      notifySuccessAlertTimeoutRef.current = null
      Alert.alert(title, message)
    }, NOTIFY_SUCCESS_ALERT_DELAY_MS)
  }, [])

  useEffect(() => () => {
    if (notifySuccessAlertTimeoutRef.current != null) {
      clearTimeout(notifySuccessAlertTimeoutRef.current)
      notifySuccessAlertTimeoutRef.current = null
    }
  }, [])

  const distanceKmUser = useMemo(() => {
    if (userLat == null || userLon == null || !court) return null
    return distanceKm(userLat, userLon, court.latitude, court.longitude)
  }, [userLat, userLon, court])

  const withinRadius = distanceKmUser != null && isWithinReportingRadius(distanceKmUser)

  const refreshLocation = useCallback(async () => {
    const { status } = await Location.getForegroundPermissionsAsync()
    if (status !== 'granted') return
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
    setUserLat(pos.coords.latitude)
    setUserLon(pos.coords.longitude)
  }, [])

  const loadCourt = useCallback(async () => {
    if (!courtId) { setCourt(null); setLoadError('Missing court id'); return }
    setLoadError(null)
    setCourt(undefined)
    const { data, error } = await supabase.from('courts').select('*').eq('id', courtId).maybeSingle()
    if (error) { setLoadError(error.message); setCourt(null); return }
    if (!data) { setCourt(null); setLoadError('Court not found'); return }
    setCourt(courtDetailFromRow(data as Record<string, unknown>))
  }, [courtId])

  const loadAvailability = useCallback(async () => {
    if (!courtId) return
    const map = await fetchLatestAvailabilityByCourt(courtId)
    setLatest(map)
  }, [courtId])

  const loadCheckins = useCallback(async () => {
    if (!courtId) return
    const gate = await ensureFavoritesUser()

    const { data } = await supabase
      .from('court_checkins')
      .select('user_id')
      .eq('court_id', courtId)
      .gt('expires_at', new Date().toISOString())

    setCheckinCount(data?.length ?? 0)

    if ('error' in gate) return
    const mine = data?.find(r => r.user_id === gate.userId)
    setIsCheckedIn(!!mine)
  }, [courtId])

  const onToggleCheckin = useCallback(async () => {
    if (!courtId || checkinBusy) return
    setCheckinBusy(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) { Alert.alert('Error', gate.error); return }

      const { data: playerData } = await supabase
        .from('players')
        .select('display_name')
        .eq('user_id', gate.userId)
        .maybeSingle()

      const displayName = playerData?.display_name ?? 'Anonymous'

      if (isCheckedIn) {
        await supabase
          .from('court_checkins')
          .delete()
          .eq('user_id', gate.userId)
          .eq('court_id', courtId)
        setIsCheckedIn(false)
        setCheckinCount(prev => Math.max(0, prev - 1))
        setPendingRating(0)
        setShowRatingModal(true)
      } else {
        if (!withinRadius) {
          Alert.alert('Too far away', 'You need to be at the court to check in.')
          return
        }
        await supabase.from('court_checkins').upsert({
          user_id: gate.userId,
          court_id: courtId,
          display_name: displayName,
          checked_in_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'user_id,court_id' })
        setIsCheckedIn(true)
        setCheckinCount(prev => prev + 1)
        Alert.alert('Checked in! 🏓', `You're at ${court?.name}. Have a great game!`)
      }
    } finally {
      setCheckinBusy(false)
    }
  }, [courtId, checkinBusy, isCheckedIn, withinRadius, court])

  const submitRating = useCallback(async (stars: number) => {
    if (!courtId || ratingBusy || stars < 1) return
    setRatingBusy(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) return
      await supabase.from('court_ratings').insert({ court_id: courtId, user_id: gate.userId, rating: stars })
      const { data } = await supabase.from('court_ratings').select('rating').eq('court_id', courtId)
      if (data && data.length > 0) {
        const avg = data.reduce((s, r) => s + r.rating, 0) / data.length
        setCourt(prev => prev ? { ...prev, rating: Math.round(avg * 10) / 10 } : prev)
      }
    } finally {
      setRatingBusy(false)
      setShowRatingModal(false)
      setPendingRating(0)
    }
  }, [courtId, ratingBusy])

  const checkSubscription = useCallback(async () => {
    if (!courtId) return
    const gate = await ensureFavoritesUser()
    if ('error' in gate) return
    const { data } = await supabase
      .from('notification_subscriptions')
      .select('id')
      .eq('user_id', gate.userId)
      .eq('court_id', courtId)
      .maybeSingle()
    setIsSubscribed(!!data)
  }, [courtId])

  const onToggleNotification = useCallback(async () => {
    if (!courtId || notifyBusy) return
    setNotifyBusy(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) { Alert.alert('Error', gate.error); return }
      if (isSubscribed) {
        await supabase.from('notification_subscriptions').delete().eq('user_id', gate.userId).eq('court_id', courtId)
        setIsSubscribed(false)
        scheduleNotifySuccessAlert('Notifications off', 'You will no longer receive alerts for this court.')
      } else {
        const token = await getPushToken()
        if (!token) { Alert.alert('Permission needed', 'Enable notifications in Settings to get court alerts.'); return }
        await supabase.from('notification_tokens').upsert({ user_id: gate.userId, push_token: token }, { onConflict: 'user_id' })
        await supabase.from('notification_subscriptions').upsert({ user_id: gate.userId, court_id: courtId, push_token: token }, { onConflict: 'user_id,court_id' })
        setIsSubscribed(true)
        scheduleNotifySuccessAlert('Notifications on! 🔔', "We'll let you know when this court opens up.")
      }
    } finally {
      setNotifyBusy(false)
    }
  }, [courtId, notifyBusy, isSubscribed, scheduleNotifySuccessAlert])

  useEffect(() => { loadCourt() }, [loadCourt])

  useFocusEffect(useCallback(() => {
    refreshLocation()
    loadAvailability()
    checkSubscription()
    loadCheckins()
  }, [refreshLocation, loadAvailability, checkSubscription, loadCheckins]))

  useEffect(() => { setFavoriteReady(false); setIsFavorite(false) }, [courtId])

  useEffect(() => {
    if (!courtId || court == null) return
    let cancelled = false
    ;(async () => {
      await ensureFavoritesUser()
      const fav = await isCourtFavorite(courtId)
      if (!cancelled) { setIsFavorite(fav); setFavoriteReady(true) }
    })()
    return () => { cancelled = true }
  }, [courtId, court])

  const onToggleFavorite = useCallback(async () => {
    if (!courtId || !favoriteReady || favoriteBusy) return
    setFavoriteBusy(true)
    try {
      if (isFavorite) {
        const { error } = await removeFavorite(courtId)
        if (error) Alert.alert('Could not update', error.message)
        else setIsFavorite(false)
      } else {
        const { error } = await addFavorite(courtId)
        if (error) Alert.alert('Could not save', error.message)
        else setIsFavorite(true)
      }
    } finally {
      setFavoriteBusy(false)
    }
  }, [courtId, favoriteReady, favoriteBusy, isFavorite])

  const onReport = async (courtNumber: number, status: ReportableStatus) => {
    if (!court || !courtId) return
    const { status: perm } = await Location.getForegroundPermissionsAsync()
    if (perm !== 'granted') { Alert.alert('Location needed', 'Allow location to verify you are at the venue before reporting.'); return }
    setSaving({ courtNum: courtNumber, status })
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest })
      const d = distanceKm(pos.coords.latitude, pos.coords.longitude, court.latitude, court.longitude)
      if (!isWithinReportingRadius(d)) {
        Alert.alert('Too far away', `Availability reports are only accepted within ${Math.round(REPORTING_RADIUS_KM * 1000)} meters of the venue.`)
        setUserLat(pos.coords.latitude)
        setUserLon(pos.coords.longitude)
        return
      }
      setUserLat(pos.coords.latitude)
      setUserLon(pos.coords.longitude)
      const { error } = await insertAvailabilityReport({ court_id: courtId, court_number: courtNumber, status, reporter_lat: pos.coords.latitude, reporter_lng: pos.coords.longitude })
      if (error) { Alert.alert('Could not save', error.message); return }
      setLatest((prev) => { const next = new Map(prev); next.set(courtNumber, status); return next })
      await loadAvailability()
    } finally {
      setSaving(null)
    }
  }

  const headerStatus = useMemo(() => {
    if (!court) return 'unknown' as CourtStatus
    const live = aggregateVenueLiveStatus(latest)
    return live !== 'unknown' ? live : court.status
  }, [court, latest])

  const amenityList = useMemo(() => {
    if (!court) return []
    const a: CourtAmenities = court.amenities
    const chips: { key: string; icon: MaterialIconName; label: string }[] = []
    if (a.parking) chips.push({ key: 'p', icon: 'local-parking', label: 'Parking' })
    if (a.restrooms) chips.push({ key: 'r', icon: 'wc', label: 'Restrooms' })
    if (a.lighting) chips.push({ key: 'l', icon: 'flare', label: 'Lighting' })
    return chips
  }, [court])

  if (court === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: screenBg }]}>
        <ActivityIndicator size="large" color={theme.tint} />
      </View>
    )
  }

  if (!court || loadError) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: screenBg }]} edges={['top', 'bottom']}>
        <Text style={[styles.errTitle, { color: theme.text }]}>{loadError ?? 'Court not found'}</Text>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.primaryGhostBtn, { borderColor: isDark ? '#F1F5F9' : '#0F172A', opacity: pressed ? 0.75 : 1 }]}>
          <Text style={[styles.primaryGhostBtnText, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  const badge = statusBadgeColors(headerStatus)
  const hoursLines = parseHoursLines(court.hours)
  const titleFont = Fonts.rounded

  return (
    <View style={{ flex: 1, backgroundColor: screenBg }}>
      <SafeAreaView edges={['top']} style={[styles.topBar, { width: '100%' }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={16}
          style={({ pressed }) => [styles.backFab, { backgroundColor: cardBg, borderColor: cardBorder, opacity: pressed ? 0.92 : 1 }, cardShadow]}>
          <MaterialIcons name="arrow-back" size={22} color={isDark ? '#F8FAFC' : '#0F172A'} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={onToggleNotification}
            disabled={notifyBusy}
            hitSlop={16}
            style={({ pressed }) => [styles.backFab, { backgroundColor: cardBg, borderColor: cardBorder, opacity: pressed ? 0.88 : 1 }, cardShadow, notifyBusy && { opacity: 0.55 }]}>
            {notifyBusy ? <ActivityIndicator size="small" color="#0EA5E9" /> : (
              <MaterialIcons name={isSubscribed ? 'notifications-active' : 'notifications-none'} size={24} color={isSubscribed ? '#0EA5E9' : '#9CA3AF'} />
            )}
          </Pressable>
          <Pressable
            onPress={onToggleFavorite}
            disabled={favoriteBusy}
            hitSlop={16}
            style={({ pressed }) => [styles.backFab, { backgroundColor: cardBg, borderColor: cardBorder, opacity: pressed ? 0.88 : 1 }, cardShadow, favoriteBusy && { opacity: 0.55 }]}>
            {favoriteBusy ? <ActivityIndicator size="small" color="#22c55e" /> : (
              <MaterialIcons name={isFavorite ? 'favorite' : 'favorite-border'} size={24} color={isFavorite ? '#22c55e' : '#9CA3AF'} />
            )}
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scrollContent, { paddingTop: 4 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <View style={[styles.heroCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
          <View style={styles.heroTitleRow}>
            <Text style={[styles.heroTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }, Platform.OS === 'ios' && titleFont ? { fontFamily: titleFont } : null]}>
              {court.name}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
              <View style={[styles.statusDot, { backgroundColor: STATUS_PIN_COLOR[headerStatus] }]} />
              <Text style={[styles.statusBadgeText, { color: badge.text }]}>{statusLabel(headerStatus)}</Text>
            </View>
          </View>
          <View style={styles.distanceRatingRow}>
            <View style={styles.distanceBlock}>
              <MaterialIcons name="near-me" size={20} color={muted} />
              <Text style={[styles.distanceText, { color: subtle }]}>
                {distanceKmUser != null ? formatDistanceDetail(distanceKmUser) : '—'}
              </Text>
            </View>
            {court.rating != null ? (
              <StarRow rating={court.rating} filledColor="#F59E0B" emptyColor={isDark ? '#334155' : '#E2E8F0'} />
            ) : (
              <Text style={[styles.noRating, { color: muted }]}>No rating</Text>
            )}
          </View>
          {court.address ? (
            <View style={[styles.addressRow, { borderTopColor: cardBorder }]}>
              <MaterialIcons name="location-on" size={20} color="#0EA5E9" style={{ marginTop: 1 }} />
              <Text style={[styles.addressText, { color: muted }]}>{court.address}</Text>
            </View>
          ) : null}
        </View>

        {/* Check in card */}
        <Pressable
          onPress={onToggleCheckin}
          disabled={checkinBusy}
          style={({ pressed }) => [
            styles.checkinCard,
            {
              backgroundColor: isCheckedIn ? '#0F6E56' : cardBg,
              borderColor: isCheckedIn ? '#0F6E56' : cardBorder,
              opacity: pressed ? 0.88 : 1,
            },
            cardShadow,
          ]}>
          {checkinBusy ? (
            <ActivityIndicator color={isCheckedIn ? '#fff' : '#1D9E75'} />
          ) : (
            <>
              <View style={styles.checkinLeft}>
                <MaterialIcons
                  name={isCheckedIn ? 'sports' : 'login'}
                  size={24}
                  color={isCheckedIn ? '#fff' : '#1D9E75'}
                />
                <View>
                  <Text style={[styles.checkinTitle, { color: isCheckedIn ? '#fff' : theme.text }]}>
                    {isCheckedIn ? 'Checked in — tap to leave' : 'Check in'}
                  </Text>
                  <Text style={[styles.checkinSub, { color: isCheckedIn ? 'rgba(255,255,255,0.75)' : muted }]}>
                    {checkinCount > 0 ? `${checkinCount} player${checkinCount !== 1 ? 's' : ''} here now` : 'Be the first to check in'}
                  </Text>
                </View>
              </View>
              {!isCheckedIn && !withinRadius && (
                <Text style={[styles.checkinHint, { color: muted }]}>Must be at court</Text>
              )}
            </>
          )}
        </Pressable>

        <View style={[styles.sectionCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
          <Text style={[styles.sectionHeading, { color: isDark ? '#E2E8F0' : '#0F172A' }]}>Details</Text>
          <View style={styles.grid}>
            <InfoTile label="Courts" value={String(court.courtCount)} isDark={isDark} />
            <InfoTile label="Surface" value={court.surfaceType?.trim() ? court.surfaceType.charAt(0).toUpperCase() + court.surfaceType.slice(1) : '—'} isDark={isDark} />
            <InfoTile label="Venue" value={court.indoorOutdoor?.trim() ? court.indoorOutdoor : '—'} isDark={isDark} />
            <InfoTile label="Fee" value={court.fee?.trim() ? court.fee.charAt(0).toUpperCase() + court.fee.slice(1) : '—'} isDark={isDark} />
          </View>
        </View>

        {amenityList.length > 0 ? (
          <View style={[styles.sectionCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
            <Text style={[styles.sectionHeading, { color: isDark ? '#E2E8F0' : '#0F172A' }]}>Amenities</Text>
            <View style={styles.amenityRow}>
              {amenityList.map((c) => <AmenityChip key={c.key} icon={c.icon} label={c.label} isDark={isDark} />)}
            </View>
          </View>
        ) : null}

        <View style={[styles.sectionCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
          <Text style={[styles.sectionHeading, { color: isDark ? '#E2E8F0' : '#0F172A' }]}>Hours</Text>
          {hoursLines.length > 0 ? (
            <View style={styles.hoursList}>
              {hoursLines.map((line, i) => (
                <View key={i} style={[styles.hoursItem, i > 0 && { borderTopColor: cardBorder, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <View style={[styles.hoursBullet, { backgroundColor: '#0EA5E9' }]} />
                  <Text style={[styles.hoursLine, { color: isDark ? '#CBD5E1' : '#334155' }]}>{line}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.hoursEmpty, { color: muted }]}>Hours not listed</Text>
          )}
        </View>

        <Pressable
          onPress={() => openMapsDirections(court.latitude, court.longitude)}
          style={({ pressed }) => [styles.directionsCta, { backgroundColor: '#0F172A', opacity: pressed ? 0.9 : 1 }, cardShadow]}>
          <MaterialIcons name="directions" size={22} color="#FFFFFF" />
          <Text style={styles.directionsCtaText}>Directions</Text>
        </Pressable>

        <Text style={[styles.availSectionTitle, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>Live availability</Text>
        <Text style={[styles.availSectionSub, { color: muted }]}>
          Per court · reporting enabled within {Math.round(REPORTING_RADIUS_KM * 1000)} m
        </Text>

        {!withinRadius && distanceKmUser != null && (
          <View style={[styles.proxBanner, { backgroundColor: isDark ? 'rgba(245,158,11,0.12)' : '#FFFBEB', borderColor: isDark ? 'rgba(245,158,11,0.35)' : '#FDE68A' }]}>
            <MaterialIcons name="info-outline" size={20} color="#D97706" />
            <Text style={[styles.proxBannerText, { color: isDark ? '#FCD34D' : '#92400E' }]}>
              You are {formatDistanceDetail(distanceKmUser)} Move within {Math.round(REPORTING_RADIUS_KM * 1000)} m to update.
            </Text>
          </View>
        )}

        {Array.from({ length: court.courtCount }, (_, i) => i + 1).map((num) => {
          const current = latest.get(num)
          return (
            <View key={num} style={[styles.availCourtCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
              <View style={styles.availCourtHeader}>
                <Text style={[styles.availCourtTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>Court {num}</Text>
                {current ? (
                  <Text style={[styles.availCourtSub, { color: muted }]}>
                    Last: <Text style={{ color: STATUS_PIN_COLOR[current], fontWeight: '700' }}>{current.charAt(0).toUpperCase() + current.slice(1)}</Text>
                  </Text>
                ) : (
                  <Text style={[styles.availCourtSub, { color: muted }]}>No reports yet</Text>
                )}
              </View>
              <View style={styles.availBtnRow}>
                {(['open', 'busy', 'full'] as const).map((status) => {
                  const busy = saving?.courtNum === num && saving?.status === status
                  const disabled = !withinRadius || busy
                  const bg = status === 'open' ? OPEN_BTN : status === 'busy' ? BUSY_BTN : FULL_BTN
                  return (
                    <Pressable
                      key={status}
                      disabled={disabled}
                      onPress={() => onReport(num, status)}
                      style={({ pressed }) => [styles.availPill, { backgroundColor: bg, opacity: disabled ? 0.36 : pressed ? 0.88 : 1 }]}>
                      {busy ? <ActivityIndicator color="#fff" size="small" /> : (
                        <Text style={styles.availPillText}>{status.charAt(0).toUpperCase() + status.slice(1)}</Text>
                      )}
                    </Pressable>
                  )
                })}
              </View>
            </View>
          )
        })}

        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal visible={showRatingModal} transparent animationType="fade" onRequestClose={() => setShowRatingModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
            <Text style={[styles.modalTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>How was {court.name}?</Text>
            <Text style={[styles.modalSub, { color: muted }]}>Tap a star to rate this court</Text>
            <View style={styles.modalStarRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable key={star} onPress={() => setPendingRating(star)} hitSlop={8}>
                  <Text style={[styles.modalStar, { color: star <= pendingRating ? '#F59E0B' : isDark ? '#334155' : '#E2E8F0' }]}>★</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => submitRating(pendingRating)}
              disabled={pendingRating === 0 || ratingBusy}
              style={({ pressed }) => [styles.modalSubmitBtn, { opacity: pendingRating === 0 || ratingBusy ? 0.4 : pressed ? 0.85 : 1 }]}>
              {ratingBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitText}>Submit Rating</Text>}
            </Pressable>
            <Pressable onPress={() => setShowRatingModal(false)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={[styles.modalSkip, { color: muted }]}>Skip</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errTitle: { fontSize: 16, textAlign: 'center', marginBottom: 16 },
  primaryGhostBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5 },
  primaryGhostBtnText: { fontWeight: '700', fontSize: 15 },
  topBar: { paddingHorizontal: 16, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backFab: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 24 },
  heroCard: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 22, marginBottom: 14 },
  heroTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  heroTitle: { flex: 1, fontSize: 28, fontWeight: '700', letterSpacing: -0.6, lineHeight: 34 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusBadgeText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  distanceRatingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, paddingRight: 2 },
  distanceBlock: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  distanceText: { fontSize: 16, fontWeight: '600' },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  starGlyph: { fontSize: 18, lineHeight: 22 },
  ratingNum: { marginLeft: 6, fontSize: 15, fontWeight: '700' },
  noRating: { fontSize: 14, fontWeight: '500' },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 18, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  addressText: { flex: 1, fontSize: 15, lineHeight: 22 },
  checkinCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, marginBottom: 14 },
  checkinLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkinTitle: { fontSize: 15, fontWeight: '700' },
  checkinSub: { fontSize: 13, marginTop: 2 },
  checkinHint: { fontSize: 11 },
  sectionCard: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 18, marginBottom: 14 },
  sectionHeading: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoTile: { width: '48%', flexGrow: 1, minWidth: '47%', borderRadius: 14, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 12 },
  infoTileLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  infoTileValue: { fontSize: 16, fontWeight: '600', lineHeight: 21 },
  amenityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  amenityChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  amenityChipText: { fontSize: 13, fontWeight: '600' },
  hoursList: { borderRadius: 14, overflow: 'hidden' },
  hoursItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  hoursBullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  hoursLine: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '500' },
  hoursEmpty: { fontSize: 15, paddingVertical: 4 },
  directionsCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16, borderRadius: 16, marginBottom: 22 },
  directionsCtaText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
  availSectionTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, marginBottom: 4 },
  availSectionSub: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  proxBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 14 },
  proxBannerText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  availCourtCard: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 18, marginBottom: 12 },
  availCourtHeader: { marginBottom: 14 },
  availCourtTitle: { fontSize: 17, fontWeight: '700' },
  availCourtSub: { marginTop: 4, fontSize: 14 },
  availBtnRow: { flexDirection: 'row', gap: 10 },
  availPill: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  availPillText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 28 },
  modalCard: { width: '100%', borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 28, alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center', marginBottom: 6 },
  modalSub: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  modalStarRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  modalStar: { fontSize: 44 },
  modalSubmitBtn: { backgroundColor: '#1D9E75', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 40, marginBottom: 14, width: '100%', alignItems: 'center' },
  modalSubmitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalSkip: { fontSize: 14, fontWeight: '500', paddingVertical: 4 },
})