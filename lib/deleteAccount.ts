import { supabase } from '@/supabase'

function deleteAccountFunctionUrl(): string {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
  if (!base) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL')
  }
  return `${base}/functions/v1/delete-account`
}

/**
 * Deletes all app data (RPC) and the Supabase Auth user via the `delete-account` Edge Function.
 * Deploy the function and set `SUPABASE_SERVICE_ROLE_KEY` in project secrets first.
 */
export async function invokeDeleteAccountEdge(): Promise<{ error: Error | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    return { error: new Error('You are not signed in.') }
  }

  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!anon) {
    return { error: new Error('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY') }
  }

  let res: Response
  try {
    res = await fetch(deleteAccountFunctionUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: anon,
        'Content-Type': 'application/json',
      },
    })
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)) }
  }

  const text = await res.text()
  let parsed: { error?: string } | null = null
  try {
    parsed = text ? (JSON.parse(text) as { error?: string }) : null
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    return {
      error: new Error((parsed?.error ?? text) || `Request failed (${res.status})`),
    }
  }

  return { error: null }
}
