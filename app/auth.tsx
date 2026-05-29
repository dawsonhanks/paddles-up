import type { AuthFieldErrors } from '@/lib/auth'
import {
  sendPasswordResetEmail,
  signInWithEmail,
  signUpWithEmail,
} from '@/lib/auth'
import { hasActiveSignedInSession } from '@/lib/authSession'
import { sanitizeUsernameInput } from '@/lib/profileValidation'
import { supabase } from '@/supabase'
import { UsernameAvailabilityStatus } from '@/components/username-availability-status'
import { useUsernameAvailability } from '@/hooks/use-username-availability'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type AuthMode = 'signup' | 'login'

const BRAND = '#0F6E56'
const BRAND_DARK = '#0B3D33'

export default function AuthScreen() {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>('signup')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({})
  const [formSuccess, setFormSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resettingPassword, setResettingPassword] = useState(false)

  const usernameAvailability = useUsernameAvailability(username, { enabled: mode === 'signup' })

  const goToApp = useCallback(() => {
    router.replace('/(tabs)')
  }, [router])

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (hasActiveSignedInSession(data.session)) {
        goToApp()
      }
    })
  }, [goToApp])

  function switchMode(next: AuthMode) {
    setMode(next)
    setFieldErrors({})
    setFormSuccess(null)
  }

  async function onSubmit() {
    Keyboard.dismiss()
    setFieldErrors({})
    setFormSuccess(null)
    setSubmitting(true)
    try {
      if (mode === 'signup') {
        if (usernameAvailability.status !== 'available') {
          setFieldErrors({
            username:
              usernameAvailability.status === 'taken'
                ? 'That username is already taken.'
                : usernameAvailability.status === 'checking'
                  ? 'Still checking username availability.'
                  : 'Choose a valid, available username.',
          })
          return
        }
        const result = await signUpWithEmail({
          fullName,
          username,
          email,
          password,
          confirmPassword,
        })
        if (!result.ok) {
          setFieldErrors(result.fieldErrors)
          return
        }
        goToApp()
        return
      }

      const result = await signInWithEmail({ email, password })
      if (!result.ok) {
        setFieldErrors(result.fieldErrors)
        return
      }
      goToApp()
    } finally {
      setSubmitting(false)
    }
  }

  async function onForgotPassword() {
    Keyboard.dismiss()
    setFieldErrors({})
    setFormSuccess(null)
    setResettingPassword(true)
    try {
      const result = await sendPasswordResetEmail(email)
      if (!result.ok) {
        setFieldErrors(result.fieldErrors)
        return
      }
      setFormSuccess('If an account exists for this email, we sent password reset instructions.')
    } finally {
      setResettingPassword(false)
    }
  }

  const formError = fieldErrors.form
  const isBusy = submitting || resettingPassword

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={styles.hero}>
              <Image source={require('../assets/images/icon.png')} style={styles.logo} />
              <Text style={styles.heroTitle}>Paddles Up</Text>
              <Text style={styles.heroSubtitle}>Find courts, play more pickleball.</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.tabRow}>
                <Pressable
                  onPress={() => switchMode('signup')}
                  style={[styles.tab, mode === 'signup' && styles.tabActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === 'signup' }}>
                  <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>Sign Up</Text>
                </Pressable>
                <Pressable
                  onPress={() => switchMode('login')}
                  style={[styles.tab, mode === 'login' && styles.tabActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === 'login' }}>
                  <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>Log In</Text>
                </Pressable>
              </View>

              {formSuccess ? (
                <Text style={styles.successText}>{formSuccess}</Text>
              ) : null}
              {formError ? <Text style={styles.formError}>{formError}</Text> : null}

              {mode === 'signup' ? (
                <AuthField
                  label="Full name"
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Jane Smith"
                  autoCapitalize="words"
                  autoComplete="name"
                  error={fieldErrors.fullName}
                  editable={!isBusy}
                />
              ) : null}

              {mode === 'signup' ? (
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>Username</Text>
                  <TextInput
                    value={username}
                    onChangeText={(t) => setUsername(sanitizeUsernameInput(t))}
                    placeholder="paddles_up"
                    placeholderTextColor="#94A3B8"
                    style={[styles.input, fieldErrors.username ? styles.inputError : null]}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={20}
                    editable={!isBusy}
                  />
                  <UsernameAvailabilityStatus status={usernameAvailability.status} />
                  {fieldErrors.username ? <Text style={styles.fieldError}>{fieldErrors.username}</Text> : null}
                </View>
              ) : null}

              <AuthField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                error={fieldErrors.email}
                editable={!isBusy}
              />

              <AuthField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={mode === 'signup' ? 'new-password' : 'password'}
                error={fieldErrors.password}
                editable={!isBusy}
              />

              {mode === 'signup' ? (
                <AuthField
                  label="Confirm password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Re-enter your password"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  error={fieldErrors.confirmPassword}
                  editable={!isBusy}
                />
              ) : null}

              {mode === 'login' ? (
                <Pressable
                  onPress={() => void onForgotPassword()}
                  disabled={isBusy}
                  style={styles.forgotBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Forgot password">
                  {resettingPassword ? (
                    <ActivityIndicator size="small" color={BRAND} />
                  ) : (
                    <Text style={styles.forgotText}>Forgot password?</Text>
                  )}
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => void onSubmit()}
                disabled={isBusy}
                style={({ pressed }) => [
                  styles.submitBtn,
                  { opacity: isBusy ? 0.75 : pressed ? 0.92 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={mode === 'signup' ? 'Sign up' : 'Log in'}>
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitText}>{mode === 'signup' ? 'Create account' : 'Log in'}</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function AuthField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  autoComplete,
  editable,
}: {
  label: string
  value: string
  onChangeText: (t: string) => void
  placeholder: string
  error?: string
  secureTextEntry?: boolean
  keyboardType?: 'default' | 'email-address'
  autoCapitalize?: 'none' | 'words'
  autoComplete?: 'email' | 'password' | 'name' | 'new-password'
  editable: boolean
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        style={[styles.input, error ? styles.inputError : null]}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        editable={editable}
        autoCorrect={false}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BRAND,
  },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  hero: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 24,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 16,
    marginBottom: 14,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    marginTop: 8,
    fontSize: 16,
    color: 'rgba(255,255,255,0.88)',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748B',
  },
  tabTextActive: {
    color: BRAND_DARK,
  },
  formError: {
    color: '#B91C1C',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  successText: {
    color: BRAND,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
    fontWeight: '600',
  },
  fieldWrap: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 16,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  inputError: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  fieldError: {
    marginTop: 6,
    fontSize: 13,
    color: '#B91C1C',
    lineHeight: 18,
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginTop: -4,
    marginBottom: 16,
    minHeight: 28,
    justifyContent: 'center',
  },
  forgotText: {
    fontSize: 14,
    fontWeight: '600',
    color: BRAND,
  },
  submitBtn: {
    backgroundColor: BRAND,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: 4,
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
})
