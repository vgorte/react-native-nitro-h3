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
export const HOTSPOTS = 40

/** Standard deviation of a hotspot, in degrees, about 2.2 km north to south. */
export const HOTSPOT_SIGMA_DEG = 0.02

/** Share of a run drawn uniformly over the box, the noise the hotspots have to show through. */
export const UNIFORM_SHARE = 0.3

/** Holds the mixture a run's points are drawn from. */
export interface PointMix {
  /** Hotspots the points cluster around, each with a weight of its own. */
  hotspots: number
  /** Standard deviation of a hotspot, in degrees. */
  sigmaDeg: number
  /** Share of the points drawn uniformly over the box instead of around a hotspot. */
  uniformShare: number
}

/** The mixture every run of the act is drawn from. */
export const POINT_MIX: PointMix = {
  hotspots: HOTSPOTS,
  sigmaDeg: HOTSPOT_SIGMA_DEG,
  uniformShare: UNIFORM_SHARE,
}

/** Holds the hotspots of one run: where each stands and what share of the cluster it takes. */
export interface Hotspots {
  /** Latitude and longitude of every hotspot, latitude first. */
  centres: Float64Array
  /** The share of the clustered points each hotspot takes, summing to one. */
  weights: Float64Array
  /** The weights added up, which a draw between zero and one is looked up in. */
  cumulative: Float64Array
}

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

/** Draws the hotspots of a run from a stream that has not been read yet. */
function drawHotspots(next: () => number, box: BoundingBox, mix: PointMix): Hotspots {
  const centres = new Float64Array(mix.hotspots * 2)
  const weights = new Float64Array(mix.hotspots)
  let total = 0
  for (let hotspot = 0; hotspot < mix.hotspots; hotspot++) {
    centres[hotspot * 2] = box.south + next() * (box.north - box.south)
    centres[hotspot * 2 + 1] = box.west + next() * (box.east - box.west)
    // a weight of its own per hotspot, so the field reads as a city and not as a lattice
    weights[hotspot] = next()
    total += weights[hotspot]
  }

  const cumulative = new Float64Array(mix.hotspots)
  let running = 0
  for (let hotspot = 0; hotspot < mix.hotspots; hotspot++) {
    weights[hotspot] /= total
    running += weights[hotspot]
    cumulative[hotspot] = running
  }
  return { centres, weights, cumulative }
}

/** Answers the hotspot a draw between zero and one falls on, by its share of the cluster. */
function hotspotAt(cumulative: Float64Array, draw: number): number {
  let low = 0
  let high = cumulative.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (draw > cumulative[middle]) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Answers the hotspots a run draws its clustered points around.
 *
 * A stream reads its hotspots off the front of its own sequence, so this answers exactly the ones
 * {@linkcode pointStream} uses for the same seed, box and mixture.
 *
 * @param seed The run's seed, which the reseed control bumps.
 * @param box The region the hotspots are placed in.
 * @param mix The mixture the run is drawn from.
 */
export function hotspotsOf(seed: number, box: BoundingBox, mix: PointMix = POINT_MIX): Hotspots {
  return drawHotspots(random(seed), box, mix)
}

/**
 * Opens the point stream of one run: draws the hotspots of `seed`, then the points around them.
 *
 * Every block continues the stream the block before it left, so a run cut into blocks draws exactly
 * the points one call for the whole run would have drawn, which is what lets the act yield to the
 * loop between blocks without the seed meaning something else.
 *
 * A hotspot's points are not held to the box: a cluster on its edge scatters past it, and the box
 * is only the frame the run opens on. The uniform share is what still stands inside it.
 *
 * @param seed The run's seed, which the reseed control bumps.
 * @param box The region the hotspots and the uniform share are drawn in.
 * @param mix The mixture the run is drawn from.
 * @returns A draw that answers the next `count` coordinates, latitude first.
 */
export function pointStream(
  seed: number,
  box: BoundingBox,
  mix: PointMix = POINT_MIX,
): (count: number) => Float64Array {
  const next = random(seed)
  const { centres, cumulative } = drawHotspots(next, box, mix)

  return (count: number): Float64Array => {
    const points = new Float64Array(count * 2)
    for (let point = 0; point < count; point++) {
      if (next() < mix.uniformShare) {
        points[point * 2] = box.south + next() * (box.north - box.south)
        points[point * 2 + 1] = box.west + next() * (box.east - box.west)
        continue
      }
      const hotspot = hotspotAt(cumulative, next()) * 2
      // Box-Muller, one pair per point
      const radius = Math.sqrt(-2 * Math.log(1 - next())) * mix.sigmaDeg
      const angle = 2 * Math.PI * next()
      points[point * 2] = centres[hotspot] + radius * Math.cos(angle)
      points[point * 2 + 1] = centres[hotspot + 1] + radius * Math.sin(angle)
    }
    return points
  }
}

/** Answers `count` synthetic coordinates from a mixture of hotspots, latitude first. */
export function generatePoints(
  count: number,
  seed: number,
  box: BoundingBox,
  mix: PointMix = POINT_MIX,
): Float64Array {
  return pointStream(seed, box, mix)(count)
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
