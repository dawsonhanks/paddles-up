import { ensureFavoritesUser } from '@/lib/favorites'
import { supabase } from '@/supabase'

export type ContentReportType = 'post' | 'review' | 'message' | 'profile'

export const REPORT_REASONS = [
  'Inappropriate content',
  'Spam',
  'Harassment',
  'False information',
  'Other',
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]

export async function submitContentReport(input: {
  contentType: ContentReportType
  contentId: string
  reason: string
}): Promise<{ error: Error | null }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) {
    return { error: new Error(gate.error) }
  }

  const { error } = await supabase.from('content_reports').insert({
    reporter_id: gate.userId,
    content_type: input.contentType,
    content_id: input.contentId,
    reason: input.reason,
  })

  return { error: error ? new Error(error.message) : null }
}
