import { supabase } from '@/supabase'

export type NotificationType =
  | 'friend_request_received'
  | 'friend_request_accepted'
  | 'challenge_invite_received'
  | 'challenge_completed'
  | string

export type AppNotification = {
  id: string
  user_id: string
  type: NotificationType
  actor_id: string | null
  actor_name: string | null
  related_id: string | null
  message: string
  created_at: string
}

/** Relative time ("just now", "2 min ago", "1 hr ago") — same style as sensor last-motion labels. */
export function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now'
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins === 1) return '1 min ago'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs === 1) return '1 hr ago'
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export async function fetchNotifications(userId: string): Promise<{
  notifications: AppNotification[]
  error?: string
}> {
  const id = userId.trim()
  if (!id) return { notifications: [] }

  const { data, error } = await supabase
    .from('notifications')
    .select('id, user_id, type, actor_id, actor_name, related_id, message, created_at')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return { notifications: [], error: error.message }
  return { notifications: (data as AppNotification[]) ?? [] }
}

export async function fetchLastViewedAt(userId: string): Promise<{
  lastViewedAt: string | null
  error?: string
}> {
  const id = userId.trim()
  if (!id) return { lastViewedAt: null }

  const { data, error } = await supabase
    .from('players')
    .select('last_notifications_viewed_at')
    .eq('user_id', id)
    .maybeSingle()

  if (error) return { lastViewedAt: null, error: error.message }
  const raw = (data as { last_notifications_viewed_at?: string | null } | null)
    ?.last_notifications_viewed_at
  return { lastViewedAt: raw ?? null }
}

export async function markNotificationsViewed(): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('mark_notifications_viewed')
  if (error) return { error: error.message }
  return {}
}

/** Count notifications newer than lastViewedAt. Null lastViewedAt → all unread. */
export function unreadCount(
  notifications: AppNotification[],
  lastViewedAt: string | null,
): number {
  if (!lastViewedAt) return notifications.length
  const viewedMs = new Date(lastViewedAt).getTime()
  if (!Number.isFinite(viewedMs)) return notifications.length
  return notifications.filter((n) => {
    const createdMs = new Date(n.created_at).getTime()
    return Number.isFinite(createdMs) && createdMs > viewedMs
  }).length
}

export function isNotificationUnread(
  createdAt: string,
  lastViewedAt: string | null,
): boolean {
  if (!lastViewedAt) return true
  const viewedMs = new Date(lastViewedAt).getTime()
  const createdMs = new Date(createdAt).getTime()
  if (!Number.isFinite(viewedMs) || !Number.isFinite(createdMs)) return true
  return createdMs > viewedMs
}
