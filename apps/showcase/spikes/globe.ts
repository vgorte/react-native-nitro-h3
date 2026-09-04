import type { CellBoundaries, LatLng } from 'react-native-nitro-h3'

import { writeFan } from './mesh'

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

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

/** Holds the cells of the globe as unit-sphere geometry, built once and rotated every frame. */
export interface GlobeCells {
  /** Slots each cell occupies in `vertices`, three per boundary vertex. */
  stride: number
  /** Unit-sphere `[x, y, z]` per boundary vertex, `stride` slots per cell. */
  vertices: Float32Array
  /** Unit-sphere `[x, y, z]` per cell centre, three slots per cell. */
  centres: Float32Array
  vertexCounts: Uint8Array
  /** Colour bucket per cell. */
  buckets: Uint8Array
  cellCount: number
}

/**
 * Holds the per-frame draw buffers, one pair per colour bucket, sized for the whole globe.
 *
 * Every field is a typed array so a frame can be filled from a worklet, where the object itself
 * is frozen but its buffers are not.
 */
export interface GlobeFrame {
  /** Screen `[x, y]` per vertex, packed, `pointCounts[bucket]` vertices in use. */
  positions: Float32Array[]
  /** Triangle fans into `positions`, `indexCounts[bucket]` entries in use. */
  indices: Uint16Array[]
  pointCounts: Int32Array
  indexCounts: Int32Array
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
 * Builds the unit-sphere geometry of a cell set once, so a frame is a rotation and nothing else.
 *
 * @param boundaries The boundaries as `cellsToBoundaries` answers them.
 * @param centres The cell centres as `cellsToLatLngs` answers them, `[lat, lng]` per cell.
 * @param buckets The colour bucket of each cell.
 */
export function toGlobeCells(
  boundaries: CellBoundaries,
  centres: Float64Array,
  buckets: Uint8Array,
): GlobeCells {
  const { vertices: source, vertexCounts } = boundaries
  const cellCount = vertexCounts.length
  const stride = (boundaries.stride / 2) * 3
  const vertices = new Float32Array(cellCount * stride)
  const centrePoints = new Float32Array(cellCount * 3)

  for (let cell = 0; cell < cellCount; cell++) {
    const count = vertexCounts[cell]
    const sourceBase = cell * boundaries.stride
    const targetBase = cell * stride
    for (let vertex = 0; vertex < count; vertex++) {
      const point = latLngToXyz(
        source[sourceBase + vertex * 2],
        source[sourceBase + vertex * 2 + 1],
      )
      const slot = targetBase + vertex * 3
      vertices[slot] = point.x
      vertices[slot + 1] = point.y
      vertices[slot + 2] = point.z
    }
    const centre = latLngToXyz(centres[cell * 2], centres[cell * 2 + 1])
    centrePoints[cell * 3] = centre.x
    centrePoints[cell * 3 + 1] = centre.y
    centrePoints[cell * 3 + 2] = centre.z
  }

  return { stride, vertices, centres: centrePoints, vertexCounts, buckets, cellCount }
}

/** Allocates the draw buffers of a frame at the size the whole globe would need. */
export function createGlobeFrame(cells: GlobeCells, bucketCount: number): GlobeFrame {
  const pointTotals = new Int32Array(bucketCount)
  const indexTotals = new Int32Array(bucketCount)
  for (let cell = 0; cell < cells.cellCount; cell++) {
    const count = cells.vertexCounts[cell]
    if (count < 3) continue
    const bucket = cells.buckets[cell]
    pointTotals[bucket] += count
    indexTotals[bucket] += (count - 2) * 3
  }

  const positions: Float32Array[] = []
  const indices: Uint16Array[] = []
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    positions.push(new Float32Array(pointTotals[bucket] * 2))
    indices.push(new Uint16Array(indexTotals[bucket]))
  }

  return {
    positions,
    indices,
    pointCounts: new Int32Array(bucketCount),
    indexCounts: new Int32Array(bucketCount),
  }
}

/**
 * Fills the frame buffers with the cells facing the viewer, projected to the screen.
 *
 * A cell is kept when its centre faces the viewer, so cells on the limb keep every vertex,
 * including the few that fall behind it and fold back onto the disk.
 *
 * @returns The number of cells written.
 */
export function buildGlobeFrame(cells: GlobeCells, frame: GlobeFrame, view: GlobeView): number {
  'worklet'
  const { stride, vertices, centres, vertexCounts, buckets, cellCount } = cells
  const { positions, indices, pointCounts, indexCounts } = frame
  const { cx, cy, radius } = view

  pointCounts.fill(0)
  indexCounts.fill(0)

  const sinLambda = Math.sin(view.lambda0)
  const cosLambda = Math.cos(view.lambda0)
  const sinPhi = Math.sin(view.phi0)
  const cosPhi = Math.cos(view.phi0)

  let visible = 0
  for (let cell = 0; cell < cellCount; cell++) {
    const count = vertexCounts[cell]
    if (count < 3) continue

    const centre = cell * 3
    const centreTurnedX = centres[centre] * cosLambda + centres[centre + 1] * sinLambda
    if (sinPhi * centres[centre + 2] + cosPhi * centreTurnedX <= 0) continue
    visible += 1

    const bucket = buckets[cell]
    const target = positions[bucket]
    const first = pointCounts[bucket]
    const base = cell * stride
    let cursor = first * 2

    for (let vertex = 0; vertex < count; vertex++) {
      const slot = base + vertex * 3
      const x = vertices[slot]
      const y = vertices[slot + 1]
      const turnedX = x * cosLambda + y * sinLambda
      target[cursor] = cx + radius * (y * cosLambda - x * sinLambda)
      target[cursor + 1] = cy - radius * (cosPhi * vertices[slot + 2] - sinPhi * turnedX)
      cursor += 2
    }

    pointCounts[bucket] = first + count
    indexCounts[bucket] = writeFan(indices[bucket], indexCounts[bucket], first, count)
  }

  return visible
}
