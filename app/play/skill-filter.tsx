import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { getPlayRatingFilter, setPlayRatingFilter } from '@/lib/playRatingFilter'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const SKILL_RATING_OPTIONS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0] as const

function parseRatingParam(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback
  const n = Number.parseFloat(value)
  if (!Number.isFinite(n)) return fallback
  const rounded = Math.round(n * 2) / 2
  return Math.min(5, Math.max(1, rounded))
}

function nearestStep(value: number): (typeof SKILL_RATING_OPTIONS)[number] {
  let best = SKILL_RATING_OPTIONS[0]
  let bestDist = Infinity
  for (const step of SKILL_RATING_OPTIONS) {
    const d = Math.abs(step - value)
    if (d < bestDist) {
      bestDist = d
      best = step
    }
  }
  return best
}

export default function PlaySkillFilterScreen() {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const router = useRouter()
  const params = useLocalSearchParams<{ ratingMin?: string; ratingMax?: string }>()

  const [ratingMin, setRatingMin] = useState(1.0)
  const [ratingMax, setRatingMax] = useState(5.0)

  useFocusEffect(
    useCallback(() => {
      const fromStore = getPlayRatingFilter()
      const minRaw = parseRatingParam(params.ratingMin, fromStore.ratingMin)
      const maxRaw = parseRatingParam(params.ratingMax, fromStore.ratingMax)
      setRatingMin(nearestStep(minRaw))
      setRatingMax(nearestStep(maxRaw))
    }, [params.ratingMin, params.ratingMax]),
  )

  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  function applyAndBack() {
    const lo = Math.min(ratingMin, ratingMax)
    const hi = Math.max(ratingMin, ratingMax)
    setPlayRatingFilter({ ratingMin: lo, ratingMax: hi })
    router.back()
  }

  function resetAndBack() {
    setPlayRatingFilter({ ratingMin: 1.0, ratingMax: 5.0 })
    router.back()
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>Skill rating</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={[styles.subtitle, { color: theme.icon }]}>
          Only show games posted by players whose DUPR-style rating falls in this range. Games from players without a rating only appear when the range is full (1.0–5.0).
        </Text>

        <View style={[styles.card, { borderColor: cardBorder, backgroundColor: cardBg }]}>
          <Text style={[styles.sectionLabel, { color: theme.icon }]}>Minimum</Text>
          <View style={styles.row}>
            {SKILL_RATING_OPTIONS.map((r) => (
              <TouchableOpacity
                key={`min-${r}`}
                onPress={() => setRatingMin(Math.min(r, ratingMax))}
                style={[
                  styles.pill,
                  {
                    borderColor: ratingMin === r ? '#1D9E75' : cardBorder,
                    backgroundColor: ratingMin === r ? '#E1F5EE' : cardBg,
                  },
                ]}>
                <Text style={[styles.pillText, { color: ratingMin === r ? '#0F6E56' : theme.icon }]}>{r.toFixed(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.sectionLabel, { color: theme.icon }]}>Maximum</Text>
          <View style={styles.row}>
            {SKILL_RATING_OPTIONS.map((r) => (
              <TouchableOpacity
                key={`max-${r}`}
                onPress={() => setRatingMax(Math.max(r, ratingMin))}
                style={[
                  styles.pill,
                  {
                    borderColor: ratingMax === r ? '#1D9E75' : cardBorder,
                    backgroundColor: ratingMax === r ? '#E1F5EE' : cardBg,
                  },
                ]}>
                <Text style={[styles.pillText, { color: ratingMax === r ? '#0F6E56' : theme.icon }]}>{r.toFixed(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: cardBorder, backgroundColor: theme.background }]}>
        <TouchableOpacity onPress={resetAndBack} style={styles.secondaryBtn}>
          <Text style={[styles.secondaryBtnText, { color: theme.icon }]}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={applyAndBack} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Apply</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  backBtn: { padding: 8 },
  headerSpacer: { width: 38 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  card: { borderWidth: 0.5, borderRadius: 12, padding: 14 },
  sectionLabel: { fontSize: 12, fontWeight: '600', marginBottom: 8, marginTop: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  pill: { borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  pillText: { fontSize: 13, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12 },
  secondaryBtnText: { fontSize: 16, fontWeight: '600' },
  primaryBtn: {
    flex: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#1D9E75',
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
})
