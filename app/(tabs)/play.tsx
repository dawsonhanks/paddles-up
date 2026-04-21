import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { ensureFavoritesUser } from '@/lib/favorites'
import { sendPushNotification } from '@/lib/push'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { supabase } from '@/supabase'

const SKILL_LEVELS = ['Beginner', 'Intermediate', 'Advanced']
const CITIES = ['Lehi', 'American Fork', 'Pleasant Grove', 'Orem', 'Provo', 'Highland', 'Cedar Hills', 'Alpine', 'Saratoga Springs', 'Eagle Mountain']

type GamePost = {
  id: string
  display_name: string
  skill_level: string
  city: string
  message: string
  players_needed: number
  created_at: string
  expires_at: string
  user_id: string
}

const PLAY_EXPIRE_AT_MIDNIGHT_KEY = 'play.expireAtMidnight'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function skillColor(level: string): { bg: string; text: string } {
  switch (level.toLowerCase()) {
    case 'beginner': return { bg: '#E1F5EE', text: '#0F6E56' }
    case 'intermediate': return { bg: '#FAEEDA', text: '#633806' }
    case 'advanced': return { bg: '#FCEBEB', text: '#791F1F' }
    default: return { bg: '#F1EFE8', text: '#5F5E5A' }
  }
}

function nextLocalMidnightIso(now = new Date()): string {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d.toISOString()
}

function formatAcceptRpcError(message: string): string {
  const raw = message.toLowerCase()
  if (raw.includes('cannot accept your own post')) return "You can't join your own game post."
  if (raw.includes('game is full')) return 'This game is already full.'
  if (raw.includes('duplicate key') || raw.includes('accepts_post_id_user_id_key')) return 'You already joined this game.'
  if (raw.includes('post not found')) return 'This post is no longer available.'
  if (raw.includes('not authenticated')) return 'Please sign in and try again.'
  return message
}

