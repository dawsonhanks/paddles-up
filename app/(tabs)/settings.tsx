import { ContentFadeIn } from '@/components/content-fade-in'
import { ErrorBanner } from '@/components/error-banner'
import { SkeletonSettingsProfile } from '@/components/skeleton-card'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { ensureFavoritesUser } from '@/lib/favorites'
import {
  isValidEmail,
  isValidPhone,
  isValidUsername,
  normalizeUsername,
  sanitizeUsernameInput,
} from '@/lib/profileValidation'
import { alertOpenSettings } from '@/lib/alerts'
import { invokeDeleteAccountEdge } from '@/lib/deleteAccount'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import * as ImagePicker from 'expo-image-picker'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Modal,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { supabase } from '@/supabase'

/** Matches App Store / Play metadata and GitHub Pages (`index.html` at repo root). */
const PRIVACY_POLICY_URL = 'https://dawsonhanks.github.io/paddles-up-privacy/'

const ITEMS = [
  { id: 'privacy', label: 'Privacy Policy', icon: 'lock-outline', url: PRIVACY_POLICY_URL },
  { id: 'suggest', label: 'Suggest a Court', icon: 'add-location-alt' },
  { id: 'feedback', label: 'Send Feedback', icon: 'chat-bubble-outline', url: 'mailto:paddlesupapp@gmail.com?subject=Paddles Up Feedback' },
]

type Profile = {
  display_name: string | null
  username: string | null
  avatar_url: string | null
  contact: string | null
  skill_rating: number | null
  pickup_skill_level: string | null
  wins: number
  losses: number
}

