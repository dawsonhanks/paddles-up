import { MaterialIcons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'

type OfflineBannerProps = {
  text: string
  subtext?: string
  onDismiss: () => void
}

export function OfflineBanner({ text, subtext, onDismiss }: OfflineBannerProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <MaterialIcons name="wifi-off" size={16} color="#92400E" />
        <Text style={styles.text}>{text}</Text>
        <Pressable onPress={onDismiss} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <MaterialIcons name="close" size={16} color="#92400E" />
        </Pressable>
      </View>
      {subtext ? <Text style={styles.subtext}>{subtext}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    flex: 1,
    color: '#92400E',
    fontSize: 12,
    fontWeight: '600',
  },
  subtext: {
    color: '#92400E',
    opacity: 0.9,
    fontSize: 11,
    marginTop: 4,
    marginLeft: 24,
  },
})
