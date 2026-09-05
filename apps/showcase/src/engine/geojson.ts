import type { CellBoundaries } from 'react-native-nitro-h3'

// the three pieces a feature is assembled from, so no line of the builder wraps
const FEATURE_HEAD = '{"type":"Feature","properties":{"bucket":'
const FEATURE_GEOMETRY = '},"geometry":{"type":"Polygon","coordinates":[['
const FEATURE_TAIL = ']]}}'

// the two pieces a point feature is assembled from, which carries no properties of its own
const POINT_HEAD = '{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":['
const POINT_TAIL = ']}}'

// a ring wider than this holds both ends of the longitude range rather than a wide cell
const HALF_TURN = 180
const FULL_TURN = 360
const POLE = 90

/**
 * Wraps features that are already written as JSON into one `FeatureCollection` string.
 *
 * A set too large to write in one pass is written in parts and joined here, so the collection is
 * assembled once rather than grown a feature at a time.
 *
 * @param features The features, each a finished JSON object, in the order they are drawn.
 */
export function featureCollection(features: readonly string[]): string {
  return `{"type":"FeatureCollection","features":[${features.join(',')}]}`
}

/**
 * Writes a block of coordinates as the point features of a collection, comma separated.
 *
 * The block is written in one pass, without an object per point, because a million features is the
 * cost this path is there to show; {@linkcode featureCollection} closes the blocks into one string.
 *
 * @param coords Latitude and longitude pairs, as the point stream answers them.
 */
export function pointFeatures(coords: Float64Array): string {
  const features: string[] = []
  for (let at = 0; at < coords.length; at += 2) {
    features.push(`${POINT_HEAD}${coords[at + 1]},${coords[at]}${POINT_TAIL}`)
  }
  return features.join(',')
}

/**
 * Builds the `FeatureCollection` of a cell set as one JSON string, ready for a `GeoJSONSource`.
 *
 * The string is written in one pass over the padded layout, without an object per vertex, because
 * this is the cost the act is there to show. Every ring closes on the vertex it started at, as
 * GeoJSON requires and H3 boundaries leave off, and the padding slots are never read.
 *
 * @param boundaries The boundaries as `cellsToBoundaries` answers them.
 * @param buckets The ramp bucket of each cell, which the fill layer's expression reads back.
 */
export function cellsToFeatureCollection(boundaries: CellBoundaries, buckets: Uint8Array): string {
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

    // a ring holding both ends of the range draws the long way round, so its negatives shift east
    const wrapped = maxLng - minLng > HALF_TURN
    let lowest = 0
    let highest = 0
    if (wrapped) {
      minLng = Number.POSITIVE_INFINITY
      maxLng = Number.NEGATIVE_INFINITY
      for (let vertex = 0; vertex < count; vertex++) {
        const raw = vertices[base + vertex * 2 + 1]
        const lng = raw < 0 ? raw + FULL_TURN : raw
        if (lng < minLng) {
          minLng = lng
          lowest = vertex
        }
        if (lng > maxLng) {
          maxLng = lng
          highest = vertex
        }
      }
    }

    // a ring around a pole spans half the world even shifted, so it closes over the cap between
    // its two extreme longitudes
    const cap = vertices[base] >= 0 ? POLE : -POLE
    // the two extremes are the seam the ring crosses, and H3 answers a pole either way round
    const rising = (highest + 1) % count === lowest
    const falling = (lowest + 1) % count === highest
    // a ring whose extremes are not neighbours has no seam to close over, so it keeps its vertices
    const capped = wrapped && maxLng - minLng > HALF_TURN && (rising || falling)
    const capAfter = rising ? highest : lowest
    // the chain follows the extreme the ring reaches first, or a south cell ties into a bow tie
    const capChain = rising
      ? `,[${maxLng},${cap}],[${minLng},${cap}]`
      : `,[${minLng},${cap}],[${maxLng},${cap}]`

    let first = ''
    let ring = ''
    for (let vertex = 0; vertex < count; vertex++) {
      const slot = base + vertex * 2
      const raw = vertices[slot + 1]
      const lng = wrapped && raw < 0 ? raw + FULL_TURN : raw
      const point = `[${lng},${vertices[slot]}]`
      if (vertex === 0) first = point
      ring += vertex === 0 ? point : `,${point}`
      if (capped && vertex === capAfter) ring += capChain
    }

    const head = `${FEATURE_HEAD}${buckets[cell]}${FEATURE_GEOMETRY}`
    features.push(`${head}${ring},${first}${FEATURE_TAIL}`)
  }

  return featureCollection(features)
}
