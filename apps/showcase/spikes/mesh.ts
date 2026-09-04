import type { CellBoundaries, LatLng } from 'react-native-nitro-h3'

const EARTH_RADIUS_M = 6378137
const DEG_TO_RAD = Math.PI / 180

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

/** Holds one drawable batch: the vertices of one colour bucket within one chunk. */
export interface MeshGroup {
  bucket: number
  chunk: number
  cellCount: number
  /** Interleaved `[x, y]` in metres, packed, two slots per vertex. */
  positions: Float32Array
  /** Triangle fans from vertex `0` of each cell, offsets into `positions` by vertex. */
  indices: Uint16Array
}

/** Holds every batch of a built mesh together with its totals. */
export interface MeshBuild {
  groups: MeshGroup[]
  chunkCount: number
  pointCount: number
  indexCount: number
}

/** Configures {@linkcode buildMesh}. */
export interface MeshOptions {
  /**
   * Cells per chunk. A batch holds `chunkSize / buckets` cells, which must stay under the 65,535
   * points a 16-bit index can address.
   */
  chunkSize: number
  /** Colour buckets, assigned by cell index. */
  buckets: number
  /** Fraction every cell shrinks toward its centre, `0` for full size. */
  inset: number
}

/** Names the ramp of the Observatory theme, low intensity to high. */
export const RAMP_STOPS = ['#0F2F5A', '#1E6FD6', '#3FB0FF', '#C9EBFF', '#FFFFFF'] as const

function mercatorY(lat: number): number {
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

/**
 * Groups projected cells into batches of at most `chunkSize` cells and `buckets` colours.
 *
 * Every cell becomes a triangle fan from its first vertex, so a hexagon carries four triangles
 * and a pentagon three.
 */
export function buildMesh(projected: ProjectedCells, options: MeshOptions): MeshBuild {
  const { stride, points, vertexCounts, cellCount } = projected
  const { chunkSize, buckets, inset } = options
  const chunkCount = Math.max(1, Math.ceil(cellCount / chunkSize))
  const groupCount = chunkCount * buckets

  const cellTotals = new Int32Array(groupCount)
  const pointTotals = new Int32Array(groupCount)
  const indexTotals = new Int32Array(groupCount)

  for (let cell = 0; cell < cellCount; cell++) {
    const count = vertexCounts[cell]
    if (count < 3) continue
    const group = Math.floor(cell / chunkSize) * buckets + (cell % buckets)
    cellTotals[group] += 1
    pointTotals[group] += count
    indexTotals[group] += (count - 2) * 3
  }

  const groups: MeshGroup[] = []
  const groupOf = new Int32Array(groupCount).fill(-1)
  let pointCount = 0
  let indexCount = 0
  for (let group = 0; group < groupCount; group++) {
    if (cellTotals[group] === 0) continue
    groupOf[group] = groups.length
    groups.push({
      bucket: group % buckets,
      chunk: Math.floor(group / buckets),
      cellCount: cellTotals[group],
      positions: new Float32Array(pointTotals[group] * 2),
      indices: new Uint16Array(indexTotals[group]),
    })
    pointCount += pointTotals[group]
    indexCount += indexTotals[group]
  }

  const pointCursors = new Int32Array(groups.length)
  const indexCursors = new Int32Array(groups.length)
  const scale = 1 - inset

  for (let cell = 0; cell < cellCount; cell++) {
    const count = vertexCounts[cell]
    if (count < 3) continue
    const target = groupOf[Math.floor(cell / chunkSize) * buckets + (cell % buckets)]
    const group = groups[target]
    const base = cell * stride
    const first = pointCursors[target]

    let originX = 0
    let originY = 0
    if (inset !== 0) {
      for (let vertex = 0; vertex < count; vertex++) {
        originX += points[base + vertex * 2]
        originY += points[base + vertex * 2 + 1]
      }
      originX /= count
      originY /= count
    }

    let cursor = first * 2
    for (let vertex = 0; vertex < count; vertex++) {
      const x = points[base + vertex * 2]
      const y = points[base + vertex * 2 + 1]
      group.positions[cursor] = inset === 0 ? x : originX + (x - originX) * scale
      group.positions[cursor + 1] = inset === 0 ? y : originY + (y - originY) * scale
      cursor += 2
    }
    pointCursors[target] = first + count

    let index = indexCursors[target]
    for (let triangle = 1; triangle <= count - 2; triangle++) {
      group.indices[index] = first
      group.indices[index + 1] = first + triangle
      group.indices[index + 2] = first + triangle + 1
      index += 3
    }
    indexCursors[target] = index
  }

  return { groups, chunkCount, pointCount, indexCount }
}

/**
 * Builds an SVG path drawing `edges` consecutive edges of every cell, one polyline per cell.
 *
 * Three edges per cell cover a full hexagonal tiling once, which halves the anti-aliasing work
 * of an outline that draws every cell in full.
 */
export function buildOutlinePath(projected: ProjectedCells, edges: number): string {
  const { stride, points, vertexCounts, cellCount } = projected
  const parts: string[] = []

  for (let cell = 0; cell < cellCount; cell++) {
    const count = vertexCounts[cell]
    if (count < 2) continue
    const last = Math.min(edges, count - 1)
    const base = cell * stride
    let part = `M${points[base].toFixed(1)} ${points[base + 1].toFixed(1)}`
    for (let vertex = 1; vertex <= last; vertex++) {
      part += `L${points[base + vertex * 2].toFixed(1)} ${points[base + vertex * 2 + 1].toFixed(1)}`
    }
    parts.push(part)
  }

  return parts.join('')
}

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16)
}

/** Quantises the theme ramp into `count` colours, evenly spaced between its stops. */
export function rampColours(count: number): string[] {
  const colours: string[] = []
  for (let step = 0; step < count; step++) {
    const position = count === 1 ? 0 : (step / (count - 1)) * (RAMP_STOPS.length - 1)
    const lower = Math.min(Math.floor(position), RAMP_STOPS.length - 2)
    const weight = position - lower
    const from = RAMP_STOPS[lower]
    const to = RAMP_STOPS[lower + 1]
    let colour = '#'
    for (let offset = 1; offset < 7; offset += 2) {
      const value = Math.round(
        channel(from, offset) + (channel(to, offset) - channel(from, offset)) * weight,
      )
      colour += value.toString(16).padStart(2, '0')
    }
    colours.push(colour)
  }
  return colours
}
