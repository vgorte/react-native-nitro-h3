import type { CellBoundaries } from 'react-native-nitro-h3'

// the three pieces a feature is assembled from, so no line of the builder wraps
const FEATURE_HEAD = '{"type":"Feature","properties":{"bucket":'
const FEATURE_GEOMETRY = '},"geometry":{"type":"Polygon","coordinates":[['
const FEATURE_TAIL = ']]}}'

// a ring wider than this holds both ends of the longitude range rather than a wide cell
const HALF_TURN = 180
const FULL_TURN = 360
const POLE = 90

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
 * circles the pole without reaching it, so the ring is closed over the cap between its two extreme
 * longitudes. H3 answers a north cell in rising longitude and a south cell in falling longitude, so
 * the cap chain follows whichever extreme the ring reaches first; inserting it always after the
 * greatest longitude ties every south cell into a bow tie. A ring that circles a pole once always
 * has those two extremes next to each other, and one that does not is left as it came rather than
 * capped at a vertex the chain would cross the rest of the ring to reach.
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

    const cap = vertices[base] >= 0 ? POLE : -POLE
    // the two extremes are the seam the ring crosses, and H3 answers a pole either way round
    const rising = (highest + 1) % count === lowest
    const falling = (lowest + 1) % count === highest
    // a ring whose extremes are not neighbours has no seam to close over, so it keeps its vertices
    const capped = wrapped && maxLng - minLng > HALF_TURN && (rising || falling)
    const capAfter = rising ? highest : lowest
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

  return `{"type":"FeatureCollection","features":[${features.join(',')}]}`
}
