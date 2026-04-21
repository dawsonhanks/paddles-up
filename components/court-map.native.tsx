import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Marker } from 'react-native-maps'

import { STATUS_PIN_COLOR, type Court } from '@/lib/courts'

export type CourtMapProps = {
  userLat: number
  userLon: number
  courts: Court[]
  selectedId: string | null
  onSelectCourt: (id: string) => void
}

const NEIGHBORHOOD_DELTA = 0.06

export function CourtMap({ userLat, userLon, courts, selectedId, onSelectCourt }: CourtMapProps) {
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
                { backgroundColor: STATUS_PIN_COLOR[c.status] },
                selectedId === c.id && styles.dotSelected,
              ]}
            />
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