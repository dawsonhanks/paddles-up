import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { ensureFavoritesUser } from '@/lib/favorites'
import { sendPushNotification } from '@/lib/push'
import { MaterialIcons } from '@expo/vector-icons'
import { useNetworkOffline } from '@/contexts/network-status-context'
import { userFriendlyFromUnknown, userFriendlyMessage } from '@/lib/errors'
import { useFocusEffect } from '@react-navigation/native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { ContentFadeIn } from '@/components/content-fade-in'
import { ErrorBanner } from '@/components/error-banner'
import { SkeletonGamePostCard, SkeletonSessionCard } from '@/components/skeleton-card'
import { PLAY_TAB_EMPTY_COPY } from '@/lib/playEmptyState'
import { getPlayRatingFilter, subscribePlayRatingFilter } from '@/lib/playRatingFilter'
import {
  type CourtPickerRow,
  deleteScheduledSessionById,
  fetchCourtRowsForPicker,
  fetchUpcomingScheduledSessions,
  formatSessionHumanDate,
  insertScheduledSessionWithReminder,
  scheduledSessionRelativeLabel,
  type ScheduledSessionRow,
  updateScheduledSessionWithReminder,
} from '@/lib/scheduledSessions'
import { supabase } from '@/supabase'

const SKILL_LEVELS = ['Beginner', 'Intermediate', 'Advanced']
const CITIES = ['Lehi', 'American Fork', 'Pleasant Grove', 'Orem', 'Provo', 'Highland', 'Cedar Hills', 'Alpine', 'Saratoga Springs', 'Eagle Mountain']

type GamePost = {
  id: string
  display_name: string
  skill_level: string
  city: string
  message: string
  players_needed: number
  created_at: string
  expires_at: string
  user_id: string
  game_type: 'singles' | 'doubles' | 'open'
  court_id?: string | null
  session_starts_at?: string | null
  /** Hydrated client-side after courts lookup for display only */
  resolved_court_name?: string | null
}

type PlayTabSection = 'sessions' | 'find'

function defaultSuggestedSessionStart(): Date {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 2)
  return d
}

function mergeDateKeepTime(base: Date, picked: Date): Date {
  const n = new Date(base)
  n.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate())
  return n
}

function mergeTimeKeepDate(base: Date, picked: Date): Date {
  const n = new Date(base)
  n.setHours(picked.getHours(), picked.getMinutes(), 0, 0)
  return n
}

type PlayerRatingRow = {
  user_id: string
  skill_rating: number | null
}

type AcceptRow = {
  post_id: string
  user_id: string
  display_name: string
  skill_level: string | null
  created_at: string
}

const GAME_TYPE_OPTIONS = [
  { key: 'singles' as const, label: 'Singles', sub: '1v1' },
  { key: 'doubles' as const, label: 'Doubles', sub: '2v2' },
  { key: 'open' as const, label: 'Open', sub: 'Any number' },
]
const PLAYERS_NEEDED_OPTIONS = ['1', '2', '3', '4', '5', '6'] as const

const PLAY_EXPIRE_AT_MIDNIGHT_KEY = 'play.expireAtMidnight'
const CACHED_GAME_POSTS_KEY = 'cached_game_posts'
/** Match Record tab FAB (`record.tsx`). */
const FAB_SIZE = 56

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function gameTypeBadge(gameType: string): string {
  if (gameType === 'singles') return 'Singles'
  if (gameType === 'doubles') return 'Doubles'
  return 'Open'
}

function spotsLabel(post: GamePost, accepts: AcceptRow[]): string {
  const filled = accepts.length
  const total = filled + Math.max(0, post.players_needed)
  return `${filled} of ${total} spots filled`
}

function skillColor(level: string): { bg: string; text: string } {
  switch (level.toLowerCase()) {
    case 'beginner': return { bg: '#E1F5EE', text: '#0F6E56' }
    case 'intermediate': return { bg: '#FAEEDA', text: '#633806' }
    case 'advanced': return { bg: '#FCEBEB', text: '#791F1F' }
    default: return { bg: '#F1EFE8', text: '#5F5E5A' }
  }
}

function nextLocalMidnightIso(now = new Date()): string {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d.toISOString()
}

async function notifyParticipantsGameFull(postId: string, posterUserId: string) {
  const { data: acceptRows } = await supabase.from('accepts').select('user_id').eq('post_id', postId)
  const recipients = new Set<string>([posterUserId])
  for (const r of acceptRows ?? []) {
    const uid = (r as { user_id: string }).user_id
    if (uid) recipients.add(uid)
  }
  for (const recipientId of recipients) {
    const { data: tokenRow } = await supabase
      .from('notification_tokens')
      .select('push_token')
      .eq('user_id', recipientId)
      .maybeSingle()
    if (tokenRow?.push_token) {
      await sendPushNotification(
        tokenRow.push_token,
        'Game full',
        'Your game is full - time to play!',
      )
    }
  }
}

function formatAcceptRpcError(message: string): string {
  const raw = message.toLowerCase()
  if (raw.includes('cannot accept your own post')) return "You can't join your own game post."
  if (raw.includes('game is full')) return 'This game is already full.'
  if (raw.includes('duplicate key') || raw.includes('accepts_post_id_user_id_key')) return 'You already joined this game.'
  if (raw.includes('post not found')) return 'This post is no longer available.'
  if (raw.includes('not authenticated')) return 'Please sign in and try again.'
  return userFriendlyMessage(message)
}

