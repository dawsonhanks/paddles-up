import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import Svg, { Circle, Path } from 'react-native-svg'

import { checkinCountToPinHex } from '@/lib/checkins'
import { STATUS_PIN_COLOR, type Court } from '@/lib/courts'

export type CourtMapProps = {
  userLat: number
  userLon: number
  courts: Court[]
  selectedId: string | null
  onSelectCourt: (id: string) => void
  onRegionChangeComplete?: (region: {
    latitude: number
    longitude: number
    latitudeDelta: number
    longitudeDelta: number
  }) => void
}

const NEIGHBORHOOD_DELTA = 0.06

function PickleballFace({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16">
      <Circle cx={8} cy={8} r={8} fill={color} />
      <Path d="M3.2 4.8c1.2-1.5 2.9-2.4 4.8-2.5" stroke="rgba(255,255,255,0.25)" strokeWidth={0.9} fill="none" />
      <Path d="M12.8 4.8c-1.2-1.5-2.9-2.4-4.8-2.5" stroke="rgba(255,255,255,0.25)" strokeWidth={0.9} fill="none" />
      <Path d="M8 12.8c-2-0.1-3.7-1-4.8-2.5" stroke="rgba(0,0,0,0.14)" strokeWidth={0.9} fill="none" />
      <Circle cx={5.2} cy={4.5} r={1.02} fill="rgba(0,0,0,0.35)" />
      <Circle cx={10.8} cy={4.5} r={1.02} fill="rgba(0,0,0,0.35)" />
      <Circle cx={8} cy={7.1} r={0.98} fill="rgba(0,0,0,0.35)" />
      <Circle cx={5.2} cy={9.8} r={1.02} fill="rgba(0,0,0,0.35)" />
      <Circle cx={10.8} cy={9.8} r={1.02} fill="rgba(0,0,0,0.35)" />
      <Circle cx={8} cy={12.3} r={0.85} fill="rgba(0,0,0,0.32)" />
    </Svg>
  )
}

export function CourtMap({ userLat, userLon, courts, selectedId, onSelectCourt, onRegionChangeComplete }: CourtMapProps) {
  const mapRef = useRef<MapView>(null)
  const initialZoomDone = useRef(false)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (initialZoomDone.current) return
    initialZoomDone.current = true

    map.animateToRegion(
      {
        latitude: userLat,
        longitude: userLon,
        latitudeDelta: NEIGHBORHOOD_DELTA,
        longitudeDelta: NEIGHBORHOOD_DELTA,
      },
      400
    )
  }, [userLat, userLon])

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={{
        latitude: userLat,
        longitude: userLon,
        latitudeDelta: NEIGHBORHOOD_DELTA,
        longitudeDelta: NEIGHBORHOOD_DELTA,
      }}
      onRegionChangeComplete={onRegionChangeComplete}
      showsUserLocation
      showsMyLocationButton={false}>
      {courts.map((c) => (
        <Marker
          key={c.id}
          coordinate={{ latitude: c.latitude, longitude: c.longitude }}
          anchor={{ x: 0.5, y: 0.5 }}
          centerOffset={{ x: 0, y: 0 }}
          onPress={() => onSelectCourt(c.id)}
          tracksViewChanges={selectedId === c.id}>
          <View collapsable={false} style={styles.markerHit}>
            <View
              style={[
                styles.dot,
                selectedId === c.id && styles.dotSelected,
              ]}>
              <PickleballFace
                color={
                  typeof c.liveCheckins === 'number'
                    ? checkinCountToPinHex(c.liveCheckins)
                    : STATUS_PIN_COLOR[c.status]
                }
              />
            </View>
          </View>
        </Marker>
      ))}
    </MapView>
  )
}

const styles = StyleSheet.create({
  markerHit: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  dotSelected: {
    transform: [{ scale: 1.2 }],
    borderWidth: 3,
  },
})