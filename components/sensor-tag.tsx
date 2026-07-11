import { StyleSheet, Text, View } from 'react-native'

type SensorTagProps = {
  isDark: boolean
  mutedColor: string
}

export function SensorTag({ isDark, mutedColor }: SensorTagProps) {
  return (
    <View
      style={[
        styles.tag,
        {
          backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.06)',
          borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.1)',
        },
      ]}>
      <Text style={[styles.tagText, { color: mutedColor }]}>Sensor</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
})
