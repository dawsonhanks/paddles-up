import { supabase } from '@/supabase'

export type CourtReview = {
  id: string
  court_id: string
  user_id: string
  display_name: string
  rating: number
  review_text: string
  created_at: string
}

function mapRow(row: Record<string, unknown>): CourtReview {
  return {
    id: String(row.id),
    court_id: String(row.court_id),
    user_id: String(row.user_id),
    display_name: String(row.display_name ?? 'Player'),
    rating: Number(row.rating),
    review_text: String(row.review_text ?? ''),
    created_at: String(row.created_at),
  }
}

const selectCols = 'id, court_id, user_id, display_name, rating, review_text, created_at'

export async function countCourtReviews(courtId: string): Promise<number> {
  const { count, error } = await supabase
    .from('court_reviews')
    .select('*', { count: 'exact', head: true })
    .eq('court_id', courtId)
  if (error) return 0
  return count ?? 0
}

/** Up to 3 rows: current user first (if any), then others by newest. */
export async function fetchCourtReviewsPreview(
  courtId: string,
  viewerUserId: string | null,
): Promise<{ total: number; rows: CourtReview[] }> {
  const total = await countCourtReviews(courtId)
  const rows: CourtReview[] = []

  if (viewerUserId) {
    const { data: mine } = await supabase
      .from('court_reviews')
      .select(selectCols)
      .eq('court_id', courtId)
      .eq('user_id', viewerUserId)
      .maybeSingle()
    if (mine) rows.push(mapRow(mine as Record<string, unknown>))
  }

  const need = Math.max(0, 3 - rows.length)
  if (need === 0) return { total, rows }

  let q = supabase
    .from('court_reviews')
    .select(selectCols)
    .eq('court_id', courtId)
    .order('created_at', { ascending: false })
    .limit(need)
  if (viewerUserId) q = q.neq('user_id', viewerUserId)

  const { data: others } = await q
  for (const r of others ?? []) rows.push(mapRow(r as Record<string, unknown>))

  return { total, rows }
}

/** Newest rows that include non-empty review text (for detail “written” snippets). */
export async function fetchRecentWrittenCourtReviews(courtId: string, limit: number): Promise<CourtReview[]> {
  const { data, error } = await supabase
    .from('court_reviews')
    .select(selectCols)
    .eq('court_id', courtId)
    .order('created_at', { ascending: false })
    .limit(80)
  if (error || !data) return []
  const out: CourtReview[] = []
  for (const row of data) {
    const r = mapRow(row as Record<string, unknown>)
    if (r.review_text.trim().length === 0) continue
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}

export async function fetchCourtReviewsPage(
  courtId: string,
  offset: number,
  limit: number,
): Promise<CourtReview[]> {
  const { data, error } = await supabase
    .from('court_reviews')
    .select(selectCols)
    .eq('court_id', courtId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error || !data) return []
  return data.map((r) => mapRow(r as Record<string, unknown>))
}

export async function fetchMyCourtReview(
  courtId: string,
  userId: string,
): Promise<CourtReview | null> {
  const { data } = await supabase
    .from('court_reviews')
    .select(selectCols)
    .eq('court_id', courtId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function upsertCourtReview(input: {
  courtId: string
  userId: string
  displayName: string
  rating: number
  reviewText: string
}): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('court_reviews').upsert(
    {
      court_id: input.courtId,
      user_id: input.userId,
      display_name: input.displayName,
      rating: input.rating,
      review_text: input.reviewText.trim(),
    },
    { onConflict: 'user_id,court_id' },
  )
  return { error: error ? new Error(error.message) : null }
}

/** Checkout star rating: always upserts one row. Empty optional text keeps any existing written review. */
export async function upsertCourtReviewFromCheckout(input: {
  courtId: string
  userId: string
  displayName: string
  rating: number
  checkoutNote: string
}): Promise<{ error: Error | null }> {
  const trimmed = input.checkoutNote.trim()
  const existing = await fetchMyCourtReview(input.courtId, input.userId)
  const mergedText =
    trimmed.length > 0
      ? trimmed
      : (existing?.review_text ?? '').trim().length > 0
        ? (existing?.review_text ?? '')
        : ''
  return upsertCourtReview({
    courtId: input.courtId,
    userId: input.userId,
    displayName: input.displayName,
    rating: input.rating,
    reviewText: mergedText,
  })
}

export async function deleteCourtReview(courtId: string, userId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('court_reviews').delete().eq('court_id', courtId).eq('user_id', userId)
  return { error: error ? new Error(error.message) : null }
}
