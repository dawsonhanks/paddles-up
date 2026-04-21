import type { CourtStatus } from '@/lib/courts'
import { supabase } from '@/supabase'

export type ReportableStatus = Extract<CourtStatus, 'open' | 'busy' | 'full'>

/** Matches `availability_reports` — adjust in Supabase if your columns differ. */
export type AvailabilityReportRow = {
  court_id: string
  court_number: number
  status: ReportableStatus
  reporter_lat: number
  reporter_lng: number
}

export async function insertAvailabilityReport(row: AvailabilityReportRow): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('availability_reports').insert({
    court_id: row.court_id,
    court_number: row.court_number,
    status: row.status,
    reporter_lat: row.reporter_lat,
    reporter_lng: row.reporter_lng,
  })
  return { error: error ? new Error(error.message) : null }
}

/** Latest status per numbered court (most recent `created_at` wins). */
export async function fetchLatestAvailabilityByCourt(
  courtId: string
): Promise<Map<number, ReportableStatus>> {
  const { data, error } = await supabase
    .from('availability_reports')
    .select('court_number, status, created_at')
    .eq('court_id', courtId)
    .order('created_at', { ascending: false })
    .limit(400)

  if (error || !data) return new Map()

  const latest = new Map<number, ReportableStatus>()
  for (const raw of data) {
    const row = raw as { court_number?: number; status?: string }
    const n = typeof row.court_number === 'number' ? row.court_number : Number(row.court_number)
    if (!Number.isFinite(n) || n < 1 || latest.has(n)) continue
    const s = row.status
    if (s === 'open' || s === 'busy' || s === 'full') latest.set(n, s)
  }
  return latest
}
