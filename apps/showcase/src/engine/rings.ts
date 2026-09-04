/** Milliseconds a newly added ring takes to fade in. */
export const RING_FADE_MS = 200

/** The smallest k the slider sets: the centre cell and the six cells around it. */
export const MIN_K = 1

/** The largest k the slider sets, a disk of 7,651 cells. */
export const MAX_K = 50

/** The resolution the act's grid stands at, about a city block a cell. */
export const GRID_RES = 9

/** Points a cell has to span before the grid lines over it are worth drawing. */
export const GRID_CELL_PX = 12

// the fitted disk keeps a tenth of the narrow side free
const FIT_MARGIN = 0.9
const CELL_SPACING = Math.sqrt(3)
const DEG_TO_RAD = Math.PI / 180

/** Answers the average edge length of a resolution, as `getHexagonEdgeLengthAvgM` gives it. */
export type EdgeLengthM = (res: number) => number

/** Answers the ring indexes for a k, keeping the ones already built. */
export function ringsToKeep(current: number[], k: number): number[] {
  const kept = current.filter((ring) => ring <= k)
  for (let ring = kept.length; ring <= k; ring++) kept.push(ring)
  return kept
}

/**
 * Answers the ramp bucket of a ring, its distance from the centre cell.
 *
 * The centre takes the brightest step and {@linkcode MAX_K} the darkest, so the disk reads as one
 * bullseye around the cell the rings are walked from. There are more rings than buckets, so a step
 * covers a few rings at a time and the bands are what carries the distance.
 *
 * @param ring The ring's distance from the centre, in cells.
 * @param buckets Steps the ramp is cut into, which the caller takes from the theme.
 */
export function bucketOfRing(ring: number, buckets: number): number {
  const held = Math.max(0, Math.min(MAX_K, ring))
  return Math.round(((MAX_K - held) / MAX_K) * (buckets - 1))
}

/** Answers the cells a walk holds, the sum of its ring lengths. */
export function cellsInRings(rings: readonly { length: number }[]): number {
  let cells = 0
  for (const ring of rings) cells += ring.length
  return cells
}

/**
 * Answers the scene metres the widest disk spans, which is what the act frames.
 *
 * The scene is measured in Web Mercator metres, of which a ground metre at `lat` spans one over the
 * cosine, which is why the latitude appears here at all.
 */
function diskSpanM(lat: number, edgeLengthM: EdgeLengthM): number {
  const reach = (MAX_K + 1) * CELL_SPACING * edgeLengthM(GRID_RES)
  return (2 * reach) / Math.cos(lat * DEG_TO_RAD)
}

/**
 * Answers the pixel scale the act opens at, the one that frames a disk of {@linkcode MAX_K} rings.
 *
 * The camera never follows the slider, so the frame has to hold the widest disk from the first
 * frame; the narrow side of the viewport is what it is fitted to.
 *
 * @param width The viewport width in points.
 * @param height The viewport height in points.
 * @param lat The latitude the disk is centred on.
 * @param edgeLengthM The average edge length of a resolution.
 */
export function openingScale(
  width: number,
  height: number,
  lat: number,
  edgeLengthM: EdgeLengthM,
): number {
  return (Math.min(width, height) * FIT_MARGIN) / diskSpanM(lat, edgeLengthM)
}

/**
 * Answers the scene metres between the centres of two neighbouring cells of the act's grid.
 *
 * @param lat The latitude the disk is centred on.
 * @param edgeLengthM The average edge length of a resolution.
 */
export function cellSpacingM(lat: number, edgeLengthM: EdgeLengthM): number {
  return (CELL_SPACING * edgeLengthM(GRID_RES)) / Math.cos(lat * DEG_TO_RAD)
}

/**
 * Answers whether the grid lines read at a pixel scale, which is what decides they are drawn.
 *
 * A cell is about three points across when the widest disk is framed, where a line every cell
 * would cover the colour it is meant to sit over rather than show a tiling. The spacing is passed
 * in because this runs on the UI thread, where no H3 call can be made.
 *
 * @param spacing Scene metres between two cell centres, from {@linkcode cellSpacingM}.
 * @param scale Pixels per Web Mercator metre the scene is drawn at.
 */
export function gridReads(spacing: number, scale: number): boolean {
  'worklet'
  return spacing * scale >= GRID_CELL_PX
}
