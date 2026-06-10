import { useColorScheme } from '@/hooks/use-color-scheme'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router, type Href } from 'expo-router'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export const TOUR_COMPLETED_STORAGE_KEY = 'tour_completed'

const BRAND_GREEN = '#1D9E75'
const CARD_RADIUS = 22
/** Let the destination tab render before the step overlay appears. */
const TAB_NAV_DELAY_MS = 350

type GuidedTourStep = {
  id: string
  text: string
  tabHref: Href
  emoji?: string
  image?: number
}

/** Same copy and order as the previous Copilot tour (steps 1–6). */
export const GUIDED_TOUR_STEPS: readonly GuidedTourStep[] = [
  {
    id: 'tour-map',
    emoji: '🗺️',
    tabHref: '/(tabs)',
    text: 'Welcome to Paddles Up! This is your local court map — pin colors reflect recent availability reports from players at each venue (gray when none)',
  },
  {
    id: 'tour-courts-list',
    emoji: '📍',
    tabHref: '/(tabs)',
    text: 'Nearby courts are listed here sorted by distance — tap any court to see details',
  },
  {
    id: 'tour-search-bar',
    emoji: '🔍',
    tabHref: '/(tabs)',
    text: 'Search for any court by name',
  },
  {
    id: 'tour-play-tab',
    image: require('../assets/images/icon.png'),
    tabHref: '/(tabs)/play',
    text: 'Looking for a game? Post here and connect with players near you',
  },
  {
    id: 'tour-record-tab',
    emoji: '🏆',
    tabHref: '/(tabs)/record',
    text: 'Track your wins and losses against friends here',
  },
  {
    id: 'tour-profile-tab',
    emoji: '👤',
    tabHref: '/(tabs)/settings',
    text: 'Set up your profile and find friends here',
  },
] as const

type GuidedTourContextValue = {
  startTour: () => void
}

const GuidedTourContext = createContext<GuidedTourContextValue | null>(null)

export function useGuidedTour() {
  const ctx = useContext(GuidedTourContext)
  if (!ctx) throw new Error('useGuidedTour must be used within GuidedTourProvider')
  return ctx
}

function splitTourText(text: string): { title: string; subtitle: string | null } {
  const parts = text.split(/\s—\s/)
  if (parts.length >= 2) {
    return {
      title: parts[0].trim(),
      subtitle: parts.slice(1).join(' — ').trim(),
    }
  }
  return { title: text.trim(), subtitle: null }
}

