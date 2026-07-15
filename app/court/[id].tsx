import { SensorTag } from '@/components/sensor-tag'
import { ContentFadeIn } from '@/components/content-fade-in'
import { ReportReasonModal } from '@/components/report-reason-modal'
import { NotificationPurposeModal } from '@/components/notification-purpose-modal'
import { ErrorBanner } from '@/components/error-banner'
import { CourtDetailSkeleton } from '@/components/court-detail-skeleton'
import { SkeletonBox } from '@/components/skeleton-box'
import { Colors, Fonts } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { fetchBlockedUserIds } from '@/lib/blockedUsers'
import type { ContentReportType } from '@/lib/contentReports'
import { showReportActionSheet } from '@/lib/showReportMenu'
import { checkinBucketLabel, checkinCountToCourtStatus } from '@/lib/checkins'
import { courtDetailFromRow, STATUS_PIN_COLOR, type CourtDetail, type CourtStatus } from '@/lib/courts'
import {
  courtHasOutdoorVenue,
  fetchCourtWeatherCached,
  peekCourtWeatherCache,
  weatherEmoji,
  weatherShortLabel,
  type CachedCourtWeather,
} from '@/lib/courtWeather'
import type { CourtReview } from '@/lib/courtReviews'
import {
  deleteCourtReview,
  fetchCourtReviewsPreview,
  fetchRecentWrittenCourtReviews,
  upsertCourtReview,
  upsertCourtReviewFromCheckout,
} from '@/lib/courtReviews'
import { deleteCourtCheckIn, upsertActiveCourtCheckIn } from '@/lib/courtPresenceCheckin'
import { addFavorite, ensureFavoritesUser, isCourtFavorite, removeFavorite } from '@/lib/favorites'
import { notifyManualCheckoutFromCourtDetail } from '@/lib/mapAutoCheckinCoordinator'
import { alertOpenSettings } from '@/lib/alerts'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { NOTIFICATION_PURPOSE_MODAL_SEEN_KEY } from '@/lib/location-permissions'
import {
  courtStatusHeadlineColors,
} from '@/lib/availability'
import {
  courtSensorFromRealtimePayload,
  applyCourtSensorRealtimeChange,
  courtSensorsByZone,
  fetchCourtSensorsForCourt,
  resolveFacilityCourtStatus,
  type CourtSensorRow,
} from '@/lib/courtSensors'
import {
  fetchLatestZoneReportsForCourt,
  fetchZonesForCourt,
  insertZoneReport,
  countOpenZones,
  resolveZoneStatus,
  venueSummaryHeadline,
  venueSummaryToCourtStatus,
  type CourtZoneRow,
} from '@/lib/zones'
import {
  distanceKm,
  // TEMP: proximity restriction disabled for pitch demo — re-enable before public launch
  // formatDistanceDetail,
  // isWithinReportingRadius,
  // REPORTING_RADIUS_KM,
} from '@/lib/geo'
import { MaterialIcons } from '@expo/vector-icons'
import { useNetworkOffline } from '@/contexts/network-status-context'
import { useFocusEffect, useIsFocused } from '@react-navigation/native'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import {
  removeCourtPhotosObjectByPublicUrl,
  uploadPickedImageToCourtPhotos,
} from '@/lib/storageImages'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { openIOSAppSettingsDeepLink } from '@/lib/open-settings'
import { supabase } from '@/supabase'

/** Defer success alerts so they run after notify spinner / state updates settle (avoids swallowed alerts and stuck alert chrome). */
const NOTIFY_SUCCESS_ALERT_DELAY_MS = 300
const DETAIL_LIVE_REFRESH_POLL_MS = 60000

/** Matches Record tab floating action button (`FAB_SIZE` there). */
const DIRECTIONS_FAB_SIZE = 56

const cardShadow =
  Platform.OS === 'ios'
    ? { shadowColor: '#0f172a', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 20 }
    : { elevation: 6 }

function openMapsDirections(lat: number, lon: number) {
  const appleMapsUrl = `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`
  const url =
    Platform.OS === 'ios'
      ? appleMapsUrl
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
  Linking.openURL(url).catch(() => Linking.openURL(appleMapsUrl))
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
    case 'full': return 'Busy'
    default: return 'Unknown'
  }
}

type CourtPhoto = {
  id: string
  court_id: string
  user_id: string
  photo_url: string
  created_at: string
  uploader_name: string
}

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function StarRow({
  rating,
  filledColor,
  emptyColor,
  compact,
  tiny,
}: {
  rating: number
  filledColor: string
  emptyColor: string
  compact?: boolean
  /** Smaller glyphs for dense single-line rows (e.g. court hero meta). */
  tiny?: boolean
}) {
  const filled = Math.min(5, Math.max(0, Math.round(rating)))
  const glyphStyle = tiny ? styles.starGlyphTiny : compact ? styles.starGlyphCompact : styles.starGlyph
  const numStyle = tiny ? styles.ratingNumTiny : compact ? styles.ratingNumCompact : styles.ratingNum
  return (
    <View style={[styles.starRow, compact && styles.starRowCompact, tiny && styles.starRowTiny]}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Text key={i} style={[glyphStyle, { color: i <= filled ? filledColor : emptyColor }]}>
          ★
        </Text>
      ))}
      <Text style={[numStyle, { color: filledColor }]}>{rating.toFixed(1)}</Text>
    </View>
  )
}

async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null
  try {
    const { status: existing } = await Notifications.getPermissionsAsync()
    let finalStatus = existing
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }
    if (finalStatus !== 'granted') return null
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      Constants.easConfig?.projectId
    return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data
  } catch (e) {
    Alert.alert('Notifications unavailable', userFriendlyFromUnknown(e))
    return null
  }
}

