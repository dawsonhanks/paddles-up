import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { courtFromRow, type Court } from '@/lib/courts'
import { ensureFavoritesUser } from '@/lib/favorites'
import { distanceKm } from '@/lib/geo'
import { supabase } from '@/supabase'
import { MaterialIcons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
    ActivityIndicator,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type CourtWithDistance = Court & { distanceKm: number }

export default function FavoritesScreen() {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [courts, setCourts] = useState<CourtWithDistance[]>([])
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLon, setUserLon] = useState<number | null>(null)

  useEffect(() => {
    ;(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
      setUserLat(pos.coords.latitude)
      setUserLon(pos.coords.longitude)
    })()
  }, [])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      ;(async () => {
        setLoading(true)
        const gate = await ensureFavoritesUser()
        if ('error' in gate) {
          setLoading(false)
          return
        }

        const { data, error } = await supabase
          .from('favorites')
          .select('court_id, courts(*)')
          .eq('user_id', gate.userId)

       if (error || !data) {
  console.log('Favorites fetch error:', error?.message, 'data:', data)
  setLoading(false)
  return
}

console.log('Favorites raw data:', JSON.stringify(data))

        const parsed = data
          .map((row: any) => courtFromRow(row.courts as Record<string, unknown>))
          .filter((c): c is Court => c != null)
          .map((c) => ({
            ...c,
            distanceKm:
              userLat != null && userLon != null
                ? distanceKm(userLat, userLon, c.latitude, c.longitude)
                : 0,
          }))
          .sort((a, b) => a.distanceKm - b.distanceKm)

        setCourts(parsed)
        setLoading(false)
      })()

      return () => {
        cancelled = true
      }
    }, [userLat, userLon])
  )

  function availabilityBadge(status: string | undefined) {
    if (status === 'open') return { label: 'Open', bg: '#E1F5EE', text: '#0F6E56' }
    if (status === 'busy') return { label: 'Busy', bg: '#FAEEDA', text: '#633806' }
    if (status === 'full') return { label: 'Full', bg: '#FCEBEB', text: '#791F1F' }
    return { label: '?', bg: '#F1EFE8', text: '#5F5E5A' }
  }

  function formatDistance(km: number) {
    const miles = km * 0.621371
    return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]} edges={['top']}>
        <ActivityIndicator size="large" color={theme.tint} />
      </SafeAreaView>
    )
  }

  if (courts.length === 0) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]} edges={['top']}>
        <MaterialIcons name="favorite-border" size={48} color={theme.icon} />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>No favorites yet</Text>
        <Text style={[styles.emptySubtitle, { color: theme.icon }]}>
          Tap the heart on a court to save it here
        </Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <FlatList
        data={courts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const badge = availabilityBadge((item as any).status)
          return (
            <TouchableOpacity
              style={[
                styles.card,
                {
                  backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
                  borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                },
              ]}
              onPress={() => router.push(`/court/${encodeURIComponent(item.id)}`)}
              activeOpacity={0.75}>
              <View style={styles.cardLeft}>
                <Text style={[styles.courtName, { color: theme.text }]}>{item.name}</Text>
                <Text style={[styles.courtMeta, { color: theme.icon }]}>
                  {userLat != null ? formatDistance(item.distanceKm) + ' · ' : ''}
                  {item.num_courts} courts · {item.indoor_outdoor}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
              </View>
            </TouchableOpacity>
          )
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 16 },
  emptySubtitle: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  list: { padding: 16, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardLeft: { flex: 1 },
  courtName: { fontSize: 15, fontWeight: '600' },
  courtMeta: { fontSize: 13, marginTop: 3 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginLeft: 10,
  },
  badgeText: { fontSize: 12, fontWeight: '600' },
})