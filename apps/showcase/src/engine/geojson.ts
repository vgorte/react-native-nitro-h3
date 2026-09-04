import type { CellBoundaries } from 'react-native-nitro-h3'

// the four pieces a feature is assembled from, so no line of the builder wraps
const FEATURE_HEAD = '{"type":"Feature","properties":{"bucket":'
const FEATURE_ID = ',"id":"'
const FEATURE_GEOMETRY = '"},"geometry":{"type":"Polygon","coordinates":[['
const FEATURE_TAIL = ']]}}'

// a ring wider than this holds both ends of the longitude range rather than a wide cell
const HALF_TURN = 180
const FULL_TURN = 360
const POLE = 90

/**
 * Estimates the bytes one hexagon adds to the collection, at H3's full coordinate precision.
 *
 * Measured in the Atlas act on 2026-09-04 in release builds on the iPhone 17 Pro simulator, the
 * Android emulator and a Galaxy S23: six settles between resolution 8 and resolution 10 gave
 * 392.1 to 392.4 bytes a cell, so the figure holds across the ladder. A pentagon costs one vertex
 * less, and a cell whose coordinates happen to be shorter comes out under it.
 */
export const GEOJSON_BYTES_PER_CELL = 392

/**
 * Answers the identity a cell's feature carries, which a layer filter can match on.
 *
 * The decimal index is built in JavaScript, because a collection of thousands of cells cannot
 * afford a native call each and nothing outside the style reads the value.
 */
export function featureIdOf(cell: bigint): string {
  return cell.toString()
}

/**
 * Builds the `FeatureCollection` of a cell set as one JSON string, ready for a `GeoJSONSource`.
 *
 * The string is written in one pass over the padded layout, without an object per vertex, because
 * this is the cost the act is there to show. Every ring closes on the vertex it started at, as
 * GeoJSON requires and H3 boundaries leave off, and the padding slots are never read.
 *
 * Two rings need more than the vertices H3 gives. A cell on the antimeridian holds longitudes at
 * both ends of the range, which a renderer fills the long way round as a strip across the world;
 * every negative longitude of such a ring is shifted east by a turn instead, which MapLibre draws
 * correctly past 180. A cell around a pole still spans half the world after that, because its ring
 * circles the pole without reaching it, so the ring is closed over the cap.
 *
 * @param boundaries The boundaries as `cellsToBoundaries` answers them.
 * @param buckets The ramp bucket of each cell, which the fill layer's expression reads back.
 * @param cells The cells themselves, whose {@linkcode featureIdOf} each feature carries.
 */
export function cellsToFeatureCollection(
  boundaries: CellBoundaries,
  buckets: Uint8Array,
  cells: BigUint64Array,
): string {
  const { stride, vertices, vertexCounts } = boundaries
  const features: string[] = []

  for (let cell = 0; cell < vertexCounts.length; cell++) {
    const count = vertexCounts[cell]
    if (count === 0) continue
    const base = cell * stride

    let minLng = Number.POSITIVE_INFINITY
    let maxLng = Number.NEGATIVE_INFINITY
    for (let vertex = 0; vertex < count; vertex++) {
      const lng = vertices[base + vertex * 2 + 1]
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }

    const wrapped = maxLng - minLng > HALF_TURN
    let peak = 0
    if (wrapped) {
      minLng = Number.POSITIVE_INFINITY
      maxLng = Number.NEGATIVE_INFINITY
      for (let vertex = 0; vertex < count; vertex++) {
        const raw = vertices[base + vertex * 2 + 1]
        const lng = raw < 0 ? raw + FULL_TURN : raw
        if (lng < minLng) minLng = lng
        if (lng > maxLng) {
          maxLng = lng
          peak = vertex
        }
      }
    }
    const capped = wrapped && maxLng - minLng > HALF_TURN
    const cap = vertices[base] >= 0 ? POLE : -POLE

    let first = ''
    let ring = ''
    for (let vertex = 0; vertex < count; vertex++) {
      const slot = base + vertex * 2
      const raw = vertices[slot + 1]
      const lng = wrapped && raw < 0 ? raw + FULL_TURN : raw
      const point = `[${lng},${vertices[slot]}]`
      if (vertex === 0) first = point
      ring += vertex === 0 ? point : `,${point}`
      if (capped && vertex === peak) ring += `,[${maxLng},${cap}],[${minLng},${cap}]`
    }

    const head = `${FEATURE_HEAD}${buckets[cell]}${FEATURE_ID}${featureIdOf(cells[cell])}`
    features.push(`${head}${FEATURE_GEOMETRY}${ring},${first}${FEATURE_TAIL}`)
  }

  return `{"type":"FeatureCollection","features":[${features.join(',')}]}`
}
