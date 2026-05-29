import { ErrorBanner } from '@/components/error-banner'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { userFriendlyFromUnknown } from '@/lib/errors'
import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { Dimensions, FlatList, Image, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const W = Dimensions.get('window').width

const SLIDES = [
  {
    id: '1',
    image: require('../assets/images/icon.png'),
    title: 'Welcome to Paddles Up',
    subtitle: 'Find pickleball courts near you anytime, anywhere.',
  },
  { id: '2', emoji: '📍', title: 'Live court availability', subtitle: 'See which courts are open, busy, or full before you leave home.' },
  { id: '3', emoji: '👥', title: 'Updated by the community', subtitle: 'Players tap Open, Busy, or Full so everyone else knows.' },
  { id: '4', emoji: '❤️', title: 'Save your favorites', subtitle: 'Heart your regular courts for quick access whenever you need them.' },
]

export default function OnboardingScreen() {
  const router = useRouter()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const [index, setIndex] = useState(0)
  const [onboardingBanner, setOnboardingBanner] = useState<string | null>(null)
  const ref = useRef<FlatList>(null)
  const slideBg = isDark ? ['#0B3D33', '#07382F', '#13634A', '#0B3D33'] : ['#0F6E56', '#085041', '#1D9E75', '#0F6E56']

  async function finish() {
    try {
      await AsyncStorage.setItem('onboarded', 'true')
      router.replace('/auth')
    } catch (e) {
      setOnboardingBanner(userFriendlyFromUnknown(e))
    }
  }

  function next() {
    if (index < SLIDES.length - 1) {
      ref.current?.scrollToIndex({ index: index + 1 })
      setIndex(index + 1)
    } else {
      finish()
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: slideBg[0] }} edges={['top']}>
      {onboardingBanner ? (
        <View style={{ paddingHorizontal: 8, paddingBottom: 4 }}>
          <ErrorBanner
            variant="warning"
            message={onboardingBanner}
            onDismiss={() => setOnboardingBanner(null)}
          />
        </View>
      ) : null}
      <FlatList
        style={{ flex: 1 }}
        ref={ref}
        data={SLIDES}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        scrollEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          setIndex(Math.round(e.nativeEvent.contentOffset.x / W))
        }}
        renderItem={({ item, index: slideIndex }) => (
          <View style={{ width: W, flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: slideBg[slideIndex % slideBg.length], paddingHorizontal: 32, paddingBottom: 180 }}>
            {item.image ? (
              <Image
                source={item.image}
                style={{ width: 128, height: 128, borderRadius: 24, marginBottom: 28 }}
              />
            ) : (
              <Text style={{ fontSize: 80, marginBottom: 32 }}>{item.emoji}</Text>
            )}
            <Text style={{ fontSize: 28, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', marginBottom: 16 }}>{item.title}</Text>
            <Text style={{ fontSize: 17, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 26 }}>{item.subtitle}</Text>
          </View>
        )}
      />
      <View style={{ position: 'absolute', bottom: 60, left: 0, right: 0, alignItems: 'center', gap: 16 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {SLIDES.map((_, i) => (
            <View key={i} style={{ width: i === index ? 24 : 8, height: 8, borderRadius: 4, backgroundColor: i === index ? '#FFFFFF' : 'rgba(255,255,255,0.4)' }} />
          ))}
        </View>
        <TouchableOpacity onPress={next} style={{ backgroundColor: '#FFFFFF', paddingHorizontal: 48, paddingVertical: 16, borderRadius: 30 }}>
          <Text style={{ color: isDark ? '#0B3D33' : '#0F6E56', fontSize: 17, fontWeight: '700' }}>{index === SLIDES.length - 1 ? 'Get Started' : 'Next'}</Text>
        </TouchableOpacity>
        {index < SLIDES.length - 1 && (
          <TouchableOpacity onPress={finish}>
            <Text style={{ color: isDark ? 'rgba(236,237,238,0.78)' : 'rgba(255,255,255,0.78)', fontSize: 15 }}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}