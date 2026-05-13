import { Colors } from '@/constants/theme'
import { geocodeAddress } from '@/lib/geocoding'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { ensureFavoritesUser } from '@/lib/favorites'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { supabase } from '@/supabase'

type CourtSubmission = {
  id: string
  user_id: string | null
  display_name: string | null
  court_name: string
  address: string
  city: string
  state: string | null
  num_courts: number
  surface_type: string
  indoor_outdoor: string
  fee: string
  hours: string
  notes: string | null
  latitude: number | null
  longitude: number | null
  geocode_source: string | null
  geocode_confidence: string | null
  created_at: string
  status: string
}

type CoordDraft = {
  latitude: string
  longitude: string
  source: string | null
  confidence: string | null
}

function validLatitude(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90
}

function validLongitude(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180
}

function parseCoordinatePair(draft: CoordDraft): { latitude: number; longitude: number } | null {
  const lat = Number(draft.latitude.trim())
  const lon = Number(draft.longitude.trim())
  if (!validLatitude(lat) || !validLongitude(lon)) return null
  return { latitude: lat, longitude: lon }
}

export default function AdminSubmissionsScreen() {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const muted = isDark ? '#94A3B8' : '#64748B'

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<CourtSubmission[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [coordDrafts, setCoordDrafts] = useState<Record<string, CoordDraft>>({})

  const deadRef = useRef(false)
  useEffect(() => {
    deadRef.current = false
    return () => {
      deadRef.current = true
    }
  }, [])

  const load = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true)
    try {
      const gate = await ensureFavoritesUser()
      if (cancelledRef?.current) return
      if ('error' in gate) return
      const { data, error } = await supabase
        .from('court_submissions')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
      if (cancelledRef?.current) return
      if (error) {
        Alert.alert('Submissions did not load', userFriendlyFromUnknown(error.message))
        return
      }
      const rows = (data as CourtSubmission[]) ?? []
      setItems(rows)
      const initialDrafts: Record<string, CoordDraft> = {}
      for (const row of rows) {
        initialDrafts[row.id] = {
          latitude: row.latitude != null ? String(row.latitude) : '',
          longitude: row.longitude != null ? String(row.longitude) : '',
          source: row.geocode_source ?? null,
          confidence: row.geocode_confidence ?? null,
        }
      }
      setCoordDrafts(initialDrafts)
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

  async function rejectSubmission(id: string) {
    setBusyId(id)
    try {
      const { error } = await supabase
        .from('court_submissions')
        .update({ status: 'rejected' })
        .eq('id', id)
      if (deadRef.current) return
      if (error) {
        Alert.alert('Update did not go through', userFriendlyFromUnknown(error.message))
        return
      }
      setItems(prev => prev.filter(i => i.id !== id))
      setCoordDrafts(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } finally {
      if (!deadRef.current) setBusyId(null)
    }
  }

  async function geocodeSubmission(item: CourtSubmission) {
    setBusyId(item.id)
    try {
      const geo = await geocodeAddress({
        address: item.address,
        city: item.city,
        state: item.state,
      })
      if (deadRef.current) return
      setCoordDrafts(prev => ({
        ...prev,
        [item.id]: {
          latitude: String(geo.latitude),
          longitude: String(geo.longitude),
          source: geo.source,
          confidence: geo.confidence,
        },
      }))
    } catch (error) {
      if (!deadRef.current) {
        Alert.alert('Address lookup', userFriendlyFromUnknown(error instanceof Error ? error.message : ''))
      }
    } finally {
      if (!deadRef.current) setBusyId(null)
    }
  }

  async function approveSubmission(item: CourtSubmission) {
    const draft = coordDrafts[item.id] ?? {
      latitude: item.latitude != null ? String(item.latitude) : '',
      longitude: item.longitude != null ? String(item.longitude) : '',
      source: item.geocode_source ?? null,
      confidence: item.geocode_confidence ?? null,
    }
    const coords = parseCoordinatePair(draft)
    if (!coords) {
      Alert.alert('Coordinates required', 'Set valid latitude and longitude before approving.')
      return
    }

    setBusyId(item.id)
    try {
      const { error: courtError } = await supabase
        .from('courts')
        .insert({
          name: item.court_name,
          address: item.address,
          num_courts: item.num_courts,
          surface_type: item.surface_type,
          indoor_outdoor: item.indoor_outdoor,
          fee: item.fee,
          hours: item.hours,
          latitude: coords.latitude,
          longitude: coords.longitude,
        })
      if (deadRef.current) return
      if (courtError) {
        if (!deadRef.current) {
          Alert.alert('Court was not added', userFriendlyFromUnknown(courtError.message))
        }
        return
      }

      const { error: submissionError } = await supabase
        .from('court_submissions')
        .update({
          status: 'approved',
          latitude: coords.latitude,
          longitude: coords.longitude,
          geocode_source: draft.source,
          geocode_confidence: draft.confidence,
        })
        .eq('id', item.id)
      if (deadRef.current) return
      if (submissionError) {
        if (!deadRef.current) {
          Alert.alert('Submission status', userFriendlyFromUnknown(submissionError.message))
        }
        return
      }

      setItems(prev => prev.filter(i => i.id !== item.id))
      setCoordDrafts(prev => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
    } finally {
      if (!deadRef.current) setBusyId(null)
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Court Submissions</Text>
        <TouchableOpacity onPress={() => void load()} activeOpacity={0.8} style={styles.refreshBtn}>
          <MaterialIcons name="refresh" size={20} color="#1D9E75" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={theme.tint} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          {items.length === 0 ? (
            <Text style={[styles.emptyText, { color: muted }]}>No pending submissions.</Text>
          ) : items.map((item) => (
            <View key={item?.id ?? ''} style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <Text style={[styles.courtName, { color: theme.text }]}>{item?.court_name}</Text>
              <Text style={[styles.meta, { color: muted }]}>{item?.address}</Text>
              <Text style={[styles.meta, { color: muted }]}>{item?.city}{item?.state ? `, ${item.state}` : ''}</Text>
              <Text style={[styles.meta, { color: muted }]}>
                {item?.num_courts} courts • {item?.indoor_outdoor} • {item?.surface_type}
              </Text>
              <Text style={[styles.meta, { color: muted }]}>Fee: {item?.fee}</Text>
              <Text style={[styles.meta, { color: muted }]}>Hours: {item?.hours}</Text>
              {item?.notes ? <Text style={[styles.notes, { color: muted }]}>Notes: {item.notes}</Text> : null}
              <Text style={[styles.submittedBy, { color: muted }]}>Submitted by {item?.display_name ?? 'Player'}</Text>

              <View style={styles.coordWrap}>
                <View style={styles.coordHeader}>
                  <Text style={[styles.coordTitle, { color: theme.text }]}>Coordinates</Text>
                  <TouchableOpacity
                    style={[styles.geoBtn, busyId === item?.id && { opacity: 0.6 }]}
                    onPress={() => item && geocodeSubmission(item)}
                    disabled={busyId === item?.id}
                    activeOpacity={0.8}>
                    <MaterialIcons name="my-location" size={14} color="#1D9E75" />
                    <Text style={styles.geoBtnText}>Geocode</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.coordRow}>
                  <TextInput
                    value={coordDrafts[item?.id ?? '']?.latitude ?? ''}
                    onChangeText={(text) => {
                      const id = item?.id
                      if (!id) return
                      setCoordDrafts(prev => ({
                        ...prev,
                        [id]: { ...(prev[id] ?? { latitude: '', longitude: '', source: null, confidence: null }), latitude: text },
                      }))
                    }}
                    keyboardType="numbers-and-punctuation"
                    placeholder="Latitude"
                    placeholderTextColor={muted}
                    style={[styles.coordInput, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
                  />
                  <TextInput
                    value={coordDrafts[item?.id ?? '']?.longitude ?? ''}
                    onChangeText={(text) => {
                      const id = item?.id
                      if (!id) return
                      setCoordDrafts(prev => ({
                        ...prev,
                        [id]: { ...(prev[id] ?? { latitude: '', longitude: '', source: null, confidence: null }), longitude: text },
                      }))
                    }}
                    keyboardType="numbers-and-punctuation"
                    placeholder="Longitude"
                    placeholderTextColor={muted}
                    style={[styles.coordInput, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
                  />
                </View>
                {coordDrafts[item?.id ?? '']?.source ? (
                  <Text style={[styles.coordMeta, { color: muted }]}>
                    Source: {coordDrafts[item?.id ?? '']?.source} • Confidence: {coordDrafts[item?.id ?? '']?.confidence ?? 'unknown'}
                  </Text>
                ) : null}
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.approveBtn, busyId === item?.id && { opacity: 0.6 }]}
                  onPress={() => item && approveSubmission(item)}
                  disabled={busyId === item?.id}
                  activeOpacity={0.8}>
                  <Text style={styles.actionBtnText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.rejectBtn, busyId === item?.id && { opacity: 0.6 }]}
                  onPress={() => item?.id && rejectSubmission(item.id)}
                  disabled={busyId === item?.id}
                  activeOpacity={0.8}>
                  <Text style={styles.actionBtnText}>Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  title: { fontSize: 22, fontWeight: '700' },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(29, 158, 117, 0.12)' },
  container: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  emptyText: { textAlign: 'center', marginTop: 32, fontSize: 15 },
  card: { borderWidth: 0.5, borderRadius: 14, padding: 14 },
  courtName: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  meta: { fontSize: 13, marginBottom: 3 },
  notes: { fontSize: 13, marginTop: 4 },
  submittedBy: { fontSize: 12, marginTop: 10 },
  coordWrap: { marginTop: 12 },
  coordHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  coordTitle: { fontSize: 13, fontWeight: '700' },
  geoBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: '#1D9E75', borderRadius: 18, paddingVertical: 6, paddingHorizontal: 10 },
  geoBtnText: { color: '#0F6E56', fontSize: 12, fontWeight: '600' },
  coordRow: { flexDirection: 'row', gap: 8 },
  coordInput: { flex: 1, borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, fontSize: 13 },
  coordMeta: { marginTop: 7, fontSize: 12 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  approveBtn: { backgroundColor: '#1D9E75' },
  rejectBtn: { backgroundColor: '#E24B4A' },
  actionBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
})
