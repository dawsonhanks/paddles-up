import { isValidUsername, normalizeUsername } from '@/lib/profileValidation'
import { checkUsernameAvailability, type UsernameAvailability } from '@/lib/usernameAvailability'
import { useEffect, useState } from 'react'

export const USERNAME_AVAILABILITY_DEBOUNCE_MS = 1000

export function useUsernameAvailability(
  rawUsername: string,
  options?: { enabled?: boolean; excludeUserId?: string; debounceMs?: number },
): { status: UsernameAvailability; handle: string } {
  const enabled = options?.enabled ?? true
  const debounceMs = options?.debounceMs ?? USERNAME_AVAILABILITY_DEBOUNCE_MS
  const excludeUserId = options?.excludeUserId

  const [status, setStatus] = useState<UsernameAvailability>('idle')
  const handle = normalizeUsername(rawUsername)

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }

    if (!handle) {
      setStatus('idle')
      return
    }

    if (!isValidUsername(handle)) {
      setStatus('invalid')
      return
    }

    let cancelled = false
    setStatus('checking')

    const timer = setTimeout(() => {
      void checkUsernameAvailability(handle, excludeUserId).then((result) => {
        if (!cancelled) setStatus(result.status)
      })
    }, debounceMs)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [handle, enabled, excludeUserId, debounceMs])

  return { status, handle }
}
