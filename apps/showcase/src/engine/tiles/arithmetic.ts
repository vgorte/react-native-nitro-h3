import type { LatLng } from 'react-native-nitro-h3'
import { EARTH_RADIUS_M } from '../projection'
import type { StyleClass } from './decode'

/** Names a tile in the slippy-map scheme. */
export interface TileId {
  z: number
  x: number
  y: number
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

/** The camera zoom at which the basemap starts drawing. */
export const TILE_MIN_ZOOM = 9

/** OpenFreeMap's deepest tile zoom; beyond it the zoom 14 tiles are overzoomed. */
export const TILE_MAX_ZOOM = 14

/** Answers the tile zoom for a camera zoom. */
export function tileZoomFor(zoom: number): number {
  'worklet'
  return Math.max(TILE_MIN_ZOOM, Math.min(TILE_MAX_ZOOM, Math.floor(zoom)))
}

const BASE_CLASSES: StyleClass[] = ['water', 'motorway', 'trunk', 'primary']
const MID_CLASSES: StyleClass[] = ['secondary', 'tertiary']
const NEAR_CLASSES: StyleClass[] = ['minor', 'service', 'building']

/** Answers the style classes drawn at a camera zoom. */
export function classesForZoom(zoom: number): StyleClass[] {
  if (zoom >= 14) return [...BASE_CLASSES, ...MID_CLASSES, ...NEAR_CLASSES]
  if (zoom >= 12) return [...BASE_CLASSES, ...MID_CLASSES]
  return BASE_CLASSES
}

/** Answers every tile the viewport touches, the centre tile first. */
export function visibleTiles(
  centre: LatLng,
  zoom: number,
  width: number,
  height: number,
): TileId[] {
  const z = tileZoomFor(zoom)
  const tilePx = 256 * 2 ** (zoom - z)
  const columns = Math.ceil(width / tilePx / 2) + 1
  const rows = Math.ceil(height / tilePx / 2) + 1
  const origin = lngLatToTile(centre.lng, centre.lat, z)
  const span = 2 ** z
  const tiles: TileId[] = []
  for (let row = -rows; row <= rows; row++) {
    for (let column = -columns; column <= columns; column++) {
      const y = origin.y + row
      if (y < 0 || y >= span) continue
      tiles.push({ z, x: (((origin.x + column) % span) + span) % span, y })
    }
  }
  // the centre tile is decoded first, so the middle of the screen fills in first
  tiles.sort(
    (left, right) =>
      Math.hypot(left.x - origin.x, left.y - origin.y) -
      Math.hypot(right.x - origin.x, right.y - origin.y),
  )
  return tiles
}

/** Answers a tile's north-west corner in Web Mercator metres and its span. */
export function tileOriginMetres(tile: TileId): { x: number; y: number; span: number } {
  const world = 2 * Math.PI * EARTH_RADIUS_M
  const span = world / 2 ** tile.z
  return { x: -world / 2 + tile.x * span, y: world / 2 - tile.y * span, span }
}
