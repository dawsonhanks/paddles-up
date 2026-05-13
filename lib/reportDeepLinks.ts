import { userFriendlyFromUnknown } from '@/lib/errors'
import { supabase } from '@/supabase'
import { Alert } from 'react-native'

import type { ContentReportType } from '@/lib/contentReports'

/** Expo Router’s `push` is typed with a branded `Href`; runtime paths are plain strings. */
type AppRouter = { push: (href: string) => void }

export async function openReportedContent(
  router: unknown,
  row: { content_type: ContentReportType; content_id: string },
): Promise<void> {
  const { push } = router as AppRouter
  try {
    switch (row.content_type) {
      case 'post':
        push('/(tabs)/play')
        return
      case 'profile':
        push(`/friends/${encodeURIComponent(row.content_id)}`)
        return
      case 'review': {
        const { data, error } = await supabase
          .from('court_reviews')
          .select('court_id')
          .eq('id', row.content_id)
          .maybeSingle()
        if (error || !data?.court_id) {
          Alert.alert('Could not open review', 'This review may have been removed.')
          return
        }
        push(`/court/${encodeURIComponent(String(data.court_id))}`)
        return
      }
      case 'message': {
        const { data, error } = await supabase
          .from('messages')
          .select('conversation_id')
          .eq('id', row.content_id)
          .maybeSingle()
        if (error || !data?.conversation_id) {
          Alert.alert('Could not open message', 'This message may have been removed.')
          return
        }
        push(`/messages/${encodeURIComponent(String(data.conversation_id))}`)
        return
      }
      default:
        return
    }
  } catch (e) {
    Alert.alert('Could not open', userFriendlyFromUnknown(e))
  }
}
