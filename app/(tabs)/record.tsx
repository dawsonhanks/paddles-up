import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { ensureFavoritesUser } from '@/lib/favorites'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { sendPushNotification } from '@/lib/push'
import { supabase } from '@/supabase'

type Match = {
  id: string
  opponent_name: string
  result: string
  user_score: number | null
  opponent_score: number | null
  notes: string | null
  played_at: string
}

type Challenge = {
  id: string
  challenger_id: string
  challenged_id: string
  challenger_name: string | null
  challenged_name: string | null
  court_id: string | null
  proposed_time: string | null
  status: 'pending' | 'accepted' | 'declined'
  created_at: string
  courts?: { name: string } | null
}

type CourtOption = { id: string; name: string }

const RESULTS = ['Win', 'Loss']

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function resultColor(result: string) {
  return result.toLowerCase() === 'win'
    ? { bg: '#E1F5EE', text: '#0F6E56' }
    : { bg: '#FCEBEB', text: '#791F1F' }
}

function challengeStatusStyle(status: string) {
  switch (status) {
    case 'accepted': return { bg: '#E1F5EE', text: '#0F6E56' }
    case 'declined': return { bg: '#FCEBEB', text: '#791F1F' }
    default: return { bg: '#FEF3C7', text: '#92400E' }
  }
}

const FAB_SIZE = 56

