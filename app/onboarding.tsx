import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { Dimensions, FlatList, Text, TouchableOpacity, View } from 'react-native'

const W = Dimensions.get('window').width

const SLIDES = [
  { id: '1', emoji: '🏓', title: 'Welcome to Paddles Up', subtitle: 'Find pickleball courts near you anytime, anywhere.', bg: '#0F6E56' },
  { id: '2', emoji: '📍', title: 'Live court availability', subtitle: 'See which courts are open, busy, or full before you leave home.', bg: '#085041' },
  { id: '3', emoji: '👥', title: 'Updated by the community', subtitle: 'Players tap Open, Busy, or Full so everyone else knows.', bg: '#1D9E75' },
  { id: '4', emoji: '❤️', title: 'Save your favourites', subtitle: 'Heart your regular courts for quick access whenever you need them.', bg: '#0F6E56' },
]

export default function OnboardingScreen() {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const ref = useRef<FlatList>(null)

  async function finish() {
    await AsyncStorage.setItem('onboarded', 'true')
    router.replace('/(tabs)')
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
    <View style={{ flex: 1, backgroundColor: '#0F6E56' }}>
      <FlatList
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
        renderItem={({ item }) => (
          <View style={{ width: W, flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: item.bg, paddingHorizontal: 32, paddingBottom: 180 }}>
            <Text style={{ fontSize: 80, marginBottom: 32 }}>{item.emoji}</Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: 'white', textAlign: 'center', marginBottom: 16 }}>{item.title}</Text>
            <Text style={{ fontSize: 17, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 26 }}>{item.subtitle}</Text>
          </View>
        )}
      />
      <View style={{ position: 'absolute', bottom: 60, left: 0, right: 0, alignItems: 'center', gap: 16 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {SLIDES.map((_, i) => (
            <View key={i} style={{ width: i === index ? 24 : 8, height: 8, borderRadius: 4, backgroundColor: i === index ? 'white' : 'rgba(255,255,255,0.4)' }} />
          ))}
        </View>
        <TouchableOpacity onPress={next} style={{ backgroundColor: 'white', paddingHorizontal: 48, paddingVertical: 16, borderRadius: 30 }}>
          <Text style={{ color: '#0F6E56', fontSize: 17, fontWeight: '700' }}>{index === SLIDES.length - 1 ? 'Get Started' : 'Next'}</Text>
        </TouchableOpacity>
        {index < SLIDES.length - 1 && (
          <TouchableOpacity onPress={finish}>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15 }}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}