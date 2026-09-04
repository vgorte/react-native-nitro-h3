import { describe, expect, test } from 'bun:test'
import type { FeatureCollection, Polygon } from 'geojson'
import type { CellBoundaries } from 'react-native-nitro-h3'
import { cellsToFeatureCollection, featureIdOf } from '../engine/geojson'

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

const ONE = new BigUint64Array([0x8758e119affffffn])
const PAIR = new BigUint64Array([0x8758e119affffffn, 0x85283473fffffffn])
const TRIPLE = new BigUint64Array([0x8758e119affffffn, 0n, 0x85283473fffffffn])

function parse(json: string): FeatureCollection<Polygon> {
  return JSON.parse(json) as FeatureCollection<Polygon>
}

describe('cellsToFeatureCollection', () => {
  test('builds one feature per cell of a parsable collection', () => {
    const json = cellsToFeatureCollection(
      boundaries([HEXAGON, PENTAGON]),
      new Uint8Array([0, 0]),
      PAIR,
    )

    const collection = parse(json)
    expect(collection.type).toBe('FeatureCollection')
    expect(collection.features).toHaveLength(2)
    expect(collection.features[0].geometry.type).toBe('Polygon')
  })

  test('closes every ring on the vertex it started at', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([HEXAGON, PENTAGON]), new Uint8Array([0, 0]), PAIR),
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
    const collection = parse(
      cellsToFeatureCollection(boundaries([HEXAGON]), new Uint8Array([0]), ONE),
    )

    const ring = collection.features[0].geometry.coordinates[0]
    expect(ring[0]).toEqual([HEXAGON[1], HEXAGON[0]])
    expect(ring[3]).toEqual([HEXAGON[7], HEXAGON[6]])
  })

  test('carries the bucket of every cell as a property', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([HEXAGON, PENTAGON]), new Uint8Array([15, 3]), PAIR),
    )

    expect(collection.features[0].properties?.bucket).toBe(15)
    expect(collection.features[1].properties?.bucket).toBe(3)
  })

  test('never emits the padding the layout leaves behind', () => {
    const json = cellsToFeatureCollection(
      boundaries([HEXAGON, PENTAGON]),
      new Uint8Array([0, 0]),
      PAIR,
    )

    expect(json).not.toContain('NaN')
    expect(json).not.toContain('null')
  })

  test('leaves a cell without vertices out of the collection', () => {
    const collection = parse(
      cellsToFeatureCollection(
        boundaries([HEXAGON, [], PENTAGON]),
        new Uint8Array([1, 2, 3]),
        TRIPLE,
      ),
    )

    expect(collection.features).toHaveLength(2)
    expect(collection.features[1].properties?.bucket).toBe(3)
    expect(collection.features[1].properties?.id).toBe(featureIdOf(TRIPLE[2]))
  })

  test('carries the identity of every cell as a property', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([HEXAGON, PENTAGON]), new Uint8Array([0, 0]), PAIR),
    )

    expect(collection.features[0].properties).toEqual({
      bucket: 0,
      id: featureIdOf(PAIR[0]),
    })
    expect(collection.features[1].properties?.id).toBe(featureIdOf(PAIR[1]))
  })

  test('answers an empty collection for no cells at all', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([]), new Uint8Array(), new BigUint64Array()),
    )

    expect(collection.features).toEqual([])
  })
})

describe('featureIdOf', () => {
  test('answers the decimal index the highlight filter matches on', () => {
    expect(featureIdOf(0x8758e119affffffn)).toBe('609549530844626943')
  })
})

const ANTIMERIDIAN = [0, 179, 1, 179.9, 1, -179.5, 0, -179, -1, -179.5, -1, 179.9]
const NORTH_POLE = [89.5, -150, 89.5, -90, 89.5, -30, 89.5, 30, 89.5, 90, 89.5, 150]
const SOUTH_POLE = [-89.5, -150, -89.5, -90, -89.5, -30, -89.5, 30, -89.5, 90, -89.5, 150]

describe('cellsToFeatureCollection across the world edge', () => {
  test('keeps a ring on the antimeridian in one copy of the hemisphere', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([ANTIMERIDIAN]), new Uint8Array([0]), ONE),
    )

    const ring = collection.features[0].geometry.coordinates[0]
    const longitudes = ring.map(([lng]) => lng)
    expect(Math.min(...longitudes)).toBeGreaterThan(0)
    expect(Math.max(...longitudes) - Math.min(...longitudes)).toBeLessThanOrEqual(180)
    expect(ring).toHaveLength(7)
  })

  test('closes a ring around the north pole over the cap', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([NORTH_POLE]), new Uint8Array([0]), ONE),
    )

    const ring = collection.features[0].geometry.coordinates[0]
    expect(ring).toHaveLength(9)
    const capped = ring.filter(([, lat]) => lat === 90)
    expect(capped).toHaveLength(2)
    expect(capped[0][0]).toBeGreaterThan(capped[1][0])
  })

  test('closes a ring around the south pole over its own cap', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([SOUTH_POLE]), new Uint8Array([0]), ONE),
    )

    const ring = collection.features[0].geometry.coordinates[0]
    expect(ring.filter(([, lat]) => lat === -90)).toHaveLength(2)
    expect(ring.filter(([, lat]) => lat === 90)).toHaveLength(0)
  })

  test('leaves a ring that never crosses the edge alone', () => {
    const collection = parse(
      cellsToFeatureCollection(boundaries([HEXAGON]), new Uint8Array([0]), ONE),
    )

    expect(collection.features[0].geometry.coordinates[0]).toHaveLength(7)
  })
})
