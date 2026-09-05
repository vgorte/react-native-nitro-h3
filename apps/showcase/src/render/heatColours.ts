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

/**
 * Answers the ramp bucket of every cell from the points that landed in it.
 *
 * It stands beside the recording rather than in the engine, because the ramp is a theme rule; it
 * stands beside {@linkcode buildHeatScene} rather than inside it, because it is the one piece of
 * the recording that can be tested without Skia.
 *
 * @param counts The points per cell, as `aggregateCells` counted them.
 * @param low The quietest cell's count, which the ramp's darkest step stands for.
 * @param max The busiest cell's count, which the ramp's brightest step stands for.
 * @param buckets Steps the ramp is cut into, which the caller takes from the theme.
 */
export function bucketsOfCounts(
  counts: Uint32Array,
  low: number,
  max: number,
  buckets: number,
): Uint8Array {
  const of = new Uint8Array(counts.length)
  for (let cell = 0; cell < counts.length; cell++) {
    of[cell] = bucketOfCount(counts[cell], low, max, buckets)
  }
  return of
}