export default function CourtDetailScreen() {
  const insets = useSafeAreaInsets()
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
  const isCourtScreenFocused = useIsFocused()
  const { width: windowW, height: windowH } = useWindowDimensions()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const theme = Colors[colorScheme ?? 'light']

  const screenBg = isDark ? '#101418' : '#EBEEF2'
  const cardBg = isDark ? '#161618' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15, 23, 42, 0.06)'
  const muted = isDark ? '#94A3B8' : '#64748B'
  const subtle = isDark ? '#CBD5E1' : '#475569'

  const [court, setCourt] = useState<CourtDetail | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLon, setUserLon] = useState<number | null>(null)
  const [courtZones, setCourtZones] = useState<CourtZoneRow[]>([])
  const [zoneReportsByZone, setZoneReportsByZone] = useState<
    Map<string, { status: 'open' | 'busy'; reported_at: string }>
  >(new Map())
  const [zoneReportBusy, setZoneReportBusy] = useState<{ zoneId: string; status: 'open' | 'busy' } | null>(
    null,
  )
  const [isFavorite, setIsFavorite] = useState(false)
  const [favoriteReady, setFavoriteReady] = useState(false)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [notifyBusy, setNotifyBusy] = useState(false)
  const [showNotificationPurposeModal, setShowNotificationPurposeModal] = useState(false)
  const [isCheckedIn, setIsCheckedIn] = useState(false)
  const [checkinBusy, setCheckinBusy] = useState(false)
  const [checkinCount, setCheckinCount] = useState(0)
  const isOffline = useNetworkOffline()
  const [photos, setPhotos] = useState<CourtPhoto[]>([])
  const [photosLoading, setPhotosLoading] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoDeletingId, setPhotoDeletingId] = useState<string | null>(null)
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [reportTarget, setReportTarget] = useState<{ type: ContentReportType; id: string } | null>(null)
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null)
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [pendingRating, setPendingRating] = useState(0)
  const [checkoutReviewText, setCheckoutReviewText] = useState('')
  const [ratingBusy, setRatingBusy] = useState(false)

  const [reviewsPreview, setReviewsPreview] = useState<CourtReview[]>([])
  const [reviewsTotal, setReviewsTotal] = useState(0)
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [screenBanner, setScreenBanner] = useState<string | null>(null)

  const [showReviewComposer, setShowReviewComposer] = useState(false)
  const [composerRating, setComposerRating] = useState(5)
  const [composerText, setComposerText] = useState('')
  const [composerBusy, setComposerBusy] = useState(false)
  const [moreInfoExpanded, setMoreInfoExpanded] = useState(false)
  const [recentWrittenReviews, setRecentWrittenReviews] = useState<CourtReview[]>([])
  const [outdoorWeather, setOutdoorWeather] = useState<{
    loading: boolean
    error: string | null
    data: CachedCourtWeather | null
  }>({ loading: false, error: null, data: null })
  const [courtSensors, setCourtSensors] = useState<CourtSensorRow[]>([])

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

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true)
    }
  }, [])

  const distanceKmUser = useMemo(() => {
    if (userLat == null || userLon == null || !court) return null
    return distanceKm(userLat, userLon, court.latitude, court.longitude)
  }, [userLat, userLon, court])

  // TEMP: proximity restriction disabled for pitch demo — re-enable before public launch
  const withinRadius = true
  // const withinRadius =
  //   distanceKmUser != null && isWithinReportingRadius(distanceKmUser)

  const fullscreenPhoto = useMemo(
    () => (selectedPhotoUrl == null ? undefined : photos.find((p) => p.photo_url === selectedPhotoUrl)),
    [photos, selectedPhotoUrl]
  )

  const refreshLocation = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync()
      if (status !== 'granted') return
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      setUserLat(pos.coords.latitude)
      setUserLon(pos.coords.longitude)
    } catch (e) {
      Alert.alert('Location unavailable', userFriendlyFromUnknown(e))
    }
  }, [])

  const loadCourt = useCallback(async (cancelledRef?: { current: boolean }) => {
    if (!courtId) {
      setCourt(null)
      setLoadError('This link does not include a court. Head back and pick a court from the map.')
      return
    }
    setLoadError(null)
    setCourt(undefined)
    const { data, error } = await supabase.from('courts').select('*').eq('id', courtId).maybeSingle()
    if (cancelledRef?.current) return
    if (error) {
      setLoadError(userFriendlyFromUnknown(error))
      setCourt(null)
      return
    }
    if (!data) {
      setCourt(null)
      setLoadError('We could not find this court. It may have been removed.')
      return
    }
    if (cancelledRef?.current) return
    setCourt(courtDetailFromRow(data as Record<string, unknown>))
  }, [courtId])

  /** Reset zone UI when opening a different court (avoid stale rows briefly showing wrong venue). */
  useEffect(() => {
    setCourtZones([])
    setZoneReportsByZone(new Map())
    setCourtSensors([])
  }, [courtId])

  const loadZonesAndReports = useCallback(async (cancelledRef?: { current: boolean }) => {
    if (!courtId) return
    try {
      const zones = await fetchZonesForCourt(courtId)
      if (cancelledRef?.current) return
      setCourtZones(zones)
      if (zones.length === 0) {
        setZoneReportsByZone(new Map())
        return
      }
      const reps = await fetchLatestZoneReportsForCourt(courtId)
      if (cancelledRef?.current) return
      setZoneReportsByZone(reps)
    } catch {
      if (cancelledRef?.current) return
      setCourtZones([])
      setZoneReportsByZone(new Map())
    }
  }, [courtId])

  useEffect(() => {
    if (!courtId || isOffline) return
    const cancelled = { current: false }
    void loadZonesAndReports(cancelled)
    return () => {
      cancelled.current = true
    }
  }, [courtId, isOffline, loadZonesAndReports])

  const loadCheckins = useCallback(async () => {
    if (!courtId) return
    const gate = await ensureFavoritesUser()

    const { data } = await supabase
      .from('court_checkins')
      .select('user_id')
      .eq('court_id', courtId)
      .gt('expires_at', new Date().toISOString())

    const blocked = new Set(await fetchBlockedUserIds())
    const rows = (data ?? []).filter((r) => !blocked.has(String((r as { user_id: string }).user_id)))

    setCheckinCount(rows.length)

    if ('error' in gate) return
    const mine = rows.find((r) => r.user_id === gate.userId)
    setIsCheckedIn(!!mine)
  }, [courtId])

  const loadCourtSensors = useCallback(async () => {
    if (!courtId || isOffline) {
      setCourtSensors([])
      return
    }
    const rows = await fetchCourtSensorsForCourt(courtId)
    setCourtSensors(rows)
  }, [courtId, isOffline])

  const loadPhotos = useCallback(async () => {
    if (!courtId) return
    setPhotosLoading(true)
    try {
      const { data, error } = await supabase
        .from('court_photos')
        .select('id, court_id, user_id, photo_url, created_at')
        .eq('court_id', courtId)
        .order('created_at', { ascending: false })

      if (error || !data) {
        setPhotos([])
        return
      }

      const userIds = Array.from(new Set(data.map((r) => String(r.user_id))))
      let nameByUser = new Map<string, string>()
      if (userIds.length > 0) {
        const { data: players } = await supabase
          .from('players')
          .select('user_id, display_name')
          .in('user_id', userIds)
        nameByUser = new Map(
          (players ?? []).map((p) => [String((p as { user_id: string }).user_id), String((p as { display_name?: string | null }).display_name ?? 'Player')])
        )
      }

      setPhotos(
        data.map((r) => ({
          id: String(r.id),
          court_id: String(r.court_id),
          user_id: String(r.user_id),
          photo_url: String(r.photo_url),
          created_at: String(r.created_at),
          uploader_name: nameByUser.get(String(r.user_id)) ?? 'Player',
        }))
      )
    } finally {
      setPhotosLoading(false)
    }
  }, [courtId])

  const loadReviews = useCallback(async () => {
    if (!courtId || isOffline) {
      setReviewsPreview([])
      setReviewsTotal(0)
      setRecentWrittenReviews([])
      return
    }
    setReviewsLoading(true)
    try {
      const gate = await ensureFavoritesUser()
      const uid = 'error' in gate ? null : gate.userId
      const [preview, writtenRecent] = await Promise.all([
        fetchCourtReviewsPreview(courtId, uid),
        fetchRecentWrittenCourtReviews(courtId, 2),
      ])
      setReviewsTotal(preview.total)
      setReviewsPreview(preview.rows)
      setRecentWrittenReviews(writtenRecent)
    } finally {
      setReviewsLoading(false)
    }
  }, [courtId, isOffline])

  const toggleMoreInfo = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setMoreInfoExpanded((v) => !v)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [])

  const uploadCourtPhoto = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    if (!courtId) return
    setPhotoUploading(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setScreenBanner(userFriendlyFromUnknown(gate.error))
        return
      }

      const uploaded = await uploadPickedImageToCourtPhotos(
        gate.userId,
        asset,
        `${courtId}/${Date.now()}`,
      )
      if ('error' in uploaded) {
        setScreenBanner(userFriendlyFromUnknown(uploaded.error))
        return
      }
      const publicUrl = uploaded.publicUrl

      const { error: insertError } = await supabase
        .from('court_photos')
        .insert({ court_id: courtId, user_id: gate.userId, photo_url: publicUrl })
      if (insertError) {
        setScreenBanner(userFriendlyFromUnknown(insertError))
        return
      }

      await loadPhotos()
    } catch (e) {
      setScreenBanner(userFriendlyFromUnknown(e))
    } finally {
      setPhotoUploading(false)
    }
  }, [courtId, loadPhotos])

  const deleteCourtPhoto = useCallback(
    (photo: CourtPhoto) => {
      Alert.alert('Delete photo?', 'This removes your photo from this court.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setPhotoDeletingId(photo.id)
              try {
                const gate = await ensureFavoritesUser()
                if ('error' in gate) {
                  setScreenBanner(userFriendlyFromUnknown(gate.error))
                  return
                }
                if (gate.userId !== photo.user_id) {
                  setScreenBanner('You can only remove photos you uploaded.')
                  return
                }

                const { error: dbErr } = await supabase
                  .from('court_photos')
                  .delete()
                  .eq('id', photo.id)
                  .eq('user_id', gate.userId)
                if (dbErr) {
                  setScreenBanner(userFriendlyFromUnknown(dbErr))
                  return
                }

                await removeCourtPhotosObjectByPublicUrl(photo.photo_url)

                setSelectedPhotoUrl((u) => (u === photo.photo_url ? null : u))
                await loadPhotos()
              } finally {
                setPhotoDeletingId(null)
              }
            })()
          },
        },
      ])
    },
    [loadPhotos]
  )

  const onAddPhoto = useCallback(async () => {
    if (!courtId || photoUploading) return
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (permission.status !== 'granted') {
        alertOpenSettings(
          'Photo library',
          'To add a court photo, allow photo access in Settings — tap below to jump there.',
        )
        return
      }

      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.82,
        allowsEditing: true,
      })
      if (picked.canceled || !picked.assets[0]) return
      await uploadCourtPhoto(picked.assets[0])
    } catch (e) {
      Alert.alert('Photos unavailable', userFriendlyFromUnknown(e))
    }
  }, [courtId, photoUploading, uploadCourtPhoto])

  const onTakePhoto = useCallback(async () => {
    if (!courtId || photoUploading) return
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (permission.status !== 'granted') {
        alertOpenSettings(
          'Camera',
          'To snap a court photo here, turn on camera access in Settings.',
        )
        return
      }

      const captured = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.82,
        allowsEditing: true,
      })
      if (captured.canceled || !captured.assets[0]) return
      await uploadCourtPhoto(captured.assets[0])
    } catch (e) {
      Alert.alert('Photos unavailable', userFriendlyFromUnknown(e))
    }
  }, [courtId, photoUploading, uploadCourtPhoto])

  const onToggleCheckin = useCallback(async () => {
    if (!courtId || checkinBusy) return
    if (isOffline) {
      setScreenBanner('Reconnect to check in or check out.')
      return
    }
    setCheckinBusy(true)
    try {
      if (isCheckedIn) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        const rm = await deleteCourtCheckIn(courtId)
        if (!rm.ok) {
          setScreenBanner(userFriendlyFromUnknown(rm.error ?? ''))
          return
        }
        notifyManualCheckoutFromCourtDetail(courtId)
        setIsCheckedIn(false)
        await loadCheckins()
        setPendingRating(0)
        setCheckoutReviewText('')
        setShowRatingModal(true)
      } else {
        // TEMP: proximity restriction disabled for pitch demo — re-enable before public launch
        // if (!withinRadius) {
        //   setScreenBanner('Get a little closer to the court to check in.')
        //   return
        // }
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        const up = await upsertActiveCourtCheckIn(courtId)
        if (!up.ok) {
          setScreenBanner(userFriendlyFromUnknown(up.error ?? ''))
          return
        }
        setIsCheckedIn(true)
        await loadCheckins()
        Alert.alert('Checked in!', `You're at ${court?.name}. Have a great game!`)
      }
    } finally {
      setCheckinBusy(false)
    }
  }, [courtId, checkinBusy, isCheckedIn, court, isOffline, loadCheckins])

  const submitRating = useCallback(async (stars: number) => {
    if (!courtId || ratingBusy || stars < 1) return
    setRatingBusy(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) return
      const { data: playerData } = await supabase
        .from('players')
        .select('display_name')
        .eq('user_id', gate.userId)
        .maybeSingle()
      const displayName = playerData?.display_name ?? 'Anonymous'

      const { error: revErr } = await upsertCourtReviewFromCheckout({
        courtId,
        userId: gate.userId,
        displayName,
        rating: stars,
        checkoutNote: checkoutReviewText,
      })
      if (revErr) setScreenBanner(userFriendlyFromUnknown(revErr))

      await loadCourt()
      await loadReviews()
    } finally {
      setRatingBusy(false)
      setShowRatingModal(false)
      setPendingRating(0)
      setCheckoutReviewText('')
    }
  }, [courtId, ratingBusy, checkoutReviewText, loadCourt, loadReviews])

  const openReviewComposer = useCallback(() => {
    if (isOffline) {
      setScreenBanner('Reconnect to edit reviews.')
      return
    }
    void ensureFavoritesUser().then((gate) => {
      if ('error' in gate) {
        setScreenBanner(userFriendlyFromUnknown(gate.error))
        return
      }
      const mine = reviewsPreview.find((r) => r?.user_id === gate.userId)
      setComposerRating(mine?.rating != null ? Math.min(5, Math.max(1, mine.rating)) : 5)
      setComposerText(mine?.review_text ?? '')
      setShowReviewComposer(true)
    })
  }, [isOffline, reviewsPreview])

  const submitComposer = useCallback(async () => {
    if (!courtId || composerBusy || composerRating < 1) return
    setComposerBusy(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) return
      const { data: playerData } = await supabase
        .from('players')
        .select('display_name')
        .eq('user_id', gate.userId)
        .maybeSingle()
      const displayName = playerData?.display_name ?? 'Anonymous'
      const { error } = await upsertCourtReview({
        courtId,
        userId: gate.userId,
        displayName,
        rating: composerRating,
        reviewText: composerText,
      })
      if (error) setScreenBanner(userFriendlyFromUnknown(error))
      else {
        setShowReviewComposer(false)
        await loadCourt()
        await loadReviews()
      }
    } finally {
      setComposerBusy(false)
    }
  }, [courtId, composerBusy, composerRating, composerText, loadCourt, loadReviews])

  const requestDeleteReview = useCallback(
    (review: CourtReview) => {
      if (!courtId) return
      if (isOffline) {
        setScreenBanner('Reconnect to change reviews.')
        return
      }
      if (viewerUserId == null || review.user_id !== viewerUserId) return
      Alert.alert('Remove review?', 'This removes your rating and any written notes you added for this court.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await deleteCourtReview(courtId, viewerUserId)
            if (error) setScreenBanner(userFriendlyFromUnknown(error))
            else {
              await loadCourt()
              await loadReviews()
            }
          },
        },
      ])
    },
    [courtId, viewerUserId, isOffline, loadCourt, loadReviews],
  )

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

  const subscribeCourtPushNotifications = useCallback(
    async (gate: { userId: string }) => {
      const token = await getPushToken()
      if (!token) {
        const permAfter = await Notifications.getPermissionsAsync()
        if (permAfter.status === 'denied') {
          Alert.alert(
            'Notifications are turned off — tap here to enable them in Settings',
            undefined,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => openIOSAppSettingsDeepLink() },
            ],
          )
          return
        }
        alertOpenSettings(
          'Notifications are off',
          'Turn them on in Settings for Paddles Up — then tap the bell again.',
        )
        return
      }
      try {
        await supabase.from('notification_tokens').upsert({ user_id: gate.userId, push_token: token }, { onConflict: 'user_id' })
        await supabase.from('notification_subscriptions').upsert({ user_id: gate.userId, court_id: courtId, push_token: token }, { onConflict: 'user_id,court_id' })
      } catch (e) {
        Alert.alert('Notifications unavailable', userFriendlyFromUnknown(e))
        return
      }
      setIsSubscribed(true)
      scheduleNotifySuccessAlert('Notifications on! 🔔', "We'll let you know when this court opens up.")
    },
    [courtId, scheduleNotifySuccessAlert],
  )

  const onNotificationPurposeAllow = useCallback(async () => {
    try {
      await AsyncStorage.setItem(NOTIFICATION_PURPOSE_MODAL_SEEN_KEY, 'yes')
    } catch {
      /* ignore */
    }
    setShowNotificationPurposeModal(false)
    setNotifyBusy(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setScreenBanner(userFriendlyFromUnknown(gate.error))
        return
      }
      await subscribeCourtPushNotifications(gate)
    } catch (e) {
      Alert.alert('Notifications unavailable', userFriendlyFromUnknown(e))
    } finally {
      setNotifyBusy(false)
    }
  }, [subscribeCourtPushNotifications])

  const onNotificationPurposeLater = useCallback(async () => {
    try {
      await AsyncStorage.setItem(NOTIFICATION_PURPOSE_MODAL_SEEN_KEY, 'yes')
    } catch {
      /* ignore */
    }
    setShowNotificationPurposeModal(false)
  }, [])

  const onToggleNotification = useCallback(async () => {
    if (!courtId || notifyBusy) return
    setNotifyBusy(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setScreenBanner(userFriendlyFromUnknown(gate.error))
        return
      }
      if (isSubscribed) {
        await supabase.from('notification_subscriptions').delete().eq('user_id', gate.userId).eq('court_id', courtId)
        setIsSubscribed(false)
        scheduleNotifySuccessAlert('Notifications off', 'You will no longer receive alerts for this court.')
        return
      }

      const perm = await Notifications.getPermissionsAsync()
      if (perm.status === 'denied') {
        Alert.alert(
          'Notifications are turned off — tap here to enable them in Settings',
          undefined,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => openIOSAppSettingsDeepLink() },
          ],
        )
        return
      }

      let seen = false
      try {
        seen = (await AsyncStorage.getItem(NOTIFICATION_PURPOSE_MODAL_SEEN_KEY)) === 'yes'
      } catch {
        seen = false
      }

      if (perm.status === 'undetermined' && !seen) {
        setShowNotificationPurposeModal(true)
        return
      }

      await subscribeCourtPushNotifications(gate)
    } catch (e) {
      Alert.alert('Notifications unavailable', userFriendlyFromUnknown(e))
    } finally {
      setNotifyBusy(false)
    }
  }, [courtId, notifyBusy, isSubscribed, scheduleNotifySuccessAlert, subscribeCourtPushNotifications])

  useEffect(() => {
    const cancelled = { current: false }
    void loadCourt(cancelled)
    return () => {
      cancelled.current = true
    }
  }, [loadCourt])

  useEffect(() => {
    if (court === undefined || court === null) return
    if (!courtHasOutdoorVenue(court.indoorOutdoor)) {
      setOutdoorWeather({ loading: false, error: null, data: null })
      return
    }

    const { id, latitude, longitude } = court
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setOutdoorWeather({
        loading: false,
        error: 'Weather needs a valid location for this court.',
        data: null,
      })
      return
    }

    const cached = peekCourtWeatherCache(id)
    setOutdoorWeather(
      cached != null
        ? { loading: false, error: null, data: cached }
        : { loading: true, error: null, data: null }
    )

    let cancelled = false
    fetchCourtWeatherCached(id, latitude, longitude)
      .then((data) => {
        if (!cancelled) setOutdoorWeather({ loading: false, error: null, data })
      })
      .catch(() => {
        if (!cancelled) {
          setOutdoorWeather((prev) =>
            prev.data != null
              ? { loading: false, error: null, data: prev.data }
              : {
                  loading: false,
                  error: 'Weather could not be loaded. Check your connection and try again.',
                  data: null,
                }
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [court])

  useFocusEffect(
    useCallback(() => {
      const cancelled = { current: false }
      refreshLocation()
      void ensureFavoritesUser().then((gate) => {
        if (cancelled.current) return
        setViewerUserId('error' in gate ? null : gate.userId)
      })
      if (!isOffline) {
        loadCheckins()
        loadZonesAndReports()
        void loadCourtSensors()
      } else {
        setCheckinCount(0)
        setIsCheckedIn(false)
        setCourtSensors([])
      }
      loadPhotos()
      checkSubscription()
      loadReviews()

      return () => {
        cancelled.current = true
        setMoreInfoExpanded(false)
      }
    }, [refreshLocation, loadZonesAndReports, checkSubscription, loadCheckins, loadPhotos, loadReviews, loadCourtSensors, isOffline]),
  )

  useEffect(() => {
    if (!isCourtScreenFocused || !courtId || isOffline) return

    const onSensorChange = (payload: {
      eventType?: string
      new?: unknown
      old?: unknown
    }) => {
      const eventType = String(payload.eventType ?? '')
      const nextRow = courtSensorFromRealtimePayload(payload.new)
      const oldId =
        payload.old != null && typeof payload.old === 'object' && 'id' in (payload.old as object)
          ? String((payload.old as { id?: unknown }).id ?? '').trim() || null
          : null

      // Apply Realtime payload immediately so YoLink status flips without a refetch wait.
      setCourtSensors((prev) => applyCourtSensorRealtimeChange(prev, eventType, nextRow, oldId))
      // Background reconcile in case of partial payloads or multi-row races.
      void loadCourtSensors()
    }

    const channel = supabase
      .channel(`court-detail-live-${courtId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'court_checkins',
          filter: `court_id=eq.${courtId}`,
        },
        () => {
          void loadCheckins()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'zone_reports',
          filter: `court_id=eq.${courtId}`,
        },
        () => {
          void loadZonesAndReports()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'court_sensors',
          filter: `court_id=eq.${courtId}`,
        },
        onSensorChange,
      )
      .subscribe()

    const pollTimer = setInterval(() => {
      void loadCheckins()
      void loadZonesAndReports()
      void loadCourtSensors()
    }, DETAIL_LIVE_REFRESH_POLL_MS)

    return () => {
      clearInterval(pollTimer)
      void supabase.removeChannel(channel)
    }
  }, [isCourtScreenFocused, courtId, isOffline, loadCheckins, loadZonesAndReports, loadCourtSensors])

  useEffect(() => { setFavoriteReady(false); setIsFavorite(false); setCourtSensors([]) }, [courtId])

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
        if (error) setScreenBanner(userFriendlyFromUnknown(error.message))
        else setIsFavorite(false)
      } else {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        const { error } = await addFavorite(courtId)
        if (error) setScreenBanner(userFriendlyFromUnknown(error.message))
        else setIsFavorite(true)
      }
    } finally {
      setFavoriteBusy(false)
    }
  }, [courtId, favoriteReady, favoriteBusy, isFavorite])

  const onZoneReport = useCallback(
    async (zoneId: string, status: 'open' | 'busy') => {
      if (!court || !courtId) return
      if (isOffline) {
        setScreenBanner('Reconnect to submit a zone update.')
        return
      }
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

      // TEMP: proximity restriction disabled for pitch demo — re-enable before public launch
      // Zone reports do not store coordinates; GPS was only used for the 150m gate.
      // let pos: Location.LocationObject
      // try {
      //   const { status: perm } = await Location.getForegroundPermissionsAsync()
      //   if (perm !== 'granted') {
      //     alertOpenSettings(
      //       'Location',
      //       'Location access is needed for this feature — tap below to open Settings.',
      //     )
      //     return
      //   }
      //   pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest })
      // } catch (e) {
      //   Alert.alert('Location unavailable', userFriendlyFromUnknown(e))
      //   return
      // }
      // const d = distanceKm(pos.coords.latitude, pos.coords.longitude, court.latitude, court.longitude)
      // if (!isWithinReportingRadius(d)) {
      //   setScreenBanner(
      //     `Stand within about ${Math.round(REPORTING_RADIUS_KM * 1000)} meters of this court to submit a zone update.`,
      //   )
      //   setUserLat(pos.coords.latitude)
      //   setUserLon(pos.coords.longitude)
      //   return
      // }
      // setUserLat(pos.coords.latitude)
      // setUserLon(pos.coords.longitude)

      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setScreenBanner(userFriendlyFromUnknown(gate.error))
        return
      }

      // Per-zone spinner via zoneReportBusy only — do not guess Open/Busy from this
      // single report; consensus comes from loadZonesAndReports after insert.
      setZoneReportBusy({ zoneId, status })
      try {
        const { error } = await insertZoneReport({
          courtId,
          zoneId,
          userId: gate.userId,
          status,
        })
        if (error) {
          setScreenBanner(userFriendlyFromUnknown(error.message))
          await loadZonesAndReports()
          return
        }
        await loadZonesAndReports()
      } finally {
        setZoneReportBusy(null)
      }
    },
    [court, courtId, isOffline, loadZonesAndReports],
  )

  const zoneSensorsByZone = useMemo(() => courtSensorsByZone(courtSensors), [courtSensors])

  /** Headline "X of Y courts open" — unknown zones are not counted as open. */
  const courtsOpenHeadline = useMemo(() => {
    if (courtZones.length === 0) {
      const total = Math.max(1, court?.courtCount ?? 1)
      return {
        open: 0,
        busy: 0,
        unknown: total,
        total,
        status: 'unknown' as const,
        label: 'No live court data',
      }
    }
    const summary = countOpenZones(courtZones, zoneSensorsByZone, zoneReportsByZone)
    return {
      ...summary,
      status: venueSummaryToCourtStatus(summary),
      label: venueSummaryHeadline(summary),
    }
  }, [court?.courtCount, courtZones, zoneReportsByZone, zoneSensorsByZone])

  if (court === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: screenBg }}>
        <SafeAreaView edges={['top']} style={[styles.topBar, { width: '100%' }]}>
          <SkeletonBox width={44} height={44} borderRadius={14} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <SkeletonBox width={44} height={44} borderRadius={14} />
            <SkeletonBox width={44} height={44} borderRadius={14} />
          </View>
        </SafeAreaView>
        <CourtDetailSkeleton screenBg={screenBg} cardBorder={cardBorder} />
      </View>
    )
  }

  if (!court || loadError) {
    const bannerCopy = loadError ?? 'We could not find this court.'
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: screenBg, paddingHorizontal: 20 }]} edges={['top', 'bottom']}>
        <ErrorBanner message={bannerCopy} autoDismissMs={0} onDismiss={() => router.back()} />
        <Text style={[styles.errTitle, { color: theme.text, marginTop: 14 }]}>
          Check your connection or try again.
        </Text>
        <Pressable
          onPress={() => void loadCourt()}
          style={({ pressed }) => [{ marginTop: 16, opacity: pressed ? 0.9 : 1, backgroundColor: '#1D9E75', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 999 }]}>
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>Try again</Text>
        </Pressable>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.primaryGhostBtn, { borderColor: isDark ? '#F1F5F9' : '#0F172A', opacity: pressed ? 0.75 : 1, marginTop: 14 }]}>
          <Text style={[styles.primaryGhostBtnText, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  const headerStatus: CourtStatus = resolveFacilityCourtStatus({
    sensors: courtSensors,
    zoneReportsByZone,
    courtZones,
    fallbackStatus: checkinCountToCourtStatus(checkinCount),
  })
  const badge = statusBadgeColors(headerStatus)
  const playersHere = checkinBucketLabel(checkinCount)
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

      {screenBanner ? (
        <ErrorBanner message={screenBanner} onDismiss={() => setScreenBanner(null)} />
      ) : null}

      <ContentFadeIn show style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: 4,
            paddingBottom: 20 + DIRECTIONS_FAB_SIZE + 28 + insets.bottom,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">

        <View style={[styles.mainContentCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
        {isOffline ? (
          <Text style={[styles.dashOfflineNote, { color: isDark ? '#FCD34D' : '#92400E' }]}>
            Live data unavailable offline
          </Text>
        ) : null}

        <View style={styles.dashHeaderBlock}>
          <Text
            style={[styles.dashCourtName, { color: isDark ? '#F8FAFC' : '#0F172A' }, Platform.OS === 'ios' && titleFont ? { fontFamily: titleFont } : null]}
            numberOfLines={3}>
            {court?.name}
          </Text>
          <View style={[styles.dashStatusPill, { backgroundColor: badge.bg }]}>
            <View style={[styles.dashStatusDot, { backgroundColor: STATUS_PIN_COLOR[headerStatus] }]} />
            <Text style={[styles.dashStatusPillText, { color: badge.text }]}>{statusLabel(headerStatus)}</Text>
          </View>
          <View style={styles.dashMetaRow}>
            <Text style={[styles.typeSecondaryMuted, { color: muted }]}>
              {court.courtCount} {court.courtCount === 1 ? 'court' : 'courts'}
            </Text>
            <Text style={[styles.dashMetaSep, { color: muted }]}>·</Text>
            {court.rating != null ? (
              <StarRow
                rating={court.rating}
                filledColor="#F59E0B"
                emptyColor={isDark ? '#475569' : '#CBD5E1'}
                compact
              />
            ) : (
              <Text style={[styles.typeSecondaryMuted, { color: muted }]}>No rating</Text>
            )}
          </View>
        </View>

        <View style={styles.availHeroBlock}>
          <Text
            style={[
              styles.availHeroLine,
              {
                color: courtStatusHeadlineColors(courtsOpenHeadline.status, isDark).text,
              },
            ]}>
            {courtsOpenHeadline.label}
          </Text>
        </View>

        <View style={styles.playersDashBlock}>
          <Text style={[styles.typeSecondary, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>{playersHere.title}</Text>
          <Text style={[styles.typeMutedDetail, styles.playersDashSub, { color: muted }]}>{playersHere.subtitle}</Text>
        </View>

        <Pressable
          onPress={onToggleCheckin}
          disabled={checkinBusy || isOffline}
          style={({ pressed }) => [
            styles.checkinWide,
            {
              backgroundColor: isCheckedIn ? '#0F6E56' : '#1D9E75',
              opacity: isOffline ? 0.45 : pressed ? 0.9 : 1,
            },
          ]}>
          {checkinBusy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View style={styles.checkinWideInner}>
              <MaterialIcons name={isCheckedIn ? 'sports' : 'login'} size={22} color="#FFFFFF" />
              <View style={styles.checkinWideTextCol}>
                <Text style={styles.checkinWideTitle}>
                  {isCheckedIn ? 'Checked in — tap to leave' : 'Check in'}
                </Text>
                <Text style={styles.checkinWideSub}>
                  {isCheckedIn ? "You're on the court!" : "Let others know you're here"}
                </Text>
              </View>
              {/* TEMP: proximity restriction disabled for pitch demo — re-enable before public launch
              {!isCheckedIn && !withinRadius ? (
                <Text style={styles.checkinWideHint}>Must be at court</Text>
              ) : null}
              */}
            </View>
          )}
        </Pressable>

        {courtZones.length > 0 ? (
          <View style={styles.zoneDashSection}>
            {/* TEMP: proximity restriction disabled for pitch demo — re-enable before public launch
            {!isOffline && !withinRadius && distanceKmUser != null ? (
              <Text style={[styles.typeMutedDetail, { color: muted, marginBottom: 10 }]}>
                Zone buttons work within {Math.round(REPORTING_RADIUS_KM * 1000)} m of this venue.
              </Text>
            ) : null}
            */}
            {courtZones.map((z, zoneIndex) => {
              const zid = z?.id ?? ''
              const zoneSensor = zid ? zoneSensorsByZone.get(zid) : undefined
              const hasSensor = zoneSensor != null
              const rep = zid ? zoneReportsByZone.get(zid) : undefined
              const zoneStatus = resolveZoneStatus(zoneSensor, rep)
              const highlightOpen = zoneStatus === 'open'
              const highlightBusy = zoneStatus === 'busy'
              const openSubmitting =
                zoneReportBusy?.zoneId === zid && zoneReportBusy?.status === 'open'
              const busySubmitting =
                zoneReportBusy?.zoneId === zid && zoneReportBusy?.status === 'busy'
              // TEMP: proximity restriction disabled for pitch demo — re-enable before public launch
              // (was: isOffline || !withinRadius || hasSensor)
              const zoneActionsDisabled = isOffline || hasSensor
              const zoneDivider = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'
              const isLast = zoneIndex === courtZones.length - 1
              const zname = z?.zone_name ?? 'Zone'
              return (
                <View
                  key={zid || `zone-${zoneIndex}`}
                  style={[
                    styles.zoneRowFlat,
                    { borderBottomColor: zoneDivider, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth },
                  ]}>
                  <View style={styles.zoneNameRow}>
                    <Text style={[styles.zoneNameFlat, { color: isDark ? '#F8FAFC' : '#0F172A' }]} numberOfLines={1}>
                      {zname}
                    </Text>
                    {hasSensor ? <SensorTag isDark={isDark} mutedColor={muted} /> : null}
                  </View>
                  <View style={styles.zoneTogglePair}>
                    <Pressable
                      disabled={zoneActionsDisabled || openSubmitting || !zid}
                      onPress={() => void onZoneReport(zid, 'open')}
                      accessibilityLabel={`Report ${zname} as open`}
                      accessibilityState={{ selected: highlightOpen, disabled: zoneActionsDisabled || openSubmitting }}
                      style={({ pressed }) => [
                        styles.zoneToggleBtn,
                        highlightOpen ? styles.zoneToggleOpenOn : styles.zoneToggleNeutral,
                        {
                          borderColor: highlightOpen
                            ? 'transparent'
                            : isDark
                              ? 'rgba(148,163,184,0.35)'
                              : 'rgba(100,116,139,0.35)',
                          opacity: zoneActionsDisabled ? 0.72 : pressed ? 0.88 : 1,
                        },
                      ]}>
                      {openSubmitting ? (
                        <ActivityIndicator size="small" color={highlightOpen ? '#166534' : muted} />
                      ) : (
                        <Text
                          style={[
                            styles.zoneToggleBtnText,
                            highlightOpen ? styles.zoneToggleOpenOnText : { color: subtle },
                          ]}>
                          Open
                        </Text>
                      )}
                    </Pressable>
                    <Pressable
                      disabled={zoneActionsDisabled || busySubmitting || !zid}
                      onPress={() => void onZoneReport(zid, 'busy')}
                      accessibilityLabel={`Report ${zname} as busy`}
                      accessibilityState={{ selected: highlightBusy, disabled: zoneActionsDisabled || busySubmitting }}
                      style={({ pressed }) => [
                        styles.zoneToggleBtn,
                        highlightBusy ? styles.zoneToggleBusyOn : styles.zoneToggleNeutral,
                        {
                          borderColor: highlightBusy
                            ? 'transparent'
                            : isDark
                              ? 'rgba(148,163,184,0.35)'
                              : 'rgba(100,116,139,0.35)',
                          opacity: zoneActionsDisabled ? 0.72 : pressed ? 0.88 : 1,
                        },
                      ]}>
                      {busySubmitting ? (
                        <ActivityIndicator size="small" color={highlightBusy ? '#B45309' : muted} />
                      ) : (
                        <Text
                          style={[
                            styles.zoneToggleBtnText,
                            highlightBusy ? styles.zoneToggleBusyOnText : { color: subtle },
                          ]}>
                          Busy
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              )
            })}
          </View>
        ) : null}

        {/* TEMP: proximity restriction disabled for pitch demo — re-enable before public launch
        {!withinRadius && distanceKmUser != null ? (
          <View style={styles.dashProxRow}>
            <MaterialIcons name="info-outline" size={18} color={muted} />
            <Text style={[styles.typeMutedDetail, styles.dashProxText, { color: muted }]}>
              You are {formatDistanceDetail(distanceKmUser)} Move within {Math.round(REPORTING_RADIUS_KM * 1000)} m to check in, update availability, or report zones.
            </Text>
          </View>
        ) : null}
        */}

        <Pressable
          onPress={toggleMoreInfo}
          style={({ pressed }) => [styles.moreInfoToggle, { opacity: pressed ? 0.82 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={moreInfoExpanded ? 'Collapse more court information' : 'Expand more court information'}
          accessibilityState={{ expanded: moreInfoExpanded }}>
          <Text style={styles.moreInfoToggleText}>More Info</Text>
          <MaterialIcons
            name={moreInfoExpanded ? 'expand-less' : 'expand-more'}
            size={22}
            color="#1D9E75"
          />
        </Pressable>

        {moreInfoExpanded ? (
          <View style={styles.moreInfoPanel}>
            <View style={[styles.sectionCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
              <View style={styles.moreInfoRatingHero}>
                <Text style={[styles.moreInfoAvgRating, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
                  {court.rating != null ? court.rating.toFixed(1) : '—'}
                </Text>
                <Text style={[styles.moreInfoStarGlyph, { color: '#F59E0B' }]}>★</Text>
              </View>
              <Text style={[styles.moreInfoReviewTotal, { color: muted }]}>
                {reviewsTotal} review{reviewsTotal !== 1 ? 's' : ''}
              </Text>
              {reviewsLoading ? (
                <ActivityIndicator size="small" color={theme.tint} style={{ marginVertical: 12 }} />
              ) : recentWrittenReviews.length === 0 ? (
                <Text style={[styles.moreInfoWrittenEmpty, { color: muted }]}>No written reviews yet.</Text>
              ) : (
                <View style={styles.moreInfoWrittenList}>
                  {recentWrittenReviews.map((r, index) => {
                    const isMine = viewerUserId != null && r?.user_id === viewerUserId
                    const isLast = index === recentWrittenReviews.length - 1
                    return (
                      <Pressable
                        key={r?.id ?? `written-${index}`}
                        onLongPress={() => {
                          if (isMine || !viewerUserId) return
                          Keyboard.dismiss()
                          showReportActionSheet(() => setReportTarget({ type: 'review', id: r?.id ?? '' }))
                        }}
                        delayLongPress={450}
                        style={[
                          styles.moreInfoWrittenRow,
                          { borderColor: cardBorder, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth },
                        ]}>
                        <View style={styles.reviewHeadingRow}>
                          <Text style={[styles.reviewName, { color: isDark ? '#F8FAFC' : '#0F172A' }]} numberOfLines={1}>
                            {r?.display_name ?? 'Player'}
                          </Text>
                          {isMine ? (
                            <View style={styles.reviewMineActions}>
                              <Pressable onPress={openReviewComposer} hitSlop={8} accessibilityLabel="Edit your review">
                                <Text style={styles.reviewEditText}>Edit</Text>
                              </Pressable>
                              <Pressable
                                onPress={() => r && requestDeleteReview(r)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                accessibilityLabel="Delete your review">
                                <MaterialIcons name="delete-outline" size={20} color="#E24B4A" />
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                        <StarRow rating={r?.rating ?? 0} filledColor="#F59E0B" emptyColor={isDark ? '#334155' : '#E2E8F0'} compact />
                        <Text style={[styles.reviewBody, { color: isDark ? '#CBD5E1' : '#475569' }]}>{(r?.review_text ?? '').trim()}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              )}
              <View style={styles.moreInfoReviewCtas}>
                {viewerUserId != null && !reviewsPreview.some((r) => r?.user_id === viewerUserId) ? (
                  <Pressable
                    onPress={openReviewComposer}
                    style={({ pressed }) => [
                      styles.reviewsPrimaryBtn,
                      { backgroundColor: '#1D9E75', opacity: pressed ? 0.88 : 1 },
                    ]}>
                    <Text style={styles.reviewsPrimaryBtnText}>Write a review</Text>
                  </Pressable>
                ) : null}
                {reviewsTotal > 0 ? (
                  <Pressable
                    onPress={() => router.push(`/court/reviews/${encodeURIComponent(courtId)}`)}
                    style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}>
                    <Text style={styles.moreInfoSeeAllLink}>See all reviews</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={[styles.sectionCard, { backgroundColor: cardBg, borderColor: cardBorder, marginTop: 0 }, cardShadow]}>
              {photosLoading ? (
                <ActivityIndicator size="small" color={theme.tint} style={{ alignSelf: 'center', marginBottom: 10 }} />
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStripMoreInfo}>
                <Pressable
                  onPress={onAddPhoto}
                  disabled={photoUploading}
                  style={({ pressed }) => [
                    styles.moreInfoAddPhotoChip,
                    { borderColor: cardBorder, backgroundColor: isDark ? '#1f1f22' : '#F0FAF6', opacity: photoUploading ? 0.6 : pressed ? 0.88 : 1 },
                  ]}>
                  {photoUploading ? (
                    <ActivityIndicator size="small" color="#1D9E75" />
                  ) : (
                    <>
                      <MaterialIcons name="add-photo-alternate" size={20} color="#1D9E75" />
                      <Text style={styles.moreInfoAddPhotoChipText}>Add Photo</Text>
                    </>
                  )}
                </Pressable>
                {photos.map((photo, idx) => {
                  const isMine = viewerUserId != null && photo?.user_id === viewerUserId
                  const deleting = photoDeletingId === photo?.id
                  return (
                    <View key={photo?.id ?? `photo-${idx}`} style={styles.photoCard}>
                      <Pressable onPress={() => setSelectedPhotoUrl(photo?.photo_url ?? null)} disabled={deleting}>
                        <Image source={{ uri: photo?.photo_url ?? '' }} style={styles.photoImage} />
                      </Pressable>
                      {isMine ? (
                        <Pressable
                          accessibilityLabel="Delete photo"
                          onPress={() => photo && deleteCourtPhoto(photo)}
                          disabled={deleting || photoUploading}
                          style={({ pressed }) => [
                            styles.photoDeleteBtn,
                            { opacity: deleting || photoUploading ? 0.45 : pressed ? 0.82 : 1 },
                          ]}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                          {deleting ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <MaterialIcons name="delete-outline" size={18} color="#FFFFFF" />
                          )}
                        </Pressable>
                      ) : null}
                      <Text style={[styles.photoMetaName, { color: isDark ? '#E2E8F0' : '#0F172A' }]} numberOfLines={1}>
                        {photo?.uploader_name ?? 'Player'}
                      </Text>
                      <Text style={[styles.photoMetaTime, { color: muted }]}>{photo?.created_at ? timeAgo(photo.created_at) : ''}</Text>
                    </View>
                  )
                })}
              </ScrollView>
              <View style={styles.photoActionsRowBelow}>
                <Pressable
                  onPress={onTakePhoto}
                  disabled={photoUploading}
                  style={({ pressed }) => [
                    styles.photoActionBtn,
                    { backgroundColor: '#0EA5E9', opacity: photoUploading ? 0.65 : pressed ? 0.85 : 1 },
                  ]}>
                  {photoUploading ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
                    <>
                      <MaterialIcons name="photo-camera" size={15} color="#FFFFFF" />
                      <Text style={styles.photoActionBtnText}>Take Photo</Text>
                    </>
                  )}
                </Pressable>
              </View>
              {!photosLoading && photos.length === 0 ? (
                <Text style={[styles.photoPlaceholderText, { color: muted, marginTop: 8 }]}>
                  No photos yet — be the first to add one
                </Text>
              ) : null}
            </View>

            {court != null && courtHasOutdoorVenue(court.indoorOutdoor) ? (
              <View style={[styles.moreInfoWeatherSlim, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
                {outdoorWeather.loading && outdoorWeather.data == null ? (
                  <View style={styles.moreInfoWeatherSlimInner}>
                    <ActivityIndicator size="small" color={theme.tint} />
                    <Text style={[styles.moreInfoWeatherMuted, { color: muted }]}>Weather…</Text>
                  </View>
                ) : outdoorWeather.error != null && outdoorWeather.data == null ? (
                  <Text style={[styles.moreInfoWeatherMuted, { color: muted }]} numberOfLines={1}>
                    {outdoorWeather.error}
                  </Text>
                ) : outdoorWeather.data != null ? (
                  <View style={styles.moreInfoWeatherSlimInner}>
                    <Text style={styles.moreInfoWeatherEmoji} accessibilityLabel={weatherShortLabel(outdoorWeather.data.weatherCode)}>
                      {weatherEmoji(outdoorWeather.data.windMph, outdoorWeather.data.weatherCode)}
                    </Text>
                    <Text style={[styles.moreInfoWeatherTemp, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
                      {Math.round(outdoorWeather.data.temperatureF)}°
                    </Text>
                    <Text style={[styles.moreInfoWeatherWord, { color: subtle }]} numberOfLines={1}>
                      {(() => {
                        const label = weatherShortLabel(outdoorWeather.data.weatherCode)
                        const sp = label.indexOf(' ')
                        return sp === -1 ? label : label.slice(0, sp)
                      })()}
                    </Text>
                    <Text style={[styles.moreInfoWeatherWind, { color: muted }]}>{Math.round(outdoorWeather.data.windMph)} mph</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={[styles.moreInfoHoursCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
              <View style={styles.moreInfoHoursHeading}>
                <MaterialIcons name="schedule" size={18} color={subtle} />
                <Text style={[styles.moreInfoHoursTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>Hours</Text>
              </View>
              <Text style={[styles.moreInfoHoursBody, { color: isDark ? '#CBD5E1' : '#334155' }]}>
                {court.hours?.trim() ? court.hours.trim() : 'Hours not listed'}
              </Text>
            </View>
          </View>
        ) : null}

          <View style={{ height: 8 }} />
        </View>
      </ScrollView>
      </ContentFadeIn>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open directions to this court"
        onPress={() => openMapsDirections(court.latitude, court.longitude)}
        style={({ pressed }) => [
          styles.directionsFab,
          {
            bottom: 16 + insets.bottom,
            right: 16 + insets.right,
            opacity: pressed ? 0.92 : 1,
          },
        ]}>
        <MaterialIcons name="navigation" size={28} color="#FFFFFF" />
      </Pressable>

      <Modal visible={selectedPhotoUrl != null} transparent animationType="fade" onRequestClose={() => setSelectedPhotoUrl(null)}>
        <View style={styles.photoModalOverlay}>
          {selectedPhotoUrl ? (
            <Image
              source={{ uri: selectedPhotoUrl }}
              style={{
                width: Math.max(0, windowW - 32),
                height: Math.max(240, Math.round(windowH * 0.74)),
              }}
              resizeMode="contain"
            />
          ) : null}
          {fullscreenPhoto != null && viewerUserId === fullscreenPhoto.user_id ? (
            <Pressable
              accessibilityLabel="Delete photo"
              onPress={() => deleteCourtPhoto(fullscreenPhoto)}
              disabled={photoDeletingId === fullscreenPhoto.id}
              style={({ pressed }) => [
                styles.photoModalDelete,
                { opacity: photoDeletingId === fullscreenPhoto.id ? 0.45 : pressed ? 0.82 : 1 },
              ]}>
              {photoDeletingId === fullscreenPhoto.id ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <MaterialIcons name="delete-outline" size={24} color="#FFFFFF" />
              )}
            </Pressable>
          ) : null}
          <Pressable onPress={() => setSelectedPhotoUrl(null)} style={styles.photoModalClose}>
            <MaterialIcons name="close" size={24} color="#FFFFFF" />
          </Pressable>
        </View>
      </Modal>

      <Modal
        visible={showRatingModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowRatingModal(false)
          setCheckoutReviewText('')
        }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalKeyboardRoot}>
          <View style={styles.modalCenterWrap}>
            <Pressable
              style={styles.modalBackdrop}
              accessibilityLabel="Dismiss"
              onPress={() => {
                setShowRatingModal(false)
                setCheckoutReviewText('')
              }}
            />
            <View style={[styles.modalCardCompact, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
              <Text style={[styles.modalTitleCompact, styles.modalCheckoutHeaderText, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
                How was {court?.name}?
              </Text>
              <Text style={[styles.modalSubCompact, styles.modalCheckoutHeaderText, { color: muted }]}>Tap a star to rate this court</Text>
              <View style={styles.modalStarRowCompact}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable key={star} onPress={() => setPendingRating(star)} hitSlop={8}>
                    <Text style={[styles.modalStarCompact, { color: star <= pendingRating ? '#F59E0B' : isDark ? '#334155' : '#E2E8F0' }]}>★</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.modalSubCompact, styles.modalCheckoutHeaderText, { color: muted, marginBottom: 8 }]}>
                Add notes (optional)
              </Text>
              <TextInput
                value={checkoutReviewText}
                onChangeText={setCheckoutReviewText}
                placeholder="Surface, nets, busy?"
                placeholderTextColor={muted}
                multiline
                style={[styles.reviewComposerInputCompact, { color: isDark ? '#F8FAFC' : '#0F172A', borderColor: cardBorder }]}
              />
              <Pressable
                onPress={() => submitRating(pendingRating)}
                disabled={pendingRating === 0 || ratingBusy}
                style={({ pressed }) => [styles.modalSubmitBtnCompact, { opacity: pendingRating === 0 || ratingBusy ? 0.4 : pressed ? 0.85 : 1 }]}>
                {ratingBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitTextCompact}>Submit rating</Text>}
              </Pressable>
              <Pressable
                onPress={() => {
                  setShowRatingModal(false)
                  setCheckoutReviewText('')
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                <Text style={[styles.modalSkipCompact, { color: muted }]}>Skip</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showReviewComposer} transparent animationType="fade" onRequestClose={() => setShowReviewComposer(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalKeyboardRoot}>
          <View style={styles.modalCenterWrap}>
            <Pressable style={styles.modalBackdrop} accessibilityLabel="Dismiss" onPress={() => setShowReviewComposer(false)} />
            <View style={[styles.modalCardCompact, styles.modalCardReviewOnly, { backgroundColor: cardBg, borderColor: cardBorder }, cardShadow]}>
              <View style={styles.modalReviewHeader}>
                <Text style={[styles.modalTitleCompact, { color: isDark ? '#F8FAFC' : '#0F172A', flex: 1, marginBottom: 0 }]}>
                  {reviewsPreview.some((r) => viewerUserId != null && r?.user_id === viewerUserId) ? 'Your review' : 'Write a review'}
                </Text>
                <Pressable hitSlop={10} accessibilityLabel="Close" onPress={() => setShowReviewComposer(false)}>
                  <MaterialIcons name="close" size={22} color={muted} />
                </Pressable>
              </View>
              <Text style={[styles.modalSubCompact, { color: muted }]}>Stars + optional notes</Text>
              <View style={styles.modalStarRowCompact}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable key={star} onPress={() => setComposerRating(star)} hitSlop={8}>
                    <Text style={[styles.modalStarCompact, { color: star <= composerRating ? '#F59E0B' : isDark ? '#334155' : '#E2E8F0' }]}>★</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={composerText}
                onChangeText={setComposerText}
                placeholder="Parking, restrooms, nets..."
                placeholderTextColor={muted}
                multiline
                style={[styles.reviewComposerInputCompactTall, { color: isDark ? '#F8FAFC' : '#0F172A', borderColor: cardBorder }]}
              />
              <Pressable
                onPress={() => void submitComposer()}
                disabled={composerBusy}
                style={({ pressed }) => [styles.modalSubmitBtnCompact, { opacity: composerBusy ? 0.5 : pressed ? 0.88 : 1 }]}>
                {composerBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitTextCompact}>Save</Text>}
              </Pressable>
              <Pressable onPress={() => setShowReviewComposer(false)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                <Text style={[styles.modalSkipCompact, { color: muted }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <NotificationPurposeModal
        visible={showNotificationPurposeModal}
        onAllow={onNotificationPurposeAllow}
        onMaybeLater={onNotificationPurposeLater}
      />

      <ReportReasonModal
        visible={reportTarget != null}
        onClose={() => setReportTarget(null)}
        contentType={reportTarget?.type ?? 'review'}
        contentId={reportTarget?.id ?? ''}
      />
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
  scrollContent: { paddingHorizontal: 16 },
  mainContentCard: {
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 22,
  },
  dashOfflineNote: { fontSize: 13, fontWeight: '600', marginBottom: 14, lineHeight: 18 },
  dashHeaderBlock: { marginBottom: 8 },
  dashCourtName: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: 34,
    marginBottom: 12,
  },
  dashStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 14,
  },
  dashStatusDot: { width: 7, height: 7, borderRadius: 4 },
  dashStatusPillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  dashMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  dashMetaSep: { fontSize: 13, fontWeight: '600', opacity: 0.65 },
  typeSecondaryMuted: { fontSize: 14, fontWeight: '500', letterSpacing: 0.05 },
  typeSecondary: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  typeMutedDetail: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  availHeroBlock: { marginTop: 12, marginBottom: 8, alignItems: 'center', alignSelf: 'stretch' },
  availHeroLine: {
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1.2,
    lineHeight: 44,
    textAlign: 'center',
    marginBottom: 6,
  },
  availHintPad: { textAlign: 'center', marginTop: 12, paddingHorizontal: 8 },
  playersDashBlock: { marginTop: 28, marginBottom: 14 },
  playersDashSub: { marginTop: 4 },
  checkinWide: {
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 28,
    alignSelf: 'stretch',
  },
  checkinWideInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    width: '100%',
  },
  checkinWideTextCol: { flex: 1, minWidth: 0 },
  checkinWideTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  checkinWideSub: { color: 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: '500', marginTop: 4, lineHeight: 18 },
  checkinWideHint: { color: 'rgba(255,255,255,0.95)', fontSize: 11, fontWeight: '700', maxWidth: 88, textAlign: 'right' },
  zoneDashSection: { marginBottom: 12 },
  zoneRowFlat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 0,
  },
  zoneNameRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  zoneNameFlat: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  dashProxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, marginBottom: 4 },
  dashProxText: { flex: 1, lineHeight: 18 },
  directionsFab: {
    position: 'absolute',
    width: DIRECTIONS_FAB_SIZE,
    height: DIRECTIONS_FAB_SIZE,
    borderRadius: DIRECTIONS_FAB_SIZE / 2,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
      },
      android: { elevation: 8 },
    }),
  },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  starRowCompact: { flexShrink: 0, gap: 0 },
  starRowTiny: { flexShrink: 0 },
  starGlyph: { fontSize: 18, lineHeight: 22 },
  starGlyphCompact: { fontSize: 13, lineHeight: 16 },
  starGlyphTiny: { fontSize: 11, lineHeight: 13 },
  ratingNum: { marginLeft: 4, fontSize: 15, fontWeight: '700' },
  ratingNumCompact: { marginLeft: 3, fontSize: 12, fontWeight: '700' },
  ratingNumTiny: { marginLeft: 3, fontSize: 11, fontWeight: '700' },
  moreInfoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 12,
    marginBottom: 0,
  },
  moreInfoToggleText: { fontSize: 15, fontWeight: '700', color: '#1D9E75' },
  moreInfoPanel: { gap: 12 },
  moreInfoRatingHero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 4, marginBottom: 6 },
  moreInfoAvgRating: { fontSize: 42, fontWeight: '800', letterSpacing: -1.2, lineHeight: 46 },
  moreInfoStarGlyph: { fontSize: 26, lineHeight: 32, paddingBottom: 2 },
  moreInfoReviewTotal: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 14 },
  moreInfoWrittenEmpty: { textAlign: 'center', paddingVertical: 6, marginBottom: 10, fontSize: 14 },
  moreInfoWrittenList: { gap: 0 },
  moreInfoWrittenRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  moreInfoReviewCtas: { marginTop: 14, gap: 12, alignSelf: 'stretch', alignItems: 'stretch' },
  moreInfoSeeAllLink: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D9E75',
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  photoStripMoreInfo: { gap: 10, paddingVertical: 6, paddingRight: 8, alignItems: 'flex-start', flexGrow: 0 },
  moreInfoAddPhotoChip: {
    width: 100,
    minHeight: 106,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  moreInfoAddPhotoChipText: { fontSize: 11, fontWeight: '700', color: '#1D9E75', textAlign: 'center' },
  photoActionsRowBelow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  moreInfoWeatherSlim: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  moreInfoWeatherSlimInner: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'nowrap' },
  moreInfoWeatherEmoji: { fontSize: 21, lineHeight: 26 },
  moreInfoWeatherTemp: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  moreInfoWeatherWord: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600' },
  moreInfoWeatherWind: { fontSize: 13, fontWeight: '600' },
  moreInfoWeatherMuted: { fontSize: 13, fontWeight: '500', paddingVertical: 2 },
  moreInfoHoursCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  moreInfoHoursHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  moreInfoHoursTitle: { fontSize: 15, fontWeight: '700' },
  moreInfoHoursBody: { fontSize: 14, lineHeight: 21, fontWeight: '500' },
  sectionCard: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 18, marginBottom: 14 },
  photoActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  photoActionBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  photoPlaceholderText: { marginTop: 10, fontSize: 13 },
  photoCard: { width: 142, position: 'relative' },
  photoImage: { width: 142, height: 106, borderRadius: 12, backgroundColor: '#0f172a22' },
  photoDeleteBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(15,23,42,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoMetaName: { marginTop: 8, fontSize: 13, fontWeight: '600' },
  photoMetaTime: { marginTop: 2, fontSize: 12 },
  zoneTogglePair: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  zoneToggleBtn: {
    minWidth: 66,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneToggleBtnText: { fontSize: 12, fontWeight: '700' },
  zoneToggleNeutral: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
  },
  zoneToggleOpenOn: {
    backgroundColor: '#DCFCE7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#BBF7D0',
  },
  zoneToggleBusyOn: {
    backgroundColor: '#FEF3C7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FDE68A',
  },
  zoneToggleOpenOnText: { color: '#166534' },
  zoneToggleBusyOnText: { color: '#B45309' },
  photoModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  photoModalDelete: { position: 'absolute', top: 56, left: 20, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,29,29,0.65)' },
  photoModalClose: { position: 'absolute', top: 56, right: 20, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.55)' },
  modalKeyboardRoot: { flex: 1 },
  modalCheckoutHeaderText: { textAlign: 'center', alignSelf: 'stretch' },
  modalCenterWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.48)' },
  modalCardCompact: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 318,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'stretch',
    zIndex: 1,
    ...(Platform.OS === 'android' ? { elevation: 14 } : {}),
  },
  modalCardReviewOnly: { maxWidth: 300 },
  modalReviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  modalTitleCompact: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.35,
    textAlign: 'left',
    marginBottom: 4,
    lineHeight: 22,
  },
  modalSubCompact: { fontSize: 13, textAlign: 'left', marginBottom: 12, lineHeight: 18 },
  modalStarRowCompact: { flexDirection: 'row', gap: 6, marginBottom: 12, justifyContent: 'center' },
  modalStarCompact: { fontSize: 32, lineHeight: 38 },
  modalSubmitBtnCompact: {
    backgroundColor: '#1D9E75',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginBottom: 10,
    width: '100%',
    alignItems: 'center',
  },
  modalSubmitTextCompact: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalSkipCompact: { fontSize: 13, fontWeight: '500', paddingVertical: 6, alignSelf: 'center' },
  reviewComposerInputCompact: {
    alignSelf: 'stretch',
    minHeight: 64,
    maxHeight: 92,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 8,
    fontSize: 15,
    textAlignVertical: 'top',
    marginBottom: 12,
    overflow: 'hidden',
  },
  reviewComposerInputCompactTall: {
    alignSelf: 'stretch',
    minHeight: 72,
    maxHeight: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 8,
    fontSize: 15,
    textAlignVertical: 'top',
    marginBottom: 12,
    overflow: 'hidden',
  },
  reviewHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  reviewMineActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reviewName: { fontSize: 15, fontWeight: '700', flex: 1, minWidth: 0 },
  reviewEditText: { fontSize: 14, fontWeight: '700', color: '#0EA5E9' },
  reviewBody: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  reviewsPrimaryBtn: {
    alignSelf: 'stretch',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  reviewsPrimaryBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
})