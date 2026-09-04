import { type TileId, tileUrl } from './arithmetic'
import { buildTilePaths, decodeTile, type StyleClass, type TilePaths } from './decode'

/** Serves decoded tiles from memory and fetches the ones the camera asks for. */
export interface TileSource {
  /** Answers a decoded tile when it holds geometry in `classes`, or `undefined` while it comes. */
  paths(tile: TileId, classes: StyleClass[]): TilePaths | undefined
  /** Queues a tile for fetching and decoding; a tile already held or queued is ignored. */
  request(tile: TileId): void
  /** The line the map's licence requires on screen. */
  attribution: string
}

/** Decoded tiles kept in memory; there is no disk cache. */
export const LRU_TILES = 64

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'
const MAX_IN_FLIGHT = 4
const DEFAULT_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles, data from OpenStreetMap'

/** Reduces the TileJSON's HTML attribution to the plain line the HUD draws. */
function plainAttribution(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&copy;/g, '©')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Creates the tile source: one TileJSON read, at most four fetches in flight, one decode per turn.
 *
 * Decoding a dense tile costs tens of milliseconds, so a tile is decoded on its own `setTimeout`
 * turn and a gesture keeps the thread between two of them. Every failure is silent, and the
 * geometry above the basemap draws without it.
 *
 * @param onDecoded Called after a tile enters the cache, so the layer can draw it.
 */
export function createTileSource(onDecoded?: () => void): TileSource {
  const cache = new Map<string, TilePaths>()
  const pending = new Set<string>()
  const wanted: TileId[] = []
  const queue: { tile: TileId; bytes: Uint8Array }[] = []
  let template: string | undefined
  let attribution = DEFAULT_ATTRIBUTION
  let metadata: Promise<void> | undefined
  let inFlight = 0
  let draining = false

  const key = (tile: TileId): string => `${tile.z}/${tile.x}/${tile.y}`

  const drain = (): void => {
    if (draining || queue.length === 0) return
    draining = true
    setTimeout(() => {
      const next = queue.shift()
      draining = false
      if (next !== undefined) {
        const decoded = decodeTile(next.bytes)
        const paths = buildTilePaths(decoded.tile, { buildings: true })
        if (cache.size >= LRU_TILES) cache.delete(cache.keys().next().value as string)
        cache.set(key(next.tile), paths)
        onDecoded?.()
      }
      drain()
    }, 0)
  }

  const readMetadata = async (): Promise<void> => {
    const response = await fetch(TILEJSON_URL)
    const json = (await response.json()) as { tiles?: string[]; attribution?: string }
    if (typeof json.tiles?.[0] === 'string') template = json.tiles[0]
    if (typeof json.attribution === 'string') attribution = plainAttribution(json.attribution)
  }

  const load = async (tile: TileId): Promise<void> => {
    // the dated path segment lives in the TileJSON, never in code
    metadata ??= readMetadata()
    await metadata
    if (template === undefined) return
    const response = await fetch(tileUrl(template, tile))
    if (!response.ok) return
    queue.push({ tile, bytes: new Uint8Array(await response.arrayBuffer()) })
    drain()
  }

  const pump = (): void => {
    while (inFlight < MAX_IN_FLIGHT) {
      const tile = wanted.shift()
      if (tile === undefined) return
      inFlight += 1
      load(tile)
        .catch(() => {
          // a failed TileJSON read must not stick, or nothing loads later
          if (template === undefined) metadata = undefined
        })
        .then(() => {
          inFlight -= 1
          pending.delete(key(tile))
          pump()
        })
    }
  }

  return {
    paths(tile: TileId, classes: StyleClass[]): TilePaths | undefined {
      const id = key(tile)
      const entry = cache.get(id)
      if (entry === undefined) return undefined
      // re-inserting moves the tile to the young end of the cache
      cache.delete(id)
      cache.set(id, entry)
      return classes.some((style) => entry.paths[style] !== '') ? entry : undefined
    },
    request(tile: TileId): void {
      const id = key(tile)
      if (cache.has(id) || pending.has(id)) return
      pending.add(id)
      wanted.push(tile)
      pump()
    },
    get attribution(): string {
      return attribution
    },
  }
}
