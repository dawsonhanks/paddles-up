import { memo, useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import MapView from 'react-native-map-clustering'
console.log('MapView source:', MapView.displayName ?? MapView.name ?? 'unknown')
import { Marker } from 'react-native-maps'
import Svg, { Circle, Path } from 'react-native-svg'

import { STATUS_PIN_COLOR, type Court } from '@/lib/courts'

export type CourtMapProps = {
  userLat: number
  userLon: number
  /** When false, hides the OS “you are here” dot (e.g. location permission denied). */
  showUserLocation?: boolean
  courts: Court[]
  selectedId: string | null
  /** Pin diameter in px; scales with map zoom from the map screen. */
  markerPinSize?: number
  onSelectCourt: (id: string) => void
  /** Bottom `mapPadding` so pins / camera clear overlays; also shifts Apple/Google legal toward the bottom edge. */
  mapBottomPadding: number
  onMapPress?: () => void
  /** Pin ids that should fade in (debounced viewport reveal); initial pins omit this. */
  fadeInCourtIds?: ReadonlySet<string>
  onRegionChange?: (region: {
    latitude: number
    longitude: number
    latitudeDelta: number
    longitudeDelta: number
  }) => void
  onRegionChangeComplete?: (region: {
    latitude: number
    longitude: number
    latitudeDelta: number
    longitudeDelta: number
  }) => void
}

const NEIGHBORHOOD_DELTA = 0.06
const MARKER_FADE_MS = 420

function PickleballFace({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
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

const DEFAULT_MARKER_PIN_SIZE = 16

const CourtMarker = memo(function CourtMarker({
  court,
  selected,
  pinSize,
  hitSize,
  borderWidth,
  tracksViewChanges,
  fadeIn,
  onSelectCourt,
}: {
  court: Court
  selected: boolean
  pinSize: number
  hitSize: number
  borderWidth: number
  tracksViewChanges: boolean
  fadeIn: boolean
  onSelectCourt: (id: string) => void
}) {
  const opacity = useRef(new Animated.Value(fadeIn ? 0 : 1)).current

  useEffect(() => {
    if (!fadeIn) return
    Animated.timing(opacity, {
      toValue: 1,
      duration: MARKER_FADE_MS,
      useNativeDriver: true,
    }).start()
  }, [fadeIn, opacity])

  return (
    <Marker
      coordinate={{ latitude: court.latitude, longitude: court.longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      centerOffset={{ x: 0, y: 0 }}
      onPress={() => onSelectCourt(court.id)}
      tracksViewChanges={tracksViewChanges || selected}>
      <Animated.View
        collapsable={false}
        style={[styles.markerHit, { width: hitSize, height: hitSize, opacity }]}>
        <View
          style={[
            styles.dot,
            {
              width: pinSize,
              height: pinSize,
              borderRadius: pinSize / 2,
              borderWidth,
            },
            selected && styles.dotSelected,
          ]}>
          <PickleballFace color={STATUS_PIN_COLOR[court.status]} size={pinSize} />
        </View>
      </Animated.View>
    </Marker>
  )
})

export function CourtMap({
  userLat,
  userLon,
  courts,
  selectedId,
  markerPinSize = DEFAULT_MARKER_PIN_SIZE,
  onSelectCourt,
  mapBottomPadding,
  onMapPress,
  fadeInCourtIds,
  onRegionChange,
  onRegionChangeComplete,
  showUserLocation = true,
}: CourtMapProps) {
  const mapRef = useRef<MapView>(null)
  const initialZoomDone = useRef(false)
  const pinSize = Math.max(1, markerPinSize)
  const hitSize = pinSize * 2.25
  const borderWidth = Math.max(2, Math.round(pinSize * 0.125))
  const [tracksMarkerViews, setTracksMarkerViews] = useState(true)

  useEffect(() => {
    console.log('MapView component mounted:', MapView)
  }, [])

  useEffect(() => {
    setTracksMarkerViews(true)
    const frame = requestAnimationFrame(() => setTracksMarkerViews(false))
    return () => cancelAnimationFrame(frame)
  }, [pinSize])

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
      400,
    )
  }, [userLat, userLon])

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      mapPadding={{ top: 0, right: 0, bottom: mapBottomPadding, left: 0 }}
      initialRegion={{
        latitude: userLat,
        longitude: userLon,
        latitudeDelta: NEIGHBORHOOD_DELTA,
        longitudeDelta: NEIGHBORHOOD_DELTA,
      }}
      onRegionChange={onRegionChange}
      onRegionChangeComplete={onRegionChangeComplete}
      onPress={onMapPress}
      onPanDrag={onMapPress}
      showsUserLocation={showUserLocation}
      showsMyLocationButton={false}
      clusterColor="#1D9E75"
      clusterTextColor="#FFFFFF"
      radius={60}>
      {courts.map((c) => (
        <CourtMarker
          key={c.id}
          court={c}
          selected={selectedId === c.id}
          pinSize={pinSize}
          hitSize={hitSize}
          borderWidth={borderWidth}
          tracksViewChanges={tracksMarkerViews || selectedId === c.id}
          fadeIn={fadeInCourtIds?.has(c.id) ?? false}
          onSelectCourt={onSelectCourt}
        />
      ))}
    </MapView>
  )
}

const styles = StyleSheet.create({
  markerHit: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    overflow: 'hidden',
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
