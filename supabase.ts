import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js'
import { Platform } from 'react-native'
import 'react-native-url-polyfill/auto'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? ''
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ''

/** False when EAS build did not embed EXPO_PUBLIC_* Supabase vars (common launch-crash cause). */
export const isSupabaseConfigured = SUPABASE_URL.length > 0 && SUPABASE_KEY.length > 0

export const supabaseConfigMessage = isSupabaseConfigured
  ? null
  : 'This build is missing Supabase configuration. Rebuild with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY set in EAS Environment Variables (preview/production environment).'

const noopStorage: SupportedStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}

const webStorage: SupportedStorage = {
  getItem: (key) => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(key)
  },
  setItem: (key, value) => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, value)
  },
  removeItem: (key) => {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(key)
  },
}

function getAuthStorage(): SupportedStorage {
  if (Platform.OS !== 'web') return AsyncStorage
  return typeof window === 'undefined' ? noopStorage : webStorage
}

function createSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    // Placeholder client so imports never throw; app shows a config screen instead.
    return createClient('https://invalid.local', 'invalid-key', {
      auth: {
        storage: getAuthStorage(),
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  }

  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      storage: getAuthStorage(),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
}

export const supabase = createSupabaseClient()
