import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { NOTIFICATION_PURPOSE_COPY } from '@/lib/location-permissions'
import { MaterialIcons } from '@expo/vector-icons'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type Props = {
  visible: boolean
  onAllow: () => void
  onMaybeLater: () => void
}

export function NotificationPurposeModal({ visible, onAllow, onMaybeLater }: Props) {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'
  const cardBg = isDark ? '#1C1C1E' : '#FFFFFF'
  const border = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)'

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="pageSheet" onRequestClose={onMaybeLater}>
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
          <View style={styles.bellWrap}>
            <MaterialIcons name="notifications-active" size={40} color="#FFFFFF" />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>Notifications</Text>
          <Text style={[styles.body, { color: theme.icon }]}>{NOTIFICATION_PURPOSE_COPY}</Text>
          <Pressable
            onPress={onAllow}
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.9 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Allow notifications">
            <Text style={styles.primaryBtnText}>Allow Notifications</Text>
          </Pressable>
          <Pressable
            onPress={onMaybeLater}
            style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.85 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Maybe later">
            <Text style={[styles.secondaryBtnText, { color: theme.icon }]}>Maybe Later</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 22,
    paddingVertical: 28,
    alignItems: 'center',
  },
  bellWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  primaryBtn: {
    backgroundColor: '#1D9E75',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondaryBtn: { paddingVertical: 12, width: '100%', alignItems: 'center' },
  secondaryBtnText: { fontSize: 16, fontWeight: '600' },
})
