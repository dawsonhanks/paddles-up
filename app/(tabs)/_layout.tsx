import { GuidedTourProvider } from '@/components/guided-tour'
import { SetUsernameModal } from '@/components/set-username-modal'
import { hasActiveSignedInSession } from '@/lib/authSession'
import { ensureFavoritesUser } from '@/lib/favorites'
import { countSessionsTodayUpcoming, fetchUpcomingScheduledSessions } from '@/lib/scheduledSessions'
import { supabase } from '@/supabase'
import { useFocusEffect } from '@react-navigation/native'
import { Redirect, Tabs } from 'expo-router'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'

import { HapticTab } from '@/components/haptic-tab'
import { IconSymbol } from '@/components/ui/icon-symbol'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'

export default function TabLayout() {
  const colorScheme = useColorScheme()
  const [authGate, setAuthGate] = useState<'loading' | 'signedOut' | 'signedIn'>('loading')
  const [unreadCount, setUnreadCount] = useState(0)
  const [todaySessionsCount, setTodaySessionsCount] = useState(0)
  const [needsUsername, setNeedsUsername] = useState(false)
  const [usernameCheckDone, setUsernameCheckDone] = useState(false)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setAuthGate(hasActiveSignedInSession(data.session) ? 'signedIn' : 'signedOut')
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthGate(hasActiveSignedInSession(session) ? 'signedIn' : 'signedOut')
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (authGate !== 'signedIn') {
      setNeedsUsername(false)
      setUsernameCheckDone(false)
      return
    }

    let cancelled = false
    setUsernameCheckDone(false)
    void (async () => {
      const gate = await ensureFavoritesUser()
      if (cancelled || 'error' in gate) {
        if (!cancelled) setUsernameCheckDone(true)
        return
      }
      const { data } = await supabase
        .from('players')
        .select('username')
        .eq('user_id', gate.userId)
        .maybeSingle()
      if (cancelled) return
      setNeedsUsername(!data?.username?.trim())
      setUsernameCheckDone(true)
    })()

    return () => {
      cancelled = true
    }
  }, [authGate])

  const loadUnreadCount = useCallback(async () => {
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) return
      const userId = gate.userId

      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
      const ids = conversations?.map(c => c.id) ?? []
      if (ids.length === 0) {
        setUnreadCount(0)
        return
      }
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', ids)
        .eq('read', false)
        .neq('sender_id', userId)
      setUnreadCount(count ?? 0)
    } catch {
      setUnreadCount(0)
    }
  }, [])

  const loadPlaySessionsBadge = useCallback(async () => {
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setTodaySessionsCount(0)
        return
      }
      const rows = await fetchUpcomingScheduledSessions(gate.userId)
      setTodaySessionsCount(countSessionsTodayUpcoming(rows))
    } catch {
      setTodaySessionsCount(0)
    }
  }, [])

  const loadUnreadCountRef = useRef(loadUnreadCount)
  const loadPlaySessionsBadgeRef = useRef(loadPlaySessionsBadge)
  loadUnreadCountRef.current = loadUnreadCount
  loadPlaySessionsBadgeRef.current = loadPlaySessionsBadge

  useFocusEffect(
    useCallback(() => {
      if (authGate !== 'signedIn') return
      void loadUnreadCount()
      void loadPlaySessionsBadge()
    }, [authGate, loadUnreadCount, loadPlaySessionsBadge])
  )

  useEffect(() => {
    if (authGate !== 'signedIn') return

    const channelName = 'messages-unread-badge'
    const stale = supabase.getChannels().find((ch) => ch.topic === `realtime:${channelName}`)
    if (stale) void supabase.removeChannel(stale)

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        void loadUnreadCountRef.current()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [authGate])

  useEffect(() => {
    if (authGate !== 'signedIn') return

    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    void (async () => {
      const gate = await ensureFavoritesUser()
      if ('error' in gate || cancelled) return

      void loadPlaySessionsBadgeRef.current()

      const channelName = `play-sessions-badge-${gate.userId}`
      const stale = supabase.getChannels().find((ch) => ch.topic === `realtime:${channelName}`)
      if (stale) void supabase.removeChannel(stale)

      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'scheduled_sessions',
            filter: `user_id=eq.${gate.userId}`,
          },
          () => {
            void loadPlaySessionsBadgeRef.current()
          }
        )
        .subscribe()

      if (cancelled && channel) void supabase.removeChannel(channel)
    })()

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [authGate])

  if (authGate === 'loading' || (authGate === 'signedIn' && !usernameCheckDone)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F6E56' }}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    )
  }
  if (authGate === 'signedOut') {
    return <Redirect href="/auth" />
  }

  if (needsUsername) {
    return (
      <SetUsernameModal
        visible
        onComplete={() => setNeedsUsername(false)}
      />
    )
  }

  return (
    <GuidedTourProvider>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
          headerShown: false,
          tabBarButton: HapticTab,
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Map',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="map.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="play"
          options={{
            title: 'Play',
            tabBarLabel: 'Play',
            tabBarBadge: todaySessionsCount > 0 ? (todaySessionsCount > 99 ? '99+' : todaySessionsCount) : undefined,
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="figure.pickleball" color={color} />,
          }}
        />
        <Tabs.Screen
          name="record"
          options={{
            title: 'Record',
            tabBarLabel: 'Record',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="trophy.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="friends"
          options={{
            title: 'Friends',
            tabBarLabel: 'Friends',
            headerShown: true,
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.2.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Profile',
            tabBarLabel: 'Profile',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.fill" color={color} />,
            tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : undefined,
          }}
        />
      </Tabs>
    </GuidedTourProvider>
  )
}
