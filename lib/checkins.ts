import { type CourtStatus, STATUS_PIN_COLOR } from '@/lib/courts'
import { supabase } from '@/supabase'

const CHUNK = 80

/** Map-level / list status from active check-in counts (0 → open/green, 1–4 → busy/amber, 5+ → full/red). */
export function checkinCountToCourtStatus(count: number): CourtStatus {
  if (count <= 0) return 'open'
  if (count < 5) return 'busy'
  return 'full'
}

export function checkinCountToPinHex(count: number): string {
  return STATUS_PIN_COLOR[checkinCountToCourtStatus(count)]
}

export function checkinBucketLabel(count: number): { title: string; subtitle: string } {
  if (count <= 0) {
    return { title: `${count} players here`, subtitle: 'Likely open' }
  }
  if (count < 5) {
    return {
      title: `${count} player${count === 1 ? '' : 's'} here`,
      subtitle: 'Getting busy',
    }
  }
  return {
    title: `${count} players here`,
    subtitle: 'Busy',
  }
}

export function checkinBucketTone(
  count: number,
  isDark: boolean
): { bg: string; border: string; title: string; subtitle: string } {
  if (!isDark) {
    if (count <= 0) {
      return { bg: '#DCFCE7', border: '#16A34A', title: '#14532D', subtitle: '#166534' }
    }
    if (count < 5) {
      return { bg: '#FFFBEB', border: '#F59E0B', title: '#78350F', subtitle: '#B45309' }
    }
    return { bg: '#FEE2E2', border: '#EF4444', title: '#7F1D1D', subtitle: '#B91C1C' }
  }
  if (count <= 0) {
    return { bg: 'rgba(34,197,94,0.16)', border: '#4ADE80', title: '#DCFCE7', subtitle: '#86EFAC' }
  }
  if (count < 5) {
    return { bg: 'rgba(245,158,11,0.14)', border: '#FBBF24', title: '#FEF3C7', subtitle: '#FCD34D' }
  }
  return { bg: 'rgba(239,68,68,0.16)', border: '#F87171', title: '#FEE2E2', subtitle: '#FECACA' }
}

/** Count active (non-expired) rows per venue. */
export async function fetchActiveCheckinCountsByCourtIds(
  courtIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (courtIds.length === 0) return out

  const nowIso = new Date().toISOString()

  for (let i = 0; i < courtIds.length; i += CHUNK) {
    const chunk = courtIds.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('court_checkins')
      .select('court_id')
      .in('court_id', chunk)
      .gt('expires_at', nowIso)

    if (error) {
      if (__DEV__) console.warn('[checkins] fetchActiveCheckinCountsByCourtIds', error.message)
      continue
    }
    for (const raw of data ?? []) {
      const row = raw as { court_id?: string }
      const id = row.court_id != null ? String(row.court_id).trim() : ''
      if (!id) continue
      out.set(id, (out.get(id) ?? 0) + 1)
    }
  }

  return out
}
