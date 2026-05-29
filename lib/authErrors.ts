const MIN_PASSWORD_LENGTH = 8

export { MIN_PASSWORD_LENGTH }

/** Maps Supabase Auth errors to clear inline copy for the auth screen. */
export function mapAuthErrorMessage(raw: string): string {
  const m = raw.trim().toLowerCase()
  if (!m) return 'Something went wrong. Please try again.'

  if (
    m.includes('already registered') ||
    m.includes('already been registered') ||
    m.includes('user already registered')
  ) {
    return 'An account with this email already exists. Switch to Log In or use a different email.'
  }

  if (
    m.includes('invalid login credentials') ||
    m.includes('invalid email or password') ||
    m.includes('invalid credentials')
  ) {
    return 'Incorrect email or password. Please check and try again.'
  }

  if (m.includes('password should be at least') || m.includes('password must be at least')) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }

  if (m.includes('unable to validate email') || m.includes('invalid email')) {
    return 'Enter a valid email address.'
  }

  if (m.includes('rate limit') || m.includes('too many requests')) {
    return 'Too many attempts. Wait a moment and try again.'
  }

  if (m.includes('network') || m.includes('fetch')) {
    return 'We could not reach the server. Check your connection and try again.'
  }

  return 'Something went wrong. Please try again.'
}
