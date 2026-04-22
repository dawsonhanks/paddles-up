/** Basic email / phone checks for profile contact fields (not full RFC 5322). */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(s: string): boolean {
  const t = s.trim()
  if (t.length < 5) return false
  return EMAIL_RE.test(t)
}

/** Strip to digits; require 10–15 (covers US and many international). */
export function isValidPhone(s: string): boolean {
  const digits = s.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}

const USERNAME_RE = /^[a-z0-9_]{2,32}$/

export function isValidUsername(s: string): boolean {
  return USERNAME_RE.test(s.trim().toLowerCase().replace(/^@+/, ''))
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, '').replace(/\s/g, '')
}

export function sanitizeUsernameInput(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9_]/g, '')
}
