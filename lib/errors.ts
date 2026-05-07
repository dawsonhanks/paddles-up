/** Generic fallback — never expose raw technical messages to users. */
export const FRIENDLY_GENERIC =
  'Something went wrong — please give it another try.'

/** PostgREST / Postgres permission hints */
const DENIED_HINTS = [
  'permission denied',
  'violates row-level security',
  'new row violates row-level security',
  'rls',
]

const NETWORK_HINTS = [
  'network request failed',
  'network error',
  'internet connection appears',
  'failed to fetch',
  'timeout',
  'timed out',
  'connection refused',
  'ENOTFOUND',
  'econnrefused',
]

const JWT_HINTS = [
  'jwt',
  'token',
  'session',
  'unauthorized',
  'auth session',
]

const SUPABASE_HINTS = [
  'supabase.co',
  'postgresql',
]

export type FriendlyErrorKind = 'network' | 'auth' | 'permission' | 'generic'

export function classifyFriendlyError(message: string): FriendlyErrorKind {
  const m = message.toLowerCase()
  if (NETWORK_HINTS.some((s) => m.includes(s))) return 'network'
  if (JWT_HINTS.some((s) => m.includes(s))) return 'auth'
  if (DENIED_HINTS.some((s) => m.includes(s))) return 'permission'
  if (SUPABASE_HINTS.some((s) => m.includes(s))) return 'generic'
  return 'generic'
}

/** Map Supabase PostgREST / auth style messages and common RN fetch errors. */
export function userFriendlyMessage(raw: string): string {
  const m = raw.trim()
  if (!m) return FRIENDLY_GENERIC

  const lower = m.toLowerCase()

  if (NETWORK_HINTS.some((s) => lower.includes(s))) {
    return 'We could not reach the server. Check your connection and try again.'
  }

  if (/jwt|token expired|invalid grant|session (expired|not found|missing)/i.test(m)) {
    return 'Your sign-in session needs a refresh. Close and reopen the app, or sign in again.'
  }

  if (
    lower.includes('permission denied') ||
    lower.includes('row-level security') ||
    lower.includes('new row violates row-level security') ||
    lower.includes('violates row-level security policy')
  ) {
    return 'You do not have access to do that with your current account.'
  }

  // PostgREST duplicate / constraint (without echoing codes)
  if (lower.includes('duplicate key') || /\b23505\b/.test(lower)) {
    return 'That item already exists. Try something a little different.'
  }

  return FRIENDLY_GENERIC
}

/** From Error, PostgrestError-like object, or unknown. */
export function userFriendlyFromUnknown(err: unknown): string {
  if (err == null) return FRIENDLY_GENERIC
  if (typeof err === 'string') return userFriendlyMessage(err)
  if (err instanceof Error) return userFriendlyMessage(err.message || '')
  if (typeof err === 'object') {
    const o = err as { message?: unknown; error_description?: unknown }
    const msg =
      (typeof o.message === 'string' && o.message) ||
      (typeof o.error_description === 'string' && o.error_description)
    if (msg) return userFriendlyMessage(msg)
  }
  return FRIENDLY_GENERIC
}
