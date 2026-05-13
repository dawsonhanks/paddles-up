import { ErrorBanner } from '@/components/error-banner'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { fetchBlockedPlayers, unblockUser, type BlockedPlayerRow } from '@/lib/blockedUsers'
import { addFriendshipIfAbsent } from '@/lib/friends'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function BlockedPlayersScreen() {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const router = useRouter()
  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const muted = isDark ? '#94A3B8' : '#64748B'

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<BlockedPlayerRow[]>([])
  const [banner, setBanner] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { rows: next, error } = await fetchBlockedPlayers()
      if (error) {
        setRows([])
        setBanner(userFriendlyFromUnknown(error.message))
        return
      }
      setRows(next)
      setBanner(null)
    } catch (e) {
      setRows([])
      setBanner(userFriendlyFromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  function confirmUnblock(item: BlockedPlayerRow) {
    const label = item.display_name ?? item.username ?? 'this player'
    Alert.alert('Unblock player', `Unblock ${label}? They will be able to appear in searches and posts again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        onPress: async () => {
          setBusyId(item.blocked_id)
          try {
            const { error } = await unblockUser(item.blocked_id)
            if (error) {
              Alert.alert('Could not unblock', userFriendlyFromUnknown(error.message))
              return
            }
            const restore = await addFriendshipIfAbsent(item.blocked_id)
            if (restore.error) {
              setBanner(
                `Unblocked, but we couldn’t restore your friend link (${restore.error}). Add them again from Friends → +.`,
              )
            }
            setRows((prev) => prev.filter((r) => r.blocked_id !== item.blocked_id))
          } finally {
            setBusyId(null)
          }
        },
      },
    ])
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { borderColor: cardBorder }]} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>Blocked players</Text>
      </View>
      <ErrorBanner message={banner} onDismiss={() => setBanner(null)} />

      <FlatList
        data={rows}
        keyExtractor={(item) => item.blocked_id}
        contentContainerStyle={styles.list}
        onRefresh={() => void load()}
        refreshing={loading}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <MaterialIcons name="block" size={40} color={muted} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No blocked players</Text>
              <Text style={[styles.emptySub, { color: muted }]}>
                When you block someone from their profile, they show up here so you can unblock them anytime.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const busy = busyId === item.blocked_id
          const title = item.display_name ?? item.username ?? 'Player'
          return (
            <View style={[styles.row, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              {item.avatar_url ? (
                <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarLetter}>{title.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.rowMain}>
                <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                  {title}
                </Text>
                {item.username ? (
                  <Text style={[styles.username, { color: muted }]} numberOfLines={1}>
                    @{item.username}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => confirmUnblock(item)}
                disabled={busy}
                style={({ pressed }) => [styles.unblockBtn, { opacity: busy ? 0.6 : pressed ? 0.88 : 1 }]}>
                {busy ? <ActivityIndicator color="#1D9E75" size="small" /> : <Text style={styles.unblockTxt}>Unblock</Text>}
              </Pressable>
            </View>
          )
        }}
      />
      {loading && rows.length === 0 ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#1D9E75" />
        </View>
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 20, fontWeight: '700', flex: 1 },
  list: { padding: 16, gap: 10, flexGrow: 1, paddingBottom: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 12,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#64748B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: '#fff', fontSize: 18, fontWeight: '700' },
  rowMain: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '600' },
  username: { fontSize: 13, marginTop: 2 },
  unblockBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1D9E75',
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unblockTxt: { color: '#1D9E75', fontSize: 14, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 28 },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginTop: 12 },
  emptySub: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
})
