import type { CellBoundaries, LatLng } from 'react-native-nitro-h3'

export const EARTH_RADIUS_M = 6378137
export const DEG_TO_RAD = Math.PI / 180
export const RAD_TO_DEG = 180 / Math.PI

/** Holds the axis-aligned extent of a projected cell set, in metres. */
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Holds a cell set projected to Web Mercator metres relative to a centre coordinate.
 *
 * The layout mirrors {@linkcode CellBoundaries}: cell `i` occupies `stride` slots of `points`
 * from `i * stride`, of which the first `vertexCounts[i]` `[x, y]` pairs are its vertices.
 */
export interface ProjectedCells {
  stride: number
  points: Float32Array
  vertexCounts: Uint8Array
  cellCount: number
  bounds: Bounds
}

/** Holds a point on the unit sphere, `x` toward `[0, 0]`, `y` toward `[0, 90]`, `z` toward the pole. */
export interface Xyz {
  x: number
  y: number
  z: number
}

/**
 * Holds the view of the globe: the coordinate at the centre of the disk in radians, and the disk
 * itself in screen pixels.
 */
export interface GlobeView {
  /** Longitude at the centre of the disk, in radians. */
  lambda0: number
  /** Latitude at the centre of the disk, in radians. */
  phi0: number
  cx: number
  cy: number
  radius: number
}

/** Holds a projected point: the screen position and the depth toward the viewer. */
export interface ProjectedPoint {
  x: number
  y: number
  /** The cosine of the angle from the view centre, positive on the half facing the viewer. */
  depth: number
  visible: boolean
}

/** Answers the Web Mercator x of a longitude, in metres. */
export function mercatorX(lng: number): number {
  'worklet'
  return EARTH_RADIUS_M * lng * DEG_TO_RAD
}

/** Answers the Web Mercator y of a latitude, in metres, growing northward. */
export function mercatorY(lat: number): number {
  'worklet'
  return EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (lat * DEG_TO_RAD) / 2))
}

/**
 * Projects a cell set to Web Mercator metres relative to `centre`.
 *
 * The y axis is negated so it grows downward like the screen axis, which leaves the camera a
 * plain scale and translate.
 *
 * @param boundaries The boundaries as `cellsToBoundaries` answers them.
 * @param centre The coordinate that becomes the origin of the metre space.
 */
export function projectCells(boundaries: CellBoundaries, centre: LatLng): ProjectedCells {
  const { stride, vertices, vertexCounts } = boundaries
  const cellCount = vertexCounts.length
  const points = new Float32Array(cellCount * stride)
  const centreX = EARTH_RADIUS_M * centre.lng * DEG_TO_RAD
  const centreY = mercatorY(centre.lat)

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let cell = 0; cell < cellCount; cell++) {
    const base = cell * stride
    const count = vertexCounts[cell]
    for (let vertex = 0; vertex < count; vertex++) {
      const slot = base + vertex * 2
      const x = EARTH_RADIUS_M * vertices[slot + 1] * DEG_TO_RAD - centreX
      const y = centreY - mercatorY(vertices[slot])
      points[slot] = x
      points[slot + 1] = y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  return { stride, points, vertexCounts, cellCount, bounds: { minX, minY, maxX, maxY } }
}

/** Converts a coordinate in degrees to a point on the unit sphere. */
export function latLngToXyz(lat: number, lng: number): Xyz {
  'worklet'
  const phi = lat * DEG_TO_RAD
  const lambda = lng * DEG_TO_RAD
  const cosPhi = Math.cos(phi)
  return { x: cosPhi * Math.cos(lambda), y: cosPhi * Math.sin(lambda), z: Math.sin(phi) }
}

/**
 * Rotates a point on the unit sphere into view space.
 *
 * The longitude turn comes first, about the polar axis, then the latitude tilt. The result is
 * oriented like the screen: `x` to the right, `y` up, `z` toward the viewer.
 */
export function rotateToView(point: Xyz, view: GlobeView): Xyz {
  'worklet'
  const sinLambda = Math.sin(view.lambda0)
  const cosLambda = Math.cos(view.lambda0)
  const sinPhi = Math.sin(view.phi0)
  const cosPhi = Math.cos(view.phi0)
  const turnedX = point.x * cosLambda + point.y * sinLambda
  return {
    x: point.y * cosLambda - point.x * sinLambda,
    y: cosPhi * point.z - sinPhi * turnedX,
    z: sinPhi * point.z + cosPhi * turnedX,
  }
}

/** Projects a coordinate in degrees onto the orthographic disk of `view`. */
export function project(lat: number, lng: number, view: GlobeView): ProjectedPoint {
  'worklet'
  const rotated = rotateToView(latLngToXyz(lat, lng), view)
  return {
    x: view.cx + view.radius * rotated.x,
    y: view.cy - view.radius * rotated.y,
    depth: rotated.z,
    visible: rotated.z > 0,
  }
}

/**
 * Answers the coordinate under a screen point, or `undefined` outside the disk.
 *
 * Only the half facing the viewer can be hit, which is what a pick from a tap needs.
 */
export function unproject(x: number, y: number, view: GlobeView): LatLng | undefined {
  'worklet'
  const viewX = (x - view.cx) / view.radius
  const viewY = (view.cy - y) / view.radius
  const squared = viewX * viewX + viewY * viewY
  if (squared > 1) return undefined
  const viewZ = Math.sqrt(1 - squared)

  const sinPhi = Math.sin(view.phi0)
  const cosPhi = Math.cos(view.phi0)
  const turnedX = cosPhi * viewZ - sinPhi * viewY
  const turnedZ = sinPhi * viewZ + cosPhi * viewY

  const lat = Math.asin(Math.max(-1, Math.min(1, turnedZ))) * RAD_TO_DEG
  let lng = (view.lambda0 + Math.atan2(viewX, turnedX)) * RAD_TO_DEG
  if (lng > 180) lng -= 360 * Math.ceil((lng - 180) / 360)
  if (lng <= -180) lng += 360 * Math.ceil((-180 - lng) / 360)
  return { lat, lng }
}
