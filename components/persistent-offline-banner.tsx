import { MaterialIcons } from '@expo/vector-icons'
import { useNetworkOffline } from '@/contexts/network-status-context'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const COPY = 'You are offline — some features may not be available'

/** Non-dismissible amber strip for app-wide offline indication. */
export function PersistentOfflineBanner() {
  const isOffline = useNetworkOffline()
  const insets = useSafeAreaInsets()

  if (!isOffline) return null

  return (
    <View
      style={[styles.bar, { paddingTop: Math.max(insets.top, 10) }]}
      accessibilityRole="alert">
      <MaterialIcons name="wifi-off" size={18} color="#92400E" />
      <Text style={styles.text}>{COPY}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F59E0B',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  text: {
    flex: 1,
    color: '#92400E',
    fontSize: 13,
    fontWeight: '600',
  },
})
