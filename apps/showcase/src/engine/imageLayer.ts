import type { LatLng } from 'react-native-nitro-h3'
import { mercatorX, mercatorY } from './projection'

/** Holds the ground a settle left the map standing over, in the order MapLibre answers it. */
export interface ViewBounds {
  /** Longitude and latitude of the north-east corner. */
  ne: [number, number]
  /** Longitude and latitude of the south-west corner. */
  sw: [number, number]
}

/** Holds the image the map carries: the ground it covers and how many pixels it is drawn at. */
export interface ImageFrame {
  west: number
  south: number
  east: number
  north: number
  width: number
  height: number
}

/**
 * Pixels one scene image may hold, which a phone at three times its points stays under.
 *
 * The cap is a ceiling on the encode and on what the map has to upload, not a target: a frame that
 * fits under it is drawn at the device's own pixels and never stretched.
 */
export const MAX_IMAGE_PIXELS = 4_000_000

/** Maps Web Mercator metres relative to an anchor onto image pixels, `y` down. */
export type FrameMatrix = [scaleX: number, scaleY: number, translateX: number, translateY: number]

/**
 * Answers the image that covers a settled viewport, at the device's own pixels under a cap.
 *
 * The frame is the map's visible bounds, so the raster stays correct under a later pan or zoom:
 * MapLibre warps it in Web Mercator, which is the space it was drawn in. Past `maxPixels` the
 * whole frame shrinks uniformly, which keeps the viewport's aspect and leaves the ground alone.
 *
 * @param bounds The ground the map stands over, from the settle.
 * @param viewport The map's size in points.
 * @param pixelRatio Device pixels a point spans.
 * @param maxPixels Pixels the image may hold, above which it is drawn smaller and stretched.
 */
export function imageFrameOf(
  bounds: ViewBounds,
  viewport: { width: number; height: number },
  pixelRatio: number,
  maxPixels: number,
): ImageFrame {
  const wide = viewport.width * pixelRatio
  const tall = viewport.height * pixelRatio
  const pixels = wide * tall
  const shrink = pixels <= maxPixels ? 1 : Math.sqrt(maxPixels / pixels)
  return {
    west: bounds.sw[0],
    south: bounds.sw[1],
    east: bounds.ne[0],
    north: bounds.ne[1],
    width: Math.max(1, Math.floor(wide * shrink)),
    height: Math.max(1, Math.floor(tall * shrink)),
  }
}

/**
 * Answers the matrix a scene is drawn under so it lands on the ground the frame covers.
 *
 * The scene stands in Web Mercator metres measured from `anchor`, `y` already downward, which is
 * the space `projectCells` leaves; the matrix is the scale and offset onto image pixels.
 *
 * @param frame The image the scene is drawn into.
 * @param anchor The coordinate the scene's metre space is measured from.
 */
export function frameMatrix(frame: ImageFrame, anchor: LatLng): FrameMatrix {
  const west = mercatorX(frame.west)
  const north = mercatorY(frame.north)
  const scaleX = frame.width / (mercatorX(frame.east) - west)
  const scaleY = frame.height / (north - mercatorY(frame.south))
  return [
    scaleX,
    scaleY,
    scaleX * (mercatorX(anchor.lng) - west),
    scaleY * (north - mercatorY(anchor.lat)),
  ]
}

/** Answers the four corners of a frame as `ImageSource` takes them, clockwise from the top left. */
export function cornersOf(
  frame: ImageFrame,
): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [frame.west, frame.north],
    [frame.east, frame.north],
    [frame.east, frame.south],
    [frame.west, frame.south],
  ]
}

/**
 * Projects coordinates onto a frame's pixels, keeping the ones that land inside it.
 *
 * The kept points are packed from the front of `out`, so a caller draws the answered count and
 * never reads a slot a dropped point left behind.
 *
 * @param points Coordinates in degrees, latitude first, as the point stream draws them.
 * @param frame The image the points are drawn into.
 * @param out Receives an `x, y` pair per kept point; it needs two slots per point of `points`.
 * @returns How many points landed inside the frame.
 */
export function projectPoints(points: Float64Array, frame: ImageFrame, out: Float32Array): number {
  const west = mercatorX(frame.west)
  const north = mercatorY(frame.north)
  const scaleX = frame.width / (mercatorX(frame.east) - west)
  const scaleY = frame.height / (north - mercatorY(frame.south))
  let kept = 0

  for (let point = 0; point < points.length; point += 2) {
    const lat = points[point]
    const lng = points[point + 1]
    if (lat < frame.south || lat > frame.north || lng < frame.west || lng > frame.east) continue
    out[kept * 2] = (mercatorX(lng) - west) * scaleX
    out[kept * 2 + 1] = (north - mercatorY(lat)) * scaleY
    kept += 1
  }
  return kept
}

/** Answers how many points to step over between two drawn ones, so `maxDrawn` is never passed. */
export function sampleStride(count: number, maxDrawn: number): number {
  return Math.max(1, Math.ceil(count / maxDrawn))
}
