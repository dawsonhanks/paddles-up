import { isValidUsername, normalizeUsername } from '@/lib/profileValidation'
import { supabase } from '@/supabase'

export type UsernameAvailability = 'idle' | 'invalid' | 'checking' | 'available' | 'taken'

export async function checkUsernameAvailability(
  rawUsername: string,
  excludeUserId?: string,
): Promise<{ status: UsernameAvailability; handle: string }> {
  const handle = normalizeUsername(rawUsername)
  if (!handle) return { status: 'idle', handle }
  if (!isValidUsername(handle)) {
    return { status: 'invalid', handle }
  }

  const { data: taken, error } = await supabase
    .from('players')
    .select('user_id')
    .eq('username', handle)
    .maybeSingle()

  if (error) return { status: 'idle', handle }
  if (taken && (!excludeUserId || taken.user_id !== excludeUserId)) {
    return { status: 'taken', handle }
  }
  return { status: 'available', handle }
}
