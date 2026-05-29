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
  fetchFriendsWithStats,
  searchPlayersFriendshipAware,
  type FriendPlayerWithRecord,
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

import { supabase } from '@/supabase'

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
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const [showAddFriends, setShowAddFriends] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FriendSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
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
      const { friends: list, error } = await fetchFriendsWithStats()
      if (cancelledRef?.current || deadRef.current) return
      if (error) {
        setFriendsBanner(userFriendlyFromUnknown(error))
      } else {
        setFriends(list)
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
      const gate = await ensureFavoritesUser()
      if (deadRef.current) return
      if ('error' in gate) {
        setFriendsBanner(userFriendlyFromUnknown(gate.error))
        return
      }
      const { error } = await supabase.from('friendships').insert({ user_id: gate.userId, friend_id: friendUserId })
      if (deadRef.current) return
      if (error) {
        setFriendsBanner(userFriendlyFromUnknown(error.message))
        return
      }
      setSearchResults((prev) =>
        prev.map((p) => (p.user_id === friendUserId ? { ...p, linkStatus: 'friends' as const } : p)),
      )
      await loadFriends()
    } finally {
      if (!deadRef.current) setAddingId(null)
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

  function renderSearchRow(player: FriendSearchResult, i: number) {
    const isLast = i === searchResults.length - 1
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
          </View>
        </Pressable>
        {player?.linkStatus === 'friends' ? (
          <View style={styles.friendedBadge}>
            <MaterialIcons name="check" size={16} color="#1D9E75" />
            <Text style={styles.friendedText}>Friends</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.addBtn, addingId === player?.user_id && { opacity: 0.6 }]}
            onPress={() => addFriend(player?.user_id ?? '')}
            disabled={addingId === player?.user_id}
            activeOpacity={0.8}>
            {addingId === player.user_id ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.addBtnTxt}>Add Friend</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    )
  }

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
      ) : filteredFriends.length === 0 ? (
        <Text style={[styles.empty, { color: muted }]}>
          {friends.length === 0
            ? 'No friends yet. Tap search to find players by @username.'
            : 'No friends match your search.'}
        </Text>
      ) : (
        <ContentFadeIn show style={{ flex: 1 }}>
          <FlatList
            data={filteredFriends}
            keyExtractor={(item) => item?.user_id ?? ''}
            renderItem={renderFriendCard}
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
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
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
  },
  addBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
})
