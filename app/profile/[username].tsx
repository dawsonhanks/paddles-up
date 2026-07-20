import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { ensureFavoritesUser } from '@/lib/favorites'
import { sendFriendRequest } from '@/lib/friends'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { normalizeUsername } from '@/lib/profileValidation'
import { supabase } from '@/supabase'
import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type PublicProfile = {
  user_id: string
  display_name: string | null
  username: string | null
  avatar_url: string | null
  skill_rating: number | null
  wins: number
  losses: number
}

type FriendActionStatus = 'none' | 'friends' | 'outgoing_pending' | 'incoming_pending' | 'self'

export default function PublicProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>()
  const router = useRouter()
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'

  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [friendStatus, setFriendStatus] = useState<FriendActionStatus>('none')
  const [adding, setAdding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const resolveFriendStatus = useCallback(async (viewerId: string, profileUserId: string) => {
    if (viewerId === profileUserId) {
      setFriendStatus('self')
      return
    }

    const [{ data: friendship }, { data: outgoing }, { data: incoming }] = await Promise.all([
      supabase
        .from('friendships')
        .select('friend_id')
        .eq('user_id', viewerId)
        .eq('friend_id', profileUserId)
        .maybeSingle(),
      supabase
        .from('friend_requests')
        .select('id')
        .eq('status', 'pending')
        .eq('from_user', viewerId)
        .eq('to_user', profileUserId)
        .maybeSingle(),
      supabase
        .from('friend_requests')
        .select('id')
        .eq('status', 'pending')
        .eq('from_user', profileUserId)
        .eq('to_user', viewerId)
        .maybeSingle(),
    ])

    if (friendship) setFriendStatus('friends')
    else if (outgoing) setFriendStatus('outgoing_pending')
    else if (incoming) setFriendStatus('incoming_pending')
    else setFriendStatus('none')
  }, [])

  useEffect(() => {
    const handle = normalizeUsername(typeof username === 'string' ? username : '')
    if (!handle) {
      setProfile(null)
      return
    }

    let cancelled = false

    async function load() {
      const gate = await ensureFavoritesUser()
      if (cancelled) return
      if (!('error' in gate)) setMyUserId(gate.userId)

      const { data: player } = await supabase
        .from('players')
        .select('user_id, display_name, username, avatar_url, skill_rating')
        .eq('username', handle)
        .maybeSingle()

      if (cancelled) return
      if (!player?.user_id) {
        setProfile(null)
        return
      }

      const { data: matchData } = await supabase
        .from('matches')
        .select('result')
        .eq('user_id', player.user_id)

      if (cancelled) return

      const wins = matchData?.filter((m) => m?.result === 'win').length ?? 0
      const losses = matchData?.filter((m) => m?.result === 'loss').length ?? 0

      setProfile({
        user_id: player.user_id,
        display_name: player.display_name,
        username: player.username,
        avatar_url: player.avatar_url,
        skill_rating: player.skill_rating ?? null,
        wins,
        losses,
      })

      if (!('error' in gate)) {
        await resolveFriendStatus(gate.userId, player.user_id)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [username, resolveFriendStatus])

  async function onAddFriend() {
    if (!profile?.user_id || adding) return
    setAdding(true)
    setActionError(null)
    try {
      const result = await sendFriendRequest(profile.user_id)
      if (result.error) {
        setActionError(userFriendlyFromUnknown(result.error))
        return
      }
      if (result.autoAccepted) setFriendStatus('friends')
      else setFriendStatus('outgoing_pending')
    } finally {
      setAdding(false)
    }
  }

  const winRate = profile && (profile.wins + profile.losses) > 0
    ? `${Math.round((profile.wins / (profile.wins + profile.losses)) * 100)}%`
    : '—'

  if (profile === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color="#1D9E75" />
      </View>
    )
  }

  if (profile === null) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        <Text style={[styles.notFoundTitle, { color: theme.text }]}>Player not found</Text>
        <Text style={[styles.notFoundSub, { color: isDark ? '#94A3B8' : '#64748B' }]}>
          @{username} doesn&apos;t exist on Paddles Up yet.
        </Text>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  const muted = isDark ? '#94A3B8' : '#64748B'
  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={16}
        style={({ pressed }) => [styles.backFab, { backgroundColor: cardBg, opacity: pressed ? 0.8 : 1 }]}>
        <MaterialIcons name="arrow-back" size={22} color={theme.text} />
      </Pressable>

      <View style={[styles.card, { backgroundColor: cardBg }]}>
        {profile?.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <MaterialIcons name="person" size={46} color="#FFFFFF" />
          </View>
        )}

        <Text style={[styles.displayName, { color: theme.text }]}>{profile?.display_name ?? 'Anonymous'}</Text>
        {profile?.username ? (
          <Text style={[styles.username, { color: muted }]}>@{profile.username}</Text>
        ) : null}
        {profile?.skill_rating != null ? (
          <View style={styles.ratingBadge}>
            <Image source={require('../../assets/images/icon.png')} style={styles.ratingLogo} />
            <Text style={styles.ratingBadgeText}>{profile.skill_rating.toFixed(1)}</Text>
          </View>
        ) : null}

        <View style={styles.statsRow}>
          <View style={styles.statBlock}>
            <Text style={[styles.statNum, { color: '#1D9E75' }]}>{profile?.wins ?? 0}</Text>
            <Text style={[styles.statLabel, { color: muted }]}>Wins</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0' }]} />
          <View style={styles.statBlock}>
            <Text style={[styles.statNum, { color: '#E24B4A' }]}>{profile?.losses ?? 0}</Text>
            <Text style={[styles.statLabel, { color: muted }]}>Losses</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0' }]} />
          <View style={styles.statBlock}>
            <Text style={[styles.statNum, { color: theme.text }]}>{winRate}</Text>
            <Text style={[styles.statLabel, { color: muted }]}>Win Rate</Text>
          </View>
        </View>

        {friendStatus === 'self' ? (
          <View style={styles.selfBadge}>
            <Text style={styles.selfBadgeText}>This is you</Text>
          </View>
        ) : friendStatus === 'friends' ? (
          <View style={styles.friendedBadge}>
            <MaterialIcons name="check" size={16} color="#1D9E75" />
            <Text style={styles.friendedText}>Friends</Text>
          </View>
        ) : friendStatus === 'outgoing_pending' ? (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>Request pending</Text>
          </View>
        ) : friendStatus === 'incoming_pending' ? (
          <Pressable
            onPress={() => router.push('/(tabs)/friends')}
            style={({ pressed }) => [styles.addBtn, { opacity: pressed ? 0.85 : 1 }]}>
            <Text style={styles.addBtnText}>Respond on Friends</Text>
          </Pressable>
        ) : myUserId ? (
          <Pressable
            onPress={() => void onAddFriend()}
            disabled={adding}
            style={({ pressed }) => [styles.addBtn, { opacity: adding || pressed ? 0.7 : 1 }]}>
            {adding ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.addBtnText}>Add Friend</Text>
            )}
          </Pressable>
        ) : null}

        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
      </View>

      <Text style={[styles.footer, { color: muted }]}>Paddles Up · Find your court. Play your game.</Text>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  backFab: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  card: {
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 20,
    elevation: 6,
  },
  avatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 16 },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#0F6E56',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  displayName: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  username: { fontSize: 15, marginBottom: 24 },
  ratingBadge: {
    backgroundColor: '#E1F5EE',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ratingBadgeText: { color: '#0F6E56', fontSize: 14, fontWeight: '700' },
  ratingLogo: { width: 16, height: 16, borderRadius: 4 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  statBlock: { alignItems: 'center', paddingHorizontal: 24 },
  statNum: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 12, marginTop: 2 },
  statDivider: { width: 0.5, height: 36 },
  addBtn: {
    backgroundColor: '#1D9E75',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  friendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E1F5EE',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  friendedText: { fontSize: 14, fontWeight: '700', color: '#0F6E56' },
  pendingBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  pendingBadgeText: { fontSize: 14, fontWeight: '700', color: '#92400E' },
  selfBadge: {
    backgroundColor: 'rgba(100,116,139,0.15)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  selfBadgeText: { fontSize: 14, fontWeight: '700', color: '#64748B' },
  actionError: { marginTop: 12, color: '#E24B4A', fontSize: 13, textAlign: 'center' },
  footer: { textAlign: 'center', fontSize: 13, marginTop: 'auto', paddingTop: 32 },
  notFoundTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  notFoundSub: { fontSize: 15, textAlign: 'center', marginBottom: 24 },
  backBtn: { backgroundColor: '#1D9E75', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14 },
  backBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
