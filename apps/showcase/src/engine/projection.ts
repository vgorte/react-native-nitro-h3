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

/**
 * Holds a point on the unit sphere, `x` toward `[0, 0]`, `y` toward `[0, 90]`, `z` toward the pole.
 */
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

/** Projects one coordinate to a screen position, or answers `undefined` where it faces away. */
export type VertexProjector = (lng: number, lat: number) => [x: number, y: number] | undefined

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

/** Answers the coordinate at a Web Mercator position in metres. */
export function mercatorToLatLng(x: number, y: number): LatLng {
  'worklet'
  return {
    lat: (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) * RAD_TO_DEG,
    lng: (x / EARTH_RADIUS_M) * RAD_TO_DEG,
  }
}

/** Answers the ground metres one pixel spans at a zoom, on a 256 px tile grid. */
export function metresPerPixel(zoom: number, lat: number): number {
  'worklet'
  return (2 * Math.PI * EARTH_RADIUS_M * Math.cos(lat * DEG_TO_RAD)) / (256 * 2 ** zoom)
}

/** Answers the zoom at which one pixel spans `mpp` ground metres. */
export function zoomForMetresPerPixel(mpp: number, lat: number): number {
  'worklet'
  return Math.log2((2 * Math.PI * EARTH_RADIUS_M * Math.cos(lat * DEG_TO_RAD)) / (256 * mpp))
}

// the width at which a hexagon still reads as a hexagon
const TARGET_CELL_PX = 30

/**
 * Answers the resolution whose average cell comes closest to `targetPx` across at a zoom.
 *
 * The edge length is passed in rather than imported so the picker stays testable without the
 * native module; the acts hand it `getHexagonEdgeLengthAvgM`.
 */
export function resolutionForZoom(
  zoom: number,
  lat: number,
  edgeLengthM: (res: number) => number,
  targetPx: number = TARGET_CELL_PX,
): number {
  const mpp = metresPerPixel(zoom, lat)
  let best = 0
  let bestError = Number.POSITIVE_INFINITY
  for (let res = 0; res <= 15; res++) {
    const error = Math.abs(Math.log((2 * edgeLengthM(res)) / mpp / targetPx))
    if (error < bestError) {
      bestError = error
      best = res
    }
  }
  return best
}

/**
 * Answers the globe radius in pixels at which {@linkcode resolutionForZoom} first asks for `res`.
 *
 * A globe's zoom does not depend on the latitude, because the cosine cancels between the radius and
 * the metres a pixel spans, so one radius answers for every view and an act can size its zoom range
 * from the resolution it hands over at.
 *
 * @param res The resolution the answer is the threshold of.
 * @param edgeLengthM The average edge length of a resolution, from `getHexagonEdgeLengthAvgM`.
 * @param targetPx The cell width the ladder aims for, as {@linkcode resolutionForZoom} takes it.
 */
export function radiusForResolution(
  res: number,
  edgeLengthM: (res: number) => number,
  targetPx?: number,
): number {
  let below = 1
  let above = EARTH_RADIUS_M
  for (let step = 0; step < 60; step++) {
    const middle = (below + above) / 2
    const zoom = zoomForMetresPerPixel(EARTH_RADIUS_M / middle, 0)
    if (resolutionForZoom(zoom, 0, edgeLengthM, targetPx) >= res) above = middle
    else below = middle
  }
  return above
}

// keeps `Float32` rounding of the offset under a twentieth of a pixel
const REANCHOR_PIXELS = 800_000

