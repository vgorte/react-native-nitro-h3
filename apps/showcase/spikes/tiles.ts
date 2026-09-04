import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'

const DEFAULT_EXTENT = 4096
const WATER_LAYER = 'water'
const ROAD_LAYER = 'transportation'
const ROAD_NAME_LAYER = 'transportation_name'
const BUILDING_LAYER = 'building'

/** Names a tile in the slippy-map scheme. */
export interface TileId {
  z: number
  x: number
  y: number
}

/** Holds one vertex in tile coordinates, `0` to the layer extent across the tile. */
export interface TilePoint {
  x: number
  y: number
}

/** Holds the part of a decoded feature the hairline draw needs. */
export interface TileFeature {
  type: number
  extent: number
  properties: Record<string, number | string | boolean>
  loadGeometry(): TilePoint[][]
}

/** Holds the part of a decoded layer the hairline draw needs. */
export interface TileLayer {
  length: number
  extent: number
  feature(index: number): TileFeature
}

/** Holds a decoded tile, layers by name. */
export interface DecodedTile {
  layers: Record<string, TileLayer>
}

/** Names the transportation classes drawn as hairlines, widest road first. */
export const ROAD_CLASSES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
] as const

export type RoadClass = (typeof ROAD_CLASSES)[number]

/** Names every style class that becomes its own path string. */
export const STYLE_CLASSES = ['water', ...ROAD_CLASSES, 'building'] as const

export type StyleClass = (typeof STYLE_CLASSES)[number]

/** Configures {@linkcode buildTilePaths}. */
export interface TilePathOptions {
  /** Whether the `building` layer contributes outlines. */
  buildings: boolean
}

/** Holds one SVG path string per style class together with the tile's extent. */
export interface TilePaths {
  paths: Record<StyleClass, string>
  extent: number
  features: number
}

/** Holds a decoded tile with the evidence that its property strings survived the decoder. */
export interface DecodeResult {
  tile: DecodedTile
  features: number
  sampleName: string | null
}

/**
 * Finds the tile containing a coordinate at a zoom level.
 *
 * @param lng Longitude in degrees.
 * @param lat Latitude in degrees.
 * @param zoom Tile zoom level.
 */
export function lngLatToTile(lng: number, lat: number, zoom: number): TileId {
  const scale = 2 ** zoom
  const phi = (lat * Math.PI) / 180
  return {
    z: zoom,
    x: Math.floor(((lng + 180) / 360) * scale),
    y: Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * scale),
  }
}

/** Answers the `columns` by `rows` block of tiles whose north-west corner is `origin`. */
export function tileGrid(origin: TileId, columns: number, rows: number): TileId[] {
  const tiles: TileId[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      tiles.push({ z: origin.z, x: origin.x + column, y: origin.y + row })
    }
  }
  return tiles
}

/** Fills a TileJSON `{z}/{x}/{y}` template with a tile. */
export function tileUrl(template: string, tile: TileId): string {
  return template
    .replace('{z}', `${tile.z}`)
    .replace('{x}', `${tile.x}`)
    .replace('{y}', `${tile.y}`)
}

/**
 * Decodes a tile and walks every feature so the property tables are materialised.
 *
 * The returned `sampleName` is the first road name in the tile, which is the check that the
 * `pbf` UTF-8 fallback works on a runtime without `TextDecoder`.
 */
export function decodeTile(bytes: Uint8Array): DecodeResult {
  const tile = new VectorTile(new PbfReader(bytes)) as unknown as DecodedTile
  let features = 0
  let sampleName: string | null = null

  for (const [name, layer] of Object.entries(tile.layers)) {
    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index)
      features += 1
      if (sampleName === null && name === ROAD_NAME_LAYER) {
        const value = feature.properties.name
        if (typeof value === 'string') sampleName = value
      }
    }
  }

  return { tile, features, sampleName }
}

function appendRings(parts: string[], rings: TilePoint[][], close: boolean): void {
  for (const ring of rings) {
    if (ring.length < 2) continue
    let part = `M${ring[0].x} ${ring[0].y}`
    for (let vertex = 1; vertex < ring.length; vertex++) {
      part += `L${ring[vertex].x} ${ring[vertex].y}`
    }
    parts.push(close ? `${part}Z` : part)
  }
}

function isRoadClass(value: number | string | boolean | undefined): value is RoadClass {
  return typeof value === 'string' && (ROAD_CLASSES as readonly string[]).includes(value)
}

/**
 * Builds one SVG path string per style class from a decoded tile, in tile coordinates.
 *
 * Water and buildings become closed subpaths, roads open polylines grouped by their `class`
 * property. Only the drawn layers are read, so the cost tracks what ends up on screen.
 */
export function buildTilePaths(tile: DecodedTile, options: TilePathOptions): TilePaths {
  const parts = {} as Record<StyleClass, string[]>
  for (const style of STYLE_CLASSES) parts[style] = []

  const water = tile.layers[WATER_LAYER]
  const roads = tile.layers[ROAD_LAYER]
  const buildings = tile.layers[BUILDING_LAYER]

  // the drawn layers of an OpenMapTiles tile share one extent, so the first present one stands
  const extent = (roads ?? water ?? buildings)?.extent ?? DEFAULT_EXTENT
  let features = 0

  if (water !== undefined) {
    for (let index = 0; index < water.length; index++) {
      appendRings(parts.water, water.feature(index).loadGeometry(), true)
      features += 1
    }
  }

  if (roads !== undefined) {
    for (let index = 0; index < roads.length; index++) {
      const feature = roads.feature(index)
      const road = feature.properties.class
      if (!isRoadClass(road)) continue
      appendRings(parts[road], feature.loadGeometry(), false)
      features += 1
    }
  }

  if (options.buildings && buildings !== undefined) {
    for (let index = 0; index < buildings.length; index++) {
      appendRings(parts.building, buildings.feature(index).loadGeometry(), true)
      features += 1
    }
  }

  const paths = {} as Record<StyleClass, string>
  for (const style of STYLE_CLASSES) paths[style] = parts[style].join('')

  return { paths, extent, features }
}
