import type { CellBoundaries } from 'react-native-nitro-h3'

import { writeFan } from './mesh'
import { type GlobeView, latLngToXyz } from './projection'

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