export default function PlayScreen() {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'

  const [posts, setPosts] = useState<GamePost[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [acceptedPostIds, setAcceptedPostIds] = useState<Set<string>>(new Set())
  const [acceptBusyPostId, setAcceptBusyPostId] = useState<string | null>(null)

  const [expireAtMidnight, setExpireAtMidnight] = useState(false)

  const [name, setName] = useState('')
  const [skill, setSkill] = useState('')
  const [city, setCity] = useState('')
  const [message, setMessage] = useState('')
  const [playersNeeded, setPlayersNeeded] = useState('2')
  const [editingPost, setEditingPost] = useState<GamePost | null>(null)

  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(PLAY_EXPIRE_AT_MIDNIGHT_KEY).then((val) => {
      if (cancelled) return
      setExpireAtMidnight(val === 'true')
    })
    return () => { cancelled = true }
  }, [])

  const expireHint = useMemo(() => {
    if (!expireAtMidnight) return 'Uses the default expiration.'
    const midnight = new Date(nextLocalMidnightIso())
    const hrs = Math.max(0, Math.round((midnight.getTime() - Date.now()) / 3600000))
    return hrs <= 1 ? 'Expires at midnight.' : `Expires at midnight (about ${hrs}h).`
  }, [expireAtMidnight])

  async function loadPosts() {
    setLoading(true)
    const gate = await ensureFavoritesUser()
    let uid: string | null = null
    if (!('error' in gate)) {
      uid = gate.userId
      setCurrentUserId(uid)
    } else {
      setCurrentUserId(null)
    }

    const { data } = await supabase
      .from('game_posts')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    setPosts((data as GamePost[]) ?? [])

    if (uid) {
      const { data: acceptRows } = await supabase.from('accepts').select('post_id').eq('user_id', uid)
      setAcceptedPostIds(new Set((acceptRows ?? []).map((r) => r.post_id as string)))
    } else {
      setAcceptedPostIds(new Set())
    }
    setLoading(false)
  }

  async function ensureCurrentUserId(): Promise<string | null> {
    const gate = await ensureFavoritesUser()
    if ('error' in gate) return null
    setCurrentUserId(gate.userId)
    return gate.userId
  }

  useFocusEffect(useCallback(() => {
    loadPosts()
  }, []))

  async function acceptGamePost(post: GamePost) {
    if (acceptBusyPostId) return
    setAcceptBusyPostId(post.id)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        Alert.alert('Error', gate.error)
        return
      }
      const { data: player } = await supabase
        .from('players')
        .select('display_name')
        .eq('user_id', gate.userId)
        .maybeSingle()
      const displayName = player?.display_name?.trim() || 'Anonymous'

      const { error } = await supabase.rpc('accept_game_post', {
        p_post_id: post.id,
        p_display_name: displayName,
      })
      if (error) {
        Alert.alert('Could not join', formatAcceptRpcError(error.message))
        return
      }

      const { data: tokenRow } = await supabase
        .from('notification_tokens')
        .select('push_token')
        .eq('user_id', post.user_id)
        .maybeSingle()
      if (tokenRow?.push_token) {
        await sendPushNotification(
          tokenRow.push_token,
          'Game update',
          `${displayName} joined your game!`,
        )
      }

      setAcceptedPostIds((prev) => new Set(prev).add(post.id))
      await loadPosts()
    } finally {
      setAcceptBusyPostId(null)
    }
  }

  async function unacceptGamePost(post: GamePost) {
    if (acceptBusyPostId) return
    setAcceptBusyPostId(post.id)
    try {
      const { error } = await supabase.rpc('unaccept_game_post', { p_post_id: post.id })
      if (error) {
        Alert.alert('Could not leave', formatAcceptRpcError(error.message))
        return
      }
      setAcceptedPostIds((prev) => {
        const next = new Set(prev)
        next.delete(post.id)
        return next
      })
      await loadPosts()
    } finally {
      setAcceptBusyPostId(null)
    }
  }

  async function submitPost() {
    if (!name.trim()) { Alert.alert('Name required', 'Add your name so others can find you.'); return }
    if (!skill) { Alert.alert('Skill level required', 'Pick your skill level.'); return }
    if (!city) { Alert.alert('City required', 'Pick your city.'); return }

    setSubmitting(true)
    try {
      const gate = await ensureFavoritesUser()
      const userId = 'error' in gate ? null : gate.userId
      if (userId) setCurrentUserId(userId)

      const insertRow: Record<string, unknown> = {
        user_id: userId,
        display_name: name.trim(),
        skill_level: skill,
        city,
        message: message.trim(),
        players_needed: parseInt(playersNeeded) || 2,
      }
      if (expireAtMidnight) insertRow.expires_at = nextLocalMidnightIso()

      const { error } = await supabase.from('game_posts').insert(insertRow)

      if (error) { Alert.alert('Could not post', error.message); return }

      setShowModal(false)
      setName('')
      setSkill('')
      setCity('')
      setMessage('')
      setPlayersNeeded('2')
      loadPosts()
      Alert.alert('Posted! 🏓', 'Players nearby will see your post.')
    } finally {
      setSubmitting(false)
    }
  }

  function openNewPostModal() {
    setEditingPost(null)
    setName('')
    setSkill('')
    setCity('')
    setMessage('')
    setPlayersNeeded('2')
    setShowModal(true)
  }

  function closeComposer() {
    setShowModal(false)
    setEditingPost(null)
  }

  function openEditPost(post: GamePost) {
    setEditingPost(post)
    setName(post.display_name)
    setSkill(post.skill_level)
    setCity(post.city)
    setMessage(post.message ?? '')
    setPlayersNeeded(String(post.players_needed || 2))
    setShowModal(true)
  }

  async function saveEditedPost() {
    if (!editingPost) return
    if (!name.trim()) { Alert.alert('Name required', 'Add your name so others can find you.'); return }
    if (!skill) { Alert.alert('Skill level required', 'Pick your skill level.'); return }
    if (!city) { Alert.alert('City required', 'Pick your city.'); return }

    setSubmitting(true)
    try {
      const userId = currentUserId ?? await ensureCurrentUserId()
      if (!userId) { Alert.alert('Could not verify user', 'Please try again.'); return }

      const { error } = await supabase
        .from('game_posts')
        .update({
          display_name: name.trim(),
          skill_level: skill,
          city,
          message: message.trim(),
          players_needed: parseInt(playersNeeded) || 2,
        })
        .eq('id', editingPost.id)
        .eq('user_id', userId)

      if (error) { Alert.alert('Could not update', error.message); return }

      setEditingPost(null)
      setShowModal(false)
      setName('')
      setSkill('')
      setCity('')
      setMessage('')
      setPlayersNeeded('2')
      loadPosts()
      Alert.alert('Post updated', 'Your game post has been updated.')
    } finally {
      setSubmitting(false)
    }
  }

  function promptDeletePost(post: GamePost) {
    Alert.alert(
      'Delete post?',
      'This will permanently remove your game post.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const userId = currentUserId ?? await ensureCurrentUserId()
            if (!userId) { Alert.alert('Could not verify user', 'Please try again.'); return }
            const { error } = await supabase
              .from('game_posts')
              .delete()
              .eq('id', post.id)
              .eq('user_id', userId)
            if (error) {
              Alert.alert('Could not delete', error.message)
              return
            }
            setPosts((prev) => prev.filter((p) => p.id !== post.id))
            Alert.alert('Deleted', 'Your post has been removed.')
          }
        }
      ]
    )
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Find a game</Text>
          <Text style={[styles.headerSub, { color: theme.icon }]}>Connect with players near you</Text>
        </View>
        <TouchableOpacity
          style={styles.postBtn}
          onPress={openNewPostModal}
          activeOpacity={0.8}>
          <MaterialIcons name="add" size={20} color="#fff" />
          <Text style={styles.postBtnText}>Post</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.tint} />
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="sports" size={48} color={theme.icon} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>No games posted yet</Text>
          <Text style={[styles.emptySub, { color: theme.icon }]}>Be the first to post — tap Post above!</Text>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onRefresh={loadPosts}
          refreshing={loading}
          renderItem={({ item }) => {
            const sc = skillColor(item.skill_level)
            const isMine = currentUserId != null && item.user_id === currentUserId
            return (
              <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
                <View style={styles.cardTop}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>{item.display_name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={[styles.cardName, { color: theme.text }]}>{item.display_name}</Text>
                    <Text style={[styles.cardMeta, { color: theme.icon }]}>{item.city} · {timeAgo(item.created_at)}</Text>
                  </View>
                  <View style={[styles.skillBadge, { backgroundColor: sc.bg }]}>
                    <Text style={[styles.skillText, { color: sc.text }]}>{item.skill_level}</Text>
                  </View>
                </View>
                {item.message ? (
                  <Text style={[styles.cardMessage, { color: theme.text }]}>{item.message}</Text>
                ) : null}
                <View style={[styles.cardFooter, { borderTopColor: cardBorder }]}>
                  {item.players_needed <= 0 ? (
                    <View style={[styles.gameFullBadge, { borderColor: cardBorder, backgroundColor: isDark ? 'rgba(148,163,184,0.15)' : '#F1F5F9' }]}>
                      <MaterialIcons name="groups" size={16} color={isDark ? '#94A3B8' : '#64748B'} />
                      <Text style={[styles.gameFullBadgeText, { color: isDark ? '#94A3B8' : '#64748B' }]}>Game full</Text>
                    </View>
                  ) : (
                    <View style={styles.cardFooterLeft}>
                      <MaterialIcons name="group" size={16} color={theme.icon} />
                      <Text style={[styles.cardFooterText, { color: theme.icon }]}>
                        {`Looking for ${item.players_needed} player${item.players_needed !== 1 ? 's' : ''}`}
                      </Text>
                    </View>
                  )}
                  {isMine ? (
                    <View style={styles.cardActions}>
                      <TouchableOpacity onPress={() => openEditPost(item)} style={[styles.smallActionBtn, { borderColor: cardBorder }]}>
                        <MaterialIcons name="edit" size={15} color="#0EA5E9" />
                        <Text style={[styles.smallActionText, { color: '#0EA5E9' }]}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => promptDeletePost(item)} style={[styles.smallActionBtn, { borderColor: cardBorder }]}>
                        <MaterialIcons name="delete-outline" size={15} color="#E24B4A" />
                        <Text style={[styles.smallActionText, { color: '#E24B4A' }]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  ) : acceptedPostIds.has(item.id) ? (
                    <TouchableOpacity
                      onPress={() => unacceptGamePost(item)}
                      disabled={acceptBusyPostId === item.id}
                      style={[styles.joinedBadge, { borderColor: cardBorder, opacity: acceptBusyPostId === item.id ? 0.6 : 1 }]}>
                      {acceptBusyPostId === item.id ? (
                        <ActivityIndicator size="small" color="#1D9E75" />
                      ) : (
                        <>
                          <MaterialIcons name="check-circle" size={16} color="#1D9E75" />
                          <Text style={styles.joinedBadgeText}>Joined ✓</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => acceptGamePost(item)}
                      disabled={acceptBusyPostId != null}
                      style={[styles.acceptBtn, { opacity: acceptBusyPostId != null ? 0.55 : 1 }]}>
                      {acceptBusyPostId === item.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.acceptBtnText}>Accept</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )
          }}
        />
      )}

      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]} edges={['top']}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{editingPost ? 'Edit post' : 'Post a game'}</Text>
            <TouchableOpacity onPress={closeComposer}>
              <MaterialIcons name="close" size={24} color={theme.icon} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Your name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Jake T."
              placeholderTextColor={theme.icon}
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Skill level</Text>
            <View style={styles.pillRow}>
              {SKILL_LEVELS.map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setSkill(s)}
                  style={[styles.pill, { borderColor: skill === s ? '#1D9E75' : cardBorder, backgroundColor: skill === s ? '#E1F5EE' : cardBg }]}>
                  <Text style={[styles.pillText, { color: skill === s ? '#0F6E56' : theme.icon }]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Your city</Text>
            <View style={styles.cityGrid}>
              {CITIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCity(c)}
                  style={[styles.cityPill, { borderColor: city === c ? '#1D9E75' : cardBorder, backgroundColor: city === c ? '#E1F5EE' : cardBg }]}>
                  <Text style={[styles.pillText, { color: city === c ? '#0F6E56' : theme.icon }]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Players needed</Text>
            <View style={styles.pillRow}>
              {['1', '2', '3'].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setPlayersNeeded(n)}
                  style={[styles.pill, { borderColor: playersNeeded === n ? '#1D9E75' : cardBorder, backgroundColor: playersNeeded === n ? '#E1F5EE' : cardBg }]}>
                  <Text style={[styles.pillText, { color: playersNeeded === n ? '#0F6E56' : theme.icon }]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Message (optional)</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="e.g. Looking to play around 3pm at any Lehi court"
              placeholderTextColor={theme.icon}
              multiline
              numberOfLines={3}
              style={[styles.input, styles.textArea, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />

            <Text style={[styles.fieldLabel, { color: theme.icon }]}>Expiration</Text>
            <TouchableOpacity
              onPress={async () => {
                const next = !expireAtMidnight
                setExpireAtMidnight(next)
                await AsyncStorage.setItem(PLAY_EXPIRE_AT_MIDNIGHT_KEY, next ? 'true' : 'false')
              }}
              activeOpacity={0.8}
              style={[
                styles.expireRow,
                { borderColor: cardBorder, backgroundColor: cardBg },
                expireAtMidnight && { borderColor: '#1D9E75' },
              ]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.expireTitle, { color: theme.text }]}>Expire at midnight</Text>
                <Text style={[styles.expireSub, { color: theme.icon }]}>{expireHint}</Text>
              </View>
              <MaterialIcons
                name={expireAtMidnight ? 'check-circle' : 'radio-button-unchecked'}
                size={22}
                color={expireAtMidnight ? '#1D9E75' : theme.icon}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={editingPost ? saveEditedPost : submitPost}
              disabled={submitting}
              activeOpacity={0.8}>
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>{editingPost ? 'Save changes' : 'Post game 🏓'}</Text>
              )}
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  headerTitle: { fontSize: 22, fontWeight: '700' },
  headerSub: { fontSize: 13, marginTop: 2 },
  postBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1D9E75', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  postBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 16 },
  emptySub: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  list: { padding: 16, gap: 12 },
  card: { borderRadius: 14, borderWidth: 0.5, padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '600' },
  cardMeta: { fontSize: 12, marginTop: 2 },
  skillBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  skillText: { fontSize: 12, fontWeight: '600' },
  cardMessage: { fontSize: 14, lineHeight: 20, marginBottom: 10 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 10, borderTopWidth: 0.5, flexWrap: 'wrap' },
  cardFooterLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  cardFooterText: { fontSize: 13 },
  cardActions: { flexDirection: 'row', gap: 8 },
  smallActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 0.5, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5 },
  smallActionText: { fontSize: 12, fontWeight: '600' },
  acceptBtn: { backgroundColor: '#1D9E75', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, minWidth: 88, alignItems: 'center', justifyContent: 'center' },
  acceptBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  joinedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 0.5, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  joinedBadgeText: { fontSize: 12, fontWeight: '700', color: '#1D9E75' },
  gameFullBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 0.5 },
  gameFullBadgeText: { fontSize: 13, fontWeight: '700' },
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
  cityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cityPill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 0.5 },
  expireRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderRadius: 12, padding: 14 },
  expireTitle: { fontSize: 15, fontWeight: '600' },
  expireSub: { fontSize: 13, marginTop: 4 },
  submitBtn: { backgroundColor: '#1D9E75', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})