/** Answers how far the view centre may drift from the mesh anchor before a rebuild re-anchors. */
export function reanchorLimitM(zoom: number, lat: number): number {
  return REANCHOR_PIXELS * metresPerPixel(zoom, lat)
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

/**
 * Drops the cells whose extent misses a rectangle and packs the rest, keeping the input layout.
 *
 * @param projected The cells to cull, as {@linkcode projectCells} answers them.
 * @param rect The rectangle to keep, in the metre space of `projected`.
 * @param sources Receives the index each kept cell had before the cull, so per-cell data can
 *   follow the cells; it needs `projected.cellCount` slots.
 */
export function cullCells(
  projected: ProjectedCells,
  rect: Bounds,
  sources?: Uint32Array,
): ProjectedCells {
  const { stride, points, vertexCounts, cellCount } = projected
  const kept = new Uint8Array(cellCount)
  let keptCount = 0

  for (let cell = 0; cell < cellCount; cell++) {
    const count = vertexCounts[cell]
    if (count === 0) continue
    const base = cell * stride
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (let vertex = 0; vertex < count; vertex++) {
      const x = points[base + vertex * 2]
      const y = points[base + vertex * 2 + 1]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    if (maxX < rect.minX || minX > rect.maxX || maxY < rect.minY || minY > rect.maxY) continue
    kept[cell] = 1
    keptCount += 1
  }

  if (keptCount === cellCount) {
    if (sources !== undefined) for (let cell = 0; cell < cellCount; cell++) sources[cell] = cell
    return projected
  }

  // the rest of the file pads with `NaN`, and a consumer must read `vertexCounts` either way
  const culled = new Float32Array(keptCount * stride).fill(Number.NaN)
  const counts = new Uint8Array(keptCount)
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let target = 0

  for (let cell = 0; cell < cellCount; cell++) {
    if (kept[cell] === 0) continue
    const count = vertexCounts[cell]
    if (sources !== undefined) sources[target] = cell
    counts[target] = count
    const from = cell * stride
    const to = target * stride
    for (let vertex = 0; vertex < count; vertex++) {
      const x = points[from + vertex * 2]
      const y = points[from + vertex * 2 + 1]
      culled[to + vertex * 2] = x
      culled[to + vertex * 2 + 1] = y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    target += 1
  }

  const bounds =
    keptCount === 0 ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY }
  return { stride, points: culled, vertexCounts: counts, cellCount: keptCount, bounds }
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

/**
 * Projects a cell set onto the orthographic disk, in pixels measured from the projected `anchor`.
 *
 * Every vertex is computed in double and stored as `Float32`, so a frame anchored at the view
 * centre holds pixel accuracy at any radius; the disk centre cancels out of the subtraction. A
 * vertex on the far side stays `NaN`, as do the padding slots.
 *
 * @param boundaries The boundaries as `cellsToBoundaries` answers them.
 * @param view The globe the cells are projected onto.
 * @param anchor The coordinate that becomes the origin, which the view centre is meant to be.
 */
export function projectCellsGlobeLocal(
  boundaries: CellBoundaries,
  view: GlobeView,
  anchor: LatLng,
): ProjectedCells {
  const { stride, vertices, vertexCounts } = boundaries
  const cellCount = vertexCounts.length
  const points = new Float32Array(vertices.length).fill(Number.NaN)
  const { radius } = view

  const sinLambda = Math.sin(view.lambda0)
  const cosLambda = Math.cos(view.lambda0)
  const sinPhi = Math.sin(view.phi0)
  const cosPhi = Math.cos(view.phi0)
  const origin = rotateToView(latLngToXyz(anchor.lat, anchor.lng), view)

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let cell = 0; cell < cellCount; cell++) {
    const base = cell * stride
    const count = vertexCounts[cell]
    for (let vertex = 0; vertex < count; vertex++) {
      const slot = base + vertex * 2
      const phi = vertices[slot] * DEG_TO_RAD
      const lambda = vertices[slot + 1] * DEG_TO_RAD
      const cosLat = Math.cos(phi)
      const pointX = cosLat * Math.cos(lambda)
      const pointY = cosLat * Math.sin(lambda)
      const pointZ = Math.sin(phi)
      const turnedX = pointX * cosLambda + pointY * sinLambda
      if (sinPhi * pointZ + cosPhi * turnedX <= 0) continue
      const x = radius * (pointY * cosLambda - pointX * sinLambda - origin.x)
      const y = -radius * (cosPhi * pointZ - sinPhi * turnedX - origin.y)
      points[slot] = x
      points[slot + 1] = y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  const bounds =
    minX === Number.POSITIVE_INFINITY
      ? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
      : { minX, minY, maxX, maxY }
  return { stride, points, vertexCounts, cellCount, bounds }
}