export function GuidedTourProvider({ children }: { children: ReactNode }) {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const insets = useSafeAreaInsets()
  const [visible, setVisible] = useState(false)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  const fade = useRef(new Animated.Value(1)).current
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const totalSteps = GUIDED_TOUR_STEPS.length
  const step = GUIDED_TOUR_STEPS[stepIndex]
  const isLastStep = stepIndex >= totalSteps - 1

  const clearNavTimer = useCallback(() => {
    if (navTimerRef.current != null) {
      clearTimeout(navTimerRef.current)
      navTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!visible) {
      setOverlayVisible(false)
      return
    }

    const targetHref = GUIDED_TOUR_STEPS[stepIndex]?.tabHref ?? '/(tabs)'
    setOverlayVisible(false)
    fade.setValue(0)
    router.replace(targetHref)

    clearNavTimer()
    navTimerRef.current = setTimeout(() => {
      navTimerRef.current = null
      setOverlayVisible(true)
      Animated.timing(fade, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
    }, TAB_NAV_DELAY_MS)

    return clearNavTimer
  }, [visible, stepIndex, fade, clearNavTimer])

  const finishTour = useCallback(async () => {
    clearNavTimer()
    setOverlayVisible(false)
    setVisible(false)
    setStepIndex(0)
    fade.setValue(1)
    await AsyncStorage.setItem(TOUR_COMPLETED_STORAGE_KEY, 'true')
  }, [clearNavTimer, fade])

  const startTour = useCallback(() => {
    setStepIndex(0)
    setVisible(true)
  }, [])

  const nextStep = useCallback(() => {
    if (isLastStep) void finishTour()
    else setStepIndex((i) => i + 1)
  }, [isLastStep, finishTour])

  const skipTour = useCallback(() => {
    void finishTour()
  }, [finishTour])

  const value = useMemo(() => ({ startTour }), [startTour])

  const cardBg = isDark ? '#161618' : '#FFFFFF'
  const titleColor = isDark ? '#ECEDEE' : '#11181C'
  const mutedColor = isDark ? 'rgba(236,237,238,0.72)' : '#687076'
  const skipColor = isDark ? 'rgba(236,237,238,0.55)' : '#687076'
  const dotInactive = isDark ? 'rgba(236,237,238,0.35)' : 'rgba(17,24,28,0.22)'
  const maxCardH = Dimensions.get('window').height - (insets.top + insets.bottom + 48)

  const { title, subtitle } = splitTourText(step?.text ?? '')

  return (
    <GuidedTourContext.Provider value={value}>
      {children}
      <Modal visible={visible && overlayVisible} animationType="fade" transparent statusBarTranslucent>
        <View style={[styles.modalRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <Animated.View style={[styles.cardOuter, { opacity: fade, maxHeight: maxCardH }]}>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: cardBg,
                  ...(Platform.OS === 'ios'
                    ? {
                        shadowColor: '#000',
                        shadowOpacity: isDark ? 0.45 : 0.14,
                        shadowRadius: 24,
                        shadowOffset: { width: 0, height: 10 },
                      }
                    : { elevation: 12 }),
                },
              ]}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                bounces={false}
                contentContainerStyle={styles.cardInner}>
                {step?.image ? (
                  <Image source={step.image} style={styles.tourLogo} />
                ) : (
                  <Text style={styles.emoji}>{step?.emoji}</Text>
                )}
                <Text style={[styles.title, { color: titleColor }]}>{title}</Text>
                {subtitle ? (
                  <Text style={[styles.subtitle, { color: mutedColor }]}>{subtitle}</Text>
                ) : null}
                <View style={styles.dots}>
                  {GUIDED_TOUR_STEPS.map((_, i) => {
                    const n = i + 1
                    const active = n === stepIndex + 1
                    return (
                      <View
                        key={GUIDED_TOUR_STEPS[i].id}
                        style={[
                          styles.dot,
                          {
                            width: active ? 22 : 7,
                            backgroundColor: active ? BRAND_GREEN : dotInactive,
                          },
                        ]}
                      />
                    )
                  })}
                </View>
                <Pressable
                  onPress={nextStep}
                  style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.92 : 1 }]}>
                  <Text style={styles.primaryBtnText}>
                    {isLastStep ? "Let's play!" : 'Next'}
                  </Text>
                </Pressable>
                {!isLastStep ? (
                  <Pressable onPress={skipTour} hitSlop={12}>
                    <Text style={[styles.skip, { color: skipColor }]}>Skip</Text>
                  </Pressable>
                ) : (
                  <View style={styles.skipSpacer} />
                )}
              </ScrollView>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </GuidedTourContext.Provider>
  )
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  cardOuter: {
    width: '100%',
    maxWidth: 400,
  },
  card: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  cardInner: {
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: 'center',
  },
  emoji: {
    fontSize: 80,
    marginBottom: 20,
    lineHeight: Platform.OS === 'android' ? 88 : undefined,
  },
  tourLogo: {
    width: 86,
    height: 86,
    borderRadius: 20,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 17,
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: 24,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 22,
  },
  dot: {
    height: 7,
    borderRadius: 4,
  },
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 30,
    alignSelf: 'center',
  },
  primaryBtnText: {
    color: BRAND_GREEN,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  skip: {
    marginTop: 14,
    fontSize: 15,
    textAlign: 'center',
  },
  skipSpacer: {
    height: 29,
  },
})
