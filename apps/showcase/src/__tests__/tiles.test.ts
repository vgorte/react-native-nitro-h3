import { afterEach, describe, expect, test } from 'bun:test'
import { PbfWriter } from 'pbf'
import { EARTH_RADIUS_M, mercatorX, mercatorY, type VertexProjector } from '../engine/projection'
import {
  buildTilePaths,
  classesForZoom,
  createTileSource,
  type DecodedTile,
  LRU_TILES,
  lngLatToTile,
  type TileFeature,
  type TileId,
  type TileLayer,
  type TilePoint,
  tileGrid,
  tileOriginMetres,
  tileUrl,
  tileZoomFor,
  visibleTiles,
} from '../engine/tiles'

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

describe('buildTilePaths with a projection', () => {
  // the top-level tile turns its coordinates into whole degrees of longitude
  const WORLD = { z: 0, x: 0, y: 0 }
  const plain: VertexProjector = (lng, lat) => [lng, lat]
  const nearSide: VertexProjector = (lng, lat) => (lat > 80 ? undefined : [lng, lat])

  test('writes the projected vertices instead of the tile coordinates', () => {
    const built = buildTilePaths(
      tile({
        water: layer([
          feature(3, { class: 'river' }, [ring([2048, 2048, 0, 2048, 2048, 0, 2048, 2048])]),
        ]),
      }),
      { buildings: true, projection: { id: WORLD, project: plain } },
    )

    expect(built.paths.water).toBe('M0.0 0.0L-180.0 0.0L0.0 85.1L0.0 0.0Z')
  })

  test('breaks a polyline where the projection answers nothing', () => {
    const built = buildTilePaths(
      tile({
        transportation: layer([
          feature(2, { class: 'primary' }, [
            ring([0, 2048, 1024, 2048, 2048, 0, 3072, 2048, 4096, 2048]),
          ]),
        ]),
      }),
      { buildings: true, projection: { id: WORLD, project: nearSide } },
    )

    expect(built.paths.primary).toBe('M-180.0 0.0L-90.0 0.0M90.0 0.0L180.0 0.0')
  })

  test('leaves a ring the projection cut open', () => {
    const built = buildTilePaths(
      tile({
        water: layer([feature(3, {}, [ring([0, 2048, 2048, 0, 4096, 2048, 2048, 2048, 0, 2048])])]),
      }),
      { buildings: true, projection: { id: WORLD, project: nearSide } },
    )

    expect(built.paths.water).toBe('M180.0 0.0L0.0 0.0L-180.0 0.0')
  })

  test('builds only the classes it is asked for', () => {
    const built = buildTilePaths(
      tile({
        transportation: layer([
          feature(2, { class: 'motorway' }, [ring([0, 0, 1, 1])]),
          feature(2, { class: 'service' }, [ring([2, 2, 3, 3])]),
        ]),
      }),
      { buildings: true, classes: ['motorway'] },
    )

    expect(built.paths.motorway).toBe('M0 0L1 1')
    expect(built.paths.service).toBe('')
    expect(built.features).toBe(1)
  })
})

describe('tile selection', () => {
  test('clamps the tile zoom to the source maximum', () => {
    expect(tileZoomFor(11.4)).toBe(11)
    expect(tileZoomFor(16.9)).toBe(14)
  })

  test('adds the road classes the spec lists per zoom band', () => {
    expect(classesForZoom(10)).toEqual(['water', 'motorway', 'trunk', 'primary'])
    expect(classesForZoom(12)).toContain('secondary')
    expect(classesForZoom(12)).not.toContain('minor')
    expect(classesForZoom(14)).toContain('building')
  })

  test('covers the viewport with the tiles around the centre', () => {
    const centre = { lat: 52.52, lng: 13.405 }
    const tiles = visibleTiles(centre, 14, 400, 800)
    const origin = lngLatToTile(centre.lng, centre.lat, 14)

    expect(tiles).toContainEqual(origin)
    expect(tiles.length).toBeGreaterThanOrEqual(6)
    expect(tiles.every((tile) => tile.z === 14)).toBe(true)
  })

  test('asks for no tile below the zoom the basemap starts at', () => {
    expect(visibleTiles({ lat: 52.52, lng: 13.405 }, 8.9, 400, 800)).toEqual([])
    expect(visibleTiles({ lat: 52.52, lng: 13.405 }, 2, 400, 800)).toEqual([])
    expect(visibleTiles({ lat: 52.52, lng: 13.405 }, 9, 400, 800).length).toBeGreaterThan(0)
  })

  test('starts at the centre tile and wraps the columns at the date line', () => {
    const tiles = visibleTiles({ lat: 0, lng: 179.99 }, 9, 400, 400)

    expect(tiles[0]).toEqual(lngLatToTile(179.99, 0, 9))
    expect(tiles.map((tile) => tile.x)).toContain(0)
    expect(tiles.every((tile) => tile.x >= 0 && tile.x < 512)).toBe(true)
    expect(tiles.every((tile) => tile.y >= 0 && tile.y < 512)).toBe(true)
  })
})

