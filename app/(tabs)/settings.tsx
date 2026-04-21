import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { submitChallenge } from '@/lib/challenges'
import { ensureFavoritesUser } from '@/lib/favorites'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import * as ImagePicker from 'expo-image-picker'
import * as Linking from 'expo-linking'
import { useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { supabase } from '@/supabase'

const ITEMS = [
  { id: 'privacy', label: 'Privacy Policy', icon: 'lock-outline', url: 'https://dawsonhanks.github.io/paddles-up-privacy/' },
  { id: 'suggest', label: 'Suggest a Court', icon: 'add-location-alt', url: 'mailto:paddlesupapp@gmail.com?subject=Court Suggestion' },
  { id: 'feedback', label: 'Send Feedback', icon: 'chat-bubble-outline', url: 'mailto:paddlesupapp@gmail.com?subject=Paddles Up Feedback' },
]

type Profile = {
  display_name: string | null
  username: string | null
  avatar_url: string | null
  wins: number
  losses: number
}

type Friend = {
  user_id: string
  display_name: string | null
  username: string | null
  avatar_url: string | null
}

type PlayerResult = Friend & { isFriend: boolean }
type CourtOption = { id: string; name: string }

function FriendAvatar({ friend, size = 56 }: { friend: Friend; size?: number }) {
  const initials = (friend.display_name ?? friend.username ?? '?').charAt(0).toUpperCase()
  if (friend.avatar_url) {
    return <Image source={{ uri: friend.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  }
  const colors = ['#534AB7', '#0F6E56', '#D97706', '#0EA5E9', '#9333EA']
  const colorIndex = (friend.user_id.charCodeAt(0) + friend.user_id.charCodeAt(1)) % colors.length
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors[colorIndex], alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: size * 0.38, fontWeight: '700' }}>{initials}</Text>
    </View>
  )
}

