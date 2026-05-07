import { supabase } from '@/supabase'
import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
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
  display_name: string | null
  username: string | null
  avatar_url: string | null
  skill_rating: number | null
  wins: number
  losses: number
}

export default function PublicProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>()
  const router = useRouter()

  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined)

  useEffect(() => {
    if (!username) { setProfile(null); return }

    async function load() {
      const { data: player } = await supabase
        .from('players')
        .select('user_id, display_name, username, avatar_url, skill_rating')
        .eq('username', username)
        .maybeSingle()

      if (!player) { setProfile(null); return }

      const { data: matchData } = await supabase
        .from('matches')
        .select('result')
        .eq('user_id', player.user_id)

      const wins = matchData?.filter(m => m.result === 'win').length ?? 0
      const losses = matchData?.filter(m => m.result === 'loss').length ?? 0

      setProfile({
        display_name: player.display_name,
        username: player.username,
        avatar_url: player.avatar_url,
        skill_rating: player.skill_rating ?? null,
        wins,
        losses,
      })
    }

    load()
  }, [username])

  const winRate = profile && (profile.wins + profile.losses) > 0
    ? `${Math.round((profile.wins / (profile.wins + profile.losses)) * 100)}%`
    : '—'

  if (profile === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1D9E75" />
      </View>
    )
  }

  if (profile === null) {
    return (
      <SafeAreaView style={styles.centered} edges={['top', 'bottom']}>
        <Text style={styles.notFoundTitle}>Player not found</Text>
        <Text style={styles.notFoundSub}>@{username} doesn&apos;t exist on Paddles Up yet.</Text>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={16}
        style={({ pressed }) => [styles.backFab, { opacity: pressed ? 0.8 : 1 }]}>
        <MaterialIcons name="arrow-back" size={22} color="#0F172A" />
      </Pressable>

      <View style={styles.card}>
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <MaterialIcons name="person" size={46} color="#FFFFFF" />
          </View>
        )}

        <Text style={styles.displayName}>{profile.display_name ?? 'Anonymous'}</Text>
        {profile.username ? (
          <Text style={styles.username}>@{profile.username}</Text>
        ) : null}
        {profile.skill_rating != null ? (
          <View style={styles.ratingBadge}>
            <Image source={require('../../assets/images/icon.png')} style={styles.ratingLogo} />
            <Text style={styles.ratingBadgeText}>{profile.skill_rating.toFixed(1)}</Text>
          </View>
        ) : null}

        <View style={styles.statsRow}>
          <View style={styles.statBlock}>
            <Text style={[styles.statNum, { color: '#1D9E75' }]}>{profile.wins}</Text>
            <Text style={styles.statLabel}>Wins</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBlock}>
            <Text style={[styles.statNum, { color: '#E24B4A' }]}>{profile.losses}</Text>
            <Text style={styles.statLabel}>Losses</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBlock}>
            <Text style={[styles.statNum, { color: '#0F172A' }]}>{winRate}</Text>
            <Text style={styles.statLabel}>Win Rate</Text>
          </View>
        </View>
      </View>

      <Text style={styles.footer}>Paddles Up · Find your court. Play your game.</Text>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E8EDF3', padding: 20 },
  centered: { flex: 1, backgroundColor: '#E8EDF3', justifyContent: 'center', alignItems: 'center', padding: 24 },
  backFab: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 24, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 32, alignItems: 'center', shadowColor: '#0f172a', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 20, elevation: 6 },
  avatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 16 },
  avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#0F6E56', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  displayName: { fontSize: 24, fontWeight: '700', color: '#0F172A', marginBottom: 4 },
  username: { fontSize: 15, color: '#64748B', marginBottom: 24 },
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
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statBlock: { alignItems: 'center', paddingHorizontal: 24 },
  statNum: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 12, color: '#64748B', marginTop: 2 },
  statDivider: { width: 0.5, height: 36, backgroundColor: '#E2E8F0' },
  footer: { textAlign: 'center', color: '#94A3B8', fontSize: 13, marginTop: 'auto', paddingTop: 32 },
  notFoundTitle: { fontSize: 20, fontWeight: '700', color: '#0F172A', marginBottom: 8 },
  notFoundSub: { fontSize: 15, color: '#64748B', textAlign: 'center', marginBottom: 24 },
  backBtn: { backgroundColor: '#1D9E75', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14 },
  backBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
