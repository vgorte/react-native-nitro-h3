import type { LatLng } from 'react-native-nitro-h3'
import type { ViewExtent } from './atlas'
import { mercatorToLatLng, mercatorX, mercatorY, zoomForMetresPerPixel } from './projection'

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
  /** The fraction of the viewport it reaches past it, which its pixels are stretched over. */
  padding: number
}

/**
 * Pixels one scene image may hold, a ceiling on the encode and on what the map has to upload.
 *
 * A padded frame asks for four times the pixels its viewport does, so every phone at three times
 * its points is over this: a 402 by 874 point screen asks for 12.6 million and is drawn at 1.69
 * image pixels a point instead of three, which the map then stretches back over the screen. That
 * softness is the price of the padding, and it is what keeps a pan inside the standing raster.
 */
export const MAX_IMAGE_PIXELS = 4_000_000

/** Web Mercator metres a screen point spans where a drawn point is at its widest. */
export const POINT_CITY_M = 20

/** Web Mercator metres a screen point spans with the whole sample box in the viewport. */
export const POINT_BOX_M = 200

/** Radius a drawn point covers at {@linkcode POINT_CITY_M}, in points. */
export const POINT_RADIUS_CITY_PT = 2.5

/** Radius a drawn point covers at {@linkcode POINT_BOX_M}, in points. */
export const POINT_RADIUS_BOX_PT = 1

// MapLibre counts zoom against a 512 point tile, the projection helpers against a 256 point one
const ZOOM_OFFSET = 1

/**
 * Fraction of the viewport the image reaches past it on every side.
 *
 * A pan of half a screen therefore lands inside the raster that is already standing, so the scene
 * never ends at an edge before the settle that follows has drawn the ground it moved onto.
 */
export const FRAME_PADDING = 0.5

/** Maps Web Mercator metres relative to an anchor onto image pixels, `y` down. */
export type FrameMatrix = [scaleX: number, scaleY: number, translateX: number, translateY: number]

/**
 * Answers the image that covers a settled viewport, at the device's own pixels under a cap.
 *
 * The frame is the map's visible bounds grown by `padding`, so the raster stays correct under a
 * later pan or zoom: MapLibre warps it in Web Mercator, which is the space it was drawn in and the
 * space the padding is measured in. Past `maxPixels` the whole frame shrinks uniformly, which keeps
 * the viewport's aspect and leaves the ground alone.
 *
 * @param bounds The ground the map stands over, from the settle.
 * @param viewport The map's size in points.
 * @param pixelRatio Device pixels a point spans.
 * @param maxPixels Pixels the image may hold, above which it is drawn smaller and stretched.
 * @param padding Fraction of the viewport the frame reaches past it on every side.
 */
export function imageFrameOf(
  bounds: ViewBounds,
  viewport: { width: number; height: number },
  pixelRatio: number,
  maxPixels: number,
  padding = FRAME_PADDING,
): ImageFrame {
  // Mercator is linear in longitude, so the east and west edges are grown in degrees exactly
  const spanLng = bounds.ne[0] - bounds.sw[0]
  const northY = mercatorY(bounds.ne[1])
  const southY = mercatorY(bounds.sw[1])
  const padY = (northY - southY) * padding
  const grown = 1 + 2 * padding
  const wide = viewport.width * pixelRatio * grown
  const tall = viewport.height * pixelRatio * grown
  const pixels = wide * tall
  const shrink = pixels <= maxPixels ? 1 : Math.sqrt(maxPixels / pixels)
  return {
    west: bounds.sw[0] - spanLng * padding,
    south: mercatorToLatLng(0, southY - padY).lat,
    east: bounds.ne[0] + spanLng * padding,
    north: mercatorToLatLng(0, northY + padY).lat,
    width: Math.max(1, Math.floor(wide * shrink)),
    height: Math.max(1, Math.floor(tall * shrink)),
    padding,
  }
}

/** Answers the screen points a frame is stretched across, which is more than the viewport. */
function stretchedOver(frame: ImageFrame, viewportWidth: number): number {
  return viewportWidth * (1 + 2 * frame.padding)
}

/**
 * Answers the image pixels one screen point spans, which a mark of a fixed size is drawn at.
 *
 * A padded frame covers more ground than the viewport, so its pixels are not the device's: what a
 * point on screen is worth in the image is the frame's width over the width it is stretched across.
 *
 * @param frame The image the mark is drawn into, which carries the padding it was cut with.
 * @param viewportWidth The map's width in points.
 */
export function framePixelRatio(frame: ImageFrame, viewportWidth: number): number {
  return frame.width / stretchedOver(frame, viewportWidth)
}

/**
 * Answers the Web Mercator metres one screen point spans, which is the camera's own scale.
 *
 * It is what the frame covers over the screen points it is stretched across, so the pixel cap
 * cannot change it: two frames of the same ground answer the same metres however they were sized.
 *
 * @param frame The image the map carries.
 * @param viewportWidth The map's width in points.
 */
export function frameMetresPerPoint(frame: ImageFrame, viewportWidth: number): number {
  return (mercatorX(frame.east) - mercatorX(frame.west)) / stretchedOver(frame, viewportWidth)
}

/**
 * Answers the radius a raw point is drawn at, from the scale the map stands at.
 *
 * A speck of a fixed size reads as one point close in and paints the box solid pulled out, where a
 * screen point covers a city block; the radius therefore follows the zoom, a step of the ramp per
 * zoom step between the two scales, and holds at either end past them.
 *
 * @param metresPerPoint The camera's scale, from {@linkcode frameMetresPerPoint}.
 * @returns The radius in points, {@linkcode POINT_RADIUS_BOX_PT} to
 *   {@linkcode POINT_RADIUS_CITY_PT}.
 */
export function pointRadiusPt(metresPerPoint: number): number {
  const steps = Math.log2(POINT_BOX_M / POINT_CITY_M)
  const at = Math.log2(metresPerPoint / POINT_CITY_M) / steps
  const held = Math.min(1, Math.max(0, at))
  return POINT_RADIUS_CITY_PT + held * (POINT_RADIUS_BOX_PT - POINT_RADIUS_CITY_PT)
}

/**
 * Answers the ground a frame covers as a view extent, which a cell coverage is sized from.
 *
 * The centre is the middle of the frame in Web Mercator rather than in degrees, so it is the
 * coordinate the image's own middle pixel stands over.
 *
 * @param frame The image the cells are covered for.
 */
export function frameExtent(frame: ImageFrame): ViewExtent {
  const middle = mercatorToLatLng(0, (mercatorY(frame.north) + mercatorY(frame.south)) / 2)
  return {
    bounds: [frame.west, frame.south, frame.east, frame.north],
    center: [(frame.west + frame.east) / 2, middle.lat],
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

/** Holds the ramp a map interpolates a point's radius over: a zoom and a radius at either end. */
export type PointRadiusStops = [
  boxZoom: number,
  boxRadius: number,
  cityZoom: number,
  cityRadius: number,
]

/**
 * Answers the stops a map ramps a point's radius over, the same two scales the image draws at.
 *
 * The zooms are the map's own, one step below the ones the projection helpers count on their 256
 * point tile grid, so a point of the circle layer covers what a point of the image covers at the
 * same camera.
 */
export function pointRadiusStops(): PointRadiusStops {
  return [
    zoomForMetresPerPixel(POINT_BOX_M, 0) - ZOOM_OFFSET,
    POINT_RADIUS_BOX_PT,
    zoomForMetresPerPixel(POINT_CITY_M, 0) - ZOOM_OFFSET,
    POINT_RADIUS_CITY_PT,
  ]
}
