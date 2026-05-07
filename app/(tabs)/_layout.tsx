import { GuidedTourProvider } from '@/components/guided-tour'
import { ensureFavoritesUser } from '@/lib/favorites'
import { countSessionsTodayUpcoming, fetchUpcomingScheduledSessions } from '@/lib/scheduledSessions'
import { supabase } from '@/supabase'
import { useFocusEffect } from '@react-navigation/native'
import { Tabs } from 'expo-router'
import React, { useCallback, useEffect, useState } from 'react'

import { HapticTab } from '@/components/haptic-tab'
import { IconSymbol } from '@/components/ui/icon-symbol'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'

export default function TabLayout() {
  const colorScheme = useColorScheme()
  const [unreadCount, setUnreadCount] = useState(0)
  const [todaySessionsCount, setTodaySessionsCount] = useState(0)

  const loadUnreadCount = useCallback(async () => {
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

  useFocusEffect(
    useCallback(() => {
      void loadUnreadCount()
      void loadPlaySessionsBadge()
    }, [loadUnreadCount, loadPlaySessionsBadge])
  )

  useEffect(() => {
    const channel = supabase
      .channel('messages-unread-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        loadUnreadCount()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadUnreadCount])

  useEffect(() => {
    let aborted = false
    let teardown: () => void = () => {}
    void (async () => {
      const gate = await ensureFavoritesUser()
      if ('error' in gate || aborted) return
      void loadPlaySessionsBadge()
      const ch = supabase
        .channel(`play-sessions-badge-${gate.userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'scheduled_sessions',
            filter: `user_id=eq.${gate.userId}`,
          },
          () => loadPlaySessionsBadge()
        )
        .subscribe()
      teardown = () => {
        supabase.removeChannel(ch)
      }
      if (aborted) teardown()
    })()

    return () => {
      aborted = true
      teardown()
    }
  }, [loadPlaySessionsBadge])

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
