import { isSignedInUser } from '@/lib/authSession'
import { supabase } from '@/supabase'

export async function ensureFavoritesUser(): Promise<{ userId: string } | { error: string }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const user = sessionData.session?.user
  if (isSignedInUser(user)) {
    return { userId: user.id }
  }
  return { error: 'Please sign in to continue.' }
}

export async function isCourtFavorite(courtId: string): Promise<boolean> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) return false

  const { data, error } = await supabase
    .from('favorites')
    .select('id')
    .eq('court_id', courtId)
    .eq('user_id', gate.userId)
    .maybeSingle()

  if (error) return false
  return data != null
}

export async function addFavorite(courtId: string): Promise<{ error: Error | null }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) {
    return { error: new Error(gate.error) }
  }

  const { error } = await supabase.from('favorites').insert({
    court_id: courtId,
    user_id: gate.userId,
  })

  return { error: error ? new Error(error.message) : null }
}

/** All courts the current user has favorited (`favorites.court_id`). */
export async function fetchFavoriteCourtIds(): Promise<{ ids: string[]; error: Error | null }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) {
    return { ids: [], error: new Error(gate.error) }
  }
  const { data, error } = await supabase.from('favorites').select('court_id').eq('user_id', gate.userId)
  if (error) return { ids: [], error: new Error(error.message) }
  const ids = (data ?? []).map((r) => String((r as { court_id: string }).court_id)).filter(Boolean)
  return { ids, error: null }
}

export async function removeFavorite(courtId: string): Promise<{ error: Error | null }> {
  const gate = await ensureFavoritesUser()
  if ('error' in gate) {
    return { error: new Error(gate.error) }
  }

  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('court_id', courtId)
    .eq('user_id', gate.userId)

  return { error: error ? new Error(error.message) : null }
}