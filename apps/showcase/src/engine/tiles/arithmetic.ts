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
