import { GuidedTourProvider } from '@/components/guided-tour'
import { ensureFavoritesUser } from '@/lib/favorites'
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

  useFocusEffect(useCallback(() => { loadUnreadCount() }, [loadUnreadCount]))

  useEffect(() => {
    const channel = supabase
      .channel('messages-unread-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        loadUnreadCount()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadUnreadCount])

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
