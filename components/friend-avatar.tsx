import type { FriendPlayer } from '@/lib/friends'
import { Image, Text, View } from 'react-native'

const AVATAR_COLORS = ['#534AB7', '#0F6E56', '#D97706', '#0EA5E9', '#9333EA']

type Props = { friend: Pick<FriendPlayer, 'user_id' | 'display_name' | 'username' | 'avatar_url'>; size?: number }

export function FriendAvatar({ friend, size = 56 }: Props) {
  const initials = (friend.display_name ?? friend.username ?? '?').charAt(0).toUpperCase()
  if (friend.avatar_url) {
    return <Image source={{ uri: friend.avatar_url }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  }
  const colorIndex = (friend.user_id.charCodeAt(0) + friend.user_id.charCodeAt(1)) % AVATAR_COLORS.length
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: AVATAR_COLORS[colorIndex],
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ color: '#fff', fontSize: size * 0.38, fontWeight: '700' }}>{initials}</Text>
    </View>
  )
}
