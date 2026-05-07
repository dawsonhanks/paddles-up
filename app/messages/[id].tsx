import { ErrorBanner } from '@/components/error-banner'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { ensureFavoritesUser } from '@/lib/favorites'
import { userFriendlyFromUnknown } from '@/lib/errors'
import {
  getConversation,
  listMessages,
  markConversationRead,
  sendConversationMessage,
  type MessageRow,
} from '@/lib/messages'
import { supabase } from '@/supabase'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
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

  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const incomingBg = isDark ? '#2C2C2E' : '#E5E7EB'

  const load = useCallback(async () => {
    if (!id) return
    try {
      const gate = await ensureFavoritesUser()
      if ('error' in gate) {
        setConversationBanner(userFriendlyFromUnknown(gate.error))
        return
      }
      setMyUserId(gate.userId)

      const [conversation, messageRows] = await Promise.all([
        getConversation(id),
        listMessages(id),
      ])
      setMessages(messageRows)
      setConversationBanner(null)

      const otherUserId = conversation.player1_id === gate.userId ? conversation.player2_id : conversation.player1_id
      const { data: other } = await supabase
        .from('players')
        .select('display_name, username')
        .eq('user_id', otherUserId)
        .maybeSingle()
      setOtherName(other?.display_name ?? other?.username ?? 'Player')
      await markConversationRead(id)
    } catch (e) {
      setMessages([])
      setConversationBanner(userFriendlyFromUnknown(e))
    }
  }, [id])

  useFocusEffect(useCallback(() => { load() }, [load]))

  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`messages-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
        async () => {
          try {
            const latest = await listMessages(id)
            setMessages(latest)
            await markConversationRead(id)
          } catch {
            setConversationBanner(
              'This chat did not refresh. Step out and open it again, or wait a beat and revisit.',
            )
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [id])

  const orderedMessages = useMemo(() => messages, [messages])

  async function send() {
    if (!id || !input.trim() || sending) return
    const text = input.trim()
    setInput('')
    setSending(true)
    try {
      await sendConversationMessage(id, text)
      const latest = await listMessages(id)
      setMessages(latest)
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
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const mine = item.sender_id === myUserId
            return (
              <View style={[styles.messageRow, mine ? styles.mineRow : styles.theirRow]}>
                <View style={[styles.bubble, mine ? styles.mineBubble : { backgroundColor: incomingBg }]}>
                  <Text style={[styles.messageText, { color: mine ? '#fff' : theme.text }]}>{item.content}</Text>
                  <Text style={[styles.messageTime, { color: mine ? 'rgba(255,255,255,0.8)' : theme.icon }]}>
                    {formatTime(item.created_at)}
                  </Text>
                </View>
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
})
