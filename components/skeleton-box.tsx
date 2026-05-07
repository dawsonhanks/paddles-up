import { useColorScheme } from '@/hooks/use-color-scheme'
import { useEffect, useRef, useState } from 'react'
import {
  Animated,
  DimensionValue,
  Easing,
  LayoutChangeEvent,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

export const SKELETON_LIGHT = '#E8E8E8'
export const SKELETON_DARK = '#2A2A2A'

type SkeletonBoxProps = {
  width?: DimensionValue
  height?: number | DimensionValue
  borderRadius?: number
  style?: StyleProp<ViewStyle>
}

/**
 * Rounded skeleton plate with a subtle left-to-right shimmer using native-driver translation.
 */
export function SkeletonBox({
  width = '100%',
  height = 16,
  borderRadius = 8,
  style,
}: SkeletonBoxProps) {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'
  const baseColor = isDark ? SKELETON_DARK : SKELETON_LIGHT
  const anim = useRef(new Animated.Value(0)).current
  const [layoutWidth, setLayoutWidth] = useState(0)

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1650,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => {
      loop.stop()
      anim.setValue(0)
    }
  }, [anim])

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width
    if (w > 0 && Math.abs(w - layoutWidth) > 1) setLayoutWidth(w)
  }

  const bandW = Math.max(Math.round(layoutWidth * 0.42), 72)
  const travel = layoutWidth + bandW * 2
  const translateX =
    layoutWidth > 0
      ? anim.interpolate({
          inputRange: [0, 1],
          outputRange: [-bandW, travel],
        })
      : 0

  const stripeOpacity = isDark ? 0.22 : 0.5

  return (
    <View
      style={[styles.wrap, { width, height, borderRadius, backgroundColor: baseColor }, style]}
      onLayout={onLayout}>
      {layoutWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shimmerStripe,
            {
              width: bandW,
              borderRadius,
              opacity: stripeOpacity,
              backgroundColor: '#FFFFFF',
              transform: [{ translateX }],
            },
          ]}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    position: 'relative',
  },
  shimmerStripe: {
    position: 'absolute',
    left: 0,
    top: -6,
    bottom: -6,
  },
})
