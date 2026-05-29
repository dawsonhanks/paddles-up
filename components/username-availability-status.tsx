import type { UsernameAvailability } from '@/lib/usernameAvailability'
import { USERNAME_FORMAT_HINT } from '@/lib/profileValidation'
import { MaterialIcons } from '@expo/vector-icons'
import { StyleSheet, Text, View } from 'react-native'

type Props = {
  status: UsernameAvailability
  mutedColor?: string
}

export function UsernameAvailabilityStatus({ status, mutedColor = '#64748B' }: Props) {
  if (status === 'idle') return null

  if (status === 'checking') {
    return <Text style={[styles.status, { color: mutedColor }]}>Checking availability…</Text>
  }

  if (status === 'available') {
    return (
      <View style={styles.row}>
        <MaterialIcons name="check-circle" size={16} color="#1D9E75" />
        <Text style={[styles.status, styles.available]}>Username is available</Text>
      </View>
    )
  }

  if (status === 'taken') {
    return (
      <View style={styles.row}>
        <MaterialIcons name="cancel" size={16} color="#E24B4A" />
        <Text style={[styles.status, styles.taken]}>Username is already taken</Text>
      </View>
    )
  }

  return <Text style={[styles.status, styles.taken]}>{USERNAME_FORMAT_HINT}</Text>
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  status: {
    fontSize: 12,
    lineHeight: 16,
  },
  available: {
    color: '#1D9E75',
    fontWeight: '600',
  },
  taken: {
    color: '#E24B4A',
  },
})
