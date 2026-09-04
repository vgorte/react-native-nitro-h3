import type { Transforms3d } from '@shopify/react-native-skia'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWindowDimensions } from 'react-native'
import { type ComposedGesture, Gesture } from 'react-native-gesture-handler'
import type { LatLng } from 'react-native-nitro-h3'
import {
  type DerivedValue,
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated'
import { type Bounds, mercatorX, mercatorY, reanchorLimitM } from '../engine/projection'
import {
  type CameraAnchor,
  fitTo,
  SETTLE_MS,
  sceneToLatLng,
  screenToScene,
  zoomForScale,
} from './camera'

export {
  type CameraAnchor,
  fitTo,
  SETTLE_MS,
  sceneToLatLng,
  screenToScene,
  zoomForScale,
} from './camera'

/** Configures {@linkcode useCamera}. */
export interface CameraOptions {
  anchor: CameraAnchor
  /** Called once the gesture has ended and no camera value changed for {@linkcode SETTLE_MS}. */
  onSettle: () => void
}

/** Holds the camera an act pans, pinches and reads its viewport from. */
export interface Camera {
  translateX: SharedValue<number>
  translateY: SharedValue<number>
  scale: SharedValue<number>
  transform: DerivedValue<Transforms3d>
  anchor: CameraAnchor
  setAnchor(next: CameraAnchor): void
  fit(bounds: Bounds, width: number, height: number): void
  zoomAt(lat: number): number
  centreOf(width: number, height: number): LatLng
  gesture: ComposedGesture
  interacting: SharedValue<boolean>
}

/**
 * Drives the shared camera: a translate and a scale that a pan and a pinch write on the UI thread.
 *
 * The transform is a Reanimated transform list rather than a matrix, so a gesture moves the scene
 * without building a Skia object inside a worklet and without a render on the JS thread.
 */
export function useCamera({ anchor, onSettle }: CameraOptions): Camera {
  const { width, height } = useWindowDimensions()
  const [currentAnchor, setCurrentAnchor] = useState(anchor)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const scale = useSharedValue(1)
  const interacting = useSharedValue(false)
  const settleAt = useSharedValue(0)
  const reanchoring = useSharedValue(false)

  const transform = useDerivedValue<Transforms3d>(() => [
    { translateX: translateX.value },
    { translateY: translateY.value },
    { scale: scale.value },
  ])

  const zoomAt = useCallback((lat: number) => zoomForScale(scale.value, lat), [scale])

  const centreOf = useCallback(
    (viewportWidth: number, viewportHeight: number) => {
      const scene = screenToScene(viewportWidth / 2, viewportHeight / 2, {
        translateX: translateX.value,
        translateY: translateY.value,
        scale: scale.value,
      })
      return sceneToLatLng(scene.x, scene.y, currentAnchor)
    },
    [translateX, translateY, scale, currentAnchor],
  )

  const setAnchor = useCallback(
    (next: CameraAnchor) => {
      // the translate absorbs the origin shift, so the view holds
      translateX.value -= (mercatorX(currentAnchor.lng) - mercatorX(next.lng)) * scale.value
      translateY.value -= (mercatorY(next.lat) - mercatorY(currentAnchor.lat)) * scale.value
      setCurrentAnchor(next)
    },
    [translateX, translateY, scale, currentAnchor],
  )

  const fit = useCallback(
    (bounds: Bounds, viewportWidth: number, viewportHeight: number) => {
      const fitted = fitTo(bounds, viewportWidth, viewportHeight)
      scale.value = fitted.scale
      translateX.value = fitted.translateX
      translateY.value = fitted.translateY
    },
    [translateX, translateY, scale],
  )

  const settleRef = useRef(onSettle)
  useEffect(() => {
    settleRef.current = onSettle
  }, [onSettle])

  const settle = useCallback(() => {
    const centre = centreOf(width, height)
    const drift = Math.hypot(
      mercatorX(centre.lng) - mercatorX(currentAnchor.lng),
      mercatorY(centre.lat) - mercatorY(currentAnchor.lat),
    )
    // `Float32` scene positions lose precision once the view drifts far
    if (drift > reanchorLimitM(zoomAt(centre.lat), centre.lat)) {
      reanchoring.value = true
      setAnchor(centre)
    }
    settleRef.current()
  }, [centreOf, setAnchor, zoomAt, reanchoring, currentAnchor, width, height])

  // the settle fires `SETTLE_MS` after the last camera change
  useAnimatedReaction(
    () => [translateX.value, translateY.value, scale.value, interacting.value] as const,
    () => {
      settleAt.value = Date.now() + SETTLE_MS
    },
  )
  useFrameCallback(
    useCallback(() => {
      'worklet'
      if (settleAt.value === 0 || interacting.value || Date.now() < settleAt.value) return
      settleAt.value = 0
      // a re-anchor writes the camera itself, and that echo is not a settle
      if (reanchoring.value) {
        reanchoring.value = false
        return
      }
      runOnJS(settle)()
    }, [settleAt, interacting, reanchoring, settle]),
  )

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .onBegin(() => {
        'worklet'
        interacting.value = true
      })
      .onChange((event) => {
        'worklet'
        translateX.value += event.changeX
        translateY.value += event.changeY
      })
      .onFinalize(() => {
        'worklet'
        interacting.value = false
      })
    const pinch = Gesture.Pinch()
      .onBegin(() => {
        'worklet'
        interacting.value = true
      })
      .onChange((event) => {
        'worklet'
        const next = scale.value * event.scaleChange
        const factor = next / scale.value
        translateX.value = event.focalX - (event.focalX - translateX.value) * factor
        translateY.value = event.focalY - (event.focalY - translateY.value) * factor
        scale.value = next
      })
      .onFinalize(() => {
        'worklet'
        interacting.value = false
      })
    return Gesture.Simultaneous(pan, pinch)
  }, [translateX, translateY, scale, interacting])

  return {
    translateX,
    translateY,
    scale,
    transform,
    anchor: currentAnchor,
    setAnchor,
    fit,
    zoomAt,
    centreOf,
    gesture,
    interacting,
  }
}
