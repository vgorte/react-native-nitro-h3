import { describe, expect, test } from 'bun:test'
import {
  buildTilePaths,
  type DecodedTile,
  lngLatToTile,
  type TileFeature,
  type TileLayer,
  type TilePoint,
  tileGrid,
  tileUrl,
} from '../tiles'

/** Lays out a hand-built feature with the part of the vector-tile interface the builder reads. */
function feature(
  type: number,
  properties: Record<string, string>,
  rings: TilePoint[][],
): TileFeature {
  return { type, extent: 4096, properties, loadGeometry: () => rings }
}

function layer(features: TileFeature[]): TileLayer {
  return { length: features.length, extent: 4096, feature: (index) => features[index] }
}

function tile(layers: Record<string, TileLayer>): DecodedTile {
  return { layers }
}

function ring(pairs: number[]): TilePoint[] {
  const points: TilePoint[] = []
  for (let pair = 0; pair < pairs.length; pair += 2) {
    points.push({ x: pairs[pair], y: pairs[pair + 1] })
  }
  return points
}

const BUILD = { buildings: true }

describe('lngLatToTile', () => {
  test('places Berlin Mitte in 14/8801/5373', () => {
    expect(lngLatToTile(13.4, 52.52, 14)).toEqual({ z: 14, x: 8801, y: 5373 })
  })

  test('places the null island at the centre of the world', () => {
    expect(lngLatToTile(0, 0, 1)).toEqual({ z: 1, x: 1, y: 1 })
    expect(lngLatToTile(-0.001, 0.001, 1)).toEqual({ z: 1, x: 0, y: 0 })
  })

  test('answers the single tile of zoom 0', () => {
    expect(lngLatToTile(13.4, 52.52, 0)).toEqual({ z: 0, x: 0, y: 0 })
  })
})

describe('tileGrid', () => {
  test('walks a three by two block east then south', () => {
    const tiles = tileGrid({ z: 14, x: 8801, y: 5373 }, 3, 2)

    expect(tiles).toHaveLength(6)
    expect(tiles.map((id) => `${id.x}/${id.y}`)).toEqual([
      '8801/5373',
      '8802/5373',
      '8803/5373',
      '8801/5374',
      '8802/5374',
      '8803/5374',
    ])
  })
})

describe('tileUrl', () => {
  test('fills the TileJSON template', () => {
    const template = 'https://tiles.openfreemap.org/planet/20260830_080001_pt/{z}/{x}/{y}.pbf'

    expect(tileUrl(template, { z: 14, x: 8801, y: 5373 })).toBe(
      'https://tiles.openfreemap.org/planet/20260830_080001_pt/14/8801/5373.pbf',
    )
  })
})

describe('buildTilePaths', () => {
  test('closes a water polygon and leaves a road open', () => {
    const built = buildTilePaths(
      tile({
        water: layer([feature(3, { class: 'river' }, [ring([0, 0, 10, 0, 10, 10, 0, 10, 0, 0])])]),
        transportation: layer([feature(2, { class: 'primary' }, [ring([0, 0, 20, 30])])]),
      }),
      BUILD,
    )

    expect(built.paths.water).toBe('M0 0L10 0L10 10L0 10L0 0Z')
    expect(built.paths.primary).toBe('M0 0L20 30')
    expect(built.extent).toBe(4096)
    expect(built.features).toBe(2)
  })

  test('keeps each transportation class in its own path', () => {
    const built = buildTilePaths(
      tile({
        transportation: layer([
          feature(2, { class: 'motorway' }, [ring([0, 0, 1, 1])]),
          feature(2, { class: 'service' }, [ring([2, 2, 3, 3])]),
          feature(2, { class: 'motorway' }, [ring([4, 4, 5, 5])]),
        ]),
      }),
      BUILD,
    )

    expect(built.paths.motorway).toBe('M0 0L1 1M4 4L5 5')
    expect(built.paths.service).toBe('M2 2L3 3')
    expect(built.paths.primary).toBe('')
  })

  test('drops transportation classes outside the drawn set', () => {
    const built = buildTilePaths(
      tile({ transportation: layer([feature(2, { class: 'path' }, [ring([0, 0, 1, 1])])]) }),
      BUILD,
    )

    expect(built.features).toBe(0)
    expect(Object.values(built.paths).every((path) => path === '')).toBe(true)
  })

  test('reads every ring of a multi-ring polygon', () => {
    const built = buildTilePaths(
      tile({
        building: layer([
          feature(3, {}, [ring([0, 0, 4, 0, 4, 4, 0, 0]), ring([1, 1, 2, 1, 2, 2, 1, 1])]),
        ]),
      }),
      BUILD,
    )

    expect(built.paths.building).toBe('M0 0L4 0L4 4L0 0ZM1 1L2 1L2 2L1 1Z')
  })

  test('leaves the building path empty when buildings are switched off', () => {
    const layers = {
      building: layer([feature(3, {}, [ring([0, 0, 4, 0, 4, 4, 0, 0])])]),
    }

    expect(buildTilePaths(tile(layers), { buildings: false }).paths.building).toBe('')
    expect(buildTilePaths(tile(layers), { buildings: false }).features).toBe(0)
  })

  test('skips a degenerate ring of one point', () => {
    const built = buildTilePaths(
      tile({ transportation: layer([feature(2, { class: 'minor' }, [ring([7, 7])])]) }),
      BUILD,
    )

    expect(built.paths.minor).toBe('')
  })

  test('falls back to the default extent for a tile without a drawn layer', () => {
    expect(buildTilePaths(tile({}), BUILD).extent).toBe(4096)
  })
})
