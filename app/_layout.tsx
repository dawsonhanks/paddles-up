import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { AppErrorBoundary } from '@/components/app-error-boundary'
import { SupabaseConfigErrorScreen } from '@/components/supabase-config-error'
import { PersistentOfflineBanner } from '@/components/persistent-offline-banner'
import { NetworkStatusProvider } from '@/contexts/network-status-context'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { establishSessionFromAuthUrl } from '@/lib/auth'
import { isSupabaseConfigured, supabase } from '@/supabase'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Linking from 'expo-linking'
import * as Notifications from 'expo-notifications'
import { router, Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { AppState, Platform, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import 'react-native-reanimated'

const isNativePlatform = Platform.OS === 'ios' || Platform.OS === 'android'

if (isNativePlatform) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  })
}

/** Syncs an existing push token only — never shows the system permission dialog (that happens in-context elsewhere). */
async function getPushTokenIfAlreadyGranted() {
  if (!isNativePlatform || !Device.isDevice) return null
  try {
    const { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') return null

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      Constants.easConfig?.projectId

    const token = (
      await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    ).data

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
      })
    }

    return token
  } catch (e) {
    if (__DEV__) console.warn('[RootLayout] registerForPushNotifications', e)
    return null
  }
}

export const unstable_settings = {
  anchor: '(tabs)',
}

export default function RootLayout() {
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      try {
        if (state === 'active') {
          void supabase.auth.startAutoRefresh()
        } else {
          void supabase.auth.stopAutoRefresh()
        }
      } catch {
        /* ignore */
      }
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!isNativePlatform) return

    async function syncPushTokenForSession() {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData.session?.user?.id
      if (!userId) return

      const token = await getPushTokenIfAlreadyGranted()
      if (!token) return

      try {
        await supabase.from('notification_tokens').upsert(
          { user_id: userId, push_token: token },
          { onConflict: 'user_id' },
        )
      } catch (e) {
        if (__DEV__) console.warn('[RootLayout] push token upsert', e)
      }
    }

    void syncPushTokenForSession().catch((e) => {
      if (__DEV__) console.warn('[RootLayout] registerForPushNotifications', e)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id) {
        void syncPushTokenForSession().catch((e) => {
          if (__DEV__) console.warn('[RootLayout] registerForPushNotifications', e)
        })
      }
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  // Password recovery deep links: exchange tokens/code, then open the reset screen.
  useEffect(() => {
    let handling = false

    async function handleAuthUrl(url: string | null) {
      if (!url || handling) return
      const looksLikeAuthRedirect =
        url.includes('reset-password') ||
        url.includes('type=recovery') ||
        url.includes('access_token=') ||
        url.includes('code=')
      if (!looksLikeAuthRedirect) return

      handling = true
      try {
        const result = await establishSessionFromAuthUrl(url)
        if (result.ok || url.includes('reset-password')) {
          router.replace('/reset-password')
        }
      } finally {
        handling = false
      }
    }

    void Linking.getInitialURL().then((url) => {
      void handleAuthUrl(url)
    })

    const linkSub = Linking.addEventListener('url', ({ url }) => {
      void handleAuthUrl(url)
    })

    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/reset-password')
      }
    })

    return () => {
      linkSub.remove()
      authSub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isNativePlatform) return

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
      try {
        if (!mounted || !last?.notification) return
        const data = last.notification.request.content.data as Record<string, unknown> | undefined
        openCourtFromReminder(data)
      } catch (e) {
        if (__DEV__) console.warn('[RootLayout] last notification', e)
      }
    })

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const data = response.notification.request.content.data as Record<string, unknown> | undefined
        openCourtFromReminder(data)
      } catch (e) {
        if (__DEV__) console.warn('[RootLayout] notification response', e)
      }
    })

    return () => {
      mounted = false
      sub.remove()
    }
  }, [])

  if (!isSupabaseConfigured) {
    return <SupabaseConfigErrorScreen />
  }

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <NetworkStatusProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <View style={[styles.root, { backgroundColor: theme.background }]}>
              <PersistentOfflineBanner />
              <View style={styles.stackWrap}>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="onboarding" />
                  <Stack.Screen name="auth" />
                  <Stack.Screen name="reset-password" options={{ headerShown: false }} />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="court/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="court/reviews/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="messages/index" options={{ headerShown: false }} />
                  <Stack.Screen name="messages/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="friends/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="profile/[username]" options={{ headerShown: false }} />
                  <Stack.Screen name="blocked-players" options={{ headerShown: false }} />
                  <Stack.Screen name="match/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="play/skill-filter" options={{ headerShown: false, presentation: 'modal' }} />
                  <Stack.Screen name="admin/submissions" options={{ headerShown: true, title: 'Admin Submissions' }} />
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