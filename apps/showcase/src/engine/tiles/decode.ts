import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { RAD_TO_DEG, type VertexProjector } from '../projection'
import type { TileId } from './arithmetic'

const DEFAULT_EXTENT = 4096
const WATER_LAYER = 'water'
const ROAD_LAYER = 'transportation'
const ROAD_NAME_LAYER = 'transportation_name'
const BUILDING_LAYER = 'building'

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

/** Carries a tile's own identity together with the projector its vertices run through. */
export interface TileProjection {
  /** The tile the coordinates belong to, so a vertex can be turned into a coordinate. */
  id: TileId
  project: VertexProjector
}

/** Configures {@linkcode buildTilePaths}. */
export interface TilePathOptions {
  /** Whether the `building` layer contributes outlines. */
  buildings: boolean
  /** The classes that become paths; by default every class the styles name. */
  classes?: StyleClass[]
  /** Projects every vertex to the screen; without it the paths stay in tile coordinates. */
  projection?: TileProjection
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
 * Answers the projector of one tile's coordinates, or `undefined` for the tile-coordinate form.
 *
 * The inverse of the tile arithmetic runs per vertex: the column becomes a longitude and the row a
 * Web Mercator ordinate, whose latitude the projector then places on the sphere.
 */
function vertexFrame(
  projection: TileProjection | undefined,
  extent: number,
): ((x: number, y: number) => [number, number] | undefined) | undefined {
  if (projection === undefined) return undefined
  const { id, project } = projection
  const span = 2 ** id.z
  const lngAt = 360 / (extent * span)
  const lngFrom = (id.x / span) * 360 - 180
  const merAt = (-2 * Math.PI) / (extent * span)
  const merFrom = Math.PI * (1 - (2 * id.y) / span)
  return (x, y) =>
    project(lngFrom + x * lngAt, Math.atan(Math.sinh(merFrom + y * merAt)) * RAD_TO_DEG)
}

function appendProjected(
  parts: string[],
  rings: TilePoint[][],
  close: boolean,
  at: (x: number, y: number) => [number, number] | undefined,
): void {
  for (const ring of rings) {
    let part = ''
    let length = 0
    let whole = true
    for (const point of ring) {
      const screen = at(point.x, point.y)
      if (screen === undefined) {
        whole = false
        if (length > 1) parts.push(part)
        part = ''
        length = 0
        continue
      }
      part += `${length === 0 ? 'M' : 'L'}${screen[0].toFixed(1)} ${screen[1].toFixed(1)}`
      length += 1
    }
    if (length > 1) parts.push(close && whole ? `${part}Z` : part)
  }
}

/**
 * Builds one SVG path string per style class from a decoded tile.
 *
 * Water and buildings become closed subpaths, roads open polylines grouped by their `class`
 * property. Only the asked classes are read, so the cost tracks what ends up on screen; with a
 * projection the numbers are screen pixels and a subpath breaks wherever a vertex faces away.
 */
export function buildTilePaths(tile: DecodedTile, options: TilePathOptions): TilePaths {
  const parts = {} as Record<StyleClass, string[]>
  for (const style of STYLE_CLASSES) parts[style] = []
  const drawn = new Set<string>(options.classes ?? STYLE_CLASSES)

  const water = tile.layers[WATER_LAYER]
  const roads = tile.layers[ROAD_LAYER]
  const buildings = tile.layers[BUILDING_LAYER]

  // the drawn layers of an OpenMapTiles tile share one extent, so the first present one stands
  const extent = (roads ?? water ?? buildings)?.extent ?? DEFAULT_EXTENT
  const at = vertexFrame(options.projection, extent)
  const append = (target: string[], rings: TilePoint[][], close: boolean): void => {
    if (at === undefined) appendRings(target, rings, close)
    else appendProjected(target, rings, close, at)
  }
  let features = 0

  if (water !== undefined && drawn.has('water')) {
    for (let index = 0; index < water.length; index++) {
      append(parts.water, water.feature(index).loadGeometry(), true)
      features += 1
    }
  }

  if (roads !== undefined) {
    for (let index = 0; index < roads.length; index++) {
      const feature = roads.feature(index)
      const road = feature.properties.class
      if (!isRoadClass(road) || !drawn.has(road)) continue
      append(parts[road], feature.loadGeometry(), false)
      features += 1
    }
  }

  if (options.buildings && buildings !== undefined && drawn.has('building')) {
    for (let index = 0; index < buildings.length; index++) {
      append(parts.building, buildings.feature(index).loadGeometry(), true)
      features += 1
    }
  }

  const paths = {} as Record<StyleClass, string>
  for (const style of STYLE_CLASSES) paths[style] = parts[style].join('')

  return { paths, extent, features }
}
