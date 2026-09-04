/** Draws a bar no narrower than this, so even a thousandfold difference keeps a sliver. */
export const MIN_BAR_PX = 2

/**
 * Answers this package's share of a row's track, whose full width is the h3-js median.
 *
 * Every row carries its own linear scale, because one axis across all of them buries the small
 * factors. A row whose h3-js side has not run yet has no scale, so the share is the whole track.
 */
export function barFraction(ownMs: number, referenceMs: number): number {
  if (referenceMs <= 0) return 1
  return Math.min(1, Math.max(0, ownMs / referenceMs))
}
