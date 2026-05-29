import { hasActiveSignedInSession } from '@/lib/authSession'
import { supabase } from '@/supabase'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function IndexScreen() {
  const router = useRouter()
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (cancelled) return

        if (hasActiveSignedInSession(data.session)) {
          router.replace('/(tabs)')
          return
        }

        const onboarded = (await AsyncStorage.getItem('onboarded')) === 'true'
        if (cancelled) return

        router.replace(onboarded ? '/auth' : '/onboarding')
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [router])

  if (!booting) return null

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={styles.label}>Paddles Up</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F6E56',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  label: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 17,
    fontWeight: '600',
  },
})
