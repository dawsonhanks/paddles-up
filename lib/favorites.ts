import { supabase } from '@/supabase'

export async function ensureFavoritesUser(): Promise<{ userId: string } | { error: string }> {
  const { data: sessionData } = await supabase.auth.getSession()
  if (sessionData.session?.user) {
    return { userId: sessionData.session.user.id }
  }
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error || !data.user) {
    return { error: error?.message ?? 'Could not start a session for favorites.' }
  }
  return { userId: data.user.id }
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