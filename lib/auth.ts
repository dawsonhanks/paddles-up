import { mapAuthErrorMessage, MIN_PASSWORD_LENGTH } from '@/lib/authErrors'
import { isValidEmail, isValidUsername, normalizeUsername } from '@/lib/profileValidation'
import { supabase } from '@/supabase'
import * as Linking from 'expo-linking'

export type AuthFieldErrors = {
  fullName?: string
  username?: string
  email?: string
  password?: string
  confirmPassword?: string
  form?: string
}

export type AuthResult = { ok: true } | { ok: false; fieldErrors: AuthFieldErrors }

function fail(fieldErrors: AuthFieldErrors): AuthResult {
  return { ok: false, fieldErrors }
}

export async function ensurePlayerProfile(params: {
  userId: string
  displayName: string
  contactEmail: string
  username?: string
}): Promise<AuthResult> {
  const row: {
    user_id: string
    display_name: string
    contact: string
    username?: string
  } = {
    user_id: params.userId,
    display_name: params.displayName.trim(),
    contact: params.contactEmail.trim(),
  }
  if (params.username) {
    row.username = params.username
  }

  const { error } = await supabase.from('players').upsert(row, { onConflict: 'user_id' })

  if (error) {
    if (error.code === '23505') {
      return fail({ username: 'That username is already taken.' })
    }
    return fail({ form: mapAuthErrorMessage(error.message) })
  }
  return { ok: true }
}

export function validateSignUpFields(params: {
  fullName: string
  username: string
  email: string
  password: string
  confirmPassword: string
}): AuthFieldErrors | null {
  const errors: AuthFieldErrors = {}
  if (!params.fullName.trim()) {
    errors.fullName = 'Enter your full name.'
  }
  const handle = normalizeUsername(params.username)
  if (!handle) {
    errors.username = 'Choose a username.'
  } else if (!isValidUsername(handle)) {
    errors.username = 'Use 3–20 characters: letters, numbers, and underscores only.'
  }
  if (!params.email.trim()) {
    errors.email = 'Enter your email address.'
  } else if (!isValidEmail(params.email)) {
    errors.email = 'Enter a valid email address.'
  }
  if (!params.password) {
    errors.password = 'Enter a password.'
  } else if (params.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (!params.confirmPassword) {
    errors.confirmPassword = 'Confirm your password.'
  } else if (params.password !== params.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.'
  }
  return Object.keys(errors).length > 0 ? errors : null
}

export function validateLogInFields(params: {
  email: string
  password: string
}): AuthFieldErrors | null {
  const errors: AuthFieldErrors = {}
  if (!params.email.trim()) {
    errors.email = 'Enter your email address.'
  } else if (!isValidEmail(params.email)) {
    errors.email = 'Enter a valid email address.'
  }
  if (!params.password) {
    errors.password = 'Enter your password.'
  }
  return Object.keys(errors).length > 0 ? errors : null
}

export async function signUpWithEmail(params: {
  fullName: string
  username: string
  email: string
  password: string
  confirmPassword: string
}): Promise<AuthResult> {
  const validation = validateSignUpFields(params)
  if (validation) return fail(validation)

  const email = params.email.trim().toLowerCase()
  const username = normalizeUsername(params.username)

  const { data: taken } = await supabase
    .from('players')
    .select('user_id')
    .eq('username', username)
    .maybeSingle()
  if (taken) {
    return fail({ username: 'That username is already taken.' })
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password: params.password,
    options: {
      data: { full_name: params.fullName.trim() },
    },
  })

  if (error) {
    const msg = mapAuthErrorMessage(error.message)
    if (msg.toLowerCase().includes('email already')) {
      return fail({ email: msg })
    }
    if (msg.toLowerCase().includes('password')) {
      return fail({ password: msg })
    }
    return fail({ form: msg })
  }

  let userId = data.session?.user?.id ?? data.user?.id

  if (!data.session) {
    const signIn = await supabase.auth.signInWithPassword({
      email,
      password: params.password,
    })
    if (signIn.error || !signIn.data.session?.user) {
      return fail({ form: mapAuthErrorMessage(signIn.error?.message ?? 'Could not sign you in after sign up.') })
    }
    userId = signIn.data.session.user.id
  }

  if (!userId) {
    return fail({ form: 'Could not create your account. Please try again.' })
  }

  const profile = await ensurePlayerProfile({
    userId,
    displayName: params.fullName,
    contactEmail: email,
    username,
  })
  if (!profile.ok) return profile

  return { ok: true }
}

