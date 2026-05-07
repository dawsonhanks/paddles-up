import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { ensureFavoritesUser } from '@/lib/favorites'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { supabase } from '@/supabase'

type MatchRow = {
  id: string
  user_id: string
  opponent_name: string
  result: string
  user_score: number | null
  opponent_score: number | null
  notes: string | null
  played_at: string
}

const RESULTS = ['Win', 'Loss'] as const

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function resultColor(result: string) {
  return result.toLowerCase() === 'win'
    ? { bg: '#E1F5EE', text: '#0F6E56' }
    : { bg: '#FCEBEB', text: '#791F1F' }
}

function avatarColor(name: string): string {
  const colors = ['#534AB7', '#0F6E56', '#D97706', '#0EA5E9', '#9333EA']
  const i = (name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % colors.length
  return colors[i]
}

export default function MatchDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>()
  const matchId = (() => {
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
  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const muted = isDark ? '#94A3B8' : '#64748B'

  const [loading, setLoading] = useState(true)
  const [match, setMatch] = useState<MatchRow | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [editOpponent, setEditOpponent] = useState('')
  const [editResult, setEditResult] = useState('')
  const [editUserScore, setEditUserScore] = useState('')
  const [editOppScore, setEditOppScore] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const loadMatch = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!matchId) {
      setLoadError('That match link looks incomplete.')
      setMatch(null)
      if (!silent) setLoading(false)
      return
    }
    if (!silent) {
      setLoading(true)
      setLoadError(null)
    }
    const gate = await ensureFavoritesUser()
    if ('error' in gate) {
      setLoadError(userFriendlyFromUnknown(gate.error))
      setMatch(null)
      if (!silent) setLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .eq('user_id', gate.userId)
      .maybeSingle()

    if (error) {
      setLoadError(userFriendlyFromUnknown(error.message))
      setMatch(null)
    } else if (!data) {
      setLoadError('We could not find that match on your profile.')
      setMatch(null)
    } else {
      setMatch(data as MatchRow)
    }
    if (!silent) setLoading(false)
  }, [matchId])

  useEffect(() => {
    loadMatch()
  }, [loadMatch])

  function enterEdit() {
    if (!match) return
    setEditOpponent(match.opponent_name)
    setEditResult(match.result.toLowerCase() === 'win' ? 'Win' : 'Loss')
    setEditUserScore(match.user_score != null ? String(match.user_score) : '')
    setEditOppScore(match.opponent_score != null ? String(match.opponent_score) : '')
    setEditNotes(match.notes ?? '')
    setEditing(true)
  }

  async function saveMatch() {
    if (!match) return
    if (!editOpponent.trim()) {
      Alert.alert('Opponent required', 'Enter your opponent name.')
      return
    }
    if (!editResult) {
      Alert.alert('Result required', 'Pick Win or Loss.')
      return
    }
    setSaving(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        Alert.alert('Please try again', userFriendlyFromUnknown(gate.error))
        return
      }
      const userScore = editUserScore.trim() === '' ? null : parseInt(editUserScore, 10)
      const oppScore = editOppScore.trim() === '' ? null : parseInt(editOppScore, 10)
      if (editUserScore.trim() !== '' && !Number.isFinite(userScore)) {
        Alert.alert('Invalid score', 'Your score must be a number.')
        return
      }
      if (editOppScore.trim() !== '' && !Number.isFinite(oppScore)) {
        Alert.alert('Invalid score', 'Opponent score must be a number.')
        return
      }

      const { data: updated, error } = await supabase
        .from('matches')
        .update({
          opponent_name: editOpponent.trim(),
          result: editResult === 'Win' ? 'win' : 'loss',
          user_score: userScore,
          opponent_score: oppScore,
          notes: editNotes.trim() || null,
        })
        .eq('id', match.id)
        .eq('user_id', gate.userId)
        .select('*')
        .maybeSingle()

      if (error) {
        Alert.alert('Please try again', userFriendlyFromUnknown(error.message))
        return
      }
      if (!updated) {
        Alert.alert(
          'No changes saved',
          'Your update did not stick. Pull to refresh, or reach out if this keeps happening.',
        )
        return
      }
      setMatch(updated as MatchRow)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete() {
    if (!match) return
    Alert.alert('Delete match', 'Remove this match from your record? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true)
          try {
            const gate = await ensureFavoritesUser()
            if ('error' in gate) {
              Alert.alert('Please try again', userFriendlyFromUnknown(gate.error))
              return
            }
            const { error } = await supabase.from('matches').delete().eq('id', match.id).eq('user_id', gate.userId)
            if (error) {
              Alert.alert('Please try again', userFriendlyFromUnknown(error.message))
              return
            }
            router.back()
          } finally {
            setDeleting(false)
          }
        },
      },
    ])
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]} edges={['top']}>
        <ActivityIndicator size="large" color={theme.tint} />
      </SafeAreaView>
    )
  }

  if (!match || loadError) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]} edges={['top']}>
        <Text style={[styles.errTitle, { color: theme.text }]}>{loadError ?? 'Match not found'}</Text>
        <Pressable onPress={() => router.back()} style={[styles.backLink, { borderColor: cardBorder }]}>
          <Text style={[styles.backLinkText, { color: theme.text }]}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  const rc = resultColor(match.result)
  const initial = (match.opponent_name?.trim() || '?').charAt(0).toUpperCase()

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}>
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: theme.text }]} numberOfLines={1}>
          Match
        </Text>
        {!editing ? (
          <Pressable onPress={enterEdit} hitSlop={12} style={({ pressed }) => [styles.editBtn, { opacity: pressed ? 0.7 : 1 }]}>
            <Text style={styles.editBtnText}>Edit</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void saveMatch()}
            hitSlop={12}
            disabled={saving}
            style={({ pressed }) => [styles.editBtn, { opacity: pressed || saving ? 0.6 : 1 }]}>
            {saving ? <ActivityIndicator color="#1D9E75" size="small" /> : <Text style={styles.editBtnText}>Save</Text>}
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.heroCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={[styles.avatarLarge, { backgroundColor: avatarColor(match.opponent_name) }]}>
            <Text style={styles.avatarLargeText}>{initial}</Text>
          </View>
          {!editing ? (
            <>
              <Text style={[styles.opponentName, { color: theme.text }]}>{match.opponent_name}</Text>
              <View style={[styles.resultBadge, { backgroundColor: rc.bg }]}>
                <Text style={[styles.resultBadgeText, { color: rc.text }]}>
                  {match.result.toLowerCase() === 'win' ? 'Win' : 'Loss'}
                </Text>
              </View>
              {match.user_score != null && match.opponent_score != null ? (
                <Text style={[styles.scoreBig, { color: theme.text }]}>
                  {match.user_score} – {match.opponent_score}
                </Text>
              ) : (
                <Text style={[styles.scoreEmpty, { color: muted }]}>No score recorded</Text>
              )}
              <Text style={[styles.dateLine, { color: muted }]}>{formatDate(match.played_at)}</Text>
              {match.notes ? (
                <View style={[styles.notesBox, { borderTopColor: cardBorder }]}>
                  <Text style={[styles.notesLabel, { color: muted }]}>Notes</Text>
                  <Text style={[styles.notesBody, { color: theme.text }]}>{match.notes}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Text style={[styles.fieldLabel, { color: muted }]}>Opponent name</Text>
              <TextInput
                value={editOpponent}
                onChangeText={setEditOpponent}
                placeholder="Opponent name"
                placeholderTextColor={muted}
                style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: theme.background }]}
              />
              <Text style={[styles.fieldLabel, { color: muted }]}>Result</Text>
              <View style={styles.pillRow}>
                {RESULTS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setEditResult(r)}
                    style={[
                      styles.pill,
                      {
                        borderColor: editResult === r ? (r === 'Win' ? '#1D9E75' : '#E24B4A') : cardBorder,
                        backgroundColor: editResult === r ? (r === 'Win' ? '#E1F5EE' : '#FCEBEB') : theme.background,
                      },
                    ]}
                    activeOpacity={0.85}>
                    <Text
                      style={[
                        styles.pillText,
                        { color: editResult === r ? (r === 'Win' ? '#0F6E56' : '#791F1F') : muted },
                      ]}>
                      {r === 'Win' ? 'Win' : 'Loss'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.fieldLabel, { color: muted }]}>Score (optional)</Text>
              <View style={styles.scoreRow}>
                <View style={styles.scoreCol}>
                  <Text style={[styles.scoreHint, { color: muted }]}>You</Text>
                  <TextInput
                    value={editUserScore}
                    onChangeText={setEditUserScore}
                    placeholder="—"
                    placeholderTextColor={muted}
                    keyboardType="number-pad"
                    style={[styles.scoreInput, { color: theme.text, borderColor: cardBorder, backgroundColor: theme.background }]}
                  />
                </View>
                <Text style={[styles.scoreDash, { color: muted }]}>–</Text>
                <View style={styles.scoreCol}>
                  <Text style={[styles.scoreHint, { color: muted }]}>Them</Text>
                  <TextInput
                    value={editOppScore}
                    onChangeText={setEditOppScore}
                    placeholder="—"
                    placeholderTextColor={muted}
                    keyboardType="number-pad"
                    style={[styles.scoreInput, { color: theme.text, borderColor: cardBorder, backgroundColor: theme.background }]}
                  />
                </View>
              </View>
              <Text style={[styles.fieldLabel, { color: muted }]}>Notes</Text>
              <TextInput
                value={editNotes}
                onChangeText={setEditNotes}
                placeholder="Optional notes"
                placeholderTextColor={muted}
                multiline
                style={[styles.input, styles.textArea, { color: theme.text, borderColor: cardBorder, backgroundColor: theme.background }]}
              />
            </>
          )}
        </View>

        {!editing ? (
          <TouchableOpacity
            style={[styles.deleteBtn, deleting && { opacity: 0.6 }]}
            onPress={confirmDelete}
            disabled={deleting}
            activeOpacity={0.85}>
            {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.deleteBtnText}>Delete match</Text>}
          </TouchableOpacity>
        ) : null}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errTitle: { fontSize: 16, textAlign: 'center', marginBottom: 16 },
  backLink: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, borderWidth: 0.5 },
  backLinkText: { fontWeight: '600' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    minHeight: 48,
  },
  iconBtn: { padding: 8, width: 44 },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  editBtn: { paddingHorizontal: 12, paddingVertical: 8, minWidth: 64, alignItems: 'flex-end' },
  editBtnText: { fontSize: 16, fontWeight: '600', color: '#1D9E75' },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },
  heroCard: {
    borderRadius: 16,
    borderWidth: 0.5,
    padding: 24,
    alignItems: 'center',
  },
  avatarLarge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarLargeText: { color: '#fff', fontSize: 36, fontWeight: '700' },
  opponentName: { fontSize: 22, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  resultBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, marginBottom: 12 },
  resultBadgeText: { fontSize: 15, fontWeight: '700' },
  scoreBig: { fontSize: 28, fontWeight: '800', marginBottom: 8 },
  scoreEmpty: { fontSize: 15, marginBottom: 8 },
  dateLine: { fontSize: 14, marginTop: 4 },
  notesBox: { marginTop: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, width: '100%' },
  notesLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase' },
  notesBody: { fontSize: 15, lineHeight: 22 },
  fieldLabel: { fontSize: 12, fontWeight: '600', alignSelf: 'stretch', marginBottom: 8, marginTop: 14, textTransform: 'uppercase' },
  input: { alignSelf: 'stretch', borderWidth: 0.5, borderRadius: 12, padding: 14, fontSize: 16 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  pillRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  pill: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 0.5, alignItems: 'center' },
  pillText: { fontSize: 15, fontWeight: '600' },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, alignSelf: 'stretch' },
  scoreCol: { flex: 1 },
  scoreHint: { fontSize: 12, marginBottom: 6, textAlign: 'center' },
  scoreInput: { borderWidth: 0.5, borderRadius: 12, padding: 12, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  scoreDash: { fontSize: 22, fontWeight: '700', paddingBottom: 14 },
  deleteBtn: {
    marginTop: 24,
    backgroundColor: '#E24B4A',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  deleteBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
