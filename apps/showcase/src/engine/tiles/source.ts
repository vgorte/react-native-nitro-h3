import type { VertexProjector } from '../projection'
import { type TileId, tileUrl } from './arithmetic'
import {
  buildTilePaths,
  type DecodedTile,
  decodeTile,
  type StyleClass,
  type TilePaths,
} from './decode'

/** Serves decoded tiles from memory and fetches the ones the camera asks for. */
export interface TileSource {
  /**
   * Answers a tile's paths when it holds geometry in `classes`, or `undefined` while it comes.
   *
   * With a projector the paths are screen pixels of the view `epoch` names, built on the first
   * call of that epoch and kept until the next one; without it they stay in tile coordinates.
   */
  paths(
    tile: TileId,
    classes: StyleClass[],
    project?: VertexProjector,
    epoch?: number,
  ): TilePaths | undefined
  /** Queues a tile for fetching and decoding; a tile already held or queued is ignored. */
  request(tile: TileId): void
  /** Drops every queued tile outside `visible`, so a pan does not decode what it left behind. */
  prune(visible: TileId[]): void
  /** The line the map's licence requires on screen. */
  attribution: string
}

/** Decoded tiles kept in memory; there is no disk cache. */
export const LRU_TILES = 64

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'
const MAX_IN_FLIGHT = 4
const DEFAULT_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles, data from OpenStreetMap'

// a burst of tiles redraws a few times, not once per tile
const NOTIFY_MS = 250

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
 * turn and a gesture keeps the thread between two of them. Every failure is silent, a bad body
 * included, and the geometry above the basemap draws without the tile.
 *
 * @param onDecoded Called after tiles enter the cache, coalesced so a burst is a few calls.
 */
export function createTileSource(onDecoded?: () => void): TileSource {
  const cache = new Map<string, DecodedTile>()
  const built = new Map<string, TilePaths>()
  let builtFor = ''
  const pending = new Set<string>()
  const wanted: TileId[] = []
  const queue: { tile: TileId; bytes: Uint8Array }[] = []
  let template: string | undefined
  let attribution = DEFAULT_ATTRIBUTION
  let metadata: Promise<void> | undefined
  let inFlight = 0
  let draining = false
  let landed = false
  let notifiedAt = 0

  const key = (tile: TileId): string => `${tile.z}/${tile.x}/${tile.y}`

  const notify = (): void => {
    const now = Date.now()
    if (!landed || (queue.length > 0 && now - notifiedAt < NOTIFY_MS)) return
    landed = false
    notifiedAt = now
    onDecoded?.()
  }

  const drain = (): void => {
    if (draining || queue.length === 0) return
    draining = true
    setTimeout(() => {
      const next = queue.shift()
      draining = false
      if (next !== undefined) {
        try {
          const decoded = decodeTile(next.bytes)
          if (cache.size >= LRU_TILES) cache.delete(cache.keys().next().value as string)
          cache.set(key(next.tile), decoded.tile)
          landed = true
        } catch {
          // a non-tile body is as silent as a failed fetch
        }
        // releasing the key here keeps a settle from fetching it twice
        pending.delete(key(next.tile))
      }
      notify()
      drain()
    }, 0)
  }

  const readMetadata = async (): Promise<void> => {
    const response = await fetch(TILEJSON_URL)
    const json = (await response.json()) as { tiles?: string[]; attribution?: string }
    if (typeof json.attribution === 'string') attribution = plainAttribution(json.attribution)
    // a TileJSON without a template must fail, or the source wedges
    if (typeof json.tiles?.[0] !== 'string') throw new Error('tilejson carries no tile template')
    template = json.tiles[0]
  }

  const load = async (tile: TileId): Promise<boolean> => {
    // the dated path segment lives in the TileJSON, never in code
    metadata ??= readMetadata()
    await metadata
    if (template === undefined) return false
    const response = await fetch(tileUrl(template, tile))
    if (!response.ok) return false
    queue.push({ tile, bytes: new Uint8Array(await response.arrayBuffer()) })
    drain()
    return true
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
          return false
        })
        .then((queued) => {
          inFlight -= 1
          if (!queued) pending.delete(key(tile))
          pump()
        })
    }
  }

  return {
    paths(
      tile: TileId,
      classes: StyleClass[],
      project?: VertexProjector,
      epoch = 0,
    ): TilePaths | undefined {
      const id = key(tile)
      const decoded = cache.get(id)
      if (decoded === undefined) return undefined
      // re-inserting moves the tile to the young end of the cache
      cache.delete(id)
      cache.set(id, decoded)

      const generation = `${epoch}|${classes.join(',')}`
      if (generation !== builtFor) {
        built.clear()
        builtFor = generation
      }
      let entry = built.get(id)
      if (entry === undefined) {
        try {
          entry = buildTilePaths(decoded, {
            buildings: classes.includes('building'),
            classes,
            projection: project === undefined ? undefined : { id: tile, project },
          })
        } catch {
          // a tile whose geometry does not decode is as silent as a failed fetch
          return undefined
        }
        built.set(id, entry)
      }
      return classes.some((style) => entry.paths[style] !== '') ? entry : undefined
    },
    request(tile: TileId): void {
      const id = key(tile)
      if (cache.has(id) || pending.has(id)) return
      pending.add(id)
      wanted.push(tile)
      pump()
    },
    prune(visible: TileId[]): void {
      const keep = new Set(visible.map(key))
      const dropped = (tile: TileId): boolean => {
        const id = key(tile)
        if (keep.has(id)) return false
        pending.delete(id)
        return true
      }
      for (let index = wanted.length - 1; index >= 0; index--) {
        if (dropped(wanted[index])) wanted.splice(index, 1)
      }
      for (let index = queue.length - 1; index >= 0; index--) {
        if (dropped(queue[index].tile)) queue.splice(index, 1)
      }
    },
    get attribution(): string {
      return attribution
    },
  }
}
