import { ReportReasonModal } from '@/components/report-reason-modal'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import type { CourtReview } from '@/lib/courtReviews'
import { fetchCourtReviewsPage } from '@/lib/courtReviews'
import { ensureFavoritesUser } from '@/lib/favorites'
import { showReportActionSheet } from '@/lib/showReportMenu'
import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const PAGE_SIZE = 10

function StarRow({ rating, filledColor, emptyColor }: { rating: number; filledColor: string; emptyColor: string }) {
  const filled = Math.min(5, Math.max(0, Math.round(rating)))
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Text key={i} style={[styles.starGlyph, { color: i <= filled ? filledColor : emptyColor }]}>★</Text>
      ))}
    </View>
  )
}

export default function CourtReviewsScreen() {
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
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'

  const cardBg = isDark ? '#161618' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15, 23, 42, 0.06)'
  const muted = isDark ? '#94A3B8' : '#64748B'

  const [items, setItems] = useState<CourtReview[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [reportReviewId, setReportReviewId] = useState<string | null>(null)

  useEffect(() => {
    void ensureFavoritesUser().then((g) => {
      if (!('error' in g)) setMyUserId(g.userId)
    })
  }, [])

  const loadBatch = useCallback(
    async (offset: number) => {
      if (!courtId) return [] as CourtReview[]
      return fetchCourtReviewsPage(courtId, offset, PAGE_SIZE)
    },
    [courtId],
  )

  useEffect(() => {
    let cancelled = false
    async function init() {
      if (!courtId) {
        setLoading(false)
        setItems([])
        return
      }
      setLoading(true)
      const batch = await loadBatch(0)
      if (cancelled) return
      setItems(batch)
      setHasMore(batch.length === PAGE_SIZE)
      setLoading(false)
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [courtId, loadBatch])

  const onEndReached = useCallback(async () => {
    if (!courtId || loading || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const batch = await loadBatch(items.length)
      setItems((prev) => [...prev, ...batch])
      setHasMore(batch.length === PAGE_SIZE)
    } finally {
      setLoadingMore(false)
    }
  }, [courtId, loading, loadingMore, hasMore, items.length, loadBatch])

  function renderItem({ item }: { item: CourtReview }) {
    const dateLabel = new Date(item.created_at).toLocaleDateString()
    return (
      <Pressable
        onLongPress={() => {
          if (!myUserId || item.user_id === myUserId) return
          Keyboard.dismiss()
          showReportActionSheet(() => setReportReviewId(item.id))
        }}
        delayLongPress={450}
        style={({ pressed }) => [pressed && { opacity: 0.92 }]}>
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={styles.cardTop}>
            <Text style={[styles.name, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>{item.display_name}</Text>
            <Text style={[styles.date, { color: muted }]}>{dateLabel}</Text>
          </View>
          <StarRow rating={item.rating} filledColor="#F59E0B" emptyColor={isDark ? '#334155' : '#E2E8F0'} />
          {item.review_text.trim() ? (
            <Text style={[styles.body, { color: isDark ? '#E2E8F0' : '#334155' }]}>{item.review_text.trim()}</Text>
          ) : (
            <Text style={[styles.bodyMuted, { color: muted }]}>Stars only · no written notes</Text>
          )}
        </View>
      </Pressable>
    )
  }

  if (!courtId) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
        <Text style={{ color: theme.text }}>Missing court</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { borderColor: cardBorder }]} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>Reviews</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={theme.tint} size="large" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onEndReachedThreshold={0.35}
          onEndReached={() => void onEndReached()}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="rate-review" size={40} color={muted} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No reviews yet</Text>
              <Text style={[styles.emptySub, { color: muted }]}>Be the first to write one from the court page.</Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={theme.tint} /> : <View style={{ height: 24 }} />
          }
        />
      )}
      <ReportReasonModal
        visible={reportReviewId != null}
        onClose={() => setReportReviewId(null)}
        contentType="review"
        contentId={reportReviewId ?? ''}
      />
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
  title: { fontSize: 20, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  name: { fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  date: { fontSize: 12, fontWeight: '600' },
  starRow: { flexDirection: 'row', gap: 2, marginBottom: 8 },
  starGlyph: { fontSize: 16, lineHeight: 20 },
  body: { fontSize: 14, lineHeight: 20 },
  bodyMuted: { fontSize: 13, fontStyle: 'italic' },
  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginTop: 12 },
  emptySub: { fontSize: 14, textAlign: 'center', marginTop: 8 },
})
