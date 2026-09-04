import type { LatLng } from 'react-native-nitro-h3'
import {
  type Bounds,
  DEG_TO_RAD,
  mercatorToLatLng,
  mercatorX,
  mercatorY,
  zoomForMetresPerPixel,
} from '../engine/projection'

/** Milliseconds of stillness after a gesture before the scene counts as settled. */
export const SETTLE_MS = 120

// the fitted scene keeps a tenth of the viewport free
const FIT_MARGIN = 0.9

/** Holds the coordinate the scene's metre space is measured from. */
export interface CameraAnchor {
  lat: number
  lng: number
}

/** Answers the scene position under a screen point. */
export function screenToScene(
  x: number,
  y: number,
  camera: { translateX: number; translateY: number; scale: number },
): { x: number; y: number } {
  'worklet'
  return { x: (x - camera.translateX) / camera.scale, y: (y - camera.translateY) / camera.scale }
}

/** Answers the coordinate at a scene position, measured from `anchor`. */
export function sceneToLatLng(x: number, y: number, anchor: CameraAnchor): LatLng {
  'worklet'
  return mercatorToLatLng(mercatorX(anchor.lng) + x, mercatorY(anchor.lat) - y)
}

/**
 * Answers the zoom a pixel scale stands for at a latitude.
 *
 * The scene unit is one Web Mercator metre, and one ground metre at `lat` spans `cos(lat)` of it.
 */
export function zoomForScale(scale: number, lat: number): number {
  'worklet'
  return zoomForMetresPerPixel(Math.cos(lat * DEG_TO_RAD) / scale, lat)
}

/** Answers the camera values that centre `bounds` in a viewport. */
export function fitTo(
  bounds: Bounds,
  width: number,
  height: number,
): { scale: number; translateX: number; translateY: number } {
  const scale =
    Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxY - bounds.minY)) * FIT_MARGIN
  return {
    scale,
    translateX: width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    translateY: height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  }
}