export default function ProfileScreen() {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const router = useRouter()

  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const muted = isDark ? '#94A3B8' : '#64748B'

  // Profile state
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editName, setEditName] = useState('')
  const [editUsername, setEditUsername] = useState('')
  const [avatarUri, setAvatarUri] = useState<string | null>(null)

  // Friends state
  const [friends, setFriends] = useState<Friend[]>([])
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null)
  const [showFriendAction, setShowFriendAction] = useState(false)

  // Challenge modal (from friends)
  const [showChallengeModal, setShowChallengeModal] = useState(false)
  const [challengeTime, setChallengeTime] = useState('')
  const [challengeCourtId, setChallengeCourtId] = useState<string | null>(null)
  const [challengeCourtName, setChallengeCourtName] = useState<string | null>(null)
  const [challengeSubmitting, setChallengeSubmitting] = useState(false)
  const [courts, setCourts] = useState<CourtOption[]>([])
  const [showCourtPicker, setShowCourtPicker] = useState(false)

  // Add friends modal
  const [showAddFriends, setShowAddFriends] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PlayerResult[]>([])
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)

  async function loadProfile() {
    setLoading(true)
    const gate = await ensureFavoritesUser()
    if ('error' in gate) { setLoading(false); return }

    const [{ data: playerData }, { data: matchData }] = await Promise.all([
      supabase.from('players').select('*').eq('user_id', gate.userId).maybeSingle(),
      supabase.from('matches').select('result').eq('user_id', gate.userId),
    ])

    const wins = matchData?.filter(m => m.result === 'win').length ?? 0
    const losses = matchData?.filter(m => m.result === 'loss').length ?? 0

    setProfile({
      display_name: playerData?.display_name ?? null,
      username: playerData?.username ?? null,
      avatar_url: playerData?.avatar_url ?? null,
      wins,
      losses,
    })
    setLoading(false)
  }

  async function loadFriends() {
    setFriendsLoading(true)
    const gate = await ensureFavoritesUser()
    if ('error' in gate) { setFriendsLoading(false); return }

    const { data: rows } = await supabase
      .from('friendships')
      .select('friend_id')
      .eq('user_id', gate.userId)

    const ids = rows?.map(r => r.friend_id) ?? []
    if (ids.length === 0) { setFriends([]); setFriendsLoading(false); return }

    const { data: players } = await supabase
      .from('players')
      .select('user_id, display_name, username, avatar_url')
      .in('user_id', ids)

    setFriends((players as Friend[]) ?? [])
    setFriendsLoading(false)
  }

  useFocusEffect(useCallback(() => {
    loadProfile()
    loadFriends()
  }, []))

  async function loadCourts() {
    if (courts.length > 0) return
    const { data } = await supabase.from('courts').select('id, name').order('name')
    setCourts((data as CourtOption[]) ?? [])
  }

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to set a profile picture.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    })
    if (!result.canceled && result.assets[0]) setAvatarUri(result.assets[0].uri)
  }

  async function saveProfile() {
    if (!editName.trim()) { Alert.alert('Name required', 'Please enter your display name.'); return }
    setSaving(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) { Alert.alert('Error', gate.error); return }
      const { error } = await supabase.from('players').upsert({
        user_id: gate.userId,
        display_name: editName.trim(),
        username: editUsername.trim() || null,
        avatar_url: avatarUri ?? profile?.avatar_url ?? null,
      }, { onConflict: 'user_id' })
      if (error) { Alert.alert('Could not save', error.message); return }
      setShowEdit(false)
      loadProfile()
    } finally {
      setSaving(false)
    }
  }

  function openEdit() {
    setEditName(profile?.display_name ?? '')
    setEditUsername(profile?.username ?? '')
    setAvatarUri(profile?.avatar_url ?? null)
    setShowEdit(true)
  }

  function openFriendAction(friend: Friend) {
    setSelectedFriend(friend)
    setShowFriendAction(true)
  }

  function openChallengeFromFriend() {
    setShowFriendAction(false)
    setChallengeTime('')
    setChallengeCourtId(null)
    setChallengeCourtName(null)
    setShowCourtPicker(false)
    loadCourts()
    setShowChallengeModal(true)
  }

  async function handleChallengeFriend() {
    if (!selectedFriend?.username) {
      Alert.alert('No username', 'This player has not set a username yet.')
      return
    }
    setChallengeSubmitting(true)
    try {
      const result = await submitChallenge({
        username: selectedFriend.username,
        proposedTime: challengeTime,
        courtId: challengeCourtId,
        courtName: challengeCourtName,
      })
      if (!result.ok) { Alert.alert('Could not send', result.error); return }
      setShowChallengeModal(false)
      Alert.alert('Challenge sent! 🏓', `${result.opponentName} has been challenged.`)
    } finally {
      setChallengeSubmitting(false)
    }
  }

  async function searchPlayers() {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) return

      const { data: results } = await supabase
        .from('players')
        .select('user_id, display_name, username, avatar_url')
        .or(`username.ilike.%${searchQuery.trim()}%,display_name.ilike.%${searchQuery.trim()}%`)
        .neq('user_id', gate.userId)
        .limit(20)

      const friendIds = new Set(friends.map(f => f.user_id))
      setSearchResults(
        (results ?? []).map(p => ({ ...(p as Friend), isFriend: friendIds.has(p.user_id) }))
      )
    } finally {
      setSearching(false)
    }
  }

  async function addFriend(friendUserId: string) {
    setAddingId(friendUserId)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) return
      const { error } = await supabase.from('friendships').insert({ user_id: gate.userId, friend_id: friendUserId })
      if (error) { Alert.alert('Could not add', error.message); return }
      setSearchResults(prev => prev.map(p => p.user_id === friendUserId ? { ...p, isFriend: true } : p))
      loadFriends()
    } finally {
      setAddingId(null)
    }
  }

  const winRate = profile && (profile.wins + profile.losses) > 0
    ? `${Math.round((profile.wins / (profile.wins + profile.losses)) * 100)}%`
    : '—'

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container}>

        {/* Profile section */}
        <View style={styles.profileSection}>
          <TouchableOpacity style={styles.avatarWrap} onPress={openEdit} activeOpacity={0.85}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: '#0F6E56' }]}>
                <Text style={styles.avatarEmoji}>🏓</Text>
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              <MaterialIcons name="edit" size={12} color="#fff" />
            </View>
          </TouchableOpacity>

          {loading ? (
            <ActivityIndicator color={theme.tint} style={{ marginTop: 12 }} />
          ) : (
            <>
              <Text style={[styles.displayName, { color: theme.text }]}>
                {profile?.display_name ?? 'Your Name'}
              </Text>
              {profile?.username ? (
                <Text style={[styles.username, { color: muted }]}>@{profile.username}</Text>
              ) : null}

              <View style={styles.statsRow}>
                <View style={styles.statBlock}>
                  <Text style={[styles.statNum, { color: '#1D9E75' }]}>{profile?.wins ?? 0}</Text>
                  <Text style={[styles.statLabel, { color: muted }]}>Wins</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
                <View style={styles.statBlock}>
                  <Text style={[styles.statNum, { color: '#E24B4A' }]}>{profile?.losses ?? 0}</Text>
                  <Text style={[styles.statLabel, { color: muted }]}>Losses</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: cardBorder }]} />
                <View style={styles.statBlock}>
                  <Text style={[styles.statNum, { color: theme.text }]}>{winRate}</Text>
                  <Text style={[styles.statLabel, { color: muted }]}>Win rate</Text>
                </View>
              </View>

              <View style={styles.profileBtnRow}>
                <TouchableOpacity style={styles.editBtn} onPress={openEdit} activeOpacity={0.8}>
                  <MaterialIcons name="edit" size={16} color="#0F6E56" />
                  <Text style={styles.editBtnText}>Edit Profile</Text>
                </TouchableOpacity>
                {profile?.username ? (
                  <TouchableOpacity
                    style={styles.shareBtn}
                    onPress={() => Share.share({
                      message: `Check out my Paddles Up profile: https://paddlesup.app/${profile.username}`,
                      url: `https://paddlesup.app/${profile.username}`,
                    })}
                    activeOpacity={0.8}>
                    <MaterialIcons name="share" size={16} color="#0EA5E9" />
                    <Text style={styles.shareBtnText}>Share Profile</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          )}
        </View>

        {/* Friends section */}
        <View style={[styles.friendsCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={styles.friendsHeader}>
            <Text style={[styles.friendsTitle, { color: theme.text }]}>Friends</Text>
            <TouchableOpacity
              style={styles.addFriendBtn}
              onPress={() => { setSearchQuery(''); setSearchResults([]); setShowAddFriends(true) }}
              activeOpacity={0.8}>
              <MaterialIcons name="person-add" size={16} color="#1D9E75" />
              <Text style={styles.addFriendBtnText}>Add</Text>
            </TouchableOpacity>
          </View>

          {friendsLoading ? (
            <ActivityIndicator color={theme.tint} style={{ marginVertical: 16 }} />
          ) : friends.length === 0 ? (
            <Text style={[styles.friendsEmpty, { color: muted }]}>
              No friends yet — add players you know!
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.friendsList}>
              {friends.map(friend => (
                <TouchableOpacity
                  key={friend.user_id}
                  style={styles.friendItem}
                  onPress={() => openFriendAction(friend)}
                  activeOpacity={0.75}>
                  <FriendAvatar friend={friend} size={56} />
                  <Text style={[styles.friendName, { color: theme.text }]} numberOfLines={1}>
                    {friend.display_name ?? friend.username ?? '?'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Settings links */}
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          {ITEMS.map((item, i) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.row, i < ITEMS.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: cardBorder }]}
              onPress={() => Linking.openURL(item.url)}
              activeOpacity={0.7}>
              <MaterialIcons name={item.icon as any} size={22} color="#1D9E75" style={styles.rowIcon} />
              <Text style={[styles.rowLabel, { color: theme.text }]}>{item.label}</Text>
              <MaterialIcons name="chevron-right" size={20} color={muted} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.tagline, { color: muted }]}>Find your court. Play your game.</Text>
        <Text style={[styles.version, { color: muted }]}>Version 1.0.0</Text>
      </ScrollView>

      {/* Edit profile modal */}
      <Modal visible={showEdit} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]} edges={['top']}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Edit Profile</Text>
            <TouchableOpacity onPress={() => setShowEdit(false)}>
              <MaterialIcons name="close" size={24} color={muted} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <TouchableOpacity style={styles.avatarPickerWrap} onPress={pickImage} activeOpacity={0.85}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarLarge} />
              ) : (
                <View style={[styles.avatarLargePlaceholder, { backgroundColor: '#0F6E56' }]}>
                  <Text style={styles.avatarLargeEmoji}>🏓</Text>
                </View>
              )}
              <View style={styles.avatarPickerBadge}>
                <MaterialIcons name="photo-camera" size={18} color="#fff" />
              </View>
              <Text style={[styles.avatarPickerHint, { color: muted }]}>Tap to change photo</Text>
            </TouchableOpacity>

            <Text style={[styles.fieldLabel, { color: muted }]}>Display name</Text>
            <TextInput
              value={editName} onChangeText={setEditName}
              placeholder="e.g. Jake T." placeholderTextColor={muted}
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />
            <Text style={[styles.fieldLabel, { color: muted }]}>Username</Text>
            <TextInput
              value={editUsername} onChangeText={setEditUsername}
              placeholder="e.g. pickleball_jake" placeholderTextColor={muted}
              autoCapitalize="none"
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />
            <TouchableOpacity
              style={[styles.submitBtn, saving && { opacity: 0.6 }]}
              onPress={saveProfile} disabled={saving} activeOpacity={0.8}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Save profile</Text>}
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Friend action sheet */}
      <Modal visible={showFriendAction} transparent animationType="fade" onRequestClose={() => setShowFriendAction(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowFriendAction(false)}>
          <View style={[styles.actionSheet, { backgroundColor: cardBg }]}>
            <View style={styles.actionSheetHandle} />
            {selectedFriend ? (
              <View style={styles.actionSheetProfile}>
                <FriendAvatar friend={selectedFriend} size={48} />
                <View style={{ marginLeft: 14 }}>
                  <Text style={[styles.actionSheetName, { color: theme.text }]}>
                    {selectedFriend.display_name ?? selectedFriend.username ?? 'Player'}
                  </Text>
                  {selectedFriend.username ? (
                    <Text style={[styles.actionSheetUsername, { color: muted }]}>@{selectedFriend.username}</Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            <View style={[styles.actionSheetDivider, { backgroundColor: cardBorder }]} />

            <TouchableOpacity
              style={styles.actionSheetBtn}
              onPress={() => {
                setShowFriendAction(false)
                if (selectedFriend?.username) router.push(`/profile/${selectedFriend.username}` as any)
              }}
              activeOpacity={0.7}>
              <MaterialIcons name="person" size={22} color="#0EA5E9" />
              <Text style={[styles.actionSheetBtnText, { color: theme.text }]}>View Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionSheetBtn}
              onPress={openChallengeFromFriend}
              activeOpacity={0.7}>
              <MaterialIcons name="sports" size={22} color="#F59E0B" />
              <Text style={[styles.actionSheetBtnText, { color: theme.text }]}>Challenge</Text>
            </TouchableOpacity>

            <View style={[styles.actionSheetDivider, { backgroundColor: cardBorder }]} />

            <TouchableOpacity
              style={styles.actionSheetBtn}
              onPress={() => setShowFriendAction(false)}
              activeOpacity={0.7}>
              <Text style={[styles.actionSheetBtnText, { color: '#E24B4A', textAlign: 'center', flex: 1 }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Challenge modal (pre-filled from friend) */}
      <Modal visible={showChallengeModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]} edges={['top']}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              Challenge {selectedFriend?.display_name ?? selectedFriend?.username ?? 'Player'}
            </Text>
            <TouchableOpacity onPress={() => setShowChallengeModal(false)}>
              <MaterialIcons name="close" size={24} color={muted} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            {selectedFriend ? (
              <View style={[styles.challengeTargetRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F8FAFC', borderColor: cardBorder }]}>
                <FriendAvatar friend={selectedFriend} size={40} />
                <View style={{ marginLeft: 12 }}>
                  <Text style={[{ fontWeight: '600', fontSize: 15, color: theme.text }]}>
                    {selectedFriend.display_name ?? selectedFriend.username}
                  </Text>
                  {selectedFriend.username
                    ? <Text style={[{ fontSize: 13, color: muted }]}>@{selectedFriend.username}</Text>
                    : null}
                </View>
              </View>
            ) : null}

            <Text style={[styles.fieldLabel, { color: muted }]}>Proposed time</Text>
            <TextInput
              value={challengeTime} onChangeText={setChallengeTime}
              placeholder="e.g. Saturday at 2pm" placeholderTextColor={muted}
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />

            <Text style={[styles.fieldLabel, { color: muted }]}>Court (optional)</Text>
            <TouchableOpacity
              style={[styles.courtPickerBtn, { backgroundColor: cardBg, borderColor: challengeCourtId ? '#1D9E75' : cardBorder }]}
              onPress={() => setShowCourtPicker(p => !p)}
              activeOpacity={0.8}>
              <MaterialIcons name="location-on" size={18} color={challengeCourtId ? '#1D9E75' : muted} />
              <Text style={[styles.courtPickerBtnText, { color: challengeCourtId ? '#1D9E75' : muted }]}>
                {challengeCourtName ?? 'Pick a court'}
              </Text>
              <MaterialIcons name={showCourtPicker ? 'expand-less' : 'expand-more'} size={20} color={muted} />
            </TouchableOpacity>

            {showCourtPicker ? (
              <ScrollView style={[styles.courtList, { backgroundColor: cardBg, borderColor: cardBorder }]} nestedScrollEnabled>
                <TouchableOpacity
                  style={[styles.courtListItem, { borderBottomColor: cardBorder, borderBottomWidth: 0.5 }]}
                  onPress={() => { setChallengeCourtId(null); setChallengeCourtName(null); setShowCourtPicker(false) }}>
                  <Text style={[styles.courtListItemText, { color: muted }]}>None</Text>
                </TouchableOpacity>
                {courts.map((court, i) => (
                  <TouchableOpacity
                    key={court.id}
                    style={[styles.courtListItem, i < courts.length - 1 && { borderBottomColor: cardBorder, borderBottomWidth: 0.5 }]}
                    onPress={() => { setChallengeCourtId(court.id); setChallengeCourtName(court.name); setShowCourtPicker(false) }}>
                    <Text style={[styles.courtListItemText, { color: theme.text }]}>{court.name}</Text>
                    {challengeCourtId === court.id ? <MaterialIcons name="check" size={18} color="#1D9E75" /> : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}

            <TouchableOpacity
              style={[styles.submitBtn, { marginTop: 32 }, challengeSubmitting && { opacity: 0.6 }]}
              onPress={handleChallengeFriend} disabled={challengeSubmitting} activeOpacity={0.8}>
              {challengeSubmitting
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.submitBtnText}>Send Challenge 🏓</Text>}
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Add Friends modal */}
      <Modal visible={showAddFriends} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]} edges={['top']}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Add Friends</Text>
            <TouchableOpacity onPress={() => setShowAddFriends(false)}>
              <MaterialIcons name="close" size={24} color={muted} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Username or display name…"
              placeholderTextColor={muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={searchPlayers}
              style={[styles.searchInput, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />
            <TouchableOpacity
              style={[styles.searchBtn, searching && { opacity: 0.6 }]}
              onPress={searchPlayers}
              disabled={searching}
              activeOpacity={0.8}>
              {searching
                ? <ActivityIndicator color="#fff" size="small" />
                : <MaterialIcons name="search" size={20} color="#fff" />}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.searchResults} keyboardShouldPersistTaps="handled">
            {searchResults.length === 0 && !searching ? (
              <Text style={[styles.searchEmpty, { color: muted }]}>
                {searchQuery.trim() ? 'No players found.' : 'Search by username or name to find friends.'}
              </Text>
            ) : null}
            {searchResults.map((player, i) => (
              <View
                key={player.user_id}
                style={[styles.searchResultRow, { borderBottomColor: cardBorder }, i === searchResults.length - 1 && { borderBottomWidth: 0 }]}>
                <FriendAvatar friend={player} size={44} />
                <View style={styles.searchResultInfo}>
                  <Text style={[styles.searchResultName, { color: theme.text }]}>
                    {player.display_name ?? player.username ?? 'Player'}
                  </Text>
                  {player.username ? (
                    <Text style={[styles.searchResultUsername, { color: muted }]}>@{player.username}</Text>
                  ) : null}
                </View>
                {player.isFriend ? (
                  <View style={styles.friendedBadge}>
                    <MaterialIcons name="check" size={16} color="#1D9E75" />
                    <Text style={styles.friendedText}>Added</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.addBtn, addingId === player.user_id && { opacity: 0.6 }]}
                    onPress={() => addFriend(player.user_id)}
                    disabled={addingId === player.user_id}
                    activeOpacity={0.8}>
                    {addingId === player.user_id
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <MaterialIcons name="person-add" size={18} color="#fff" />}
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { padding: 24 },
  profileSection: { alignItems: 'center', marginBottom: 24 },
  avatarWrap: { position: 'relative', marginBottom: 16 },
  avatar: { width: 90, height: 90, borderRadius: 45 },
  avatarPlaceholder: { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 40 },
  avatarEditBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#1D9E75', borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  displayName: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  username: { fontSize: 14, marginBottom: 16 },
  statsRow: { flexDirection: 'row', marginBottom: 16 },
  statBlock: { alignItems: 'center', paddingHorizontal: 20 },
  statNum: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 11, marginTop: 2 },
  statDivider: { width: 0.5 },
  profileBtnRow: { flexDirection: 'row', gap: 10 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#1D9E75' },
  editBtnText: { color: '#0F6E56', fontSize: 14, fontWeight: '600' },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#0EA5E9' },
  shareBtnText: { color: '#0EA5E9', fontSize: 14, fontWeight: '600' },
  // Friends section
  friendsCard: { borderRadius: 16, borderWidth: 0.5, padding: 16, marginBottom: 16 },
  friendsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  friendsTitle: { fontSize: 16, fontWeight: '700' },
  addFriendBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#1D9E75' },
  addFriendBtnText: { color: '#0F6E56', fontSize: 13, fontWeight: '600' },
  friendsEmpty: { fontSize: 14, textAlign: 'center', paddingVertical: 12 },
  friendsList: { gap: 16, paddingVertical: 4 },
  friendItem: { alignItems: 'center', width: 72 },
  friendName: { fontSize: 12, marginTop: 6, textAlign: 'center', fontWeight: '500' },
  // Settings card
  card: { borderRadius: 14, borderWidth: 0.5, overflow: 'hidden', marginBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  rowIcon: { marginRight: 14 },
  rowLabel: { flex: 1, fontSize: 15 },
  tagline: { textAlign: 'center', fontSize: 13, marginBottom: 4 },
  version: { textAlign: 'center', fontSize: 12, marginBottom: 24 },
  // Modals shared
  modal: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  modalScroll: { flex: 1, paddingHorizontal: 20 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 0.5, borderRadius: 12, padding: 14, fontSize: 15 },
  submitBtn: { backgroundColor: '#1D9E75', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // Edit profile modal extras
  avatarPickerWrap: { alignItems: 'center', marginBottom: 8, marginTop: 8, position: 'relative' },
  avatarLarge: { width: 100, height: 100, borderRadius: 50 },
  avatarLargePlaceholder: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center' },
  avatarLargeEmoji: { fontSize: 44 },
  avatarPickerBadge: { position: 'absolute', bottom: 20, right: '30%', backgroundColor: '#1D9E75', borderRadius: 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  avatarPickerHint: { fontSize: 12, marginTop: 8 },
  // Friend action sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  actionSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 },
  actionSheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  actionSheetProfile: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  actionSheetName: { fontSize: 16, fontWeight: '700' },
  actionSheetUsername: { fontSize: 13, marginTop: 2 },
  actionSheetDivider: { height: 0.5, marginHorizontal: 0 },
  actionSheetBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16 },
  actionSheetBtnText: { fontSize: 16, fontWeight: '500' },
  // Challenge modal
  challengeTargetRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 0.5, borderRadius: 14, padding: 14, marginTop: 8 },
  courtPickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 0.5, borderRadius: 12, padding: 14 },
  courtPickerBtnText: { flex: 1, fontSize: 15 },
  courtList: { borderWidth: 0.5, borderRadius: 12, marginTop: 6, maxHeight: 220 },
  courtListItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  courtListItemText: { fontSize: 15 },
  // Add friends modal
  searchRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingBottom: 16 },
  searchInput: { flex: 1, borderWidth: 0.5, borderRadius: 12, padding: 13, fontSize: 15 },
  searchBtn: { backgroundColor: '#1D9E75', width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  searchResults: { flex: 1, paddingHorizontal: 20 },
  searchEmpty: { textAlign: 'center', marginTop: 32, fontSize: 14 },
  searchResultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, gap: 12 },
  searchResultInfo: { flex: 1 },
  searchResultName: { fontSize: 15, fontWeight: '600' },
  searchResultUsername: { fontSize: 13, marginTop: 2 },
  friendedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  friendedText: { color: '#1D9E75', fontSize: 13, fontWeight: '600' },
  addBtn: { backgroundColor: '#1D9E75', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
})
