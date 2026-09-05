import { describe, expect, test } from 'bun:test'
import type { FeatureCollection, Point, Polygon, Position } from 'geojson'
import type { CellBoundaries } from 'react-native-nitro-h3'
import { cellsToFeatureCollection, featureCollection, pointFeatures } from '../engine/geojson'

const STRIDE = 20

/** Lays out hand-written cells in the padded layout `cellsToBoundaries` answers. */
function boundaries(cells: number[][]): CellBoundaries {
  const vertices = new Float64Array(cells.length * STRIDE).fill(Number.NaN)
  const vertexCounts = new Uint8Array(cells.length)
  cells.forEach((pairs, cell) => {
    vertexCounts[cell] = pairs.length / 2
    vertices.set(pairs, cell * STRIDE)
  })
  return { stride: STRIDE, vertices, vertexCounts }
}

/** Answers a regular polygon of `count` vertices around a coordinate, one degree across. */
function polygon(count: number, lat: number, lng: number): number[] {
  const pairs: number[] = []
  for (let vertex = 0; vertex < count; vertex++) {
    const angle = (vertex / count) * 2 * Math.PI
    pairs.push(lat + Math.sin(angle), lng + Math.cos(angle))
  }
  return pairs
}

const HEXAGON = polygon(6, 52.5, 13.4)
const PENTAGON = polygon(5, 10, 20)

function parse(json: string): FeatureCollection<Polygon> {
  return JSON.parse(json) as FeatureCollection<Polygon>
}

describe('cellsToFeatureCollection', () => {
  test('builds one feature per cell of a parsable collection', () => {
    const json = cellsToFeatureCollection(boundaries([HEXAGON, PENTAGON]), new Uint8Array([0, 0]))

    const collection = parse(json)
    expect(collection.type).toBe('FeatureCollection')
    expect(collection.features).toHaveLength(2)
    expect(collection.features[0].geometry.type).toBe('Polygon')
  })

  test('closes every ring on the vertex it started at', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([HEXAGON, PENTAGON]), new Uint8Array([0, 0])),
    )

    const [hexagon, pentagon] = collection.features.map(
      (feature) => feature.geometry.coordinates[0],
    )
    expect(hexagon).toHaveLength(7)
    expect(pentagon).toHaveLength(6)
    expect(hexagon[6]).toEqual(hexagon[0])
    expect(pentagon[5]).toEqual(pentagon[0])
  })

  test('writes each vertex in lng, lat order', () => {
    const collection = parse(cellsToFeatureCollection(boundaries([HEXAGON]), new Uint8Array([0])))

    const ring = collection.features[0].geometry.coordinates[0]
    expect(ring[0]).toEqual([HEXAGON[1], HEXAGON[0]])
    expect(ring[3]).toEqual([HEXAGON[7], HEXAGON[6]])
  })

  test('carries the bucket of every cell as a property', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([HEXAGON, PENTAGON]), new Uint8Array([15, 3])),
    )

    expect(collection.features[0].properties).toEqual({ bucket: 15 })
    expect(collection.features[1].properties).toEqual({ bucket: 3 })
  })

  test('never emits the padding the layout leaves behind', () => {
    const json = cellsToFeatureCollection(boundaries([HEXAGON, PENTAGON]), new Uint8Array([0, 0]))

    expect(json).not.toContain('NaN')
    expect(json).not.toContain('null')
  })

  test('leaves a cell without vertices out of the collection', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([HEXAGON, [], PENTAGON]), new Uint8Array([1, 2, 3])),
    )

    expect(collection.features).toHaveLength(2)
    expect(collection.features[1].properties?.bucket).toBe(3)
  })

  test('answers an empty collection for no cells at all', () => {
    const collection = parse(cellsToFeatureCollection(boundaries([]), new Uint8Array()))

    expect(collection.features).toEqual([])
  })
})

const ANTIMERIDIAN = [0, 179, 1, 179.9, 1, -179.5, 0, -179, -1, -179.5, -1, 179.9]

// `cellToBoundary` of `latLngToCell(90, 0, 8)`, which H3 answers in rising longitude
const NORTH_POLE = [
  89.991558, 14.512916, 89.99358, 49.86234, 89.997287, 98.11663, 89.997514, -110.48311, 89.99398,
  -58.289035, 89.991786, -20.66643,
]

// `cellToBoundary` of `latLngToCell(-90, 0, 8)`, which H3 answers in falling longitude
const SOUTH_POLE = [
  -89.991786, 159.33357, -89.99398, 121.710965, -89.997514, 69.51689, -89.997287, -81.88337,
  -89.99358, -130.13766, -89.991558, -165.487084,
]

