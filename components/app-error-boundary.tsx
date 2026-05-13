import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import * as Updates from 'expo-updates'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, DevSettings } from 'react-native'

type Props = {
  children: ReactNode
}

type State = { hasError: boolean }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (__DEV__) {
      console.warn('[AppErrorBoundary]', error.message, info.componentStack)
    }
  }

  private handleRestart = async () => {
    try {
      if (Updates.isEnabled) {
        await Updates.reloadAsync()
        return
      }
    } catch {
      // fall through
    }
    try {
      DevSettings.reload()
      return
    } catch {
      // last resort: clear error UI so user can try again without full reload
    }
    this.setState({ hasError: false })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return <ErrorBoundaryFallback onRestart={this.handleRestart} />
  }
}

function ErrorBoundaryFallback({ onRestart }: { onRestart: () => void }) {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Text style={styles.emoji} accessibilityRole="text">
        🏓
      </Text>
      <Text style={[styles.title, { color: theme.text }]}>Something went wrong — tap to restart</Text>
      <Text style={[styles.body, { color: theme.icon }]}>
        We will reload the app. If this keeps happening, try again after a short break.
      </Text>
      <Pressable
        onPress={onRestart}
        style={({ pressed }) => [
          styles.btn,
          { opacity: pressed ? 0.92 : 1, backgroundColor: '#1D9E75' },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Restart app">
        <Text style={styles.btnText}>Restart</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
    gap: 14,
  },
  emoji: {
    fontSize: 56,
    lineHeight: 64,
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 320,
    marginTop: 4,
  },
  btn: {
    marginTop: 22,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
})
