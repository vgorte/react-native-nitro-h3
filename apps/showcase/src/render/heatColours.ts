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
interface Anchors {
  low: number
  high: number
}

/**
 * Answers the counts at {@linkcode LOW_QUANTILE} and {@linkcode HIGH_QUANTILE} of the busy cells.
 *
 * A counting histogram over the integer counts answers both in one pass of the cells and one of the
 * counts they reach, which is what keeps the anchors inside the window the colours row names.
 *
 * @param counts The points per cell, of which the cells of no points are left out.
 * @param max The busiest cell's count, which the histogram is sized by.
 */
function anchorsOfCounts(counts: Uint32Array, max: number): Anchors {
  const histogram = new Uint32Array(max + 1)
  let busy = 0
  for (let cell = 0; cell < counts.length; cell++) {
    const count = counts[cell]
    if (count <= 0) continue
    histogram[count] += 1
    busy += 1
  }
  if (busy === 0) return { low: 1, high: 1 }

  const lowRank = Math.max(1, Math.ceil(LOW_QUANTILE * busy))
  const highRank = Math.max(1, Math.ceil(HIGH_QUANTILE * busy))
  let low = max
  let high = max
  let found = false
  let seen = 0
  for (let count = 1; count <= max; count++) {
    seen += histogram[count]
    if (!found && seen >= lowRank) {
      low = count
      found = true
    }
    if (seen >= highRank) {
      high = count
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
 * @param max The busiest cell's count, as `aggregateCells` answered it.
 * @param buckets Steps the ramp is cut into, which the caller takes from the theme.
 */
export function bucketsOfCounts(counts: Uint32Array, max: number, buckets: number): Uint8Array {
  const { low, high } = anchorsOfCounts(counts, max)
  const of = new Uint8Array(counts.length)
  for (let cell = 0; cell < counts.length; cell++) {
    of[cell] = bucketOfCount(counts[cell], low, high, buckets)
  }
  return of
}