export default function PlayScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'

  const [posts, setPosts] = useState<GamePost[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [playBanner, setPlayBanner] = useState<string | null>(null)
  const isOffline = useNetworkOffline()
  const [cachedPostsAt, setCachedPostsAt] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [acceptedPostIds, setAcceptedPostIds] = useState<Set<string>>(new Set())
  const [acceptBusyPostId, setAcceptBusyPostId] = useState<string | null>(null)

  const [expireAtMidnight, setExpireAtMidnight] = useState(false)

  const [name, setName] = useState('')
  const [skill, setSkill] = useState('')
  const [city, setCity] = useState('')
  const [message, setMessage] = useState('')
  const [playersNeeded, setPlayersNeeded] = useState('2')
  const [gameType, setGameType] = useState<'singles' | 'doubles' | 'open'>('open')
  const [editingPost, setEditingPost] = useState<GamePost | null>(null)

  const [acceptsByPostId, setAcceptsByPostId] = useState<Record<string, AcceptRow[]>>({})
  const [expandedPosts, setExpandedPosts] = useState<Record<string, boolean>>({})
  const [ratingsByUserId, setRatingsByUserId] = useState<Record<string, number | null>>({})
  const [ratingMin, setRatingMin] = useState<number>(() => getPlayRatingFilter().ratingMin)
  const [ratingMax, setRatingMax] = useState<number>(() => getPlayRatingFilter().ratingMax)

  const [playSection, setPlaySection] = useState<PlayTabSection>('find')
  const [scheduledSessions, setScheduledSessions] = useState<ScheduledSessionRow[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsRefreshing, setSessionsRefreshing] = useState(false)

  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [scheduleCourtId, setScheduleCourtId] = useState('')
  const [scheduleCourtName, setScheduleCourtName] = useState('')
  const [scheduleSessionAt, setScheduleSessionAt] = useState(() => defaultSuggestedSessionStart())
  const [scheduleNotes, setScheduleNotes] = useState('')
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [editingScheduledSessionId, setEditingScheduledSessionId] = useState<string | null>(null)
  /** Snapshot when edit opens so reminder cancel works even if the list refetches. */
  const [editingSessionNotificationId, setEditingSessionNotificationId] = useState<string | null>(null)
  /** Inline court list inside parent modal (nested Modal does not present reliably on iOS). */
  const [courtPickOverlay, setCourtPickOverlay] = useState<null | 'schedule' | 'compose'>(null)
  const [courtPickSearch, setCourtPickSearch] = useState('')
  const [courtPickerRows, setCourtPickerRows] = useState<CourtPickerRow[]>([])
  const [courtPickLoading, setCourtPickLoading] = useState(false)
  /** Android sequential date/time pickers */
  const [androidDpMode, setAndroidDpMode] = useState<'idle' | 'date' | 'time'>('idle')

  const [composeCourtId, setComposeCourtId] = useState<string | null>(null)
  const [composeCourtName, setComposeCourtName] = useState('')
  const [composeSessionStartsAt, setComposeSessionStartsAt] = useState<Date | null>(null)
  const [composeCourtSearch, setComposeCourtSearch] = useState('')
  const [showComposeDatetime, setShowComposeDatetime] = useState(false)

  useEffect(() => {
    const unsub = subscribePlayRatingFilter(() => {
      const next = getPlayRatingFilter()
      setRatingMin(next.ratingMin)
      setRatingMax(next.ratingMax)
    })
    return unsub
  }, [])

  const offlineCacheAgeLabel = useMemo(() => {
    if (!cachedPostsAt) return undefined
    const ms = Date.now() - new Date(cachedPostsAt).getTime()
    if (!Number.isFinite(ms) || ms < 0) return undefined
    const mins = Math.floor(ms / 60000)
    if (mins < 1) return 'Last updated just now'
    if (mins < 60) return `Last updated ${mins} min ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `Last updated ${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `Last updated ${days}d ago`
  }, [cachedPostsAt])

  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  const filteredCourtPickForSchedule = useMemo(() => {
    const q = courtPickSearch.trim().toLowerCase()
    if (!q.length) return courtPickerRows
    return courtPickerRows.filter((c) => c.name.toLowerCase().includes(q))
  }, [courtPickSearch, courtPickerRows])

  const filteredCourtPickForCompose = useMemo(() => {
    const q = composeCourtSearch.trim().toLowerCase()
    if (!q.length) return courtPickerRows
    return courtPickerRows.filter((c) => c.name.toLowerCase().includes(q))
  }, [composeCourtSearch, courtPickerRows])

  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(PLAY_EXPIRE_AT_MIDNIGHT_KEY).then((val) => {
      if (cancelled) return
      setExpireAtMidnight(val === 'true')
    })
    return () => { cancelled = true }
  }, [])

  const ratingFilterActive = ratingMin !== 1.0 || ratingMax !== 5.0

  function openSkillRatingFilter() {
    router.push({
      pathname: '/play/skill-filter',
      params: { ratingMin: String(ratingMin), ratingMax: String(ratingMax) },
    })
  }

  const expireHint = useMemo(() => {
    if (!expireAtMidnight) return 'Uses the default expiration.'
    const midnight = new Date(nextLocalMidnightIso())
    const hrs = Math.max(0, Math.round((midnight.getTime() - Date.now()) / 3600000))
    return hrs <= 1 ? 'Expires at midnight.' : `Expires at midnight (about ${hrs}h).`
  }, [expireAtMidnight])

  const filteredPosts = useMemo(
    () =>
      posts.filter((p) => {
        const rating = ratingsByUserId[p.user_id] ?? null
        const isDefaultRange = ratingMin === 1.0 && ratingMax === 5.0
        if (rating == null) return isDefaultRange
        return rating >= ratingMin && rating <= ratingMax
      }),
    [posts, ratingsByUserId, ratingMin, ratingMax],
  )

  const myGames = useMemo(() => {
    if (!currentUserId) return []
    return filteredPosts.filter(
      (p) => p.user_id === currentUserId || acceptedPostIds.has(p.id),
    )
  }, [filteredPosts, currentUserId, acceptedPostIds])

  const browsePosts = useMemo(() => {
    const mine = new Set(myGames.map((p) => p.id))
    return filteredPosts.filter((p) => !mine.has(p.id))
  }, [filteredPosts, myGames])

  const loadPosts = useCallback(async (opts?: { pullToRefresh?: boolean }) => {
    const pullToRefresh = opts?.pullToRefresh === true
    if (pullToRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      if (isOffline) {
        const raw = await AsyncStorage.getItem(CACHED_GAME_POSTS_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as { posts?: GamePost[]; cachedAt?: string }
          const hydrated = (parsed.posts ?? []).map((p) => ({
            ...p,
            game_type: (p.game_type as GamePost['game_type']) ?? 'open',
          }))
          setPosts(hydrated)
          setCachedPostsAt(parsed.cachedAt ?? null)
        } else {
          setPosts([])
          setCachedPostsAt(null)
        }
        setAcceptedPostIds(new Set())
        setAcceptsByPostId({})
        setRatingsByUserId({})
        return
      }

      const gate = await ensureFavoritesUser()
      let uid: string | null = null
      if (!('error' in gate)) {
        uid = gate.userId
        setCurrentUserId(uid)
      } else {
        setCurrentUserId(null)
      }

      const { data } = await supabase
        .from('game_posts')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
      const rawPostsPre = ((data ?? []) as GamePost[]).map((p) => ({
        ...p,
        game_type: (p.game_type as GamePost['game_type']) ?? 'open',
      }))
      const courtIdsNeeded = [...new Set(
        rawPostsPre
          .map((p) => (typeof p.court_id === 'string' ? p.court_id.trim() : ''))
          .filter(Boolean)
      )]
      let nameByCourtId: Record<string, string> = {}
      if (courtIdsNeeded.length > 0) {
        const { data: cnRows } = await supabase.from('courts').select('id, name').in('id', courtIdsNeeded)
        for (const r of (cnRows ?? []) as { id: string; name: string | null }[]) {
          const nm = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : ''
          nameByCourtId[String(r.id)] = nm.length > 0 ? nm : 'Court'
        }
      }
      const rawPosts = rawPostsPre.map((p) => {
        const cid = typeof p.court_id === 'string' && p.court_id.trim() ? p.court_id.trim() : ''
        return {
          ...p,
          resolved_court_name: cid ? nameByCourtId[cid] ?? null : null,
        }
      })
      const nextPosts = rawPosts
      setPosts(nextPosts)

      const posterUserIds = nextPosts
        .map((p) => p.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (posterUserIds.length > 0) {
        const { data: ratingRows } = await supabase
          .from('players')
          .select('user_id, skill_rating')
          .in('user_id', posterUserIds)
        const ratingMap: Record<string, number | null> = {}
        for (const row of (ratingRows ?? []) as PlayerRatingRow[]) {
          ratingMap[row.user_id] = row.skill_rating ?? null
        }
        setRatingsByUserId(ratingMap)
      } else {
        setRatingsByUserId({})
      }

      const postIds = nextPosts.map((p) => p.id)
      if (postIds.length > 0) {
        const { data: acceptRows } = await supabase
          .from('accepts')
          .select('post_id, user_id, display_name, skill_level, created_at')
          .in('post_id', postIds)
          .order('created_at', { ascending: true })
        const buckets: Record<string, AcceptRow[]> = {}
        for (const id of postIds) buckets[id] = []
        for (const row of acceptRows ?? []) {
          const a = row as AcceptRow
          if (!buckets[a.post_id]) buckets[a.post_id] = []
          buckets[a.post_id].push(a)
        }
        setAcceptsByPostId(buckets)
      } else {
        setAcceptsByPostId({})
      }
      const cachedAt = new Date().toISOString()
      await AsyncStorage.setItem(
        CACHED_GAME_POSTS_KEY,
        JSON.stringify({ cachedAt, posts: nextPosts })
      )
      setCachedPostsAt(cachedAt)

      if (uid) {
        const { data: acceptRows } = await supabase.from('accepts').select('post_id').eq('user_id', uid)
        setAcceptedPostIds(new Set((acceptRows ?? []).map((r) => r.post_id as string)))
      } else {
        setAcceptedPostIds(new Set())
      }
    } finally {
      if (pullToRefresh) setRefreshing(false)
      else setLoading(false)
    }
  }, [isOffline])

  const primeCourtPickList = useCallback(async () => {
    setCourtPickLoading(true)
    try {
      const rows = await fetchCourtRowsForPicker()
      setCourtPickerRows(rows)
    } catch {
      setPlayBanner('We could not load the court list. Check your connection and try again.')
    } finally {
      setCourtPickLoading(false)
    }
  }, [])

  const loadScheduledSessions = useCallback(async (opts?: { refreshing?: boolean }) => {
    if (opts?.refreshing === true) setSessionsRefreshing(true)
    else setSessionsLoading(true)
    try {
      if (isOffline) {
        setScheduledSessions([])
        return
      }
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setScheduledSessions([])
        return
      }
      const rows = await fetchUpcomingScheduledSessions(gate.userId)
      setScheduledSessions(rows)
    } catch {
      setScheduledSessions([])
    } finally {
      setSessionsRefreshing(false)
      setSessionsLoading(false)
    }
  }, [isOffline])

  function openBlankScheduleComposer() {
    setEditingScheduledSessionId(null)
    setEditingSessionNotificationId(null)
    setScheduleCourtId('')
    setScheduleCourtName('')
    setScheduleNotes('')
    setScheduleSessionAt(defaultSuggestedSessionStart())
    setCourtPickSearch('')
    setAndroidDpMode('idle')
    setCourtPickOverlay(null)
    void primeCourtPickList()
    setShowScheduleModal(true)
  }

  function closeScheduleComposer() {
    setShowScheduleModal(false)
    setEditingScheduledSessionId(null)
    setEditingSessionNotificationId(null)
    setCourtPickSearch('')
    setAndroidDpMode('idle')
    setCourtPickOverlay(null)
  }

  function openEditScheduledSession(sess: ScheduledSessionRow) {
    void primeCourtPickList()
    setEditingScheduledSessionId(sess.id)
    setEditingSessionNotificationId(sess.notification_id ?? null)
    setScheduleCourtId(sess.court_id)
    setScheduleCourtName(sess.court_name)
    const d = new Date(sess.session_date)
    setScheduleSessionAt(Number.isFinite(d.getTime()) ? d : defaultSuggestedSessionStart())
    setScheduleNotes(typeof sess.notes === 'string' ? sess.notes : '')
    setCourtPickSearch('')
    setAndroidDpMode('idle')
    setCourtPickOverlay(null)
    setShowScheduleModal(true)
  }

  async function openScheduleFromJoinedGamePost(post: GamePost) {
    await primeCourtPickList()
    const gate = await ensureFavoritesUser()
    if ('error' in gate) {
      setPlayBanner(userFriendlyFromUnknown(gate.error))
      return
    }
    let cid = typeof post.court_id === 'string' && post.court_id.trim() ? post.court_id.trim() : ''
    let cname = ''
    if (cid) {
      const match = courtPickerRows.find((c) => c.id === cid)?.name
      if (typeof match === 'string' && match.trim()) {
        cname = match
      } else {
        const { data } = await supabase.from('courts').select('name').eq('id', cid).maybeSingle()
        const n = (data as { name?: string } | null)?.name
        cname = typeof n === 'string' && n.trim() ? n : 'Court'
      }
    }
    let nextAt = defaultSuggestedSessionStart()
    const iso = typeof post.session_starts_at === 'string' ? post.session_starts_at : ''
    if (iso.trim()) {
      const tms = new Date(iso).getTime()
      if (Number.isFinite(tms) && tms > Date.now() + 60_000) nextAt = new Date(tms)
    }
    const noteFromPost = typeof post.message === 'string' && post.message.trim() ? post.message.trim() : ''
    setScheduleCourtId(cid)
    setScheduleCourtName(cname)
    setScheduleSessionAt(nextAt)
    setScheduleNotes(noteFromPost)
    setCourtPickSearch('')
    setAndroidDpMode('idle')
    setEditingScheduledSessionId(null)
    setEditingSessionNotificationId(null)
    setCourtPickOverlay(null)
    void primeCourtPickList()
    setShowScheduleModal(true)
  }

  async function saveScheduledSessionDraft() {
    if (scheduleCourtId.trim().length === 0 || scheduleCourtName.trim().length === 0) {
      Alert.alert('Choose a court', 'Pick where you’re playing.')
      return
    }
    if (!(scheduleSessionAt.getTime() > Date.now())) {
      Alert.alert('Pick a future time', 'Session time needs to be in the future.')
      return
    }
    setScheduleSaving(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setPlayBanner(userFriendlyFromUnknown(gate.error))
        return
      }
      let res: { row: ScheduledSessionRow | null; error?: string }
      if (editingScheduledSessionId != null) {
        res = await updateScheduledSessionWithReminder({
          sessionId: editingScheduledSessionId,
          userId: gate.userId,
          courtId: scheduleCourtId.trim(),
          courtName: scheduleCourtName.trim(),
          sessionDate: scheduleSessionAt,
          notes: scheduleNotes,
          previousNotificationId: editingSessionNotificationId,
        })
      } else {
        res = await insertScheduledSessionWithReminder({
          userId: gate.userId,
          courtId: scheduleCourtId.trim(),
          courtName: scheduleCourtName.trim(),
          sessionDate: scheduleSessionAt,
          notes: scheduleNotes,
        })
      }
      if (res.error || !res.row) {
        setPlayBanner(userFriendlyFromUnknown(res.error ?? ''))
        return
      }
      await loadScheduledSessions()
      closeScheduleComposer()
    } finally {
      setScheduleSaving(false)
    }
  }

  function promptScheduledSessionActions(sess: ScheduledSessionRow) {
    Alert.alert(sess.court_name, 'Edit details or delete this session.', [
      {
        text: 'Edit',
        onPress: () => {
          Keyboard.dismiss()
          openEditScheduledSession(sess)
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Keyboard.dismiss()
          Alert.alert(
            'Delete scheduled session?',
            'This removes the session and its reminder.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  Keyboard.dismiss()
                  const gate = await ensureFavoritesUser()
                  if ('error' in gate) return
                  const del = await deleteScheduledSessionById(sess.id, gate.userId, sess.notification_id)
                  if (!del.ok) setPlayBanner(userFriendlyFromUnknown(del.error ?? ''))
                  else await loadScheduledSessions()
                },
              },
            ]
          )
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function ensureCurrentUserId(): Promise<string | null> {
    const gate = await ensureFavoritesUser()
    if ('error' in gate) return null
    setCurrentUserId(gate.userId)
    return gate.userId
  }

  useFocusEffect(
    useCallback(() => {
      void loadPosts()
      void loadScheduledSessions()
    }, [loadPosts, loadScheduledSessions])
  )

  useEffect(() => {
    if (isOffline) return
    void loadPosts()
  }, [isOffline, loadPosts])

  async function acceptGamePost(post: GamePost) {
    if (acceptBusyPostId) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setAcceptBusyPostId(post.id)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setPlayBanner(userFriendlyFromUnknown(gate.error))
        return
      }
      const { data: player } = await supabase
        .from('players')
        .select('display_name, pickup_skill_level')
        .eq('user_id', gate.userId)
        .maybeSingle()
      const displayName = player?.display_name?.trim() || 'Anonymous'
      const pickupSkill = (player as { pickup_skill_level?: string | null } | null)?.pickup_skill_level?.trim() || null

      const { error } = await supabase.rpc('accept_game_post', {
        p_post_id: post.id,
        p_display_name: displayName,
        p_skill_level: pickupSkill,
      })
      if (error) {
        setPlayBanner(formatAcceptRpcError(error.message))
        return
      }

      const { data: tokenRow } = await supabase
        .from('notification_tokens')
        .select('push_token')
        .eq('user_id', post.user_id)
        .maybeSingle()
      if (tokenRow?.push_token) {
        await sendPushNotification(
          tokenRow.push_token,
          'Game update',
          `${displayName} joined your game!`,
        )
      }

      setAcceptedPostIds((prev) => new Set(prev).add(post.id))

      const { data: after } = await supabase
        .from('game_posts')
        .select('players_needed')
        .eq('id', post.id)
        .maybeSingle()
      if (after && (after.players_needed ?? 0) <= 0) {
        await notifyParticipantsGameFull(post.id, post.user_id)
      }

      await loadPosts()
    } finally {
      setAcceptBusyPostId(null)
    }
  }

  async function unacceptGamePost(post: GamePost) {
    if (acceptBusyPostId) return
    setAcceptBusyPostId(post.id)
    try {
      const { error } = await supabase.rpc('unaccept_game_post', { p_post_id: post.id })
      if (error) {
        setPlayBanner(formatAcceptRpcError(error.message))
        return
      }
      setAcceptedPostIds((prev) => {
        const next = new Set(prev)
        next.delete(post.id)
        return next
      })
      await loadPosts()
    } finally {
      setAcceptBusyPostId(null)
    }
  }

  async function submitPost() {
    if (!name.trim()) { Alert.alert('Name required', 'Add your name so others can find you.'); return }
    if (!skill) { Alert.alert('Skill level required', 'Pick your skill level.'); return }
    if (!city) { Alert.alert('City required', 'Pick your city.'); return }

    setSubmitting(true)
    try {
      const gate = await ensureFavoritesUser()
      const userId = 'error' in gate ? null : gate.userId
      if (userId) setCurrentUserId(userId)

      const need = parseInt(playersNeeded, 10)
      const validatedNeed = PLAYERS_NEEDED_OPTIONS.includes(String(need) as (typeof PLAYERS_NEEDED_OPTIONS)[number])
        ? need
        : 2

      const insertRow: Record<string, unknown> = {
        user_id: userId,
        display_name: name.trim(),
        skill_level: skill,
        city,
        message: message.trim(),
        players_needed: validatedNeed,
        game_type: gameType,
      }
      if (expireAtMidnight) insertRow.expires_at = nextLocalMidnightIso()
      if (composeCourtId && composeCourtId.trim()) insertRow.court_id = composeCourtId.trim()
      else insertRow.court_id = null
      if (composeSessionStartsAt instanceof Date && Number.isFinite(composeSessionStartsAt.getTime())) {
        insertRow.session_starts_at = composeSessionStartsAt.toISOString()
      } else insertRow.session_starts_at = null

      const { error } = await supabase.from('game_posts').insert(insertRow)

      if (error) { setPlayBanner(userFriendlyFromUnknown(error.message)); return }

      setShowModal(false)
      setName('')
      setSkill('')
      setCity('')
      setMessage('')
      setPlayersNeeded('2')
      setGameType('open')
      setComposeCourtId(null)
      setComposeCourtName('')
      setComposeSessionStartsAt(null)
      setComposeCourtSearch('')
      loadPosts()
      Alert.alert('Posted!', 'Players nearby will see your post.')
    } finally {
      setSubmitting(false)
    }
  }

  function openNewPostModal() {
    setEditingPost(null)
    setName('')
    setSkill('')
    setCity('')
    setMessage('')
    setPlayersNeeded('2')
    setGameType('open')
    setComposeCourtId(null)
    setComposeCourtName('')
    setComposeSessionStartsAt(null)
    setComposeCourtSearch('')
    setCourtPickOverlay(null)
    setShowComposeDatetime(false)
    setShowModal(true)
  }

  function closeComposer() {
    setShowModal(false)
    setEditingPost(null)
    setCourtPickOverlay(null)
    setShowComposeDatetime(false)
  }

  function openEditPost(post: GamePost) {
    setEditingPost(post)
    setName(post.display_name)
    setSkill(post.skill_level)
    setCity(post.city)
    setMessage(post.message ?? '')
    setPlayersNeeded(String(Math.max(1, Math.min(6, post.players_needed || 2))))
    setGameType(post.game_type ?? 'open')
    const cpid = typeof post.court_id === 'string' && post.court_id.trim() ? post.court_id.trim() : null
    setComposeCourtId(cpid)
    setComposeCourtName(
      typeof post.resolved_court_name === 'string' && post.resolved_court_name.trim() ? post.resolved_court_name.trim() : ''
    )
    void (async () => {
      if (cpid && post.resolved_court_name?.trim()) return
      if (cpid) {
        const cached = courtPickerRows.find((c) => c.id === cpid)?.name
        if (cached?.trim()) {
          setComposeCourtName(cached)
          return
        }
        const { data } = await supabase.from('courts').select('name').eq('id', cpid).maybeSingle()
        const n = (data as { name?: string } | null)?.name
        setComposeCourtName(typeof n === 'string' && n.trim() ? n : 'Court')
      }
    })()
    const sas = typeof post.session_starts_at === 'string' && post.session_starts_at.trim() ? new Date(post.session_starts_at) : null
    setComposeSessionStartsAt(sas && Number.isFinite(sas.getTime()) ? sas : null)
    setShowModal(true)
  }

  async function saveEditedPost() {
    if (!editingPost) return
    if (!name.trim()) { Alert.alert('Name required', 'Add your name so others can find you.'); return }
    if (!skill) { Alert.alert('Skill level required', 'Pick your skill level.'); return }
    if (!city) { Alert.alert('City required', 'Pick your city.'); return }

    setSubmitting(true)
    try {
      const userId = currentUserId ?? await ensureCurrentUserId()
      if (!userId) { setPlayBanner('Give us a moment, then try that again.'); return }

      const need = parseInt(playersNeeded, 10)
      const validatedNeed = PLAYERS_NEEDED_OPTIONS.includes(String(need) as (typeof PLAYERS_NEEDED_OPTIONS)[number])
        ? need
        : 2

      const up: Record<string, unknown> = {
        display_name: name.trim(),
        skill_level: skill,
        city,
        message: message.trim(),
        players_needed: validatedNeed,
        game_type: gameType,
      }
      if (composeCourtId && composeCourtId.trim()) up.court_id = composeCourtId.trim()
      else up.court_id = null
      if (composeSessionStartsAt instanceof Date && Number.isFinite(composeSessionStartsAt.getTime())) {
        up.session_starts_at = composeSessionStartsAt.toISOString()
      } else up.session_starts_at = null

      const { error } = await supabase
        .from('game_posts')
        .update(up)
        .eq('id', editingPost.id)
        .eq('user_id', userId)

      if (error) { setPlayBanner(userFriendlyFromUnknown(error.message)); return }

      setEditingPost(null)
      setShowModal(false)
      setName('')
      setSkill('')
      setCity('')
      setMessage('')
      setPlayersNeeded('2')
      setGameType('open')
      setComposeCourtId(null)
      setComposeCourtName('')
      setComposeSessionStartsAt(null)
      loadPosts()
      Alert.alert('Post updated', 'Your game post has been updated.')
    } finally {
      setSubmitting(false)
    }
  }

  function renderGameCard(item: GamePost) {
    const sc = skillColor(item.skill_level)
    const isMine = currentUserId != null && item.user_id === currentUserId
    const accepts = acceptsByPostId[item.id] ?? []
    const expanded = !!expandedPosts[item.id]
    const gtLabel = gameTypeBadge(item.game_type)
    const posterRating = ratingsByUserId[item.user_id] ?? null

    return (
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={styles.cardTop}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{item.display_name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={[styles.cardName, { color: theme.text }]}>{item.display_name}</Text>
            <Text style={[styles.cardMeta, { color: theme.icon }]}>{item.city} · {timeAgo(item.created_at)}</Text>
            <View style={styles.gameTypeBadgeRow}>
              <View style={[styles.gameTypePillSmall, { backgroundColor: isDark ? 'rgba(29,158,117,0.22)' : '#E1F5EE', borderColor: '#1D9E75' }]}>
                <Text style={[styles.gameTypePillSmallText, { color: '#0F6E56' }]}>{gtLabel}</Text>
              </View>
              {posterRating != null ? (
                <View style={[styles.gameTypePillSmall, styles.ratingBadgePill, { backgroundColor: isDark ? 'rgba(14,165,233,0.25)' : '#E0F2FE', borderColor: '#0EA5E9' }]}>
                  <Image source={require('../../assets/images/icon.png')} style={styles.ratingLogoTiny} />
                  <Text style={[styles.gameTypePillSmallText, { color: '#0369A1' }]}>{posterRating.toFixed(1)}</Text>
                </View>
              ) : null}
            </View>
          </View>
          <View style={[styles.skillBadge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.skillText, { color: sc.text }]}>{item.skill_level}</Text>
          </View>
        </View>
        {item.message ? (
          <Text style={[styles.cardMessage, { color: theme.text }]}>{item.message}</Text>
        ) : null}
        {item.session_starts_at || item.resolved_court_name ? (
          <View style={styles.gameMeetWrap}>
            {item.session_starts_at ? (
              <Text style={[styles.gameMeetMeta, { color: theme.icon }]} numberOfLines={2}>
                <Text style={{ fontWeight: '700', color: theme.text }}>Meet: </Text>
                {formatSessionHumanDate(new Date(item.session_starts_at))}
              </Text>
            ) : null}
            {item.resolved_court_name ? (
              <Text style={[styles.gameMeetMeta, { color: theme.icon }]} numberOfLines={2}>
                <Text style={{ fontWeight: '700', color: theme.text }}>Court: </Text>
                {item.resolved_court_name}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.joinersBlock}>
          {accepts.length > 0 ? (
            <View style={styles.joinersAvatars}>
              {accepts.slice(0, 8).map((a) => (
                <View key={a.user_id} style={[styles.miniAvatar, { borderColor: cardBorder }]}>
                  <Text style={styles.miniAvatarText}>{a.display_name.charAt(0).toUpperCase()}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.spotsRow}>
            <MaterialIcons name="groups" size={16} color={theme.icon} />
            <Text style={[styles.spotsText, { color: theme.icon }]}>
              {spotsLabel(item, accepts)}
            </Text>
          </View>
        </View>

        <Pressable
          onPress={() => {
            Keyboard.dismiss()
            setExpandedPosts((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
          }}
          style={({ pressed }) => [
            styles.playersToggle,
            { borderColor: cardBorder, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC', opacity: pressed ? 0.85 : 1 },
          ]}>
          <Text style={[styles.playersToggleText, { color: theme.text }]}>
            Players {accepts.length > 0 ? `(${accepts.length})` : ''}
          </Text>
          <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={20} color={theme.icon} />
        </Pressable>

        {expanded ? (
          <View style={[styles.playersList, { borderTopColor: cardBorder }]}>
            {accepts.length === 0 ? (
              <Text style={[styles.playersEmpty, { color: theme.icon }]}>No one has joined yet.</Text>
            ) : (
              accepts.map((a) => (
                <View key={a.user_id} style={[styles.playerRow, { borderBottomColor: cardBorder }]}>
                  <View style={styles.avatarCircleSm}>
                    <Text style={styles.avatarTextSm}>{a.display_name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.playerName, { color: theme.text }]} numberOfLines={1}>{a.display_name}</Text>
                    <Text style={[styles.playerSkill, { color: theme.icon }]}>
                      Skill: {a.skill_level?.trim() ? a.skill_level : 'Not set'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}

        <View style={[styles.cardFooter, { borderTopColor: cardBorder }]}>
          <View style={styles.cardFooterSpacer}>
            {item.players_needed <= 0 ? (
              <View style={[styles.gameFullBadge, { borderColor: cardBorder, backgroundColor: isDark ? 'rgba(148,163,184,0.15)' : '#F1F5F9' }]}>
                <MaterialIcons name="groups" size={16} color={isDark ? '#94A3B8' : '#64748B'} />
                <Text style={[styles.gameFullBadgeText, { color: isDark ? '#94A3B8' : '#64748B' }]}>Game full</Text>
              </View>
            ) : null}
          </View>
          {isMine ? (
            <View style={styles.cardActions}>
              <TouchableOpacity
                onPress={() => {
                  Keyboard.dismiss()
                  openEditPost(item)
                }}
                style={[styles.smallActionBtn, { borderColor: cardBorder }]}>
                <MaterialIcons name="edit" size={15} color="#0EA5E9" />
                <Text style={[styles.smallActionText, { color: '#0EA5E9' }]}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  Keyboard.dismiss()
                  promptDeletePost(item)
                }}
                style={[styles.smallActionBtn, { borderColor: cardBorder }]}>
                <MaterialIcons name="delete-outline" size={15} color="#E24B4A" />
                <Text style={[styles.smallActionText, { color: '#E24B4A' }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          ) : acceptedPostIds.has(item.id) ? (
            <View style={styles.acceptedJoinedCol}>
              <TouchableOpacity
                onPress={() => {
                  Keyboard.dismiss()
                  unacceptGamePost(item)
                }}
                disabled={acceptBusyPostId === item.id}
                style={[styles.joinedBadge, { borderColor: cardBorder, opacity: acceptBusyPostId === item.id ? 0.6 : 1 }]}>
                {acceptBusyPostId === item.id ? (
                  <ActivityIndicator size="small" color="#1D9E75" />
                ) : (
                  <>
                    <MaterialIcons name="check-circle" size={16} color="#1D9E75" />
                    <Text style={styles.joinedBadgeText}>Joined ✓</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  Keyboard.dismiss()
                  void openScheduleFromJoinedGamePost(item)
                }}
                style={[styles.addSessionInlineBtn, { borderColor: cardBorder, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F0FDF7' }]}>
                <MaterialIcons name="calendar-month" size={15} color="#1D9E75" />
                <Text style={styles.addSessionInlineText}>Add to my sessions</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => {
                Keyboard.dismiss()
                acceptGamePost(item)
              }}
              disabled={acceptBusyPostId != null || item.players_needed <= 0}
              style={[styles.acceptBtn, { opacity: acceptBusyPostId != null || item.players_needed <= 0 ? 0.55 : 1 }]}>
              {acceptBusyPostId === item.id ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.acceptBtnText}>Accept</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    )
  }

  function promptDeletePost(post: GamePost) {
    Alert.alert(
      'Delete post?',
      'This will permanently remove your game post.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
        text: 'Delete',
        style: 'destructive',
          onPress: async () => {
            Keyboard.dismiss()
            const userId = currentUserId ?? await ensureCurrentUserId()
            if (!userId) { setPlayBanner('Give us a moment, then try that again.'); return }
            const { error } = await supabase
              .from('game_posts')
              .delete()
              .eq('id', post.id)
              .eq('user_id', userId)
            if (error) {
              setPlayBanner(userFriendlyFromUnknown(error.message))
              return
            }
            setPosts((prev) => prev.filter((p) => p.id !== post.id))
            Alert.alert('Deleted', 'Your post has been removed.')
          }
        }
      ]
    )
  }

  function renderScheduledSessionCard(row: ScheduledSessionRow) {
    const when = new Date(row.session_date)
    const rel = scheduledSessionRelativeLabel(when)
    const humanWhen = formatSessionHumanDate(when)
    const note = typeof row.notes === 'string' && row.notes.trim() ? row.notes.trim() : null
    return (
      <Pressable
        onPress={() => {
          Keyboard.dismiss()
          router.push(`/court/${encodeURIComponent(row.court_id)}`)
        }}
        onLongPress={() => {
          Keyboard.dismiss()
          promptScheduledSessionActions(row)
        }}
        delayLongPress={500}
        style={({ pressed }) => [
          styles.sessionCard,
          {
            borderColor: cardBorder,
            backgroundColor: cardBg,
            opacity: pressed ? 0.92 : 1,
          },
        ]}>
        <Text style={[styles.sessionCourtName, { color: theme.text }]} numberOfLines={2}>
          {row.court_name}
        </Text>
        <Text style={[styles.sessionHumanWhen, { color: theme.icon }]}>{humanWhen}</Text>
        <Text style={[styles.sessionCountdownLine, { color: '#1D9E75' }]}>{rel}</Text>
        {note ? <Text style={[styles.sessionNotesPreview, { color: theme.icon }]} numberOfLines={3}>{note}</Text> : null}
      </Pressable>
    )
  }

  const findGamesListBottomPad = FAB_SIZE + 32 + insets.bottom

  const findGameRefreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => loadPosts({ pullToRefresh: true })}
      tintColor="#1D9E75"
      colors={['#1D9E75']}
    />
  )

  const sessionsRefreshControl = (
    <RefreshControl
      refreshing={sessionsRefreshing}
      onRefresh={() => void loadScheduledSessions({ refreshing: true })}
      tintColor="#1D9E75"
      colors={['#1D9E75']}
    />
  )

  /** Clears list / empty-state content above the floating schedule pill (matches Find-a-Game FAB clearance). */
  const sessionsScheduleBtnBottomPad = FAB_SIZE + 32 + insets.bottom

  const findGamesFullyEmpty = !loading && browsePosts.length === 0 && myGames.length === 0

  const findGamesLoadedInner = findGamesFullyEmpty ? (
    <ScrollView
      style={styles.findGameFlex}
      contentContainerStyle={[
        styles.emptyScrollContent,
        { paddingBottom: findGamesListBottomPad },
      ]}
      refreshControl={findGameRefreshControl}
      keyboardShouldPersistTaps="handled">
      <View style={styles.emptyStateBlock}>
        <MaterialIcons name="sports" size={48} color={theme.icon} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>
          {PLAY_TAB_EMPTY_COPY.findGame.noGamesPostedTitle}
        </Text>
        <Text style={[styles.emptySub, { color: theme.icon }]}>
          {PLAY_TAB_EMPTY_COPY.findGame.noGamesPostedSub}
        </Text>
      </View>
    </ScrollView>
  ) : (
    <FlatList
      style={styles.findGameFlex}
      data={browsePosts}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.list, { paddingBottom: findGamesListBottomPad }]}
      refreshControl={findGameRefreshControl}
      ListHeaderComponent={
        myGames.length > 0 ? (
          <View style={styles.myGamesHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>My games</Text>
            {myGames.map((p) => (
              <View key={p.id} style={styles.myGameCardWrap}>
                {renderGameCard(p)}
              </View>
            ))}
            <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 4 }]}>Other games</Text>
          </View>
        ) : null
      }
      ListEmptyComponent={
        browsePosts.length === 0 ? (
          <View style={styles.otherEmpty}>
            <Text style={[styles.emptySub, { color: theme.icon }]}>
              {PLAY_TAB_EMPTY_COPY.findGame.noOtherGames}
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => <View style={styles.cardOuter}>{renderGameCard(item)}</View>}
    />
  )

  const findGamesBodyInner =
    loading ? (
      <ScrollView
        style={styles.findGameFlex}
        contentContainerStyle={[styles.list, { paddingBottom: findGamesListBottomPad }]}
        keyboardShouldPersistTaps="handled">
        {[0, 1, 2].map((k) => (
          <SkeletonGamePostCard key={k} isDark={isDark} />
        ))}
      </ScrollView>
    ) : (
      <ContentFadeIn show style={styles.findGameFlex}>
        {findGamesLoadedInner}
      </ContentFadeIn>
    )

  const schedulesFullyEmpty = !sessionsLoading && scheduledSessions.length === 0

  const sessionsLoadedInner = schedulesFullyEmpty ? (
    <View style={styles.sessionsEmptyShell}>
      <ScrollView
        style={styles.sessionsEmptyScroll}
        contentContainerStyle={[styles.emptyScrollContent, { paddingBottom: sessionsScheduleBtnBottomPad }]}
        refreshControl={sessionsRefreshControl}
        keyboardShouldPersistTaps="handled">
        <View style={styles.emptyStateBlock}>
          <MaterialIcons name="event-available" size={42} color={theme.icon} />
          <Text style={[styles.emptySub, { color: theme.icon, marginTop: 10, textAlign: 'center' }]}>
            {isOffline
              ? PLAY_TAB_EMPTY_COPY.sessions.offlineMessage
              : PLAY_TAB_EMPTY_COPY.sessions.noUpcoming}
          </Text>
        </View>
      </ScrollView>
    </View>
  ) : (
    <FlatList
      style={{ flex: 1 }}
      data={scheduledSessions}
      keyExtractor={(s) => s.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.sessionsList, { paddingBottom: sessionsScheduleBtnBottomPad }]}
      refreshControl={sessionsRefreshControl}
      renderItem={({ item }) => <View style={styles.cardOuter}>{renderScheduledSessionCard(item)}</View>}
    />
  )

  const schedulesBody =
    sessionsLoading && scheduledSessions.length === 0 ? (
      <View style={styles.sessionsEmptyShell}>
        <ScrollView
          style={styles.sessionsEmptyScroll}
          contentContainerStyle={[styles.sessionsList, { paddingBottom: sessionsScheduleBtnBottomPad }]}
          refreshControl={sessionsRefreshControl}
          keyboardShouldPersistTaps="handled">
          {[0, 1, 2].map((k) => (
            <SkeletonSessionCard key={k} isDark={isDark} />
          ))}
        </ScrollView>
      </View>
    ) : (
      <ContentFadeIn show style={{ flex: 1 }}>
        {sessionsLoadedInner}
      </ContentFadeIn>
    )

  const handleScheduleCourtRowPress = (c: CourtPickerRow, fromComposer: boolean) => {
    Keyboard.dismiss()
    if (fromComposer) {
      setComposeCourtId(c.id)
      setComposeCourtName(c.name)
      setCourtPickOverlay(null)
    } else {
      setScheduleCourtId(c.id)
      setScheduleCourtName(c.name)
      setCourtPickOverlay(null)
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.root}>
      <View style={styles.segmentOuter}>
        <View style={[styles.segmentTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }]}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => {
              Keyboard.dismiss()
              setPlaySection('sessions')
            }}
            style={[
              styles.segmentCell,
              playSection === 'sessions' && styles.segmentCellActive,
              playSection === 'sessions' ? { backgroundColor: isDark ? '#2C2C2E' : '#FFFFFF', shadowOpacity: isDark ? 0 : 0.08 } : null,
            ]}>
            <Text style={[styles.segmentLabel, { color: playSection === 'sessions' ? theme.text : theme.icon }]}>My Sessions</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => {
              Keyboard.dismiss()
              setPlaySection('find')
            }}
            style={[
              styles.segmentCell,
              playSection === 'find' && styles.segmentCellActive,
              playSection === 'find' ? { backgroundColor: isDark ? '#2C2C2E' : '#FFFFFF', shadowOpacity: isDark ? 0 : 0.08 } : null,
            ]}>
            <Text style={[styles.segmentLabel, { color: playSection === 'find' ? theme.text : theme.icon }]}>Find a Game</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ErrorBanner message={playBanner} onDismiss={() => setPlayBanner(null)} />
      {isOffline ? (
        <Text style={[styles.offlineLiveNotice, { color: isDark ? '#FCD34D' : '#92400E' }]}>
          {playSection === 'sessions'
            ? 'Reconnect to refresh your upcoming sessions.'
            : `${offlineCacheAgeLabel ? `${offlineCacheAgeLabel}. ` : ''}Showing saved posts until you reconnect.`}
        </Text>
      ) : null}

      {playSection === 'sessions' ? (
        <View style={styles.sessionsTabShell}>
          <View style={styles.sessionsSubtitleRow}>
            <Text style={[styles.sessionListSubtitle, { color: theme.icon }]}>
              Coming up · long-press to edit or delete
            </Text>
          </View>
          {schedulesBody}
          <TouchableOpacity
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Schedule a session"
            style={[styles.scheduleSessionFabCenter, { bottom: 16 + insets.bottom }]}
            onPress={() => {
              Keyboard.dismiss()
              openBlankScheduleComposer()
            }}>
            <View style={styles.scheduleSessionBottomBtn}>
              <MaterialIcons name="add" size={18} color="#fff" />
              <Text style={styles.scheduleSessionHeaderBtnText}>Schedule a Session</Text>
            </View>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.findGameShell}>
          {findGamesBodyInner}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              ratingFilterActive
                ? `Filter games by skill rating, ${ratingMin.toFixed(1)} to ${ratingMax.toFixed(1)}`
                : 'Filter games by skill rating'
            }
            style={({ pressed }) => [
              styles.fabFilter,
              {
                bottom: 16 + insets.bottom,
                left: 16 + insets.left,
                opacity: pressed ? 0.92 : 1,
                backgroundColor: isDark ? '#2C2C2E' : '#FFFFFF',
                borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)',
              },
            ]}
            onPress={async () => {
              Keyboard.dismiss()
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              openSkillRatingFilter()
            }}>
            <MaterialIcons name="tune" size={26} color={ratingFilterActive ? '#1D9E75' : theme.icon} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Post a game"
            style={({ pressed }) => [
              styles.fabPost,
              {
                bottom: 16 + insets.bottom,
                right: 16 + insets.right,
                opacity: pressed ? 0.92 : 1,
              },
            ]}
            onPress={async () => {
              Keyboard.dismiss()
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
              openNewPostModal()
            }}>
            <MaterialIcons name="add" size={30} color="#fff" />
          </Pressable>
        </View>
      )}

      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]} edges={['top']}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.modal}>
          {courtPickOverlay === 'compose' ? (
            <>
              <View style={styles.modalHeaderTri}>
                <TouchableOpacity
                  onPress={() => {
                    Keyboard.dismiss()
                    setCourtPickOverlay(null)
                  }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={styles.modalHeaderSide}>
                  <MaterialIcons name="arrow-back" size={24} color={theme.icon} />
                </TouchableOpacity>
                <Text style={[styles.modalTitleCentered, { color: theme.text }]}>Pick a court</Text>
                <TouchableOpacity
                  onPress={() => {
                    Keyboard.dismiss()
                    closeComposer()
                  }}
                  style={styles.modalHeaderSide}>
                  <MaterialIcons name="close" size={24} color={theme.icon} />
                </TouchableOpacity>
              </View>
              <TextInput
                placeholder="Search by name…"
                value={composeCourtSearch}
                onChangeText={setComposeCourtSearch}
                placeholderTextColor={theme.icon}
                style={[styles.input, styles.courtPickSearchInputInset, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
              />
              {courtPickLoading ? (
                <View style={styles.centered}>
                  <ActivityIndicator color={theme.tint} />
                </View>
              ) : (
                <FlatList
                  style={{ flex: 1 }}
                  data={filteredCourtPickForCompose}
                  keyExtractor={(c) => c.id}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.courtPickListInset}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.courtPickRow, { borderBottomColor: cardBorder }]}
                      onPress={() => handleScheduleCourtRowPress(item, true)}>
                      <Text style={[styles.courtPickRowTitle, { color: theme.text }]} numberOfLines={2}>{item.name}</Text>
                    </TouchableOpacity>
                  )}
                />
              )}
            </>
          ) : (
            <>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>{editingPost ? 'Edit post' : 'Post a game'}</Text>
                <TouchableOpacity
                  onPress={() => {
                    Keyboard.dismiss()
                    closeComposer()
                  }}>
                  <MaterialIcons name="close" size={24} color={theme.icon} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Your name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Jake T."
              placeholderTextColor={theme.icon}
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Skill level</Text>
            <View style={styles.pillRow}>
              {SKILL_LEVELS.map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => {
                    Keyboard.dismiss()
                    setSkill(s)
                  }}
                  style={[styles.pill, { borderColor: skill === s ? '#1D9E75' : cardBorder, backgroundColor: skill === s ? '#E1F5EE' : cardBg }]}>
                  <Text style={[styles.pillText, { color: skill === s ? '#0F6E56' : theme.icon }]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Your city</Text>
            <View style={styles.cityGrid}>
              {CITIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => {
                    Keyboard.dismiss()
                    setCity(c)
                  }}
                  style={[styles.cityPill, { borderColor: city === c ? '#1D9E75' : cardBorder, backgroundColor: city === c ? '#E1F5EE' : cardBg }]}>
                  <Text style={[styles.pillText, { color: city === c ? '#0F6E56' : theme.icon }]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Game type</Text>
            <View style={styles.gameTypePicker}>
              {GAME_TYPE_OPTIONS.map((opt) => {
                const sel = gameType === opt.key
                return (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => {
                      Keyboard.dismiss()
                      setGameType(opt.key)
                    }}
                    activeOpacity={0.85}
                    style={[
                      styles.gameTypeOption,
                      { borderColor: sel ? '#1D9E75' : cardBorder, backgroundColor: sel ? (isDark ? 'rgba(29, 158, 117, 0.2)' : '#E1F5EE') : cardBg },
                    ]}>
                    <Text style={[styles.gameTypeOptionTitle, { color: sel ? '#0F6E56' : theme.text }]}>{opt.label}</Text>
                    <Text style={[styles.gameTypeOptionSub, { color: theme.icon }]}>{opt.sub}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Players needed</Text>
            <View style={styles.playersNeededGrid}>
              {PLAYERS_NEEDED_OPTIONS.map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => {
                    Keyboard.dismiss()
                    setPlayersNeeded(n)
                  }}
                  style={[styles.playersNeededPill, { borderColor: playersNeeded === n ? '#1D9E75' : cardBorder, backgroundColor: playersNeeded === n ? '#E1F5EE' : cardBg }]}>
                  <Text style={[styles.playersNeededPillText, { color: playersNeeded === n ? '#0F6E56' : theme.icon }]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Message (optional)</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="e.g. Looking to play around 3pm at any Lehi court"
              placeholderTextColor={theme.icon}
              multiline
              numberOfLines={3}
              style={[styles.input, styles.textArea, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Court and meet time (optional)</Text>
            <Text style={[styles.optionalSubcopy, { color: theme.icon }]}>
              Helps people add the game straight to My Sessions after they join.
            </Text>
            <TouchableOpacity
              onPress={() => {
                Keyboard.dismiss()
                setComposeCourtSearch('')
                setCourtPickOverlay('compose')
                void primeCourtPickList()
              }}
              style={[styles.composeOptionalRow, { borderColor: cardBorder, backgroundColor: cardBg }]}>
              <MaterialIcons name="place" size={18} color={theme.icon} />
              <Text style={[styles.composeOptionalPrimary, { color: theme.text }]}>
                {composeCourtId && composeCourtName.trim() ? composeCourtName : 'Tap to choose a venue'}
              </Text>
              <MaterialIcons name="chevron-right" size={20} color={theme.icon} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                Keyboard.dismiss()
                if (!(composeSessionStartsAt instanceof Date) || !Number.isFinite((composeSessionStartsAt as Date).getTime())) {
                  setComposeSessionStartsAt(defaultSuggestedSessionStart())
                }
                setShowComposeDatetime((prev) => !prev)
              }}
              style={[styles.composeOptionalRow, { borderColor: cardBorder, backgroundColor: cardBg }]}>
              <MaterialIcons name="schedule" size={18} color={theme.icon} />
              <Text style={[styles.composeOptionalPrimary, { color: theme.text }]}>
                {composeSessionStartsAt instanceof Date && Number.isFinite(composeSessionStartsAt.getTime())
                  ? formatSessionHumanDate(composeSessionStartsAt)
                  : 'Set meet time'}
              </Text>
              <MaterialIcons name={showComposeDatetime ? 'expand-less' : 'expand-more'} size={20} color={theme.icon} />
            </TouchableOpacity>
            {(composeCourtId || composeSessionStartsAt) ? (
              <TouchableOpacity
                style={styles.clearOptionalLink}
                onPress={() => {
                  Keyboard.dismiss()
                  setComposeCourtId(null)
                  setComposeCourtName('')
                  setComposeSessionStartsAt(null)
                  setShowComposeDatetime(false)
                }}>
                <Text style={[styles.clearOptionalLinkText, { color: theme.icon }]}>Clear venue & time</Text>
              </TouchableOpacity>
            ) : null}
            {showComposeDatetime && composeSessionStartsAt instanceof Date ? (
              Platform.OS === 'web' ? (
                <Text style={[styles.optionalSubcopy, { color: theme.icon }]}>Meet time picker is available in the native app.</Text>
              ) : (
                <>
                  <Text style={[styles.miniPickerLabel, { color: theme.icon }]}>Date</Text>
                  <DateTimePicker
                    themeVariant={colorScheme ?? 'light'}
                    value={composeSessionStartsAt}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_e, d) => {
                      if (!d) return
                      setComposeSessionStartsAt((prev) =>
                        mergeDateKeepTime(prev instanceof Date && Number.isFinite(prev.getTime()) ? prev : defaultSuggestedSessionStart(), d)
                      )
                    }}
                  />
                  <Text style={[styles.miniPickerLabel, { color: theme.icon }]}>Time</Text>
                  <DateTimePicker
                    themeVariant={colorScheme ?? 'light'}
                    value={composeSessionStartsAt}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_e, d) => {
                      if (!d) return
                      setComposeSessionStartsAt((prev) =>
                        mergeTimeKeepDate(prev instanceof Date && Number.isFinite(prev.getTime()) ? prev : defaultSuggestedSessionStart(), d)
                      )
                    }}
                  />
                </>
              )
            ) : null}

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Expiration</Text>
            <TouchableOpacity
              onPress={async () => {
                Keyboard.dismiss()
                const next = !expireAtMidnight
                setExpireAtMidnight(next)
                await AsyncStorage.setItem(PLAY_EXPIRE_AT_MIDNIGHT_KEY, next ? 'true' : 'false')
              }}
              activeOpacity={0.8}
              style={[
                styles.expireRow,
                { borderColor: cardBorder, backgroundColor: cardBg },
                expireAtMidnight && { borderColor: '#1D9E75' },
              ]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.expireTitle, { color: theme.text }]}>Expire at midnight</Text>
                <Text style={[styles.expireSub, { color: theme.icon }]}>{expireHint}</Text>
              </View>
              <MaterialIcons
                name={expireAtMidnight ? 'check-circle' : 'radio-button-unchecked'}
                size={22}
                color={expireAtMidnight ? '#1D9E75' : theme.icon}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={() => {
                Keyboard.dismiss()
                void (editingPost ? saveEditedPost() : submitPost())
              }}
              disabled={submitting}
              activeOpacity={0.8}>
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>{editingPost ? 'Save changes' : 'Post game'}</Text>
              )}
            </TouchableOpacity>

            <View style={{ height: 40 }} />
              </ScrollView>
            </>
          )}
          </View>
          </TouchableWithoutFeedback>
        </SafeAreaView>
      </Modal>

      <Modal visible={showScheduleModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]} edges={['top']}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.modal}>
          {courtPickOverlay === 'schedule' ? (
            <>
              <View style={styles.modalHeaderTri}>
                <TouchableOpacity
                  onPress={() => {
                    Keyboard.dismiss()
                    setCourtPickOverlay(null)
                  }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={styles.modalHeaderSide}>
                  <MaterialIcons name="arrow-back" size={24} color={theme.icon} />
                </TouchableOpacity>
                <Text style={[styles.modalTitleCentered, { color: theme.text }]}>Choose court</Text>
                <TouchableOpacity
                  onPress={() => {
                    Keyboard.dismiss()
                    closeScheduleComposer()
                  }}
                  style={styles.modalHeaderSide}>
                  <MaterialIcons name="close" size={24} color={theme.icon} />
                </TouchableOpacity>
              </View>
              <TextInput
                placeholder="Search by name…"
                value={courtPickSearch}
                onChangeText={setCourtPickSearch}
                placeholderTextColor={theme.icon}
                style={[styles.input, styles.courtPickSearchInputInset, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
              />
              {courtPickLoading ? (
                <View style={styles.centered}>
                  <ActivityIndicator color={theme.tint} />
                </View>
              ) : (
                <FlatList
                  style={{ flex: 1 }}
                  data={filteredCourtPickForSchedule}
                  keyboardShouldPersistTaps="handled"
                  keyExtractor={(c) => c.id}
                  contentContainerStyle={styles.courtPickListInset}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.courtPickRow, { borderBottomColor: cardBorder }]}
                      onPress={() => handleScheduleCourtRowPress(item, false)}>
                      <Text style={[styles.courtPickRowTitle, { color: theme.text }]} numberOfLines={2}>{item.name}</Text>
                    </TouchableOpacity>
                  )}
                />
              )}
            </>
          ) : (
            <>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>
                  {editingScheduledSessionId != null ? 'Edit session' : 'Schedule session'}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    Keyboard.dismiss()
                    closeScheduleComposer()
                  }}>
                  <MaterialIcons name="close" size={24} color={theme.icon} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Court</Text>
            <TouchableOpacity
              onPress={() => {
                Keyboard.dismiss()
                setCourtPickSearch('')
                setCourtPickOverlay('schedule')
                void primeCourtPickList()
              }}
              style={[styles.composeOptionalRow, { borderColor: cardBorder, backgroundColor: cardBg }]}>
              <MaterialIcons name="place" size={18} color={theme.icon} />
              <Text style={[styles.composeOptionalPrimary, { color: scheduleCourtName.trim() ? theme.text : theme.icon }]}>
                {scheduleCourtName.trim() ? scheduleCourtName : 'Tap to choose a venue'}
              </Text>
              <MaterialIcons name="chevron-right" size={20} color={theme.icon} />
            </TouchableOpacity>

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>When</Text>
            {Platform.OS === 'web' ? (
              <Text style={[styles.optionalSubcopy, { color: theme.icon }]}>Date and time pickers are available in the native app.</Text>
            ) : Platform.OS === 'android' ? (
              <View style={styles.scheduleAndroidPickers}>
                <TouchableOpacity
                  onPress={() => {
                    Keyboard.dismiss()
                    setAndroidDpMode('date')
                  }}
                  style={[styles.androidPickerBtn, { borderColor: cardBorder, backgroundColor: cardBg }]}>
                  <Text style={[styles.androidPickerBtnText, { color: theme.text }]}>
                    {scheduleSessionAt.toLocaleDateString()}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    Keyboard.dismiss()
                    setAndroidDpMode('time')
                  }}
                  style={[styles.androidPickerBtn, { borderColor: cardBorder, backgroundColor: cardBg }]}>
                  <Text style={[styles.androidPickerBtnText, { color: theme.text }]}>
                    {scheduleSessionAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <DateTimePicker
                  themeVariant={colorScheme ?? 'light'}
                  value={scheduleSessionAt}
                  mode="date"
                  display="spinner"
                  onChange={(_e, d) => {
                    if (d) setScheduleSessionAt((prev) => mergeDateKeepTime(prev, d))
                  }}
                />
                <DateTimePicker
                  themeVariant={colorScheme ?? 'light'}
                  value={scheduleSessionAt}
                  mode="time"
                  display="spinner"
                  onChange={(_e, d) => {
                    if (d) setScheduleSessionAt((prev) => mergeTimeKeepDate(prev, d))
                  }}
                />
              </>
            )}
            {Platform.OS === 'android' && androidDpMode !== 'idle' ? (
              <DateTimePicker
                themeVariant={colorScheme ?? 'light'}
                value={scheduleSessionAt}
                mode={androidDpMode === 'date' ? 'date' : 'time'}
                display="default"
                onChange={(evt, date) => {
                  const kind = typeof (evt as { type?: unknown })?.type === 'string'
                    ? (evt as { type: string }).type
                    : ''
                  const dismissed = kind === 'dismissed'
                  if (!dismissed && date != null && androidDpMode === 'date') {
                    setScheduleSessionAt((prev) => mergeDateKeepTime(prev, date))
                  } else if (!dismissed && date != null && androidDpMode === 'time') {
                    setScheduleSessionAt((prev) => mergeTimeKeepDate(prev, date))
                  }
                  setAndroidDpMode('idle')
                }}
              />
            ) : null}

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Notes (optional)</Text>
            <TextInput
              value={scheduleNotes}
              onChangeText={setScheduleNotes}
              placeholderTextColor={theme.icon}
              placeholder="Bring drinks, warmup plan…"
              multiline
              numberOfLines={3}
              style={[styles.input, styles.textArea, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />

            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.submitBtn, scheduleSaving && { opacity: 0.65 }]}
              disabled={scheduleSaving}
              onPress={() => {
                Keyboard.dismiss()
                void saveScheduledSessionDraft()
              }}>
              {scheduleSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>
                  {editingScheduledSessionId != null ? 'Save changes' : 'Save session'}
                </Text>
              )}
            </TouchableOpacity>
            <View style={{ height: 32 }} />
              </ScrollView>
            </>
          )}
          </View>
          </TouchableWithoutFeedback>
        </SafeAreaView>
      </Modal>
      </View>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  findGameShell: { flex: 1 },
  findGameFlex: { flex: 1 },
  fabPost: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
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
  fabFilter: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
      },
      android: { elevation: 8 },
    }),
  },
  offlineLiveNotice: { paddingHorizontal: 20, paddingBottom: 4, fontSize: 12, fontWeight: '600' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  /** Fill viewport so empty-state icon + copy sit vertically centered */
  emptyScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyStateBlock: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  sessionsEmptyShell: { flex: 1 },
  sessionsEmptyScroll: { flex: 1 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 16 },
  emptySub: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  list: { padding: 16, gap: 12 },
  myGamesHeader: { marginBottom: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  myGameCardWrap: { marginBottom: 12 },
  cardOuter: { marginBottom: 12 },
  otherEmpty: { paddingVertical: 20, alignItems: 'center' },
  card: { borderRadius: 14, borderWidth: 0.5, padding: 16 },
  gameTypeBadgeRow: { flexDirection: 'row', marginTop: 6, flexWrap: 'wrap', gap: 6 },
  gameTypePillSmall: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, borderWidth: 0.5 },
  ratingBadgePill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gameTypePillSmallText: { fontSize: 11, fontWeight: '700' },
  ratingLogoTiny: { width: 12, height: 12, borderRadius: 3 },
  joinersBlock: { marginBottom: 10 },
  joinersAvatars: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  miniAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#534AB7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  miniAvatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  spotsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  spotsText: { fontSize: 13, fontWeight: '600' },
  playersToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 0.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  playersToggleText: { fontSize: 14, fontWeight: '600' },
  playersList: { borderTopWidth: 0.5, paddingTop: 8, marginBottom: 4 },
  playersEmpty: { fontSize: 13, paddingVertical: 6, fontStyle: 'italic' },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
  },
  avatarCircleSm: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center' },
  avatarTextSm: { color: '#fff', fontSize: 14, fontWeight: '700' },
  playerName: { fontSize: 14, fontWeight: '600' },
  playerSkill: { fontSize: 12, marginTop: 2 },
  gameTypePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gameTypeOption: {
    flexGrow: 1,
    minWidth: 104,
    borderWidth: 0.5,
    borderRadius: 12,
    padding: 12,
  },
  gameTypeOptionTitle: { fontSize: 14, fontWeight: '700' },
  gameTypeOptionSub: { fontSize: 11, marginTop: 4 },
  playersNeededGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  playersNeededPill: {
    minWidth: 44,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 0.5,
    alignItems: 'center',
  },
  playersNeededPillText: { fontSize: 15, fontWeight: '600' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '600' },
  cardMeta: { fontSize: 12, marginTop: 2 },
  skillBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  skillText: { fontSize: 12, fontWeight: '600' },
  cardMessage: { fontSize: 14, lineHeight: 20, marginBottom: 10 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 10, borderTopWidth: 0.5, flexWrap: 'wrap' },
  cardFooterSpacer: { flex: 1, minWidth: 80, justifyContent: 'center' },
  cardFooterLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  cardFooterText: { fontSize: 13 },
  cardActions: { flexDirection: 'row', gap: 8 },
  smallActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 0.5, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5 },
  smallActionText: { fontSize: 12, fontWeight: '600' },
  acceptBtn: { backgroundColor: '#1D9E75', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, minWidth: 88, alignItems: 'center', justifyContent: 'center' },
  acceptBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  joinedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 0.5, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  joinedBadgeText: { fontSize: 12, fontWeight: '700', color: '#1D9E75' },
  gameFullBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 0.5 },
  gameFullBadgeText: { fontSize: 13, fontWeight: '700' },
  modal: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  modalHeaderTri: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    gap: 4,
  },
  modalHeaderSide: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitleCentered: { flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  modalScroll: { flex: 1, paddingHorizontal: 20 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 0.5, borderRadius: 12, padding: 14, fontSize: 15 },
  textArea: { height: 90, textAlignVertical: 'top' },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 0.5, alignItems: 'center' },
  pillText: { fontSize: 14, fontWeight: '500' },
  cityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cityPill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 0.5 },
  expireRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderRadius: 12, padding: 14 },
  expireTitle: { fontSize: 15, fontWeight: '600' },
  expireSub: { fontSize: 13, marginTop: 4 },
  submitBtn: { backgroundColor: '#1D9E75', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  segmentOuter: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  segmentTrack: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  segmentCell: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  segmentCellActive: {
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  segmentLabel: { fontSize: 14, fontWeight: '700' },
  sessionsTabShell: { flex: 1 },
  sessionsSubtitleRow: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  sessionsList: { padding: 16, gap: 10, flexGrow: 1 },
  sessionListSubtitle: { fontSize: 13, lineHeight: 18 },
  scheduleSessionFabCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  scheduleSessionBottomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1D9E75',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2,
        shadowRadius: 5,
      },
      android: { elevation: 6 },
    }),
  },
  scheduleSessionHeaderBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sessionCard: { borderRadius: 14, borderWidth: 0.5, padding: 14 },
  sessionCourtName: { fontSize: 17, fontWeight: '700' },
  sessionHumanWhen: { fontSize: 14, marginTop: 4 },
  sessionCountdownLine: { fontSize: 13, marginTop: 4, fontWeight: '700' },
  sessionNotesPreview: { fontSize: 13, marginTop: 10, lineHeight: 18 },
  gameMeetWrap: { marginBottom: 10, gap: 4 },
  gameMeetMeta: { fontSize: 13, lineHeight: 18 },
  acceptedJoinedCol: { alignItems: 'flex-end', gap: 8 },
  addSessionInlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 0.5,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  addSessionInlineText: { fontSize: 12, fontWeight: '700', color: '#1D9E75' },
  optionalSubcopy: { fontSize: 13, marginBottom: 8, lineHeight: 18 },
  composeOptionalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 0.5,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  composeOptionalPrimary: { flex: 1, fontSize: 15, fontWeight: '600' },
  clearOptionalLink: { marginBottom: 10 },
  clearOptionalLinkText: { fontSize: 13, fontWeight: '600' },
  miniPickerLabel: { fontSize: 12, fontWeight: '600', marginTop: 6, marginBottom: 4 },
  courtPickSearchInput: { marginHorizontal: 20, marginBottom: 8 },
  courtPickSearchInputInset: { marginHorizontal: 20, marginBottom: 8 },
  courtPickList: { paddingBottom: 24 },
  courtPickListInset: { paddingBottom: 24 },
  courtPickRow: { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  courtPickRowTitle: { fontSize: 16, fontWeight: '600' },
  scheduleAndroidPickers: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  androidPickerBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 0.5,
  },
  androidPickerBtnText: { fontSize: 14, fontWeight: '600' },
})