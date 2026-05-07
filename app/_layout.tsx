import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { AppErrorBoundary } from '@/components/app-error-boundary'
import { PersistentOfflineBanner } from '@/components/persistent-offline-banner'
import { NetworkStatusProvider } from '@/contexts/network-status-context'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { supabase } from '@/supabase'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { router, Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import 'react-native-reanimated'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

async function registerForPushNotifications() {
  if (!Device.isDevice) return null

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') return null

  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId

  const token = (
    await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
  ).data

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    })
  }

  return token
}

export const unstable_settings = {
  anchor: '(tabs)',
}

export default function RootLayout() {
  const colorScheme = useColorScheme()

  useEffect(() => {
    registerForPushNotifications().then(async (token) => {
      if (!token) return
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData.session?.user?.id
      if (!userId) return
      await supabase.from('notification_tokens').upsert({
        user_id: userId,
        push_token: token,
      }, { onConflict: 'user_id' })
    })
  }, [])

  useEffect(() => {
    function openCourtFromReminder(data: Record<string, unknown> | undefined) {
      const t = typeof data?.type === 'string' ? data.type : ''
      if (t !== 'session_reminder') return
      const courtId = data?.courtId
      if (typeof courtId === 'string' && courtId.length > 0) {
        router.push(`/court/${encodeURIComponent(courtId)}`)
      }
    }

    let mounted = true
    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (!mounted || !last?.notification) return
      const data = last.notification.request.content.data as Record<string, unknown> | undefined
      openCourtFromReminder(data)
    })

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined
      openCourtFromReminder(data)
    })

    return () => {
      mounted = false
      sub.remove()
    }
  }, [])

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <NetworkStatusProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <View style={styles.root}>
              <PersistentOfflineBanner />
              <View style={styles.stackWrap}>
                <Stack>
                  <Stack.Screen name="onboarding" options={{ headerShown: false }} />
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="court/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="court/reviews/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="messages/index" options={{ headerShown: false }} />
                  <Stack.Screen name="messages/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="friends/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="match/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="play/skill-filter" options={{ headerShown: false, presentation: 'modal' }} />
                  <Stack.Screen name="admin/submissions" options={{ title: 'Admin Submissions' }} />
                  <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
                </Stack>
              </View>
              <StatusBar style="auto" />
            </View>
          </ThemeProvider>
        </NetworkStatusProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  stackWrap: { flex: 1 },
})