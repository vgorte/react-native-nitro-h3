import { type Bounds, mercatorX, mercatorY } from './projection'

/** Holds a rectangle of coordinates in degrees, the region one run draws its points in. */
export interface BoundingBox {
  south: number
  west: number
  north: number
  east: number
}

/** Holds one block of a chunked run: where it starts in the run and how many points it holds. */
export interface Block {
  from: number
  count: number
}

/** Holds the points of one run, kept so a run that draws the same ones need not draw them again. */
export interface PointCache {
  seed: number
  count: number
  /** The points as they were drawn, one array a block, so no call is handed a windowed view. */
  blocks: Float64Array[]
  /** What drawing them took, which the HUD keeps showing, as a cached figure, while they serve. */
  ms: number
}

/** The Berlin administrative bounding box, the sample region of the act. */
export const BERLIN: BoundingBox = { south: 52.3383, west: 13.0884, north: 52.6755, east: 13.7612 }

/** Hotspots the synthetic points cluster around. */
export const HOTSPOTS = 12

/** Standard deviation of a hotspot, in degrees, about 1.3 km north to south. */
export const HOTSPOT_SIGMA_DEG = 0.012

/** Points one block of a chunked run holds, after which the run yields to the loop. */
export const BLOCK = 100_000

/** Cells up to which the outline strip is drawn; above it the cells are drawn inset instead. */
export const OUTLINE_MAX_CELLS = 20_000

// mulberry32: a small deterministic generator, so a seed reproduces a run exactly
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Opens the point stream of one run: draws the hotspots of `seed`, then the points around them.
 *
 * Every block continues the stream the block before it left, so a run cut into blocks draws exactly
 * the points one call for the whole run would have drawn, which is what lets the act yield to the
 * loop between blocks without the seed meaning something else.
 *
 * @param seed The run's seed, which the reseed control bumps.
 * @param box The region the points are drawn in and clamped to.
 * @returns A draw that answers the next `count` coordinates, latitude first.
 */
export function pointStream(seed: number, box: BoundingBox): (count: number) => Float64Array {
  const next = random(seed)
  const centres = new Float64Array(HOTSPOTS * 2)
  for (let hotspot = 0; hotspot < HOTSPOTS; hotspot++) {
    centres[hotspot * 2] = box.south + next() * (box.north - box.south)
    centres[hotspot * 2 + 1] = box.west + next() * (box.east - box.west)
  }

  return (count: number): Float64Array => {
    const points = new Float64Array(count * 2)
    for (let point = 0; point < count; point++) {
      const hotspot = Math.floor(next() * HOTSPOTS) * 2
      // Box-Muller, one pair per point
      const radius = Math.sqrt(-2 * Math.log(1 - next())) * HOTSPOT_SIGMA_DEG
      const angle = 2 * Math.PI * next()
      points[point * 2] = Math.min(
        box.north,
        Math.max(box.south, centres[hotspot] + radius * Math.cos(angle)),
      )
      points[point * 2 + 1] = Math.min(
        box.east,
        Math.max(box.west, centres[hotspot + 1] + radius * Math.sin(angle)),
      )
    }
    return points
  }
}

/** Answers `count` synthetic coordinates from a mixture of hotspots, latitude first. */
export function generatePoints(count: number, seed: number, box: BoundingBox): Float64Array {
  return pointStream(seed, box)(count)
}

/**
 * Cuts a run of `count` points into the blocks it is generated and located in.
 *
 * A run at or under the block size answers one block, which is the unchunked run the act makes
 * without yielding at all.
 *
 * @param count The points the run holds.
 * @param size Points a block holds, {@linkcode BLOCK} for every run the act makes.
 */
export function blocksOf(count: number, size = BLOCK): Block[] {
  const blocks: Block[] = []
  for (let from = 0; from < count; from += size) {
    blocks.push({ from, count: Math.min(size, count - from) })
  }
  return blocks
}

/**
 * Answers whether a cache of points can serve a run.
 *
 * The seed and the point count are what a run's points depend on; the resolution enters one stage
 * later, so changing it reuses the points the last run drew.
 *
 * @param cache The points the last run kept, absent before the first one.
 * @param seed The run's seed.
 * @param count The points the run holds.
 */
export function servesRun(cache: PointCache | null, seed: number, count: number): boolean {
  return cache !== null && cache.seed === seed && cache.count === count
}

/** Answers the coordinate at the middle of a box, which the act's metre frame is anchored to. */
export function centreOf(box: BoundingBox): { lat: number; lng: number } {
  return { lat: (box.south + box.north) / 2, lng: (box.west + box.east) / 2 }
}

/**
 * Answers the extent of a box in the metre frame of its own centre, which the camera opens on.
 *
 * The y axis grows downward like the screen axis, the way the cell projection leaves it, so the
 * north edge is the top of the frame.
 */
export function boxBounds(box: BoundingBox): Bounds {
  const centre = centreOf(box)
  const centreX = mercatorX(centre.lng)
  const centreY = mercatorY(centre.lat)
  return {
    minX: mercatorX(box.west) - centreX,
    minY: centreY - mercatorY(box.north),
    maxX: mercatorX(box.east) - centreX,
    maxY: centreY - mercatorY(box.south),
  }
}