const PICKUP_SKILL_LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const
const SKILL_RATING_OPTIONS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0] as const
const SKILL_RATING_LABELS: Record<string, string> = {
  '1.0': 'Beginner',
  '1.5': 'Beginner',
  '2.0': 'Recreational',
  '2.5': 'Recreational',
  '3.0': 'Intermediate',
  '3.5': 'Intermediate',
  '4.0': 'Advanced',
  '4.5': 'Advanced',
  '5.0': 'Pro',
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
  const [refreshing, setRefreshing] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createSaving, setCreateSaving] = useState(false)
  const [editName, setEditName] = useState('')
  const [editUsername, setEditUsername] = useState('')
  const [editContact, setEditContact] = useState('')
  const [editContactType, setEditContactType] = useState<'email' | 'phone'>('email')
  const [editSkillRating, setEditSkillRating] = useState<number | null>(null)
  const [editPickupSkill, setEditPickupSkill] = useState<string>('')
  const [createName, setCreateName] = useState('')
  const [createUsername, setCreateUsername] = useState('')
  const [createContact, setCreateContact] = useState('')
  const [createContactType, setCreateContactType] = useState<'email' | 'phone'>('email')
  const [createUsernameStatus, setCreateUsernameStatus] = useState<'idle' | 'invalid' | 'checking' | 'available' | 'taken'>('idle')
  const [avatarUri, setAvatarUri] = useState<string | null>(null)

  const [showSuggestCourt, setShowSuggestCourt] = useState(false)
  const [suggestSubmitting, setSuggestSubmitting] = useState(false)
  const [suggestCourtName, setSuggestCourtName] = useState('')
  const [suggestAddress, setSuggestAddress] = useState('')
  const [suggestCity, setSuggestCity] = useState('')
  const [suggestNumCourts, setSuggestNumCourts] = useState('')
  const [suggestIndoorOutdoor, setSuggestIndoorOutdoor] = useState<'indoor' | 'outdoor'>('outdoor')
  const [suggestSurfaceType, setSuggestSurfaceType] = useState('')
  const [suggestFee, setSuggestFee] = useState('')
  const [suggestHours, setSuggestHours] = useState('')
  const [suggestNotes, setSuggestNotes] = useState('')
  const [profileBanner, setProfileBanner] = useState<string | null>(null)
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false)

  const loadProfile = useCallback(async (cancelledRef?: { current: boolean }) => {
    setLoading(true)
    try {
      const gate = await ensureFavoritesUser()
      if (cancelledRef?.current) return
      if ('error' in gate) return

      const [{ data: playerData }, { data: matchData }] = await Promise.all([
        supabase.from('players').select('*').eq('user_id', gate.userId).maybeSingle(),
        supabase.from('matches').select('result').eq('user_id', gate.userId),
      ])

      if (cancelledRef?.current) return

      const wins = matchData?.filter(m => m.result === 'win').length ?? 0
      const losses = matchData?.filter(m => m.result === 'loss').length ?? 0

      if (cancelledRef?.current) return

      setProfile({
        display_name: playerData?.display_name ?? null,
        username: playerData?.username ?? null,
        avatar_url: playerData?.avatar_url ?? null,
        contact: (playerData as { contact?: string | null } | null)?.contact ?? null,
        skill_rating: (playerData as { skill_rating?: number | null } | null)?.skill_rating ?? null,
        pickup_skill_level:
          (playerData as { pickup_skill_level?: string | null } | null)?.pickup_skill_level ?? null,
        wins,
        losses,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      const cancelled = { current: false }
      void loadProfile(cancelled)
      return () => {
        cancelled.current = true
      }
    }, [loadProfile]),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await loadProfile()
    } finally {
      setRefreshing(false)
    }
  }, [loadProfile])

  async function pickImage() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (status !== 'granted') {
        alertOpenSettings(
          'Photo library',
          'To choose a profile picture, allow photo access in Settings.',
        )
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      })
      if (!result.canceled && result.assets[0]) setAvatarUri(result.assets[0].uri)
    } catch (e) {
      Alert.alert('Photos unavailable', userFriendlyFromUnknown(e))
    }
  }

  function pickEditContactType(contact: string | null): 'email' | 'phone' {
    if (!contact || !contact.trim()) return 'email'
    if (isValidEmail(contact)) return 'email'
    if (isValidPhone(contact)) return 'phone'
    return 'email'
  }

  async function saveProfile() {
    if (!editName.trim()) { Alert.alert('Name required', 'Please enter your display name.'); return }
    const c = editContact.trim()
    if (c) {
      const ok = editContactType === 'email' ? isValidEmail(c) : isValidPhone(c)
      if (!ok) {
        Alert.alert('Invalid contact', editContactType === 'email' ? 'Enter a valid email address.' : 'Enter a valid phone number (10+ digits).')
        return
      }
    }
    if (editUsername.trim()) {
      const u = normalizeUsername(editUsername)
      if (!isValidUsername(u)) { Alert.alert('Invalid username', 'Use 2–32 characters: lowercase letters, numbers, and underscores only.'); return }
    }
    setSaving(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setProfileBanner(userFriendlyFromUnknown(gate.error))
        return
      }
      if (editUsername.trim()) {
        const handle = normalizeUsername(editUsername)
        const { data: taken } = await supabase
          .from('players')
          .select('user_id')
          .eq('username', handle)
          .maybeSingle()
        if (taken && taken.user_id !== gate.userId) {
          Alert.alert('Username taken', 'That username is already in use.')
          return
        }
      }
      const { error } = await supabase.from('players').upsert({
        user_id: gate.userId,
        display_name: editName.trim(),
        username: editUsername.trim() ? normalizeUsername(editUsername) : null,
        contact: c || null,
        skill_rating: editSkillRating,
        pickup_skill_level: editPickupSkill.trim() ? editPickupSkill.trim() : null,
        avatar_url: avatarUri ?? profile?.avatar_url ?? null,
      }, { onConflict: 'user_id' })
      if (error) {
        if (error.code === '23505') {
          Alert.alert('Username taken', 'That username is already in use.')
          return
        }
        setProfileBanner(userFriendlyFromUnknown(error.message))
        return
      }
      setShowEdit(false)
      loadProfile()
    } finally {
      setSaving(false)
    }
  }

  function openCreateProfile() {
    setCreateName('')
    setCreateUsername('')
    setCreateContact('')
    setCreateContactType('email')
    setShowCreate(true)
  }

  async function saveCreateProfile() {
    if (!createName.trim()) { Alert.alert('Name required', 'Please enter your display name.'); return }
    const handle = normalizeUsername(createUsername)
    if (!isValidUsername(handle)) {
      Alert.alert('Invalid username', 'Use 2–32 characters: lowercase letters, numbers, and underscores only. No spaces.')
      return
    }
    const c = createContact.trim()
    if (!c) { Alert.alert('Contact required', 'Add an email or phone number so we can reach you if needed.'); return }
    const contactOk = createContactType === 'email' ? isValidEmail(c) : isValidPhone(c)
    if (!contactOk) {
      Alert.alert('Invalid contact', createContactType === 'email' ? 'Enter a valid email address.' : 'Enter a valid phone number (10+ digits).')
      return
    }
    setCreateSaving(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setProfileBanner(userFriendlyFromUnknown(gate.error))
        return
      }
      const { data: taken } = await supabase
        .from('players')
        .select('user_id')
        .eq('username', handle)
        .maybeSingle()
      if (taken && taken.user_id !== gate.userId) {
        Alert.alert('Username taken', 'That username is already in use. Try another.')
        return
      }
      const { error } = await supabase.from('players').upsert({
        user_id: gate.userId,
        display_name: createName.trim(),
        username: handle,
        contact: c,
        avatar_url: profile?.avatar_url ?? null,
      }, { onConflict: 'user_id' })
      if (error) {
        if (error.code === '23505') {
          Alert.alert('Username taken', 'That username is already in use. Try another.')
          return
        }
        setProfileBanner(userFriendlyFromUnknown(error.message))
        return
      }
      setShowCreate(false)
      loadProfile()
    } finally {
      setCreateSaving(false)
    }
  }

  function openEdit() {
    setEditName(profile?.display_name ?? '')
    setEditUsername(profile?.username ?? '')
    setEditContact(profile?.contact ?? '')
    setEditContactType(pickEditContactType(profile?.contact ?? null))
    setEditSkillRating(profile?.skill_rating ?? null)
    setEditPickupSkill(profile?.pickup_skill_level ?? '')
    setAvatarUri(profile?.avatar_url ?? null)
    setShowEdit(true)
  }

  const winRate = profile && (profile.wins + profile.losses) > 0
    ? `${Math.round((profile.wins / (profile.wins + profile.losses)) * 100)}%`
    : '—'

  const hasProfile = Boolean(profile?.display_name?.trim())

  useEffect(() => {
    if (!showCreate) return
    const handle = normalizeUsername(createUsername)
    if (!handle) {
      setCreateUsernameStatus('idle')
      return
    }
    if (!isValidUsername(handle)) {
      setCreateUsernameStatus('invalid')
      return
    }

    let cancelled = false
    setCreateUsernameStatus('checking')
    const timer = setTimeout(async () => {
      const gate = await ensureFavoritesUser()
      if (cancelled || 'error' in gate) return

      const { data: taken, error } = await supabase
        .from('players')
        .select('user_id')
        .eq('username', handle)
        .maybeSingle()

      if (cancelled) return
      if (error) {
        setCreateUsernameStatus('idle')
        return
      }
      if (cancelled) return
      setCreateUsernameStatus(taken && taken.user_id !== gate.userId ? 'taken' : 'available')
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [createUsername, showCreate])

  function openSuggestCourt() {
    setSuggestCourtName('')
    setSuggestAddress('')
    setSuggestCity('')
    setSuggestNumCourts('')
    setSuggestIndoorOutdoor('outdoor')
    setSuggestSurfaceType('')
    setSuggestFee('')
    setSuggestHours('')
    setSuggestNotes('')
    setShowSuggestCourt(true)
  }

  async function submitCourtSuggestion() {
    if (!suggestCourtName.trim()) { Alert.alert('Court name required', 'Please enter the court name.'); return }
    if (!suggestAddress.trim()) { Alert.alert('Address required', 'Please enter the court address.'); return }
    if (!suggestCity.trim()) { Alert.alert('City required', 'Please enter the city.'); return }
    const numCourts = parseInt(suggestNumCourts, 10)
    if (!Number.isFinite(numCourts) || numCourts < 1) { Alert.alert('Number of courts required', 'Enter a valid number of courts.'); return }
    if (!suggestSurfaceType.trim()) { Alert.alert('Surface type required', 'Please enter a surface type.'); return }
    if (!suggestFee.trim()) { Alert.alert('Fee required', 'Please enter fee information (e.g. Free, $5/hour).'); return }
    if (!suggestHours.trim()) { Alert.alert('Hours required', 'Please enter court hours.'); return }

    setSuggestSubmitting(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setProfileBanner(userFriendlyFromUnknown(gate.error))
        return
      }

      const { data: me } = await supabase
        .from('players')
        .select('display_name')
        .eq('user_id', gate.userId)
        .maybeSingle()

      const { error } = await supabase.from('court_submissions').insert({
        user_id: gate.userId,
        display_name: me?.display_name ?? profile?.display_name ?? 'Player',
        court_name: suggestCourtName.trim(),
        address: suggestAddress.trim(),
        city: suggestCity.trim(),
        num_courts: numCourts,
        surface_type: suggestSurfaceType.trim(),
        indoor_outdoor: suggestIndoorOutdoor,
        fee: suggestFee.trim(),
        hours: suggestHours.trim(),
        notes: suggestNotes.trim() || null,
      })

      if (error) {
        setProfileBanner(userFriendlyFromUnknown(error.message))
        return
      }
      setShowSuggestCourt(false)
      Alert.alert("Thanks! We'll review your suggestion and add it soon.")
    } finally {
      setSuggestSubmitting(false)
    }
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This will permanently remove your profile, match history, friends, reviews and all other data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void runDeleteAccount() },
      ],
    )
  }

  async function runDeleteAccount() {
    setDeleteAccountLoading(true)
    try {
      const { error } = await invokeDeleteAccountEdge()
      if (error) {
        Alert.alert('Could not delete account', userFriendlyFromUnknown(error.message))
        return
      }
      await supabase.auth.signOut()
      await AsyncStorage.clear()
      router.replace('/onboarding')
    } catch (e) {
      Alert.alert('Something went wrong', userFriendlyFromUnknown(e))
    } finally {
      setDeleteAccountLoading(false)
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#1D9E75"
            colors={['#1D9E75']}
          />
        }>
        <ErrorBanner message={profileBanner} onDismiss={() => setProfileBanner(null)} />

        {/* Profile section */}
        <View style={styles.profileSection}>
          {loading ? (
            <SkeletonSettingsProfile isDark={isDark} />
          ) : (
            <>
              <TouchableOpacity
                style={styles.avatarWrap}
                onPress={() => (hasProfile ? openEdit() : openCreateProfile())}
                activeOpacity={0.85}>
                {profile?.avatar_url ? (
                  <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatarPlaceholder, { backgroundColor: '#0F6E56' }]}>
                    <MaterialIcons name="person" size={42} color="#FFFFFF" />
                  </View>
                )}
                <View style={styles.avatarEditBadge}>
                  <MaterialIcons name={hasProfile ? 'edit' : 'add'} size={12} color="#fff" />
                </View>
              </TouchableOpacity>

              {!hasProfile ? (
                <TouchableOpacity
                  style={styles.createProfileBtn}
                  onPress={openCreateProfile}
                  activeOpacity={0.85}>
                  <MaterialIcons name="person-add" size={18} color="#fff" />
                  <Text style={styles.createProfileBtnText}>Create Profile</Text>
                </TouchableOpacity>
              ) : null}

              <ContentFadeIn show style={{ alignItems: 'center', alignSelf: 'stretch' }}>
              <Text style={[styles.displayName, { color: theme.text }]}>
                {profile?.display_name ?? 'Your Name'}
              </Text>
              {profile?.username ? (
                <Text style={[styles.username, { color: muted }]}>@{profile.username}</Text>
              ) : null}
              {profile?.skill_rating != null ? (
                <View style={styles.profileRatingBadge}>
                  <Image source={require('../../assets/images/icon.png')} style={styles.ratingLogoSm} />
                  <Text style={styles.profileRatingText}>{profile.skill_rating.toFixed(1)}</Text>
                </View>
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

              {hasProfile ? (
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
              ) : null}
              </ContentFadeIn>
            </>
          )}
        </View>

        <TouchableOpacity
          style={[styles.card, styles.blockedCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
          onPress={() => router.push('/blocked-players')}
          activeOpacity={0.75}>
          <MaterialIcons name="block" size={22} color="#64748B" style={styles.rowIcon} />
          <Text style={[styles.rowLabel, { color: theme.text }]}>Blocked players</Text>
          <MaterialIcons name="chevron-right" size={20} color={muted} />
        </TouchableOpacity>

        {/* Settings links */}
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          {ITEMS.map((item, i) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.row, i < ITEMS.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: cardBorder }]}
              onPress={() => {
                if (item.id === 'suggest') {
                  openSuggestCourt()
                  return
                }
                if (item.id === 'privacy' && item.url) {
                  void WebBrowser.openBrowserAsync(item.url).catch(() =>
                    Linking.openURL(item.url!)
                  )
                  return
                }
                if (item.url) void Linking.openURL(item.url)
              }}
              activeOpacity={0.7}>
              <MaterialIcons name={item.icon as any} size={22} color="#1D9E75" style={styles.rowIcon} />
              <Text style={[styles.rowLabel, { color: theme.text }]}>{item.label}</Text>
              <MaterialIcons name="chevron-right" size={20} color={muted} />
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={styles.adminTestBtn}
          onPress={() => router.push('/admin/submissions')}
          activeOpacity={0.8}>
          <MaterialIcons name="admin-panel-settings" size={18} color="#fff" />
          <Text style={styles.adminTestBtnText}>Open Admin Submissions (Temp)</Text>
        </TouchableOpacity>

        <Text style={[styles.tagline, { color: muted }]}>Find your court. Play your game.</Text>
        <Text style={[styles.version, { color: muted }]}>Version 1.0.0</Text>

        <TouchableOpacity
          style={styles.deleteAccountBtn}
          onPress={confirmDeleteAccount}
          activeOpacity={0.65}
          accessibilityRole="button"
          accessibilityLabel="Delete account">
          <Text style={styles.deleteAccountLabel}>Delete Account</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Edit profile modal */}
      <Modal visible={showEdit} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]} edges={['top']}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.modal}>
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
                  <MaterialIcons name="person" size={46} color="#FFFFFF" />
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
              value={editUsername} onChangeText={t => setEditUsername(sanitizeUsernameInput(t))}
              placeholder="e.g. pickleball_jake" placeholderTextColor={muted}
              autoCapitalize="none"
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />
            <Text style={[styles.fieldLabel, { color: muted }]}>Contact (optional)</Text>
            <View style={styles.contactPillRow}>
              {(['email', 'phone'] as const).map(key => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setEditContactType(key)}
                  style={[
                    styles.contactPill,
                    { borderColor: cardBorder, backgroundColor: cardBg },
                    editContactType === key && { borderColor: '#1D9E75', backgroundColor: isDark ? 'rgba(29, 158, 117, 0.2)' : '#E1F5EE' },
                  ]}
                  activeOpacity={0.8}>
                  <Text style={[styles.contactPillText, { color: editContactType === key ? '#0F6E56' : muted }]}>
                    {key === 'email' ? 'Email' : 'Phone'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.fieldLabel, { color: muted }]}>Skill rating (DUPR)</Text>
            <Text style={[styles.usernameHint, { color: muted, marginTop: -4 }]}>
              Choose from 1.0 to 5.0 in 0.5 increments.
            </Text>
            <View style={styles.ratingGrid}>
              {SKILL_RATING_OPTIONS.map((rating) => {
                const selected = editSkillRating === rating
                const labelKey = rating.toFixed(1)
                return (
                  <TouchableOpacity
                    key={labelKey}
                    onPress={() => setEditSkillRating(selected ? null : rating)}
                    style={[
                      styles.ratingPill,
                      { borderColor: cardBorder, backgroundColor: cardBg },
                      selected && { borderColor: '#1D9E75', backgroundColor: isDark ? 'rgba(29, 158, 117, 0.2)' : '#E1F5EE' },
                    ]}
                    activeOpacity={0.8}>
                    <Text style={[styles.ratingValue, { color: selected ? '#0F6E56' : theme.text }]}>
                      {labelKey}
                    </Text>
                    <Text style={[styles.ratingLabel, { color: muted }]}>
                      {SKILL_RATING_LABELS[labelKey]}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            <Text style={[styles.fieldLabel, { color: muted }]}>Pickup skill (optional)</Text>
            <Text style={[styles.usernameHint, { color: muted, marginTop: -4 }]}>
              Shown when you join a posted game — same scale as Beginner / Intermediate / Advanced.
            </Text>
            <View style={styles.pillRowFlexible}>
              {PICKUP_SKILL_LEVELS.map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setEditPickupSkill(editPickupSkill === s ? '' : s)}
                  style={[
                    styles.pickupSkillPill,
                    { borderColor: cardBorder, backgroundColor: cardBg },
                    editPickupSkill === s && { borderColor: '#1D9E75', backgroundColor: isDark ? 'rgba(29, 158, 117, 0.2)' : '#E1F5EE' },
                  ]}>
                  <Text style={[styles.contactPillText, { color: editPickupSkill === s ? '#0F6E56' : muted }]}>
                    {s}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              value={editContact} onChangeText={setEditContact}
              placeholder={editContactType === 'email' ? 'you@example.com' : '(555) 123-4567'}
              placeholderTextColor={muted}
              keyboardType={editContactType === 'phone' ? 'phone-pad' : 'email-address'}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />
            <TouchableOpacity
              style={[styles.submitBtn, saving && { opacity: 0.6 }]}
              onPress={saveProfile} disabled={saving} activeOpacity={0.8}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Save profile</Text>}
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
          </View>
          </TouchableWithoutFeedback>
        </SafeAreaView>
      </Modal>

      {/* Suggest Court modal */}
      <Modal visible={showSuggestCourt} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowSuggestCourt(false)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]} edges={['top']}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Suggest a Court</Text>
            <TouchableOpacity onPress={() => setShowSuggestCourt(false)}>
              <MaterialIcons name="close" size={24} color={muted} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={[styles.fieldLabel, { color: muted }]}>Court name</Text>
            <TextInput value={suggestCourtName} onChangeText={setSuggestCourtName} placeholder="e.g. Willow Creek Park" placeholderTextColor={muted} style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]} />

            <Text style={[styles.fieldLabel, { color: muted }]}>Address</Text>
            <TextInput value={suggestAddress} onChangeText={setSuggestAddress} placeholder="e.g. 123 Main St" placeholderTextColor={muted} style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]} />

            <Text style={[styles.fieldLabel, { color: muted }]}>City</Text>
            <TextInput value={suggestCity} onChangeText={setSuggestCity} placeholder="e.g. Lehi" placeholderTextColor={muted} style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]} />

            <Text style={[styles.fieldLabel, { color: muted }]}>Number of courts</Text>
            <TextInput value={suggestNumCourts} onChangeText={setSuggestNumCourts} placeholder="e.g. 6" placeholderTextColor={muted} keyboardType="number-pad" style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]} />

            <Text style={[styles.fieldLabel, { color: muted }]}>Indoor or outdoor</Text>
            <View style={styles.contactPillRow}>
              {(['indoor', 'outdoor'] as const).map(key => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setSuggestIndoorOutdoor(key)}
                  style={[
                    styles.contactPill,
                    { borderColor: cardBorder, backgroundColor: cardBg },
                    suggestIndoorOutdoor === key && { borderColor: '#1D9E75', backgroundColor: isDark ? 'rgba(29, 158, 117, 0.2)' : '#E1F5EE' },
                  ]}
                  activeOpacity={0.8}>
                  <Text style={[styles.contactPillText, { color: suggestIndoorOutdoor === key ? '#0F6E56' : muted }]}>
                    {key === 'indoor' ? 'Indoor' : 'Outdoor'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: muted }]}>Surface type</Text>
            <TextInput value={suggestSurfaceType} onChangeText={setSuggestSurfaceType} placeholder="e.g. Acrylic" placeholderTextColor={muted} style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]} />

            <Text style={[styles.fieldLabel, { color: muted }]}>Fee</Text>
            <TextInput value={suggestFee} onChangeText={setSuggestFee} placeholder="e.g. Free" placeholderTextColor={muted} style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]} />

            <Text style={[styles.fieldLabel, { color: muted }]}>Hours</Text>
            <TextInput value={suggestHours} onChangeText={setSuggestHours} placeholder="e.g. 6am - 10pm" placeholderTextColor={muted} style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]} />

            <Text style={[styles.fieldLabel, { color: muted }]}>Notes (optional)</Text>
            <TextInput
              value={suggestNotes}
              onChangeText={setSuggestNotes}
              placeholder="Any extra details..."
              placeholderTextColor={muted}
              multiline
              numberOfLines={4}
              style={[styles.input, styles.notesInput, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />

            <TouchableOpacity
              style={[styles.submitBtn, suggestSubmitting && { opacity: 0.6 }]}
              onPress={submitCourtSuggestion}
              disabled={suggestSubmitting}
              activeOpacity={0.8}>
              {suggestSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit Suggestion</Text>}
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
          </View>
          </TouchableWithoutFeedback>
        </SafeAreaView>
      </Modal>

      {/* Create profile modal */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCreate(false)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]} edges={['top']}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Create Profile</Text>
            <TouchableOpacity onPress={() => setShowCreate(false)}>
              <MaterialIcons name="close" size={24} color={muted} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={[styles.fieldLabel, { color: muted }]}>Display name</Text>
            <TextInput
              value={createName} onChangeText={setCreateName}
              placeholder="Name shown to other players"
              placeholderTextColor={muted}
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />
            <Text style={[styles.fieldLabel, { color: muted }]}>Username</Text>
            <Text style={[styles.usernameHint, { color: muted }]}>
              Lowercase, no spaces. Shown as {'@' + (createUsername || 'yourname')}
            </Text>
            <TextInput
              value={createUsername} onChangeText={t => setCreateUsername(sanitizeUsernameInput(t))}
              placeholder="dawson"
              placeholderTextColor={muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />
            {createUsernameStatus === 'checking' ? (
              <Text style={[styles.usernameStatus, { color: muted }]}>Checking availability…</Text>
            ) : null}
            {createUsernameStatus === 'available' ? (
              <Text style={[styles.usernameStatus, { color: '#1D9E75' }]}>Username is available.</Text>
            ) : null}
            {createUsernameStatus === 'taken' ? (
              <Text style={[styles.usernameStatus, { color: '#E24B4A' }]}>Username is already taken.</Text>
            ) : null}
            {createUsernameStatus === 'invalid' ? (
              <Text style={[styles.usernameStatus, { color: '#E24B4A' }]}>
                Use 2-32 characters: lowercase letters, numbers, and underscores only.
              </Text>
            ) : null}
            <Text style={[styles.fieldLabel, { color: muted }]}>Contact</Text>
            <View style={styles.contactPillRow}>
              {(['email', 'phone'] as const).map(key => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setCreateContactType(key)}
                  style={[
                    styles.contactPill,
                    { borderColor: cardBorder, backgroundColor: cardBg },
                    createContactType === key && { borderColor: '#1D9E75', backgroundColor: isDark ? 'rgba(29, 158, 117, 0.2)' : '#E1F5EE' },
                  ]}
                  activeOpacity={0.8}>
                  <Text style={[styles.contactPillText, { color: createContactType === key ? '#0F6E56' : muted }]}>
                    {key === 'email' ? 'Email' : 'Phone'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={createContact} onChangeText={setCreateContact}
              placeholder={createContactType === 'email' ? 'you@example.com' : '(555) 123-4567'}
              placeholderTextColor={muted}
              keyboardType={createContactType === 'phone' ? 'phone-pad' : 'email-address'}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: theme.text, borderColor: cardBorder, backgroundColor: cardBg }]}
            />
            <TouchableOpacity
              style={[styles.submitBtn, createSaving && { opacity: 0.6 }]}
              onPress={saveCreateProfile} disabled={createSaving} activeOpacity={0.8}>
              {createSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Save</Text>}
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
          </View>
          </TouchableWithoutFeedback>
        </SafeAreaView>
      </Modal>
      <Modal visible={deleteAccountLoading} transparent animationType="fade">
        <View style={styles.deleteAccountOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.deleteAccountOverlayText}>Deleting account…</Text>
        </View>
      </Modal>
      </View>
      </TouchableWithoutFeedback>
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
  profileRatingBadge: {
    backgroundColor: '#E1F5EE',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  profileRatingText: { color: '#0F6E56', fontSize: 14, fontWeight: '700' },
  statsRow: { flexDirection: 'row', marginBottom: 16 },
  statBlock: { alignItems: 'center', paddingHorizontal: 20 },
  statNum: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 11, marginTop: 2 },
  statDivider: { width: 0.5 },
  createProfileBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4, marginBottom: 4, backgroundColor: '#1D9E75', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, alignSelf: 'center', minWidth: 200 },
  createProfileBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  profileBtnRow: { flexDirection: 'row', gap: 10 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#1D9E75' },
  editBtnText: { color: '#0F6E56', fontSize: 14, fontWeight: '600' },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#0EA5E9' },
  shareBtnText: { color: '#0EA5E9', fontSize: 14, fontWeight: '600' },
  ratingLogoSm: { width: 16, height: 16, borderRadius: 4 },
  // Settings card
  card: { borderRadius: 14, borderWidth: 0.5, overflow: 'hidden', marginBottom: 32 },
  blockedCard: { flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  rowIcon: { marginRight: 14 },
  rowLabel: { flex: 1, fontSize: 15 },
  adminTestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#334155', borderRadius: 12, paddingVertical: 12, marginBottom: 20 },
  adminTestBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  tagline: { textAlign: 'center', fontSize: 13, marginBottom: 4 },
  version: { textAlign: 'center', fontSize: 12, marginBottom: 24 },
  deleteAccountBtn: {
    alignSelf: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  deleteAccountLabel: {
    color: '#DC2626',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteAccountOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  deleteAccountOverlayText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  // Modals shared
  modal: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  modalScroll: { flex: 1, paddingHorizontal: 20 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 0.5, borderRadius: 12, padding: 14, fontSize: 15 },
  usernameHint: { fontSize: 12, marginBottom: 8, marginTop: -4 },
  usernameStatus: { fontSize: 12, marginTop: 8 },
  contactPillRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  ratingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  ratingPill: {
    minWidth: 90,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  ratingValue: { fontSize: 16, fontWeight: '700' },
  ratingLabel: { fontSize: 11, marginTop: 2 },
  pillRowFlexible: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  pickupSkillPill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  contactPill: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  contactPillText: { fontSize: 14, fontWeight: '600' },
  notesInput: { minHeight: 100, textAlignVertical: 'top' },
  submitBtn: { backgroundColor: '#1D9E75', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // Edit profile modal extras
  avatarPickerWrap: { alignItems: 'center', marginBottom: 8, marginTop: 8, position: 'relative' },
  avatarLarge: { width: 100, height: 100, borderRadius: 50 },
  avatarLargePlaceholder: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center' },
  avatarLargeEmoji: { fontSize: 44 },
  avatarPickerBadge: { position: 'absolute', bottom: 20, right: '30%', backgroundColor: '#1D9E75', borderRadius: 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  avatarPickerHint: { fontSize: 12, marginTop: 8 },
})