// a ring wide enough to look polar whose greatest and smallest longitudes are three apart; H3
// answers no such cell, and the builder has to leave it alone rather than tie it into a bow tie
const SCATTERED = [89, 10, 89, 120, 89, -10, 89, -160, 89, 60, 89, -60]

/** Reports whether two segments cross anywhere other than at a shared endpoint. */
function crosses(a: Position, b: Position, c: Position, d: Position): boolean {
  const side = (p: Position, q: Position, r: Position): number =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  const shared = [a, b].some(([x, y]) => [c, d].some(([u, v]) => x === u && y === v))
  if (shared) return false
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)
}

/** Reports whether a closed ring crosses itself, which a cell's polygon never may. */
function selfIntersects(ring: Position[]): boolean {
  for (let edge = 0; edge < ring.length - 1; edge++) {
    for (let other = edge + 1; other < ring.length - 1; other++) {
      if (crosses(ring[edge], ring[edge + 1], ring[other], ring[other + 1])) return true
    }
  }
  return false
}

describe('cellsToFeatureCollection across the world edge', () => {
  test('keeps a ring on the antimeridian in one copy of the hemisphere', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([ANTIMERIDIAN]), new Uint8Array([0])),
    )

    const ring = collection.features[0].geometry.coordinates[0]
    const longitudes = ring.map(([lng]) => lng)
    expect(Math.min(...longitudes)).toBeGreaterThan(0)
    expect(Math.max(...longitudes) - Math.min(...longitudes)).toBeLessThanOrEqual(180)
    expect(ring).toHaveLength(7)
  })

  test('closes a ring that rises in longitude over the north cap', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([NORTH_POLE]), new Uint8Array([0])),
    )

    const ring = collection.features[0].geometry.coordinates[0]
    expect(ring).toHaveLength(9)
    const capped = ring.filter(([, lat]) => lat === 90)
    expect(capped).toHaveLength(2)
    // the ring reaches its greatest longitude first, so the cap runs back from it
    expect(capped[0][0]).toBeGreaterThan(capped[1][0])
    expect(selfIntersects(ring)).toBe(false)
  })

  test('closes a ring that falls in longitude over the south cap', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([SOUTH_POLE]), new Uint8Array([0])),
    )

    const ring = collection.features[0].geometry.coordinates[0]
    expect(ring).toHaveLength(9)
    const capped = ring.filter(([, lat]) => lat === -90)
    expect(capped).toHaveLength(2)
    // the ring reaches its smallest longitude first, so the cap runs forward from it
    expect(capped[0][0]).toBeLessThan(capped[1][0])
    expect(ring.filter(([, lat]) => lat === 90)).toHaveLength(0)
    expect(selfIntersects(ring)).toBe(false)
  })

  test('leaves a wide ring uncapped where its two extreme longitudes are not neighbours', () => {
    const collection = parse(cellsToFeatureCollection(boundaries([SCATTERED]), new Uint8Array([0])))

    const ring = collection.features[0].geometry.coordinates[0]
    expect(ring).toHaveLength(7)
    expect(ring.filter(([, lat]) => Math.abs(lat) === 90)).toHaveLength(0)
    expect(ring.map(([lng]) => lng)).toEqual([10, 120, 350, 200, 60, 300, 10])
  })

  test('leaves a ring that never crosses the edge alone', () => {
    const collection = parse(cellsToFeatureCollection(boundaries([HEXAGON]), new Uint8Array([0])))

    expect(collection.features[0].geometry.coordinates[0]).toHaveLength(7)
  })
})

describe('pointFeatures and featureCollection', () => {
  test('writes one point feature a coordinate pair, longitude first', () => {
    const collection = JSON.parse(
      featureCollection([pointFeatures(Float64Array.from([52.52, 13.405, 52.5, 13.4]))]),
    ) as FeatureCollection<Point>

    expect(collection.features).toHaveLength(2)
    expect(collection.features[0].geometry.coordinates).toEqual([13.405, 52.52])
    expect(collection.features[1].geometry.coordinates).toEqual([13.4, 52.5])
  })

  test('joins blocks into the collection the whole run would have written in one pass', () => {
    const whole = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8])

    expect(
      featureCollection([pointFeatures(whole.subarray(0, 4)), pointFeatures(whole.subarray(4))]),
    ).toBe(featureCollection([pointFeatures(whole)]))
  })

  test('answers an empty collection where a block holds no points', () => {
    const collection = JSON.parse(
      featureCollection([pointFeatures(new Float64Array(0))]),
    ) as FeatureCollection<Point>

    expect(collection.type).toBe('FeatureCollection')
    expect(collection.features).toHaveLength(0)
  })
})
