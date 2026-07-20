import {
  establishSessionFromAuthUrl,
  updatePasswordWithConfirm,
  type AuthFieldErrors,
} from '@/lib/auth'
import { MIN_PASSWORD_LENGTH } from '@/lib/authErrors'
import { supabase } from '@/supabase'
import * as Linking from 'expo-linking'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
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

const BRAND = '#0F6E56'

export default function ResetPasswordScreen() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({})
  const [ready, setReady] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const bootstrapFromUrl = useCallback(async (url: string | null) => {
    if (url) {
      const result = await establishSessionFromAuthUrl(url)
      if (result.ok) {
        setFieldErrors({})
        setReady(true)
        setBootstrapping(false)
        return
      }
    }

    // Already in a recovery session (root layout exchanged the link, or PASSWORD_RECOVERY).
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      setFieldErrors({})
      setReady(true)
      setBootstrapping(false)
      return
    }

    if (url) {
      setFieldErrors({
        form: 'This reset link is invalid or expired. Request a new password reset email.',
      })
    } else {
      setFieldErrors({
        form: 'Open the reset link from your email to continue. If you already did, request a new reset email.',
      })
    }
    setBootstrapping(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const initial = await Linking.getInitialURL()
      if (cancelled) return
      await bootstrapFromUrl(initial)
    })()

    const sub = Linking.addEventListener('url', ({ url }) => {
      void bootstrapFromUrl(url)
    })

    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true)
        setBootstrapping(false)
        setFieldErrors({})
      }
    })

    return () => {
      cancelled = true
      sub.remove()
      authSub.subscription.unsubscribe()
    }
  }, [bootstrapFromUrl])

  async function onSubmit() {
    Keyboard.dismiss()
    setFieldErrors({})
    setSubmitting(true)
    try {
      const result = await updatePasswordWithConfirm({ password, confirmPassword })
      if (!result.ok) {
        setFieldErrors(result.fieldErrors)
        return
      }
      setSuccess(true)
      setTimeout(() => {
        router.replace('/(tabs)')
      }, 1200)
    } finally {
      setSubmitting(false)
    }
  }

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
            <Text style={styles.title}>Set a new password</Text>
            <Text style={styles.sub}>
              Choose a new password for your Paddles Up account (at least {MIN_PASSWORD_LENGTH} characters).
            </Text>

            {bootstrapping ? (
              <View style={styles.centered}>
                <ActivityIndicator color="#fff" size="large" />
                <Text style={styles.bootText}>Verifying reset link…</Text>
              </View>
            ) : (
              <>
                {fieldErrors.form ? <Text style={styles.formError}>{fieldErrors.form}</Text> : null}
                {success ? (
                  <Text style={styles.success}>Password updated. Taking you to the app…</Text>
                ) : null}

                {ready && !success ? (
                  <>
                    <View style={styles.fieldWrap}>
                      <Text style={styles.fieldLabel}>New password</Text>
                      <TextInput
                        value={password}
                        onChangeText={setPassword}
                        placeholder="New password"
                        placeholderTextColor="#94A3B8"
                        secureTextEntry
                        autoComplete="new-password"
                        autoCapitalize="none"
                        editable={!submitting}
                        style={[styles.input, fieldErrors.password ? styles.inputError : null]}
                      />
                      {fieldErrors.password ? (
                        <Text style={styles.fieldError}>{fieldErrors.password}</Text>
                      ) : null}
                    </View>

                    <View style={styles.fieldWrap}>
                      <Text style={styles.fieldLabel}>Confirm password</Text>
                      <TextInput
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        placeholder="Confirm password"
                        placeholderTextColor="#94A3B8"
                        secureTextEntry
                        autoComplete="new-password"
                        autoCapitalize="none"
                        editable={!submitting}
                        style={[styles.input, fieldErrors.confirmPassword ? styles.inputError : null]}
                      />
                      {fieldErrors.confirmPassword ? (
                        <Text style={styles.fieldError}>{fieldErrors.confirmPassword}</Text>
                      ) : null}
                    </View>

                    <Pressable
                      onPress={() => void onSubmit()}
                      disabled={submitting}
                      style={({ pressed }) => [
                        styles.submitBtn,
                        { opacity: submitting || pressed ? 0.75 : 1 },
                      ]}>
                      {submitting ? (
                        <ActivityIndicator color={BRAND} />
                      ) : (
                        <Text style={styles.submitText}>Update password</Text>
                      )}
                    </Pressable>
                  </>
                ) : null}

                {!ready && !success ? (
                  <Pressable
                    onPress={() => router.replace('/auth')}
                    style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.8 : 1 }]}>
                    <Text style={styles.secondaryText}>Back to sign in</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BRAND },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 40 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 8 },
  sub: { color: 'rgba(255,255,255,0.85)', fontSize: 15, lineHeight: 22, marginBottom: 24 },
  centered: { alignItems: 'center', paddingVertical: 40, gap: 14 },
  bootText: { color: 'rgba(255,255,255,0.9)', fontSize: 15 },
  formError: {
    backgroundColor: 'rgba(226,75,74,0.2)',
    color: '#FEE2E2',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    fontSize: 14,
    lineHeight: 20,
  },
  success: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    color: '#fff',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    fontSize: 15,
    fontWeight: '600',
  },
  fieldWrap: { marginBottom: 14 },
  fieldLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: '#0F172A',
  },
  inputError: { borderWidth: 1.5, borderColor: '#E24B4A' },
  fieldError: { color: '#FECACA', fontSize: 13, marginTop: 6 },
  submitBtn: {
    marginTop: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitText: { color: BRAND, fontSize: 16, fontWeight: '800' },
  secondaryBtn: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 12,
  },
  secondaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