export async function signInWithEmail(params: {
  email: string
  password: string
}): Promise<AuthResult> {
  const validation = validateLogInFields(params)
  if (validation) return fail(validation)

  const email = params.email.trim().toLowerCase()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: params.password,
  })

  if (error) {
    const msg = mapAuthErrorMessage(error.message)
    if (msg.toLowerCase().includes('email or password') || msg.toLowerCase().includes('incorrect')) {
      return fail({ form: msg })
    }
    return fail({ form: msg })
  }

  if (!data.session?.user) {
    return fail({ form: 'Could not sign you in. Please try again.' })
  }

  return { ok: true }
}

export async function sendPasswordResetEmail(emailRaw: string): Promise<AuthResult> {
  const email = emailRaw.trim().toLowerCase()
  if (!email) {
    return fail({ email: 'Enter your email address to reset your password.' })
  }
  if (!isValidEmail(email)) {
    return fail({ email: 'Enter a valid email address.' })
  }

  const redirectTo = Linking.createURL('reset-password')
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })

  if (error) {
    return fail({ form: mapAuthErrorMessage(error.message) })
  }

  return { ok: true }
}

export async function updatePasswordWithConfirm(params: {
  password: string
  confirmPassword: string
}): Promise<AuthResult> {
  const errors: AuthFieldErrors = {}
  if (!params.password) {
    errors.password = 'Enter a new password.'
  } else if (params.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (!params.confirmPassword) {
    errors.confirmPassword = 'Confirm your new password.'
  } else if (params.password !== params.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.'
  }
  if (Object.keys(errors).length > 0) return fail(errors)

  const { error } = await supabase.auth.updateUser({ password: params.password })
  if (error) {
    return fail({ form: mapAuthErrorMessage(error.message) })
  }
  return { ok: true }
}

/** Parse access/refresh tokens or PKCE code from a Supabase auth redirect URL. */
function parseAuthRedirectParams(url: string): Record<string, string> {
  const out: Record<string, string> = {}
  const qIndex = url.indexOf('?')
  const hIndex = url.indexOf('#')
  const query = qIndex >= 0 ? url.slice(qIndex + 1, hIndex >= 0 ? hIndex : undefined) : ''
  const hash = hIndex >= 0 ? url.slice(hIndex + 1) : ''
  for (const part of [query, hash]) {
    if (!part) continue
    for (const pair of part.split('&')) {
      if (!pair) continue
      const eq = pair.indexOf('=')
      const key = eq >= 0 ? pair.slice(0, eq) : pair
      const val = eq >= 0 ? pair.slice(eq + 1) : ''
      if (!key) continue
      try {
        out[decodeURIComponent(key)] = decodeURIComponent(val.replace(/\+/g, ' '))
      } catch {
        out[key] = val
      }
    }
  }
  return out
}

/**
 * Establish a session from a password-recovery (or other auth) deep link.
 * Returns whether a recovery session was established.
 */
export async function establishSessionFromAuthUrl(url: string): Promise<{
  ok: boolean
  isRecovery: boolean
  error?: string
}> {
  const params = parseAuthRedirectParams(url)
  const type = params.type ?? ''

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code)
    if (error) return { ok: false, isRecovery: type === 'recovery', error: mapAuthErrorMessage(error.message) }
    return { ok: true, isRecovery: type === 'recovery' || type === '' }
  }

  const access_token = params.access_token
  const refresh_token = params.refresh_token
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token })
    if (error) return { ok: false, isRecovery: type === 'recovery', error: mapAuthErrorMessage(error.message) }
    return { ok: true, isRecovery: type === 'recovery' }
  }

  return { ok: false, isRecovery: false }
}