describe('tileOriginMetres', () => {
  test('spans the whole world at zoom 0', () => {
    const world = 2 * Math.PI * EARTH_RADIUS_M

    expect(tileOriginMetres({ z: 0, x: 0, y: 0 })).toEqual({
      x: -world / 2,
      y: world / 2,
      span: world,
    })
  })

  test('places a tile at the mercator position of its north-west corner', () => {
    const tile = lngLatToTile(13.405, 52.52, 9)
    const origin = tileOriginMetres(tile)
    const lng = (tile.x / 2 ** tile.z) * 360 - 180
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * tile.y) / 2 ** tile.z))) * 180) / Math.PI

    expect(origin.x).toBeCloseTo(mercatorX(lng), 3)
    expect(origin.y).toBeCloseTo(mercatorY(lat), 3)
  })
})

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'
const TEMPLATE = 'https://tiles.openfreemap.org/planet/20260830_080001_pt/{z}/{x}/{y}.pbf'
const ATTRIBUTION = '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; OpenMapTiles'

/** Encodes a tile of one closed water ring, the smallest input the decoder accepts. */
function waterTileBuffer(): ArrayBuffer {
  const writer = new PbfWriter()
  writer.writeMessage(
    3,
    (geometry: number[], layer) => {
      layer.writeVarintField(15, 2)
      layer.writeStringField(1, 'water')
      layer.writeMessage(
        2,
        (rings: number[], feature) => {
          feature.writeVarintField(3, 3)
          feature.writePackedVarint(4, rings)
        },
        geometry,
      )
      layer.writeVarintField(5, 4096)
    },
    [9, 0, 0, 26, 20, 0, 0, 20, 19, 0, 15],
  )
  const bytes = writer.finish()
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

const originalFetch = globalThis.fetch

function fakeFetch(onTile: () => Promise<ArrayBuffer>): void {
  globalThis.fetch = (async (input: string) => {
    if (String(input) === TILEJSON_URL) {
      return { ok: true, json: async () => ({ tiles: [TEMPLATE], attribution: ATTRIBUTION }) }
    }
    return { ok: true, arrayBuffer: onTile }
  }) as unknown as typeof fetch
}

/** Drains the microtask queue without letting a timer run, so a decode cannot start. */
async function ticks(count: number): Promise<void> {
  for (let tick = 0; tick < count; tick++) await Promise.resolve()
}

async function until(ready: () => boolean, turns = 2000): Promise<void> {
  for (let turn = 0; turn < turns && !ready(); turn++) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

/** Stands in for the captive-portal page a proxy answers with a 200. */
const ERROR_PAGE = new TextEncoder().encode('<html><body>not a tile</body></html>').buffer

const WATER_PATH = 'M0 0L10 0L10 10L0 10L0 0Z'
const BERLIN_TILE: TileId = { z: 14, x: 8801, y: 5373 }

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('createTileSource', () => {
  test('answers a decoded tile after reading the template from the TileJSON', async () => {
    const bytes = waterTileBuffer()
    const asked: string[] = []
    globalThis.fetch = (async (input: string) => {
      asked.push(String(input))
      if (String(input) === TILEJSON_URL) {
        return { ok: true, json: async () => ({ tiles: [TEMPLATE], attribution: ATTRIBUTION }) }
      }
      return { ok: true, arrayBuffer: async () => bytes }
    }) as unknown as typeof fetch

    const source = createTileSource()
    source.request(BERLIN_TILE)

    expect(source.paths(BERLIN_TILE, ['water'])).toBeUndefined()
    await until(() => source.paths(BERLIN_TILE, ['water']) !== undefined)

    expect(source.paths(BERLIN_TILE, ['water'])?.paths.water).toBe(WATER_PATH)
    expect(source.paths(BERLIN_TILE, ['water'])?.extent).toBe(4096)
    expect(asked).toEqual([
      TILEJSON_URL,
      'https://tiles.openfreemap.org/planet/20260830_080001_pt/14/8801/5373.pbf',
    ])
    expect(source.attribution).toBe('OpenFreeMap © OpenMapTiles')
  })

  test('answers undefined for a tile with nothing in the asked classes', async () => {
    const bytes = waterTileBuffer()
    fakeFetch(async () => bytes)
    const source = createTileSource()
    source.request(BERLIN_TILE)
    await until(() => source.paths(BERLIN_TILE, ['water']) !== undefined)

    expect(source.paths(BERLIN_TILE, ['motorway', 'building'])).toBeUndefined()
  })

  test('keeps the geometry drawn when a fetch fails', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const source = createTileSource()
    source.request(BERLIN_TILE)
    await until(() => false, 20)

    expect(source.paths(BERLIN_TILE, ['water'])).toBeUndefined()
    expect(source.attribution).toContain('OpenFreeMap')
  })

  test('evicts the least recently drawn tile past the cache limit', async () => {
    const bytes = waterTileBuffer()
    fakeFetch(async () => bytes)
    const source = createTileSource()
    const tiles: TileId[] = []
    for (let x = 0; x <= LRU_TILES; x++) tiles.push({ z: 14, x, y: 5373 })

    for (let index = 0; index < LRU_TILES; index++) source.request(tiles[index])
    await until(() => source.paths(tiles[LRU_TILES - 1], ['water']) !== undefined)

    // reading tile 0 makes it young, so tile 1 is the oldest
    expect(source.paths(tiles[0], ['water'])).toBeDefined()
    source.request(tiles[LRU_TILES])
    await until(() => source.paths(tiles[LRU_TILES], ['water']) !== undefined)

    expect(source.paths(tiles[0], ['water'])).toBeDefined()
    expect(source.paths(tiles[1], ['water'])).toBeUndefined()
  })

  test('keeps draining when a body is not a tile', async () => {
    const bytes = waterTileBuffer()
    const second: TileId = { z: 14, x: 8802, y: 5373 }
    let tiles = 0
    globalThis.fetch = (async (input: string) => {
      if (String(input) === TILEJSON_URL) {
        return { ok: true, json: async () => ({ tiles: [TEMPLATE], attribution: ATTRIBUTION }) }
      }
      tiles += 1
      // the body is picked per response, because both fetches resolve first
      const body = tiles === 1 ? ERROR_PAGE : bytes
      return { ok: true, arrayBuffer: async () => body }
    }) as unknown as typeof fetch

    const source = createTileSource()
    source.request(BERLIN_TILE)
    source.request(second)
    await until(() => source.paths(second, ['water']) !== undefined)

    expect(source.paths(BERLIN_TILE, ['water'])).toBeUndefined()
    expect(source.paths(second, ['water'])?.paths.water).toBe(WATER_PATH)
  })

  test('does not fetch a tile again while it waits for its decode', async () => {
    const bytes = waterTileBuffer()
    let fetches = 0
    globalThis.fetch = (async (input: string) => {
      if (String(input) === TILEJSON_URL) {
        return { ok: true, json: async () => ({ tiles: [TEMPLATE] }) }
      }
      fetches += 1
      return { ok: true, arrayBuffer: async () => bytes }
    }) as unknown as typeof fetch

    const source = createTileSource()
    source.request(BERLIN_TILE)
    await ticks(60)
    source.request(BERLIN_TILE)
    await until(() => source.paths(BERLIN_TILE, ['water']) !== undefined)

    expect(fetches).toBe(1)
  })

  test('decodes only the tiles still visible after a prune', async () => {
    const bytes = waterTileBuffer()
    fakeFetch(async () => bytes)
    const source = createTileSource()
    const kept: TileId = { z: 14, x: 8801, y: 5373 }
    const gone: TileId[] = [
      { z: 14, x: 8802, y: 5373 },
      { z: 14, x: 8803, y: 5373 },
    ]

    source.request(kept)
    for (const tile of gone) source.request(tile)
    await ticks(60)
    source.prune([kept])
    await until(() => source.paths(kept, ['water']) !== undefined)
    await until(() => false, 30)

    expect(source.paths(gone[0], ['water'])).toBeUndefined()
    expect(source.paths(gone[1], ['water'])).toBeUndefined()
  })

  test('reads the TileJSON again when it carries no template', async () => {
    const bytes = waterTileBuffer()
    let template: string | undefined
    globalThis.fetch = (async (input: string) => {
      if (String(input) === TILEJSON_URL) {
        return { ok: true, json: async () => ({ tiles: template === undefined ? [] : [template] }) }
      }
      return { ok: true, arrayBuffer: async () => bytes }
    }) as unknown as typeof fetch

    const source = createTileSource()
    source.request(BERLIN_TILE)
    await until(() => false, 20)

    expect(source.paths(BERLIN_TILE, ['water'])).toBeUndefined()

    template = TEMPLATE
    source.request(BERLIN_TILE)
    await until(() => source.paths(BERLIN_TILE, ['water']) !== undefined)

    expect(source.paths(BERLIN_TILE, ['water'])?.paths.water).toBe(WATER_PATH)
  })
})
