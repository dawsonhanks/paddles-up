import { ErrorBanner } from '@/components/error-banner'
import { ReportReasonModal } from '@/components/report-reason-modal'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { fetchBlockedUserIds } from '@/lib/blockedUsers'
import { ensureFavoritesUser } from '@/lib/favorites'
import { userFriendlyFromUnknown } from '@/lib/errors'
import {
  getConversation,
  listMessages,
  markConversationRead,
  sendConversationMessage,
  type MessageRow,
} from '@/lib/messages'
import { showReportActionSheet } from '@/lib/showReportMenu'
import { supabase } from '@/supabase'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import type { ContentReportType } from '@/lib/contentReports'

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function filterMessagesForBlocks(rows: MessageRow[], blocked: Set<string>, myId: string): MessageRow[] {
  return rows.filter((m) => m.sender_id === myId || !blocked.has(m.sender_id))
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const colorScheme = useColorScheme()
  const theme = Colors[colorScheme ?? 'light']
  const isDark = colorScheme === 'dark'

  const [messages, setMessages] = useState<MessageRow[]>([])
  const [input, setInput] = useState('')
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [otherName, setOtherName] = useState('Conversation')
  const [sending, setSending] = useState(false)
  const [conversationBanner, setConversationBanner] = useState<string | null>(null)
  const [blockedSenders, setBlockedSenders] = useState<Set<string>>(new Set())
  const [reportTarget, setReportTarget] = useState<{ type: ContentReportType; id: string } | null>(null)

  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const incomingBg = isDark ? '#2C2C2E' : '#E5E7EB'

  const load = useCallback(async (cancelledRef?: { current: boolean }) => {
    if (!id) return
    try {
      const gate = await ensureFavoritesUser()
      if (cancelledRef?.current) return
      if ('error' in gate) {
        setConversationBanner(userFriendlyFromUnknown(gate.error))
        return
      }
      if (cancelledRef?.current) return
      setMyUserId(gate.userId)
      const blocked = new Set(await fetchBlockedUserIds())
      if (cancelledRef?.current) return
      setBlockedSenders(blocked)

      const [conversation, messageRows] = await Promise.all([
        getConversation(id),
        listMessages(id),
      ])
      if (cancelledRef?.current) return
      setMessages(filterMessagesForBlocks(messageRows, blocked, gate.userId))
      setConversationBanner(null)

      const otherUserId = conversation.player1_id === gate.userId ? conversation.player2_id : conversation.player1_id
      const { data: other } = await supabase
        .from('players')
        .select('display_name, username')
        .eq('user_id', otherUserId)
        .maybeSingle()
      if (cancelledRef?.current) return
      setOtherName(other?.display_name ?? other?.username ?? 'Player')
      await markConversationRead(id)
    } catch (e) {
      if (cancelledRef?.current) return
      setMessages([])
      setConversationBanner(userFriendlyFromUnknown(e))
    }
  }, [id])

  useFocusEffect(
    useCallback(() => {
      const cancelled = { current: false }
      void load(cancelled)
      return () => {
        cancelled.current = true
      }
    }, [load]),
  )

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const channel = supabase
      .channel(`messages-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
        async () => {
          if (cancelled) return
          try {
            const gate = await ensureFavoritesUser()
            const latest = await listMessages(id)
            if (cancelled) return
            if ('error' in gate) {
              setMessages(latest)
            } else {
              const blocked = new Set(await fetchBlockedUserIds())
              if (cancelled) return
              setBlockedSenders(blocked)
              setMessages(filterMessagesForBlocks(latest, blocked, gate.userId))
            }
            await markConversationRead(id)
          } catch {
            if (cancelled) return
            setConversationBanner(
              'This chat did not refresh. Step out and open it again, or wait a beat and revisit.',
            )
          }
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [id])

  const orderedMessages = useMemo(
    () => (myUserId ? filterMessagesForBlocks(messages, blockedSenders, myUserId) : messages),
    [messages, blockedSenders, myUserId],
  )

  async function send() {
    if (!id || !input.trim() || sending) return
    const text = input.trim()
    setInput('')
    setSending(true)
    try {
      await sendConversationMessage(id, text)
      const latest = await listMessages(id)
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setMessages(latest)
      } else {
        setMessages(filterMessagesForBlocks(latest, blockedSenders, gate.userId))
      }
      setConversationBanner(null)
    } catch (e) {
      setInput(text)
      setConversationBanner(userFriendlyFromUnknown(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: cardBorder }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>{otherName}</Text>
        <View style={{ width: 24 }} />
      </View>
      <ErrorBanner message={conversationBanner} onDismiss={() => setConversationBanner(null)} />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          style={styles.flex}
          contentContainerStyle={styles.messagesList}
          data={orderedMessages}
          keyExtractor={(item) => item?.id ?? ''}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyText, { color: theme.icon }]}>No messages yet — say hello below.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const mine = item?.sender_id === myUserId
            return (
              <View style={[styles.messageRow, mine ? styles.mineRow : styles.theirRow]}>
                <Pressable
                  onLongPress={() => {
                    if (mine || !myUserId) return
                    Keyboard.dismiss()
                    showReportActionSheet(() => setReportTarget({ type: 'message', id: item?.id ?? '' }))
                  }}
                  delayLongPress={450}
                  style={[styles.bubble, mine ? styles.mineBubble : { backgroundColor: incomingBg }]}>
                  <Text style={[styles.messageText, { color: mine ? '#fff' : theme.text }]}>{item?.content ?? ''}</Text>
                  <Text style={[styles.messageTime, { color: mine ? 'rgba(255,255,255,0.8)' : theme.icon }]}>
                    {item?.created_at ? formatTime(item.created_at) : ''}
                  </Text>
                </Pressable>
              </View>
            )
          }}
        />

        <View style={[styles.inputRow, { borderTopColor: cardBorder }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Type a message..."
            placeholderTextColor={theme.icon}
            style={[styles.input, { color: theme.text, borderColor: cardBorder }]}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.5 }]}
            disabled={!input.trim() || sending}
            onPress={send}>
            <MaterialIcons name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <ReportReasonModal
        visible={reportTarget != null}
        onClose={() => setReportTarget(null)}
        contentType={reportTarget?.type ?? 'message'}
        contentId={reportTarget?.id ?? ''}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', flex: 1 },
  messagesList: { padding: 12, gap: 8 },
  messageRow: { flexDirection: 'row' },
  mineRow: { justifyContent: 'flex-end' },
  theirRow: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mineBubble: { backgroundColor: '#1D9E75' },
  messageText: { fontSize: 15 },
  messageTime: { marginTop: 4, fontSize: 11, alignSelf: 'flex-end' },
  inputRow: {
    borderTopWidth: 0.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 0.5,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxHeight: 110,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: { paddingVertical: 24, paddingHorizontal: 16, alignItems: 'center' },
  emptyText: { fontSize: 15, textAlign: 'center' },
})
