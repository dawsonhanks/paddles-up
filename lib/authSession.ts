import type { Session, User } from '@supabase/supabase-js'

/** True when the user has a real email/password (or OAuth) session — not anonymous. */
export function isSignedInUser(user: User | null | undefined): boolean {
  return !!user && !user.is_anonymous
}

export function hasActiveSignedInSession(session: Session | null | undefined): boolean {
  return !!session?.user && isSignedInUser(session.user)
}
