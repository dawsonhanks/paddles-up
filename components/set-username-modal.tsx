import { UsernameAvailabilityStatus } from '@/components/username-availability-status'
import { useUsernameAvailability } from '@/hooks/use-username-availability'
import { ensureFavoritesUser } from '@/lib/favorites'
import { isValidUsername, normalizeUsername, sanitizeUsernameInput, USERNAME_FORMAT_HINT } from '@/lib/profileValidation'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { supabase } from '@/supabase'
import { MaterialIcons } from '@expo/vector-icons'
import { useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type Props = {
  visible: boolean
  onComplete: () => void
}

export function SetUsernameModal({ visible, onComplete }: Props) {
  const [username, setUsername] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { status, handle } = useUsernameAvailability(username, { enabled: visible })

  async function saveUsername() {
    setError(null)
    if (!isValidUsername(handle)) {
      setError(USERNAME_FORMAT_HINT)
      return
    }
    if (status !== 'available') {
      setError(status === 'taken' ? 'That username is already taken.' : 'Wait for username availability to finish checking.')
      return
    }

    setSaving(true)
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setError(gate.error)
        return
      }

      const { error: upErr } = await supabase.from('players').upsert(
        { user_id: gate.userId, username: handle },
        { onConflict: 'user_id' },
      )

      if (upErr) {
        if (upErr.code === '23505') {
          setError('That username is already taken.')
          return
        }
        setError(userFriendlyFromUnknown(upErr.message))
        return
      }

      setUsername('')
      onComplete()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <MaterialIcons name="alternate-email" size={40} color="#0F6E56" />
          <Text style={styles.title}>Choose your username</Text>
          <Text style={styles.subtitle}>
            Pick a unique handle so friends can find you and send challenge invites. This is required to continue.
          </Text>

          <Text style={styles.label}>Username</Text>
          <TextInput
            value={username}
            onChangeText={(t) => {
              setError(null)
              setUsername(sanitizeUsernameInput(t))
            }}
            placeholder="e.g. paddles_up"
            placeholderTextColor="#94A3B8"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            style={styles.input}
            editable={!saving}
          />
          <Text style={styles.hint}>{USERNAME_FORMAT_HINT}</Text>
          <UsernameAvailabilityStatus status={status} />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.btn, (saving || status !== 'available') && styles.btnDisabled]}
            onPress={() => void saveUsername()}
            disabled={saving || status !== 'available'}
            activeOpacity={0.85}>
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnText}>Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    alignItems: 'stretch',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 16,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#64748B',
    marginTop: 10,
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 16,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  hint: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 8,
  },
  error: {
    color: '#B91C1C',
    fontSize: 13,
    marginTop: 12,
  },
  btn: {
    marginTop: 28,
    backgroundColor: '#0F6E56',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.55,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
})