export default function RecordScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  // Match state
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [detailedMode, setDetailedMode] = useState(false)
  const [opponent, setOpponent] = useState('')
  const [result, setResult] = useState('')
  const [userScore, setUserScore] = useState('')
  const [opponentScore, setOpponentScore] = useState('')
  const [notes, setNotes] = useState('')

  // Challenge state
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [showChallengeModal, setShowChallengeModal] = useState(false)
  const [challengeUsername, setChallengeUsername] = useState('')
  const [challengeTime, setChallengeTime] = useState('')
  const [challengeCourtId, setChallengeCourtId] = useState<string | null>(null)
  const [challengeCourtName, setChallengeCourtName] = useState<string | null>(null)
  const [challengeSubmitting, setChallengeSubmitting] = useState(false)
  const [courts, setCourts] = useState<CourtOption[]>([])
  const [showCourtPicker, setShowCourtPicker] = useState(false)
  const [respondingId, setRespondingId] = useState<string | null>(null)

  const wins = matches.filter(m => m.result.toLowerCase() === 'win').length
  const losses = matches.filter(m => m.result.toLowerCase() === 'loss').length

  async function loadAll() {
    setLoading(true)
    const gate = await ensureFavoritesUser()
    if ('error' in gate) { setLoading(false); return }
    setCurrentUserId(gate.userId)

    const [{ data: matchData }, { data: challengeData }] = await Promise.all([
      supabase.from('matches').select('*').eq('user_id', gate.userId).order('played_at', { ascending: false }),
      supabase.from('challenges').select('*, courts(name)')
        .or(`challenger_id.eq.${gate.userId},challenged_id.eq.${gate.userId}`)
        .order('created_at', { ascending: false }),
    ])

    setMatches((matchData as Match[]) ?? [])
    setChallenges((challengeData as Challenge[]) ?? [])
    setLoading(false)
  }

  useFocusEffect(useCallback(() => { loadAll() }, []))

  async function loadCourts() {
    if (courts.length > 0) return
    const { data } = await supabase.from('courts').select('id, name').order('name')
    setCourts((data as CourtOption[]) ?? [])
  }

  function openChallengeModal() {
    setChallengeUsername('')
    setChallengeTime('')
    setChallengeCourtId(null)
    setChallengeCourtName(null)
    setShowCourtPicker(false)
    loadCourts()
    setShowChallengeModal(true)
  }

  async function submitChallenge() {
    const rawUsername = challengeUsername.trim().replace(/^@/, '')
    if (!rawUsername) { Alert.alert('Username required', "Enter your opponent's username."); return }
    setChallengeSubmitting(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) { Alert.alert('Error', gate.error); return }

      const { data: player } = await supabase
        .from('players')
        .select('user_id, display_name, username')
        .eq('username', rawUsername)
        .maybeSingle()

      if (!player) { Alert.alert('Player not found', `No player with username @${rawUsername} was found.`); return }
      if (player.user_id === gate.userId) { Alert.alert('Nice try', "You can't challenge yourself!"); return }

      const { data: me } = await supabase.from('players').select('display_name').eq('user_id', gate.userId).maybeSingle()

      const { error } = await supabase.from('challenges').insert({
        challenger_id: gate.userId,
        challenged_id: player.user_id,
        challenger_name: me?.display_name ?? 'A player',
        challenged_name: player.display_name,
        court_id: challengeCourtId,
        proposed_time: challengeTime.trim() || null,
        status: 'pending',
      })

      if (error) { Alert.alert('Could not send', error.message); return }

      const { data: tokenRow } = await supabase
        .from('notification_tokens').select('push_token').eq('user_id', player.user_id).maybeSingle()
      if (tokenRow?.push_token) {
        const courtText = challengeCourtName ? ` at ${challengeCourtName}` : ''
        const timeText = challengeTime.trim() ? ` · ${challengeTime.trim()}` : ''
        await sendPushNotification(
          tokenRow.push_token,
          '🏓 Match Challenge!',
          `${me?.display_name ?? 'Someone'} challenged you${courtText}${timeText}`,
        )
      }

      setShowChallengeModal(false)
      loadAll()
      Alert.alert('Challenge sent! 🏓', `${player.display_name ?? player.username} has been challenged.`)
    } finally {
      setChallengeSubmitting(false)
    }
  }

  async function respondToChallenge(challengeId: string, status: 'accepted' | 'declined') {
    setRespondingId(challengeId)
    try {
      const { error } = await supabase.from('challenges').update({ status }).eq('id', challengeId)
      if (error) { Alert.alert('Error', error.message); return }

      const challenge = challenges.find(c => c.id === challengeId)
      if (challenge) {
        const { data: tokenRow } = await supabase
          .from('notification_tokens').select('push_token').eq('user_id', challenge.challenger_id).maybeSingle()
        if (tokenRow?.push_token) {
          const myName = challenge.challenged_name ?? 'Your opponent'
          const verb = status === 'accepted' ? 'accepted' : 'declined'
          await sendPushNotification(
            tokenRow.push_token,
            `Challenge ${verb}!`,
            `${myName} ${verb} your match challenge.${status === 'accepted' ? ' Game on! 🏓' : ''}`,
          )
        }
      }

      loadAll()
    } finally {
      setRespondingId(null)
    }
  }

  async function submitMatch() {
    if (!opponent.trim()) { Alert.alert('Opponent required', "Enter your opponent's name."); return }
    if (!result) { Alert.alert('Result required', 'Did you win or lose?'); return }
    setSubmitting(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) { Alert.alert('Error', gate.error); return }
      const { error } = await supabase.from('matches').insert({
        user_id: gate.userId,
        opponent_name: opponent.trim(),
        result: result.toLowerCase(),
        user_score: detailedMode && userScore ? parseInt(userScore) : null,
        opponent_score: detailedMode && opponentScore ? parseInt(opponentScore) : null,
        notes: notes.trim() || null,
        played_at: new Date().toISOString(),
      })
      if (error) { Alert.alert('Could not save', error.message); return }
      setShowModal(false)
      setOpponent(''); setResult(''); setUserScore(''); setOpponentScore(''); setNotes(''); setDetailedMode(false)
      loadAll()
      Alert.alert(result === 'Win' ? 'Nice win! 🏆' : 'Tough one 💪', 'Match recorded.')
    } finally {
      setSubmitting(false)
    }
  }

  function renderChallenge(challenge: Challenge) {
    const isIncoming = challenge.challenged_id === currentUserId
    const isPending = challenge.status === 'pending'
    const statusStyle = challengeStatusStyle(challenge.status)
    const isResponding = respondingId === challenge.id
    const name = isIncoming ? challenge.challenger_name : challenge.challenged_name

    return (
      <View
        key={challenge.id}
        style={[styles.challengeCard, { backgroundColor: cardBg, borderColor: isPending && isIncoming ? '#F59E0B' : cardBorder }]}>
        <View style={styles.challengeTop}>
          <View style={[styles.avatarCircle, { backgroundColor: isIncoming ? '#F59E0B' : '#534AB7' }]}>
            <Text style={styles.avatarText}>{(name ?? '?').charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.challengeInfo}>
            <Text style={[styles.challengeTitle, { color: theme.text }]}>
              {isIncoming ? `${challenge.challenger_name} challenged you` : `vs ${challenge.challenged_name}`}
            </Text>
            {challenge.proposed_time ? (
              <Text style={[styles.challengeMeta, { color: theme.icon }]}>🕐 {challenge.proposed_time}</Text>
            ) : null}
            {challenge.courts?.name ? (
              <Text style={[styles.challengeMeta, { color: theme.icon }]}>📍 {challenge.courts.name}</Text>
            ) : null}
          </View>
          {!(isIncoming && isPending) ? (
            <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
              <Text style={[styles.statusText, { color: statusStyle.text }]}>
                {challenge.status.charAt(0).toUpperCase() + challenge.status.slice(1)}
              </Text>
            </View>
          ) : null}
        </View>

        {isIncoming && isPending ? (
          <View style={styles.challengeActions}>
            <TouchableOpacity
              style={[styles.acceptBtn, isResponding && { opacity: 0.6 }]}
              onPress={() => respondToChallenge(challenge.id, 'accepted')}
              disabled={isResponding}
              activeOpacity={0.8}>
              {isResponding
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.acceptBtnText}>Accept</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.declineBtn, { borderColor: cardBorder }, isResponding && { opacity: 0.6 }]}
              onPress={() => respondToChallenge(challenge.id, 'declined')}
              disabled={isResponding}
              activeOpacity={0.8}>
              <Text style={[styles.declineBtnText, { color: theme.text }]}>Decline</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    )
  }

  const listHeader = (
    <>
      <View style={[styles.statsRow, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={styles.statBlock}>
          <Text style={[styles.statNum, { color: '#1D9E75' }]}>{wins}</Text>
          <Text style={[styles.statLabel, { color: theme.icon }]}>Wins</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
        <View style={styles.statBlock}>
          <Text style={[styles.statNum, { color: theme.text }]}>{wins + losses}</Text>
          <Text style={[styles.statLabel, { color: theme.icon }]}>Played</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
        <View style={styles.statBlock}>
          <Text style={[styles.statNum, { color: '#E24B4A' }]}>{losses}</Text>
          <Text style={[styles.statLabel, { color: theme.icon }]}>Losses</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
        <View style={styles.statBlock}>
          <Text style={[styles.statNum, { color: theme.text }]}>
            {wins + losses === 0 ? '—' : `${Math.round((wins / (wins + losses)) * 100)}%`}
          </Text>
          <Text style={[styles.statLabel, { color: theme.icon }]}>Win rate</Text>
        </View>
      </View>

      {challenges.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Challenges</Text>
          {challenges.map(renderChallenge)}
        </View>
      ) : null}

      {matches.length > 0 ? (
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Match history</Text>
      ) : null}
    </>
  )

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.main}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.headerTitle, { color: theme.text }]}>My record</Text>
            <Text style={[styles.headerSub, { color: theme.icon }]}>Track your wins and losses</Text>
          </View>
          <TouchableOpacity style={styles.challengeHeaderBtn} onPress={openChallengeModal} activeOpacity={0.8}>
            <MaterialIcons name="sports" size={18} color="#92400E" />
            <Text style={styles.challengeHeaderBtnText}>Challenge</Text>
          </TouchableOpacity>
        </View>

        <FlatList
        style={{ flex: 1 }}
        data={matches}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: FAB_SIZE + 32 + insets.bottom }]}
        onRefresh={loadAll}
        refreshing={loading}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.centered}>
              <MaterialIcons name="emoji-events" size={48} color={theme.icon} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No matches yet</Text>
              <Text style={[styles.emptySub, { color: theme.icon }]}>Tap the + button to log your first match!</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const rc = resultColor(item.result)
          return (
            <TouchableOpacity
              style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={() => router.push(`/match/${encodeURIComponent(item.id)}`)}
              activeOpacity={0.85}>
              <View style={styles.cardTop}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>{item.opponent_name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={[styles.cardName, { color: theme.text }]}>vs {item.opponent_name}</Text>
                  <Text style={[styles.cardDate, { color: theme.icon }]}>{formatDate(item.played_at)}</Text>
                </View>
                <View style={styles.cardRight}>
                  {item.user_score != null && item.opponent_score != null ? (
                    <Text style={[styles.scoreText, { color: theme.text }]}>{item.user_score} – {item.opponent_score}</Text>
                  ) : null}
                  <View style={[styles.resultBadge, { backgroundColor: rc.bg }]}>
                    <Text style={[styles.resultText, { color: rc.text }]}>
                      {item.result.charAt(0).toUpperCase() + item.result.slice(1)}
                    </Text>
                  </View>
                </View>
              </View>
              {item.notes ? (
                <Text style={[styles.cardNotes, { color: theme.icon }]}>{item.notes}</Text>
              ) : null}
            </TouchableOpacity>
          )
        }}
      />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log a match"
          style={({ pressed }) => [
            styles.fab,
            {
              bottom: 16 + insets.bottom,
              right: 16 + insets.right,
              opacity: pressed ? 0.92 : 1,
            },
          ]}
          onPress={() => setShowModal(true)}>
          <MaterialIcons name="add" size={30} color="#fff" />
        </Pressable>
      </View>

      {/* Log match modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]} edges={['top']}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Log a match</Text>
            <TouchableOpacity onPress={() => setShowModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.icon} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Opponent name</Text>
            <TextInput
              value={opponent} onChangeText={setOpponent}
              placeholder="e.g. Maria L." placeholderTextColor={theme.icon}
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Result</Text>
            <View style={styles.pillRow}>
              {RESULTS.map((r) => (
                <TouchableOpacity
                  key={r} onPress={() => setResult(r)}
                  style={[styles.pill, {
                    borderColor: result === r ? (r === 'Win' ? '#1D9E75' : '#E24B4A') : cardBorder,
                    backgroundColor: result === r ? (r === 'Win' ? '#E1F5EE' : '#FCEBEB') : cardBg,
                  }]}>
                  <Text style={[styles.pillText, { color: result === r ? (r === 'Win' ? '#0F6E56' : '#791F1F') : theme.icon }]}>
                    {r === 'Win' ? '🏆 Win' : '💪 Loss'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.detailToggleRow}>
              <Text style={[styles.fieldLabel, { color: theme.icon, marginTop: 0 }]}>Add score & details</Text>
              <TouchableOpacity
                onPress={() => setDetailedMode(!detailedMode)}
                style={[styles.toggleBtn, { backgroundColor: detailedMode ? '#E1F5EE' : cardBg, borderColor: detailedMode ? '#1D9E75' : cardBorder }]}>
                <Text style={[styles.toggleBtnText, { color: detailedMode ? '#0F6E56' : theme.icon }]}>
                  {detailedMode ? 'On' : 'Off'}
                </Text>
              </TouchableOpacity>
            </View>

            {detailedMode && (
              <>
                <Text style={[styles.fieldLabel, { color: theme.icon }]}>Score</Text>
                <View style={styles.scoreRow}>
                  <View style={styles.scoreInputWrap}>
                    <Text style={[styles.scoreInputLabel, { color: theme.icon }]}>You</Text>
                    <TextInput
                      value={userScore} onChangeText={setUserScore} placeholder="11"
                      placeholderTextColor={theme.icon} keyboardType="number-pad"
                      style={[styles.scoreInput, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
                    />
                  </View>
                  <Text style={[styles.scoreDash, { color: theme.icon }]}>–</Text>
                  <View style={styles.scoreInputWrap}>
                    <Text style={[styles.scoreInputLabel, { color: theme.icon }]}>Them</Text>
                    <TextInput
                      value={opponentScore} onChangeText={setOpponentScore} placeholder="9"
                      placeholderTextColor={theme.icon} keyboardType="number-pad"
                      style={[styles.scoreInput, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
                    />
                  </View>
                </View>
              </>
            )}

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Notes (optional)</Text>
            <TextInput
              value={notes} onChangeText={setNotes}
              placeholder="e.g. Great dinking game, played at Riverside Park"
              placeholderTextColor={theme.icon} multiline numberOfLines={3}
              style={[styles.input, styles.textArea, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />

            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={submitMatch} disabled={submitting} activeOpacity={0.8}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Save match</Text>}
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Challenge modal */}
      <Modal visible={showChallengeModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]} edges={['top']}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Challenge a Player</Text>
            <TouchableOpacity onPress={() => setShowChallengeModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.icon} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Opponent username</Text>
            <TextInput
              value={challengeUsername} onChangeText={setChallengeUsername}
              placeholder="@username" placeholderTextColor={theme.icon}
              autoCapitalize="none" autoCorrect={false}
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Proposed time</Text>
            <TextInput
              value={challengeTime} onChangeText={setChallengeTime}
              placeholder="e.g. Saturday at 2pm" placeholderTextColor={theme.icon}
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Court (optional)</Text>
            <TouchableOpacity
              style={[styles.courtPickerBtn, { backgroundColor: cardBg, borderColor: challengeCourtId ? '#1D9E75' : cardBorder }]}
              onPress={() => setShowCourtPicker(p => !p)}
              activeOpacity={0.8}>
              <MaterialIcons name="location-on" size={18} color={challengeCourtId ? '#1D9E75' : theme.icon} />
              <Text style={[styles.courtPickerBtnText, { color: challengeCourtId ? '#1D9E75' : theme.icon }]}>
                {challengeCourtName ?? 'Pick a court'}
              </Text>
              <MaterialIcons name={showCourtPicker ? 'expand-less' : 'expand-more'} size={20} color={theme.icon} />
            </TouchableOpacity>

            {showCourtPicker ? (
              <ScrollView
                style={[styles.courtList, { backgroundColor: cardBg, borderColor: cardBorder }]}
                nestedScrollEnabled>
                <TouchableOpacity
                  style={[styles.courtListItem, { borderBottomColor: cardBorder, borderBottomWidth: 0.5 }]}
                  onPress={() => { setChallengeCourtId(null); setChallengeCourtName(null); setShowCourtPicker(false) }}>
                  <Text style={[styles.courtListItemText, { color: theme.icon }]}>None</Text>
                </TouchableOpacity>
                {courts.map((court, i) => (
                  <TouchableOpacity
                    key={court.id}
                    style={[styles.courtListItem, i < courts.length - 1 && { borderBottomColor: cardBorder, borderBottomWidth: 0.5 }]}
                    onPress={() => { setChallengeCourtId(court.id); setChallengeCourtName(court.name); setShowCourtPicker(false) }}>
                    <Text style={[styles.courtListItemText, { color: theme.text }]}>{court.name}</Text>
                    {challengeCourtId === court.id
                      ? <MaterialIcons name="check" size={18} color="#1D9E75" />
                      : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}

            <TouchableOpacity
              style={[styles.submitBtn, { marginTop: 32 }, challengeSubmitting && { opacity: 0.6 }]}
              onPress={submitChallenge} disabled={challengeSubmitting} activeOpacity={0.8}>
              {challengeSubmitting
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.submitBtnText}>Send Challenge 🏓</Text>}
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  main: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  headerTitle: { fontSize: 22, fontWeight: '700' },
  headerSub: { fontSize: 13, marginTop: 2 },
  challengeHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEF3C7', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#F59E0B' },
  challengeHeaderBtnText: { color: '#92400E', fontSize: 14, fontWeight: '600' },
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
      },
      android: { elevation: 8 },
    }),
  },
  statsRow: { flexDirection: 'row', marginHorizontal: 16, borderRadius: 14, borderWidth: 0.5, padding: 16, marginBottom: 16 },
  statBlock: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 24, fontWeight: '700' },
  statLabel: { fontSize: 12, marginTop: 2 },
  statDivider: { width: 0.5, marginHorizontal: 8 },
  section: { marginHorizontal: 16, marginBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginHorizontal: 16, marginBottom: 10 },
  challengeCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  challengeTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  challengeInfo: { flex: 1 },
  challengeTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  challengeMeta: { fontSize: 13, marginTop: 3 },
  challengeActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  acceptBtn: { flex: 1, backgroundColor: '#1D9E75', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  declineBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 0.5 },
  declineBtnText: { fontWeight: '600', fontSize: 14 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, alignSelf: 'flex-start' },
  statusText: { fontSize: 12, fontWeight: '600' },
  centered: { justifyContent: 'center', alignItems: 'center', padding: 24, minHeight: 200 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 16 },
  emptySub: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  list: { flexGrow: 1, paddingHorizontal: 16, gap: 10 },
  card: { borderRadius: 14, borderWidth: 0.5, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#534AB7', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '600' },
  cardDate: { fontSize: 12, marginTop: 2 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  scoreText: { fontSize: 14, fontWeight: '700' },
  resultBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  resultText: { fontSize: 12, fontWeight: '600' },
  cardNotes: { fontSize: 13, marginTop: 8, lineHeight: 18 },
  modal: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  modalScroll: { flex: 1, paddingHorizontal: 20 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 0.5, borderRadius: 12, padding: 14, fontSize: 15 },
  textArea: { height: 90, textAlignVertical: 'top' },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 0.5, alignItems: 'center' },
  pillText: { fontSize: 14, fontWeight: '500' },
  detailToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  toggleBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 0.5 },
  toggleBtnText: { fontSize: 13, fontWeight: '600' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scoreInputWrap: { flex: 1, alignItems: 'center', gap: 6 },
  scoreInputLabel: { fontSize: 12, fontWeight: '600' },
  scoreInput: { borderWidth: 0.5, borderRadius: 12, padding: 14, fontSize: 20, fontWeight: '700', textAlign: 'center', width: '100%' },
  scoreDash: { fontSize: 24, fontWeight: '700' },
  submitBtn: { backgroundColor: '#1D9E75', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  courtPickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 0.5, borderRadius: 12, padding: 14 },
  courtPickerBtnText: { flex: 1, fontSize: 15 },
  courtList: { borderWidth: 0.5, borderRadius: 12, marginTop: 6, maxHeight: 240 },
  courtListItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  courtListItemText: { fontSize: 15 },
})
