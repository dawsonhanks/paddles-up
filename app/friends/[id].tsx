import { FriendAvatar } from '@/components/friend-avatar'
import { ReportReasonModal } from '@/components/report-reason-modal'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { blockUser } from '@/lib/blockedUsers'
import { ensureFavoritesUser } from '@/lib/favorites'
import { fetchFriendProfileBundle, removeFriendship, type FriendPlayer } from '@/lib/friends'
import { getOrCreateConversation } from '@/lib/messages'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { showReportActionSheet } from '@/lib/showReportMenu'
import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function resultColor(result: string) {
  return result.toLowerCase() === 'win'
    ? { bg: '#E1F5EE', text: '#0F6E56' }
    : { bg: '#FCEBEB', text: '#791F1F' }
}

export default function FriendProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const muted = isDark ? '#94A3B8' : '#64748B'

  const [bundle, setBundle] = useState<
    | { state: 'loading' }
    | { state: 'error'; kind: 'not_friend' | 'not_found' }
    | {
        state: 'ok'
        player: FriendPlayer
        wins: number
        losses: number
        recentMatches: Array<{
          id: string
          opponent_name: string
          result: string
          user_score: number | null
          opponent_score: number | null
          played_at: string
        }>
      }
  >({ state: 'loading' })

  const [unfriendBusy, setUnfriendBusy] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [reportProfileOpen, setReportProfileOpen] = useState(false)

  useEffect(() => {
    void ensureFavoritesUser().then((g) => {
      if (!('error' in g)) setMyUserId(g.userId)
    })
  }, [])

  const reload = useCallback(async () => {
    if (!id || typeof id !== 'string') {
      setBundle({ state: 'error', kind: 'not_found' })
      return
    }
    setBundle({ state: 'loading' })
    const res = await fetchFriendProfileBundle(id)
    if (!res.ok) setBundle({ state: 'error', kind: res.error })
    else
      setBundle({
        state: 'ok',
        player: res.player,
        wins: res.wins,
        losses: res.losses,
        recentMatches: res.recentMatches,
      })
  }, [id])

  useEffect(() => {
    void reload()
  }, [reload])

  function openChallengeFlow() {
    if (bundle.state !== 'ok') return
    router.push({ pathname: '/record', params: { challengeUserId: bundle.player.user_id } })
  }

  async function messageFriend() {
    if (bundle.state !== 'ok') return
    try {
      const conversationId = await getOrCreateConversation(bundle.player.user_id)
      router.push(`/messages/${conversationId}`)
    } catch (e: unknown) {
      const msg = userFriendlyFromUnknown(e instanceof Error ? e.message : '')
      Alert.alert('Messages unavailable', msg)
    }
  }

  function confirmBlock() {
    if (bundle.state !== 'ok') return
    const label = bundle.player.display_name ?? bundle.player.username ?? 'this player'
    Alert.alert('Block player', `Block ${label}? You won’t see their posts or messages, and they’ll be hidden from your friends list and searches until you unblock them.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          setBlockBusy(true)
          try {
            const { error } = await blockUser(bundle.player.user_id)
            if (error) {
              Alert.alert('Could not block', userFriendlyFromUnknown(error.message))
              return
            }
            router.back()
          } finally {
            setBlockBusy(false)
          }
        },
      },
    ])
  }

  function confirmUnfriend() {
    if (bundle.state !== 'ok') return
    Alert.alert(
      'Remove friend',
      `Remove ${bundle.player.display_name ?? bundle.player.username ?? 'this player'} from your friends?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unfriend',
          style: 'destructive',
          onPress: async () => {
            setUnfriendBusy(true)
            try {
              const { error } = await removeFriendship(bundle.player.user_id)
              if (error) {
                Alert.alert('Please try again', userFriendlyFromUnknown(error))
                return
              }
              router.back()
            } finally {
              setUnfriendBusy(false)
            }
          },
        },
      ],
    )
  }

  const winRate =
    bundle.state === 'ok' && bundle.wins + bundle.losses > 0
      ? `${Math.round((bundle.wins / (bundle.wins + bundle.losses)) * 100)}%`
      : '—'

  if (bundle.state === 'loading') {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.tint} />
      </View>
    )
  }

  if (bundle.state === 'error') {
    const title = bundle.kind === 'not_friend' ? 'Not in your friends list' : 'Player not found'
    const sub =
      bundle.kind === 'not_friend'
        ? 'Add them from the Friends tab before viewing this profile.'
        : 'This link may be invalid.'
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        <Text style={[styles.errTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.errSub, { color: muted }]}>{sub}</Text>
        <Pressable onPress={() => router.back()} style={styles.backGhost}>
          <Text style={[styles.backGhostTxt, { color: theme.tint }]}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  const { player, wins, losses, recentMatches } = bundle

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={16}
        style={({ pressed }) => [
          styles.backFab,
          { backgroundColor: cardBg, borderColor: cardBorder, opacity: pressed ? 0.85 : 1 },
        ]}>
        <MaterialIcons name="arrow-back" size={22} color={theme.text} />
      </Pressable>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollInner}>
        <Pressable
          onLongPress={() => {
            if (!myUserId || player.user_id === myUserId) return
            Keyboard.dismiss()
            showReportActionSheet(() => setReportProfileOpen(true))
          }}
          delayLongPress={450}>
          <View style={[styles.heroCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={[styles.avatarRing, isDark ? { borderColor: 'rgba(255,255,255,0.06)' } : { borderColor: 'rgba(0,0,0,0.04)' }]}>
              <FriendAvatar friend={player} size={120} />
            </View>
            <Text style={[styles.displayName, { color: theme.text }]}>{player.display_name ?? 'Player'}</Text>
            {player.username ? <Text style={[styles.username, { color: muted }]}>@{player.username}</Text> : null}

            {player.skill_rating != null ? (
              <View style={[styles.ratingBadge, isDark ? { backgroundColor: 'rgba(29, 158, 117, 0.2)' } : { backgroundColor: '#E1F5EE' }]}>
                <Image source={require('../../assets/images/icon.png')} style={styles.ratingLogo} />
                <Text style={styles.ratingBadgeText}>{player.skill_rating.toFixed(1)}</Text>
              </View>
            ) : null}

            <View style={styles.statsRow}>
              <View style={styles.statBlock}>
                <Text style={[styles.statNum, { color: '#1D9E75' }]}>{wins}</Text>
                <Text style={[styles.statLabel, { color: muted }]}>Wins</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
              <View style={styles.statBlock}>
                <Text style={[styles.statNum, { color: '#E24B4A' }]}>{losses}</Text>
                <Text style={[styles.statLabel, { color: muted }]}>Losses</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
              <View style={styles.statBlock}>
                <Text style={[styles.statNum, { color: theme.text }]}>{winRate}</Text>
                <Text style={[styles.statLabel, { color: muted }]}>Win rate</Text>
              </View>
            </View>
          </View>
        </Pressable>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>Recent matches</Text>
        {recentMatches.length === 0 ? (
          <Text style={[styles.mutedCenter, { color: muted }]}>No logged matches yet.</Text>
        ) : (
          <View style={[styles.matchesCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            {recentMatches.map((m, idx) => {
              const tint = resultColor(m.result)
              const scoreParts = [m.user_score, m.opponent_score].every((x) => x != null)
                ? `${m.user_score}–${m.opponent_score}`
                : '—'
              return (
                <View
                  key={m.id}
                  style={[styles.matchRow, idx < recentMatches.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: cardBorder }]}>
                  <View style={styles.matchLeft}>
                    <Text style={[styles.matchOpp, { color: theme.text }]} numberOfLines={1}>
                      vs {m.opponent_name}
                    </Text>
                    <Text style={[styles.matchDate, { color: muted }]}>{formatDate(m.played_at)}</Text>
                  </View>
                  <View style={styles.matchRight}>
                    <View style={[styles.resultPill, { backgroundColor: tint.bg }]}>
                      <Text style={[styles.resultPillTxt, { color: tint.text }]}>{m.result}</Text>
                    </View>
                    <Text style={[styles.scoreTxt, { color: muted }]}>{scoreParts}</Text>
                  </View>
                </View>
              )
            })}
          </View>
        )}

        <View style={styles.btnCol}>
          <TouchableOpacity style={styles.challengeBtn} onPress={openChallengeFlow} activeOpacity={0.85}>
            <MaterialIcons name="sports" size={20} color="#fff" />
            <Text style={styles.challengeBtnTxt}>Challenge</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.msgBtn, { borderColor: cardBorder, backgroundColor: cardBg }]}
            onPress={() => void messageFriend()}
            activeOpacity={0.85}>
            <MaterialIcons name="chat-bubble-outline" size={20} color="#1D9E75" />
            <Text style={[styles.msgBtnTxt, { color: theme.text }]}>Message</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.blockBtn, blockBusy && { opacity: 0.6 }]}
          onPress={confirmBlock}
          disabled={blockBusy}
          activeOpacity={0.85}>
          {blockBusy ? <ActivityIndicator color={theme.text} /> : <Text style={[styles.blockTxt, { color: theme.text }]}>Block</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.unfriendBtn, unfriendBusy && { opacity: 0.6 }]}
          onPress={confirmUnfriend}
          disabled={unfriendBusy}
          activeOpacity={0.85}>
          {unfriendBusy ? <ActivityIndicator color="#E24B4A" /> : <Text style={styles.unfriendTxt}>Unfriend</Text>}
        </TouchableOpacity>
      </ScrollView>

      <ReportReasonModal
        visible={reportProfileOpen}
        onClose={() => setReportProfileOpen(false)}
        contentType="profile"
        contentId={player.user_id}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  backFab: {
    alignSelf: 'flex-start',
    marginLeft: 16,
    marginTop: 8,
    marginBottom: 12,
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  scrollInner: { paddingHorizontal: 20, paddingBottom: 48 },
  heroCard: {
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  avatarRing: {
    padding: 4,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 16,
  },
  displayName: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  username: { fontSize: 15, marginBottom: 16 },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    marginBottom: 20,
  },
  ratingLogo: { width: 16, height: 16, borderRadius: 4 },
  ratingBadgeText: { color: '#0F6E56', fontSize: 14, fontWeight: '700' },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statBlock: { alignItems: 'center', paddingHorizontal: 22 },
  statNum: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 12, marginTop: 4 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 38 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  mutedCenter: { textAlign: 'center', paddingVertical: 12 },
  matchesCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 22 },
  matchRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 14 },
  matchLeft: { flex: 1, marginRight: 12 },
  matchRight: { alignItems: 'flex-end', gap: 6 },
  matchOpp: { fontSize: 15, fontWeight: '600' },
  matchDate: { fontSize: 12, marginTop: 4 },
  resultPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  resultPillTxt: { fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  scoreTxt: { fontSize: 13 },

  btnCol: { gap: 10, marginBottom: 16 },
  challengeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F59E0B',
    paddingVertical: 14,
    borderRadius: 14,
  },
  challengeBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  msgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: 14,
  },
  msgBtnTxt: { fontSize: 16, fontWeight: '600' },

  blockBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.45)',
  },
  blockTxt: { fontSize: 16, fontWeight: '700' },

  unfriendBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, marginTop: 10 },
  unfriendTxt: { color: '#E24B4A', fontSize: 16, fontWeight: '700' },

  errTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  errSub: { fontSize: 15, textAlign: 'center', marginBottom: 20 },
  backGhost: { paddingVertical: 12, paddingHorizontal: 20 },
  backGhostTxt: { fontSize: 16, fontWeight: '600' },
})
