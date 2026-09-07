import { Canvas, Circle, Fill, Group, RadialGradient, vec } from '@shopify/react-native-skia'
import { type ReactNode, useMemo } from 'react'
import { StyleSheet, useWindowDimensions } from 'react-native'
import { type ComposedGesture, Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS } from 'react-native-reanimated'
import { colours } from '../theme/tokens'
import { BlockedReadout } from './BlockedReadout'
import type { Camera } from './useCamera'

/** Configures {@linkcode EngineCanvas}. */
export interface EngineCanvasProps {
  camera: Camera
  children?: ReactNode
  /** Replaces the camera's pan and pinch, for an act that drives its own view. */
  gesture?: ComposedGesture
  /** Drawn above the camera group in screen coordinates, for geometry the camera does not move. */
  overlay?: ReactNode
  /** Called with the screen point of a tap, outside any pan or pinch. */
  onTap?: (x: number, y: number) => void
  vignette?: boolean
}

// the vignette reaches past the corners, hiding its falloff
const VIGNETTE_REACH = 0.7

/**
 * Draws the one canvas every act shares: the ground below, the act's layers inside the camera
 * group, the readout above.
 */
export function EngineCanvas({
  camera,
  children,
  gesture,
  overlay,
  onTap,
  vignette = true,
}: EngineCanvasProps) {
  const { width, height } = useWindowDimensions()
  const tap = useMemo(
    () =>
      Gesture.Tap().onEnd((event) => {
        'worklet'
        if (onTap !== undefined) runOnJS(onTap)(event.x, event.y)
      }),
    [onTap],
  )
  // a simultaneous tap also fires on pinch end
  const composed = useMemo(
    () => Gesture.Exclusive(gesture ?? camera.gesture, tap),
    [gesture, camera.gesture, tap],
  )
  const radius = Math.max(width, height) * VIGNETTE_REACH

  return (
    <>
      <GestureDetector gesture={composed}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color={colours.ground} />
          {vignette ? (
            <Circle cx={width / 2} cy={height / 2} r={radius}>
              <RadialGradient
                c={vec(width / 2, height / 2)}
                r={radius}
                colors={[colours.vignette, colours.ground]}
              />
            </Circle>
          ) : null}
          <Group transform={camera.transform}>{children}</Group>
          {overlay}
        </Canvas>
      </GestureDetector>
      {/* its own surface, so a readout frame does not replay the act's canvas */}
      <BlockedReadout />
    </>
  )
}
