/** @type {import('expo/config').ExpoConfig} */
const appJson = require('./app.json')

const REQUIRED_PUBLIC_ENV = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
]

const missing = REQUIRED_PUBLIC_ENV.filter((key) => !process.env[key]?.trim())
const isEasBuild = process.env.EAS_BUILD === 'true'
const buildProfile = process.env.EAS_BUILD_PROFILE ?? 'development'
const includeDevClient = buildProfile === 'development'

if (isEasBuild && missing.length > 0) {
  throw new Error(
    [
      `EAS build is missing required client environment variables: ${missing.join(', ')}.`,
      'In expo.dev → your project → Environment variables, add EXPO_PUBLIC_SUPABASE_URL and',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY to the environment for this profile (preview or production).',
      'Use "Environment variables", not server-only "Secrets" — EXPO_PUBLIC_* vars must be embedded in the app bundle.',
    ].join(' '),
  )
}

const plugins = appJson.expo.plugins.filter((plugin) => {
  const name = typeof plugin === 'string' ? plugin : plugin[0]
  if (name === 'expo-dev-client') return includeDevClient
  return true
})

module.exports = {
  expo: {
    ...appJson.expo,
    plugins,
  },
}
