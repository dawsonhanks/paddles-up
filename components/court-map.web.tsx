import type { Court } from '@/lib/courts'
import { StyleSheet, Text, View } from 'react-native'

export type CourtMapProps = {
  userLat: number
  userLon: number
  /** Native only; ignored on web. */
  showUserLocation?: boolean
  courts: Court[]
  selectedId: string | null
  onSelectCourt: (id: string) => void
  /** Unused on web; kept for a shared `CourtMapProps` shape with native. */
  mapBottomPadding?: number
  onMapPress?: () => void
  onRegionChangeComplete?: (region: {
    latitude: number
    longitude: number
    latitudeDelta: number
    longitudeDelta: number
  }) => void
}

export function CourtMap(_props: CourtMapProps) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]}>
      <Text style={styles.title}>Map</Text>
      <Text style={styles.body}>Live maps with GPS and pins are available on the iOS and Android builds of this app.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#e8eef2',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    color: '#111',
  },
  body: {
    textAlign: 'center',
    color: '#444',
    maxWidth: 280,
    lineHeight: 22,
  },
})
