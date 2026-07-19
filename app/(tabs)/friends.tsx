import { ContentFadeIn } from '@/components/content-fade-in'
import { ErrorBanner } from '@/components/error-banner'
import { FriendAvatar } from '@/components/friend-avatar'
import { ReportReasonModal } from '@/components/report-reason-modal'
import { SkeletonCard } from '@/components/skeleton-card'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { USERNAME_AVAILABILITY_DEBOUNCE_MS } from '@/hooks/use-username-availability'
import { ensureFavoritesUser } from '@/lib/favorites'
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  fetchFriendsWithStats,
  fetchPendingFriendRequests,
  searchPlayersFriendshipAware,
  sendFriendRequest,
  type FriendPlayerWithRecord,
  type FriendRequestItem,
  type FriendSearchResult,
} from '@/lib/friends'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { showReportActionSheet } from '@/lib/showReportMenu'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useNavigation, useRouter } from 'expo-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import type { ContentReportType } from '@/lib/contentReports'

export default function FriendsScreen() {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const navigation = useNavigation()
  const router = useRouter()

  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const muted = isDark ? '#94A3B8' : '#64748B'

  const [friends, setFriends] = useState<FriendPlayerWithRecord[]>([])
  const [incoming, setIncoming] = useState<FriendRequestItem[]>([])
  const [outgoing, setOutgoing] = useState<FriendRequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const [showAddFriends, setShowAddFriends] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FriendSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [actingRequestId, setActingRequestId] = useState<string | null>(null)
  const [friendsBanner, setFriendsBanner] = useState<string | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [reportTarget, setReportTarget] = useState<{ type: ContentReportType; id: string } | null>(null)

  const deadRef = useRef(false)
  useEffect(() => {
    deadRef.current = false
    return () => {
      deadRef.current = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void ensureFavoritesUser().then((g) => {
      if (cancelled) return
      if (!('error' in g)) setMyUserId(g.userId)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const loadFriends = useCallback(async (cancelledRef?: { current: boolean }) => {
    if (deadRef.current) return
    setLoading(true)
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        fetchFriendsWithStats(),
        fetchPendingFriendRequests(),
      ])
      if (cancelledRef?.current || deadRef.current) return
      if (friendsRes.error) {
        setFriendsBanner(userFriendlyFromUnknown(friendsRes.error))
      } else {
        setFriends(friendsRes.friends)
      }
      if (requestsRes.error) {
        setFriendsBanner(userFriendlyFromUnknown(requestsRes.error))
      } else {
        setIncoming(requestsRes.incoming)
        setOutgoing(requestsRes.outgoing)
      }
    } finally {
      if (!cancelledRef?.current && !deadRef.current) setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      const cancelled = { current: false }
      void loadFriends(cancelled)
      return () => {
        cancelled.current = true
      }
    }, [loadFriends]),
  )

  useLayoutEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: theme.background },
      headerTintColor: theme.text,
      headerTitleStyle: { fontWeight: '700' },
      headerShadowVisible: false,
      headerRight: () => (
        <TouchableOpacity
          onPress={() => {
            setSearchQuery('')
            setSearchResults([])
            setShowAddFriends(true)
          }}
          style={{ marginRight: 4, padding: 8 }}
          hitSlop={12}
          accessibilityLabel="Search players">
          <MaterialIcons name="person-search" size={24} color={theme.tint} />
        </TouchableOpacity>
      ),
    })
  }, [navigation, theme.background, theme.text, theme.tint])

  const filteredFriends = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return friends
    return friends.filter((f) => {
      const name = (f.display_name ?? '').toLowerCase()
      const un = (f.username ?? '').toLowerCase()
      return name.includes(q) || un.includes(q)
    })
  }, [friends, filter])

  const filterRequests = useCallback(
    (items: FriendRequestItem[]) => {
      const q = filter.trim().toLowerCase()
      if (!q) return items
      return items.filter((item) => {
        const name = (item.player.display_name ?? '').toLowerCase()
        const un = (item.player.username ?? '').toLowerCase()
        return name.includes(q) || un.includes(q)
      })
    },
    [filter],
  )

  const filteredIncoming = useMemo(() => filterRequests(incoming), [filterRequests, incoming])
  const filteredOutgoing = useMemo(() => filterRequests(outgoing), [filterRequests, outgoing])

  async function searchPlayers() {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const { results, error } = await searchPlayersFriendshipAware(searchQuery.trim())
      if (deadRef.current) return
      if (error) {
        setSearchResults([])
        setFriendsBanner(userFriendlyFromUnknown(error))
        return
      }
      setSearchResults(results)
    } finally {
      if (!deadRef.current) setSearching(false)
    }
  }

  useEffect(() => {
    if (!showAddFriends) return
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults([])
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      void searchPlayersFriendshipAware(q).then(({ results, error }) => {
        if (cancelled || deadRef.current) return
        if (error) {
          setSearchResults([])
          setFriendsBanner(userFriendlyFromUnknown(error))
        } else {
          setSearchResults(results)
          setFriendsBanner(null)
        }
        setSearching(false)
      })
    }, USERNAME_AVAILABILITY_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searchQuery, showAddFriends])

  async function addFriend(friendUserId: string) {
    setAddingId(friendUserId)
    try {
      const result = await sendFriendRequest(friendUserId)
      if (deadRef.current) return
      if (result.error) {
        setFriendsBanner(userFriendlyFromUnknown(result.error))
        return
      }
      if (result.autoAccepted) {
        setSearchResults((prev) =>
          prev.map((p) =>
            p.user_id === friendUserId ? { ...p, linkStatus: 'friends' as const, requestId: undefined } : p,
          ),
        )
      } else {
        setSearchResults((prev) =>
          prev.map((p) =>
            p.user_id === friendUserId
              ? { ...p, linkStatus: 'outgoing_pending' as const, requestId: result.requestId }
              : p,
          ),
        )
      }
      await loadFriends()
    } finally {
      if (!deadRef.current) setAddingId(null)
    }
  }

  async function onAcceptRequest(requestId: string, fromSearchUserId?: string) {
    setActingRequestId(requestId)
    try {
      const { error } = await acceptFriendRequest(requestId)
      if (deadRef.current) return
      if (error) {
        setFriendsBanner(userFriendlyFromUnknown(error))
        return
      }
      if (fromSearchUserId) {
        setSearchResults((prev) =>
          prev.map((p) =>
            p.user_id === fromSearchUserId ? { ...p, linkStatus: 'friends' as const, requestId: undefined } : p,
          ),
        )
      }
      await loadFriends()
    } finally {
      if (!deadRef.current) setActingRequestId(null)
    }
  }

  async function onDeclineRequest(requestId: string) {
    setActingRequestId(requestId)
    try {
      const { error } = await declineFriendRequest(requestId)
      if (deadRef.current) return
      if (error) {
        setFriendsBanner(userFriendlyFromUnknown(error))
        return
      }
      await loadFriends()
    } finally {
      if (!deadRef.current) setActingRequestId(null)
    }
  }

  async function onCancelRequest(requestId: string, toUserId?: string) {
    setActingRequestId(requestId)
    try {
      const { error } = await cancelFriendRequest(requestId)
      if (deadRef.current) return
      if (error) {
        setFriendsBanner(userFriendlyFromUnknown(error))
        return
      }
      if (toUserId) {
        setSearchResults((prev) =>
          prev.map((p) =>
            p.user_id === toUserId ? { ...p, linkStatus: 'none' as const, requestId: undefined } : p,
          ),
        )
      }
      await loadFriends()
    } finally {
      if (!deadRef.current) setActingRequestId(null)
    }
  }

  function renderFriendCard({ item: f }: { item: FriendPlayerWithRecord }) {
    return (
      <TouchableOpacity
        style={[styles.friendCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
        onPress={() => router.push(`/friends/${f?.user_id ?? ''}`)}
        onLongPress={() => {
          if (!myUserId || f?.user_id === myUserId) return
          Keyboard.dismiss()
          showReportActionSheet(() => setReportTarget({ type: 'profile', id: f?.user_id ?? '' }))
        }}
        delayLongPress={450}
        activeOpacity={0.75}>
        <FriendAvatar friend={f} size={56} />
        <View style={styles.friendMid}>
          <Text style={[styles.friendDisplay, { color: theme.text }]} numberOfLines={1}>
            {f?.display_name ?? f?.username ?? 'Player'}
          </Text>
          {f?.username ? <Text style={[styles.friendUsername, { color: muted }]} numberOfLines={1}>@{f.username}</Text> : null}
          <Text style={[styles.recordHint, { color: muted }]}>
            {f?.wins ?? 0}W {f?.losses ?? 0}L
          </Text>
        </View>
        <View style={styles.friendTrail}>
          {f?.skill_rating != null ? (
            <View style={[styles.skillBadgeSm, isDark ? { backgroundColor: 'rgba(29, 158, 117, 0.2)' } : { backgroundColor: '#E1F5EE' }]}>
              <Image source={require('../../assets/images/icon.png')} style={styles.ratingIco} />
              <Text style={[styles.skillBadgeTxt, { color: '#0F6E56' }]}>{f.skill_rating.toFixed(1)}</Text>
            </View>
          ) : null}
          <MaterialIcons name="chevron-right" size={22} color={muted} />
        </View>
      </TouchableOpacity>
    )
  }

  function renderIncomingCard(item: FriendRequestItem) {
    const busy = actingRequestId === item.id
    return (
      <View
        key={item.id}
        style={[styles.requestCard, { backgroundColor: cardBg, borderColor: '#F59E0B' }]}>
        <View style={styles.requestTop}>
          <FriendAvatar friend={item.player} size={48} />
          <View style={styles.friendMid}>
            <Text style={[styles.friendDisplay, { color: theme.text }]} numberOfLines={1}>
              {item.player.display_name ?? item.player.username ?? 'Player'}
            </Text>
            {item.player.username ? (
              <Text style={[styles.friendUsername, { color: muted }]} numberOfLines={1}>
                @{item.player.username}
              </Text>
            ) : null}
            <Text style={[styles.pendingHint, { color: '#D97706' }]}>Wants to be friends</Text>
          </View>
        </View>
        <View style={styles.requestActions}>
          <TouchableOpacity
            style={[styles.acceptBtn, busy && { opacity: 0.6 }]}
            onPress={() => onAcceptRequest(item.id)}
            disabled={busy}
            activeOpacity={0.8}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.acceptBtnText}>Accept</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.declineBtn, { borderColor: cardBorder }, busy && { opacity: 0.6 }]}
            onPress={() => onDeclineRequest(item.id)}
            disabled={busy}
            activeOpacity={0.8}>
            <Text style={[styles.declineBtnText, { color: theme.text }]}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  function renderOutgoingCard(item: FriendRequestItem) {
    const busy = actingRequestId === item.id
    return (
      <View
        key={item.id}
        style={[styles.requestCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={styles.requestTop}>
          <FriendAvatar friend={item.player} size={48} />
          <View style={styles.friendMid}>
            <Text style={[styles.friendDisplay, { color: theme.text }]} numberOfLines={1}>
              {item.player.display_name ?? item.player.username ?? 'Player'}
            </Text>
            {item.player.username ? (
              <Text style={[styles.friendUsername, { color: muted }]} numberOfLines={1}>
                @{item.player.username}
              </Text>
            ) : null}
            <Text style={[styles.pendingHint, { color: muted }]}>Pending</Text>
          </View>
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>Pending</Text>
          </View>
        </View>
        <View style={styles.requestActions}>
          <TouchableOpacity
            style={[styles.declineBtn, { borderColor: cardBorder, flex: 1 }, busy && { opacity: 0.6 }]}
            onPress={() => onCancelRequest(item.id)}
            disabled={busy}
            activeOpacity={0.8}>
            {busy ? (
              <ActivityIndicator color={theme.text} size="small" />
            ) : (
              <Text style={[styles.declineBtnText, { color: theme.text }]}>Cancel</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  function renderSearchRow(player: FriendSearchResult, i: number) {
    const isLast = i === searchResults.length - 1
    const busyAdd = addingId === player?.user_id
    const busyReq = player.requestId != null && actingRequestId === player.requestId

    let action
    if (player?.linkStatus === 'friends') {
      action = (
        <View style={styles.friendedBadge}>
          <MaterialIcons name="check" size={16} color="#1D9E75" />
          <Text style={styles.friendedText}>Friends</Text>
        </View>
      )
    } else if (player?.linkStatus === 'outgoing_pending') {
      action = (
        <TouchableOpacity
          style={[styles.declineBtn, { borderColor: cardBorder, paddingHorizontal: 12, minWidth: 88 }, busyReq && { opacity: 0.6 }]}
          onPress={() => player.requestId && onCancelRequest(player.requestId, player.user_id)}
          disabled={busyReq || !player.requestId}
          activeOpacity={0.8}>
          {busyReq ? (
            <ActivityIndicator color={theme.text} size="small" />
          ) : (
            <Text style={[styles.declineBtnText, { color: theme.text }]}>Cancel</Text>
          )}
        </TouchableOpacity>
      )
    } else if (player?.linkStatus === 'they_added_you') {
      action = (
        <TouchableOpacity
          style={[styles.addBtn, busyReq && { opacity: 0.6 }]}
          onPress={() => player.requestId && onAcceptRequest(player.requestId, player.user_id)}
          disabled={busyReq || !player.requestId}
          activeOpacity={0.8}>
          {busyReq ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.addBtnTxt}>Accept</Text>}
        </TouchableOpacity>
      )
    } else {
      action = (
        <TouchableOpacity
          style={[styles.addBtn, busyAdd && { opacity: 0.6 }]}
          onPress={() => addFriend(player?.user_id ?? '')}
          disabled={busyAdd}
          activeOpacity={0.8}>
          {busyAdd ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.addBtnTxt}>Add Friend</Text>}
        </TouchableOpacity>
      )
    }

    return (
      <View
        key={player?.user_id ?? String(i)}
        style={[
          styles.searchResultRow,
          { borderBottomColor: cardBorder },
          isLast && { borderBottomWidth: 0 },
        ]}>
        <Pressable
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 }}
          onLongPress={() => {
            if (!myUserId || player?.user_id === myUserId) return
            Keyboard.dismiss()
            showReportActionSheet(() => setReportTarget({ type: 'profile', id: player?.user_id ?? '' }))
          }}
          delayLongPress={450}>
          <FriendAvatar friend={player} size={44} />
          <View style={styles.searchResultInfo}>
            <Text style={[styles.searchResultName, { color: theme.text }]}>
              {player?.display_name ?? player?.username ?? 'Player'}
            </Text>
            {player?.username ? (
              <Text style={[styles.searchResultUsername, { color: muted }]}>@{player.username}</Text>
            ) : null}
            {player?.linkStatus === 'they_added_you' ? (
              <Text style={[styles.pendingHint, { color: '#D97706' }]}>Added you</Text>
            ) : null}
            {player?.linkStatus === 'outgoing_pending' ? (
              <Text style={[styles.pendingHint, { color: muted }]}>Request sent</Text>
            ) : null}
          </View>
        </Pressable>
        {action}
      </View>
    )
  }

  const listHeader = (
    <>
      {filteredIncoming.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Requests</Text>
          {filteredIncoming.map(renderIncomingCard)}
        </View>
      ) : null}
      {filteredOutgoing.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Sent</Text>
          {filteredOutgoing.map(renderOutgoingCard)}
        </View>
      ) : null}
      {filteredFriends.length > 0 ? (
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Friends</Text>
      ) : null}
    </>
  )

  const showEmpty =
    filteredFriends.length === 0 && filteredIncoming.length === 0 && filteredOutgoing.length === 0

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['bottom']}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.root}>
      <ErrorBanner message={friendsBanner} onDismiss={() => setFriendsBanner(null)} />
      <View style={[styles.toolbar, { paddingHorizontal: 16, paddingVertical: 10 }]}>
        <View style={[styles.searchBar, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <MaterialIcons name="search" size={22} color={muted} />
          <TextInput
            value={filter}
            onChangeText={setFilter}
            placeholder="Search friends…"
            placeholderTextColor={muted}
            style={[styles.searchBarInput, { color: theme.text }]}
          />
        </View>
      </View>

      {loading ? (
        <View style={[styles.listContent, { paddingTop: 12 }]}>
          {[0, 1, 2, 3].map((k) => (
            <SkeletonCard key={k} isDark={isDark} />
          ))}
        </View>
      ) : showEmpty ? (
        <Text style={[styles.empty, { color: muted }]}>
          {friends.length === 0 && incoming.length === 0 && outgoing.length === 0
            ? 'No friends yet. Tap search to find players by @username.'
            : 'No friends match your search.'}
        </Text>
      ) : (
        <ContentFadeIn show style={{ flex: 1 }}>
          <FlatList
            data={filteredFriends}
            keyExtractor={(item) => item?.user_id ?? ''}
            renderItem={renderFriendCard}
            ListHeaderComponent={listHeader}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          />
        </ContentFadeIn>
      )}

      <Modal visible={showAddFriends} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modalRoot, { backgroundColor: theme.background }]} edges={['top']}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Search Players</Text>
            <TouchableOpacity onPress={() => setShowAddFriends(false)}>
              <MaterialIcons name="close" size={24} color={muted} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by @username or name…"
              placeholderTextColor={muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={searchPlayers}
              style={[styles.searchInput, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />
            <TouchableOpacity
              style={[styles.searchBtn, searching && { opacity: 0.6 }]}
              onPress={searchPlayers}
              disabled={searching}
              activeOpacity={0.8}>
              {searching ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <MaterialIcons name="search" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          <FlatList
            data={searchResults}
            keyExtractor={(item) => item?.user_id ?? ''}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item, index }) => renderSearchRow(item, index)}
            ListEmptyComponent={
              searching ? null : (
                <Text style={[styles.searchEmpty, { color: muted }]}>
                  {searchQuery.trim() ? 'No players found.' : 'Type a @username or name to find players.'}
                </Text>
              )
            }
            contentContainerStyle={[styles.modalList, searching && searchResults.length === 0 ? { flexGrow: 1 } : undefined]}
          />
          </View>
          </TouchableWithoutFeedback>
        </SafeAreaView>
      </Modal>
      </View>
      </TouchableWithoutFeedback>
      <ReportReasonModal
        visible={reportTarget != null}
        onClose={() => setReportTarget(null)}
        contentType="profile"
        contentId={reportTarget?.id ?? ''}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: {},
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchBarInput: { flex: 1, paddingVertical: 11, fontSize: 16 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  section: { marginBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10, marginTop: 4 },
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  requestCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  requestTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  requestActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  acceptBtn: {
    flex: 1,
    backgroundColor: '#1D9E75',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  declineBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 0.5,
    minHeight: 44,
    justifyContent: 'center',
  },
  declineBtnText: { fontWeight: '600', fontSize: 14 },
  pendingBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  pendingBadgeText: { fontSize: 12, fontWeight: '600', color: '#92400E' },
  friendMid: { flex: 1, minWidth: 0 },
  friendTrail: { alignItems: 'flex-end', gap: 6 },
  friendDisplay: { fontSize: 16, fontWeight: '700' },
  friendUsername: { fontSize: 13, marginTop: 2 },
  recordHint: { fontSize: 12, marginTop: 6, fontWeight: '600' },
  skillBadgeSm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  skillBadgeTxt: { fontSize: 12, fontWeight: '700' },
  ratingIco: { width: 14, height: 14, borderRadius: 3 },
  empty: { textAlign: 'center', marginTop: 40, paddingHorizontal: 36, fontSize: 15, lineHeight: 22 },

  modalRoot: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  modalList: { paddingHorizontal: 20, paddingBottom: 36 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 12 },
  searchInput: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
  searchBtn: {
    backgroundColor: '#1D9E75',
    width: 48,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  searchResultInfo: { flex: 1 },
  searchResultName: { fontWeight: '600', fontSize: 15 },
  searchResultUsername: { fontSize: 13 },
  pendingHint: { fontSize: 12, marginTop: 4, fontWeight: '600' },
  searchEmpty: { textAlign: 'center', paddingVertical: 24, paddingHorizontal: 12 },
  friendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E1F5EE',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  friendedText: { fontSize: 13, fontWeight: '700', color: '#0F6E56' },
  addBtn: {
    backgroundColor: '#1D9E75',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  addBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
})
