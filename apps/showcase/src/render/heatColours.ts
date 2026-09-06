import { BUCKETS, bucketOfCount, colours, rampColours } from '../theme/tokens'

/**
 * The colours a busy cell is drawn in, the theme ramp with the contrast colour at its hot end.
 *
 * The ramp runs cold blue to white, which reads as intensity but not as heat; the amber the theme
 * already keeps for the hot end takes the last step, so the busiest cells stand out of the field.
 */
export const heatPalette: readonly string[] = rampColours(BUCKETS).map((colour, bucket) =>
  bucket === BUCKETS - 1 ? colours.contrast : colour,
)

/** The colour a covered cell no point landed in is drawn in, under the grid strip. */
export const EMPTY_COLOUR = colours.hairline

/** Alpha the empty cells are drawn at, low enough that the basemap still reads through them. */
export const EMPTY_ALPHA = 0.18

/** The quantile of the busy cells the ramp's first step is anchored at. */
const LOW_QUANTILE = 0.25

/** The quantile of the busy cells the ramp's top step is anchored at, its busiest percent. */
const HIGH_QUANTILE = 0.99

/** Holds the two counts one run's ramp is spread between. */
export interface Anchors {
  low: number
  high: number
}

/** Counts that keep a bin to themselves, which is every count a busy map of cells reaches. */
const EXACT_COUNTS = 1024

/** The exact counts end at this power of two. */
const EXACT_OCTAVE = 10

/** Bins one doubling of a count past the exact ones is cut into, which sets how close it lands. */
const BINS_PER_OCTAVE = 16

/** Bins the histogram holds, enough for every count a `Uint32Array` can carry. */
const BINS = EXACT_COUNTS + (32 - EXACT_OCTAVE) * BINS_PER_OCTAVE

/** Answers the bin a count at or past {@linkcode EXACT_COUNTS} falls in, a step of its doubling. */
function coarseBin(count: number): number {
  const octave = 31 - Math.clz32(count)
  const step = (count >>> (octave - 4)) & (BINS_PER_OCTAVE - 1)
  return EXACT_COUNTS + (octave - EXACT_OCTAVE) * BINS_PER_OCTAVE + step
}

/** Answers the count a bin stands for, its lower edge, which is what an anchor is read off. */
function countOfBin(bin: number): number {
  if (bin < EXACT_COUNTS) return bin
  const above = bin - EXACT_COUNTS
  const octave = EXACT_OCTAVE + Math.floor(above / BINS_PER_OCTAVE)
  const step = above - (octave - EXACT_OCTAVE) * BINS_PER_OCTAVE
  return (BINS_PER_OCTAVE + step) * 2 ** (octave - 4)
}

/**
 * Answers the counts at {@linkcode LOW_QUANTILE} and {@linkcode HIGH_QUANTILE} of the busy cells.
 *
 * A histogram of a fixed size answers both in one pass of the cells and one of the bins, which is
 * what keeps the anchors inside the window the colours row names. With no cell above `0` both
 * anchors are `1`, which leaves every cell on the empty step.
 *
 * @param counts The points per cell, of which the cells of no points are left out.
 */
export function anchorsOfCounts(counts: Uint32Array): Anchors {
  const histogram = new Uint32Array(BINS)
  let busy = 0
  for (let cell = 0; cell < counts.length; cell++) {
    const count = counts[cell]
    if (count <= 0) continue
    histogram[count < EXACT_COUNTS ? count : coarseBin(count)] += 1
    busy += 1
  }
  if (busy === 0) return { low: 1, high: 1 }

  const lowRank = Math.max(1, Math.ceil(LOW_QUANTILE * busy))
  const highRank = Math.max(1, Math.ceil(HIGH_QUANTILE * busy))
  let low = 1
  let high = 1
  let found = false
  let seen = 0
  // a bound taken from the caller's count would leave the tail bins uncounted
  for (let bin = 0; bin < BINS; bin++) {
    seen += histogram[bin]
    if (!found && seen >= lowRank) {
      low = countOfBin(bin)
      found = true
    }
    if (seen >= highRank) {
      high = countOfBin(bin)
      break
    }
  }
  return { low, high }
}

/**
 * Answers the ramp bucket of every cell from the points that landed in it.
 *
 * It stands beside the recording rather than in the engine, because the ramp is a theme rule; it
 * stands beside {@linkcode buildHeatScene} rather than inside it, because it is the one piece of
 * the recording that can be tested without Skia.
 *
 * @param counts The points per cell, as `aggregateCells` counted them.
 * @param buckets Steps the ramp is cut into, which the caller takes from the theme.
 */
export function bucketsOfCounts(counts: Uint32Array, buckets: number): Uint8Array {
  const { low, high } = anchorsOfCounts(counts)
  const of = new Uint8Array(counts.length)
  for (let cell = 0; cell < counts.length; cell++) {
    of[cell] = bucketOfCount(counts[cell], low, high, buckets)
  }
  return of
}
