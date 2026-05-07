import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { type FriendlyErrorKind } from '@/lib/errors'
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const ERROR_EMOJI: Record<FriendlyErrorKind, string> = {
  generic: '🏓',
  network: '📶',
  auth: '🏓',
  permission: '🏓',
}

type ErrorScreenProps = {
  kind?: FriendlyErrorKind
  /** Override default emoji for this kind */
  emoji?: string
  title: string
  subtitle?: string
  onRetry: () => void
  retryLabel?: string
  style?: ViewStyle
}

export function ErrorScreen({
  kind = 'generic',
  emoji,
  title,
  subtitle,
  onRetry,
  retryLabel = 'Try again',
  style,
}: ErrorScreenProps) {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const glyph = emoji ?? ERROR_EMOJI[kind] ?? '🏓'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }, style]} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <Text style={styles.emoji} accessibilityRole="text">
          {glyph}
        </Text>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.icon }]}>{subtitle}</Text>
        ) : null}
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retry,
            { opacity: pressed ? 0.92 : 1, backgroundColor: '#1D9E75' },
          ]}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}>
          <Text style={styles.retryText}>{retryLabel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  emoji: {
    fontSize: 56,
    marginBottom: 8,
    lineHeight: 64,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 4,
  },
  retry: {
    marginTop: 20,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    minWidth: 200,
    alignItems: 'center',
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
})
