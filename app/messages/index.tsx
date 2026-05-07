import { ErrorBanner } from '@/components/error-banner'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { listConversations, type ConversationListItem } from '@/lib/messages'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

function timeAgo(dateString: string) {
  const date = new Date(dateString).getTime()
  const diff = Date.now() - date
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m`
  if (diff < day) return `${Math.floor(diff / hour)}h`
  if (diff < day * 7) return `${Math.floor(diff / day)}d`
  return new Date(dateString).toLocaleDateString()
}

export default function MessagesScreen() {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ConversationListItem[]>([])
  const [messagesBanner, setMessagesBanner] = useState<string | null>(null)

  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listConversations()
      setRows(data)
      setMessagesBanner(null)
    } catch (e) {
      setRows([])
      setMessagesBanner(userFriendlyFromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Messages</Text>
      </View>
      <ErrorBanner message={messagesBanner} onDismiss={() => setMessagesBanner(null)} />

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onRefresh={load}
        refreshing={loading}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.centered}>
              <MaterialIcons name="chat-bubble-outline" size={40} color={theme.icon} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No conversations yet</Text>
              <Text style={[styles.emptySub, { color: theme.icon }]}>Message a friend from your Profile tab.</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const unread = item.unreadCount > 0
          return (
            <Pressable
              onPress={() => router.push(`/messages/${item.id}`)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: cardBg, borderColor: cardBorder, opacity: pressed ? 0.88 : 1 },
              ]}>
              {item.otherAvatarUrl ? (
                <Image source={{ uri: item.otherAvatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarText}>{item.otherDisplayName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.rowMain}>
                <View style={styles.rowTop}>
                  <Text style={[styles.name, { color: theme.text, fontWeight: unread ? '700' : '600' }]} numberOfLines={1}>
                    {item.otherDisplayName}
                  </Text>
                  <Text style={[styles.time, { color: theme.icon }]}>{timeAgo(item.lastMessageAt)}</Text>
                </View>
                <View style={styles.rowBottom}>
                  <Text style={[styles.preview, { color: theme.icon }]} numberOfLines={1}>
                    {item.lastMessage}
                  </Text>
                  {unread ? <View style={styles.unreadDot} /> : null}
                </View>
              </View>
            </Pressable>
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
  header: { paddingHorizontal: 20, paddingVertical: 14 },
  title: { fontSize: 28, fontWeight: '700' },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  row: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0F6E56',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 20 },
  rowMain: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontSize: 16, flex: 1 },
  time: { fontSize: 12 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  preview: { fontSize: 14, flex: 1 },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1D9E75', marginLeft: 8 },
  centered: { justifyContent: 'center', alignItems: 'center', minHeight: 220, paddingHorizontal: 30 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 10 },
  emptySub: { fontSize: 14, marginTop: 6, textAlign: 'center' },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
})
