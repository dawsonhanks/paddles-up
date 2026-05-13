import { ErrorBanner } from '@/components/error-banner'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import type { ContentReportType } from '@/lib/contentReports'
import { ensureFavoritesUser } from '@/lib/favorites'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { openReportedContent } from '@/lib/reportDeepLinks'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { supabase } from '@/supabase'

type ContentReportRow = {
  id: string
  reporter_id: string
  content_type: ContentReportType
  content_id: string
  reason: string
  created_at: string
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function AdminReportsScreen() {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const router = useRouter()
  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const muted = isDark ? '#94A3B8' : '#64748B'

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ContentReportRow[]>([])
  const [banner, setBanner] = useState<string | null>(null)

  const load = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true)
    try {
      const gate = await ensureFavoritesUser()
      if (cancelledRef?.current) return
      if ('error' in gate) {
        setItems([])
        setBanner(gate.error)
        return
      }
      const { data, error } = await supabase
        .from('content_reports')
        .select('id, reporter_id, content_type, content_id, reason, created_at')
        .order('created_at', { ascending: false })
      if (cancelledRef?.current) return
      if (error) {
        setItems([])
        setBanner(userFriendlyFromUnknown(error.message))
        return
      }
      setItems((data ?? []) as ContentReportRow[])
      setBanner(null)
    } catch (e) {
      if (cancelledRef?.current) return
      setItems([])
      setBanner(userFriendlyFromUnknown(e))
    } finally {
      if (!cancelledRef?.current) setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      const cancelled = { current: false }
      void load(cancelled)
      return () => {
        cancelled.current = true
      }
    }, [load]),
  )

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { borderColor: cardBorder }]} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>Content reports</Text>
      </View>
      <ErrorBanner message={banner} onDismiss={() => setBanner(null)} />

      <FlatList
        data={items}
        keyExtractor={(r) => r?.id ?? ''}
        contentContainerStyle={styles.list}
        onRefresh={() => void load()}
        refreshing={loading}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <MaterialIcons name="flag" size={40} color={muted} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No reports yet</Text>
              <Text style={[styles.emptySub, { color: muted }]}>Reports from the app will appear here.</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={styles.cardTop}>
              <Text style={[styles.typePill, { color: theme.text, borderColor: cardBorder }]}>{item?.content_type}</Text>
              <Text style={[styles.when, { color: muted }]}>{item?.created_at ? formatWhen(item.created_at) : ''}</Text>
            </View>
            <Text style={[styles.reason, { color: theme.text }]}>{item?.reason}</Text>
            <Text style={[styles.meta, { color: muted }]} numberOfLines={1}>
              Reporter {item?.reporter_id} · Content id {item?.content_id}
            </Text>
            <Pressable
              onPress={() =>
                void openReportedContent(router, {
                  content_type: (item?.content_type ?? 'post') as ContentReportType,
                  content_id: item?.content_id ?? '',
                })
              }
              style={({ pressed }) => [styles.linkBtn, { opacity: pressed ? 0.85 : 1 }]}>
              <MaterialIcons name="open-in-new" size={18} color="#1D9E75" />
              <Text style={styles.linkBtnTxt}>View reported content</Text>
            </Pressable>
          </View>
        )}
      />
      {loading && items.length === 0 ? (
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
  list: { padding: 16, gap: 12, flexGrow: 1, paddingBottom: 32 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  typePill: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  when: { fontSize: 12, fontWeight: '600' },
  reason: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 12 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, paddingVertical: 6 },
  linkBtnTxt: { color: '#1D9E75', fontSize: 15, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginTop: 12 },
  emptySub: { fontSize: 14, textAlign: 'center', marginTop: 8 },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
})
