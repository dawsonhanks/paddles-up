import { supabaseConfigMessage } from '@/supabase'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export function SupabaseConfigErrorScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Text style={styles.emoji}>🏓</Text>
      <Text style={styles.title}>Configuration error</Text>
      <Text style={styles.body}>{supabaseConfigMessage}</Text>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F6E56',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
    gap: 14,
  },
  emoji: {
    fontSize: 56,
    marginBottom: 4,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  body: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 320,
  },
})
