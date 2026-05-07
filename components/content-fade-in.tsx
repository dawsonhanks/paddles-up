import { type ReactNode, useEffect, useRef } from 'react'
import { Animated, type StyleProp, type ViewStyle } from 'react-native'

type ContentFadeInProps = {
  /** When true, fades opacity from 0 → 1 (each transition resets). */
  show: boolean
  children: ReactNode
  style?: StyleProp<ViewStyle>
  durationMs?: number
}

export function ContentFadeIn({ show, children, style, durationMs = 300 }: ContentFadeInProps) {
  const opacity = useRef(new Animated.Value(show ? 1 : 0)).current

  useEffect(() => {
    if (show) {
      opacity.setValue(0)
      Animated.timing(opacity, {
        toValue: 1,
        duration: durationMs,
        useNativeDriver: true,
      }).start()
    } else {
      opacity.setValue(0)
    }
  }, [show, opacity, durationMs])

  return (
    <Animated.View style={[{ opacity }, style]} needsOffscreenAlphaCompositing={false}>
      {children}
    </Animated.View>
  )
}
