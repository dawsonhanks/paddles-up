import { MaterialIcons } from '@expo/vector-icons'
import { useEffect } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

const DEFAULT_MS = 4000

type ErrorBannerProps = {
  message: string | null
  variant?: 'danger' | 'warning'
  /** Auto-hide after this many ms; set 0 to disable */
  autoDismissMs?: number
  onDismiss: () => void
}

export function ErrorBanner({
  message,
  variant = 'danger',
  autoDismissMs = DEFAULT_MS,
  onDismiss,
}: ErrorBannerProps) {
  useEffect(() => {
    if (!message || autoDismissMs <= 0) return
    const t = setTimeout(() => onDismiss(), autoDismissMs)
    return () => clearTimeout(t)
  }, [message, autoDismissMs, onDismiss])

  if (!message) return null

  const palette =
    variant === 'warning'
      ? { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E', icon: '#92400E' as const }
      : { bg: '#FEF2F2', border: '#F87171', text: '#991B1B', icon: '#B91C1C' as const }

  return (
    <View
      style={[styles.wrap, { backgroundColor: palette.bg, borderColor: palette.border }]}
      accessibilityRole="alert">
      <MaterialIcons name={variant === 'warning' ? 'warning' : 'info'} size={18} color={palette.icon} />
      <Text style={[styles.text, { color: palette.text }]}>{message}</Text>
      <Pressable
        onPress={onDismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss message">
        <MaterialIcons name="close" size={18} color={palette.icon} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 12,
    marginTop: 8,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
})
