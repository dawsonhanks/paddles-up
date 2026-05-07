import { ensureFavoritesUser } from '@/lib/favorites'
import { sendPushNotification } from '@/lib/push'
import { supabase } from '@/supabase'

export type ConversationRow = {
  id: string
  player1_id: string
  player2_id: string
  created_at: string
  last_message_at: string
}

export type MessageRow = {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  created_at: string
  read: boolean
}

export type ConversationListItem = {
  id: string
  otherUserId: string
  otherDisplayName: string
  otherUsername: string | null
  otherAvatarUrl: string | null
  lastMessage: string
  lastMessageAt: string
  unreadCount: number
}

export async function getOrCreateConversation(friendUserId: string): Promise<string> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) throw new Error(gate.error)
  const userId = gate.userId

  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .or(`and(player1_id.eq.${userId},player2_id.eq.${friendUserId}),and(player1_id.eq.${friendUserId},player2_id.eq.${userId})`)
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data: inserted, error } = await supabase
    .from('conversations')
    .insert({ player1_id: userId, player2_id: friendUserId })
    .select('id')
    .single()

  if (!error && inserted?.id) return inserted.id

  const { data: retry } = await supabase
    .from('conversations')
    .select('id')
    .or(`and(player1_id.eq.${userId},player2_id.eq.${friendUserId}),and(player1_id.eq.${friendUserId},player2_id.eq.${userId})`)
    .maybeSingle()
  if (retry?.id) return retry.id

  throw new Error(error?.message ?? 'Could not create conversation.')
}

export async function listConversations(): Promise<ConversationListItem[]> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) throw new Error(gate.error)
  const userId = gate.userId

  const { data: conversations } = await supabase
    .from('conversations')
    .select('*')
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .order('last_message_at', { ascending: false })

  const rows = (conversations ?? []) as ConversationRow[]
  if (rows.length === 0) return []

  const conversationIds = rows.map(r => r.id)
  const otherUserIds = rows.map(r => (r.player1_id === userId ? r.player2_id : r.player1_id))

  const [{ data: players }, { data: allMessages }] = await Promise.all([
    supabase.from('players').select('user_id, display_name, username, avatar_url').in('user_id', otherUserIds),
    supabase.from('messages').select('*').in('conversation_id', conversationIds).order('created_at', { ascending: false }),
  ])

  const playerById = new Map((players ?? []).map(p => [p.user_id, p]))
  const lastMessageByConversation = new Map<string, MessageRow>()
  const unreadByConversation = new Map<string, number>()

  for (const m of (allMessages ?? []) as MessageRow[]) {
    if (!lastMessageByConversation.has(m.conversation_id)) {
      lastMessageByConversation.set(m.conversation_id, m)
    }
    if (!m.read && m.sender_id !== userId) {
      unreadByConversation.set(m.conversation_id, (unreadByConversation.get(m.conversation_id) ?? 0) + 1)
    }
  }

  return rows.map(c => {
    const otherUserId = c.player1_id === userId ? c.player2_id : c.player1_id
    const player = playerById.get(otherUserId)
    const last = lastMessageByConversation.get(c.id)
    return {
      id: c.id,
      otherUserId,
      otherDisplayName: player?.display_name ?? player?.username ?? 'Player',
      otherUsername: player?.username ?? null,
      otherAvatarUrl: player?.avatar_url ?? null,
      lastMessage: last?.content ?? 'Start a conversation',
      lastMessageAt: last?.created_at ?? c.last_message_at,
      unreadCount: unreadByConversation.get(c.id) ?? 0,
    }
  })
}

export async function listMessages(conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as MessageRow[]
}

export async function getConversation(conversationId: string): Promise<ConversationRow> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Conversation not found.')
  return data as ConversationRow
}

export async function markConversationRead(conversationId: string) {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) throw new Error(gate.error)
  await supabase
    .from('messages')
    .update({ read: true })
    .eq('conversation_id', conversationId)
    .neq('sender_id', gate.userId)
    .eq('read', false)
}

export async function sendConversationMessage(conversationId: string, content: string) {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) throw new Error(gate.error)
  const userId = gate.userId
  const text = content.trim()
  if (!text) throw new Error('Message cannot be empty.')

  const conversation = await getConversation(conversationId)
  const recipientId = conversation.player1_id === userId ? conversation.player2_id : conversation.player1_id

  const [{ error: insertError }, { data: me }] = await Promise.all([
    supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: userId,
      content: text,
    }),
    supabase.from('players').select('display_name').eq('user_id', userId).maybeSingle(),
  ])
  if (insertError) throw new Error(insertError.message)

  const { data: tokenRow } = await supabase
    .from('notification_tokens')
    .select('push_token')
    .eq('user_id', recipientId)
    .maybeSingle()

  if (tokenRow?.push_token) {
    const senderName = me?.display_name ?? 'Someone'
    const preview = text.length > 90 ? `${text.slice(0, 87)}...` : text
    await sendPushNotification(tokenRow.push_token, 'New message', `${senderName}: ${preview}`)
  }
}
