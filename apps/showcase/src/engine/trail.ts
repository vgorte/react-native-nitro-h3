/** The resolution the trail opens at, a cell about 57 m across. */
export const TRAIL_RES = 11

/** The coarsest resolution the control offers. */
export const MIN_TRAIL_RES = 10

/** The finest resolution the control offers. */
export const MAX_TRAIL_RES = 12

/** Cells the trail keeps; the fade spreads over however many of them are standing. */
export const AGE_SPAN = 600

/** Cells the opening frame fits across the narrow side of the viewport. */
export const TRAIL_CELLS_ACROSS = 20

// the fraction of the ramp a filled cell may reach, so a grid-path cell reads under a measured one
const FILLED_BAND = 0.5

// the framed stretch keeps a tenth of the narrow side free
const FIT_MARGIN = 0.9
const CELL_SPACING = Math.sqrt(3)
const DEG_TO_RAD = Math.PI / 180

/** Holds one fix of a route: where it was taken and how long after the first one. */
export interface TrailFix {
  lat: number
  lng: number
  /** Milliseconds since the first fix of the route, which is the pace a replay keeps. */
  t: number
}

/** Holds one cell of the trail: the cell itself, and whether a grid path filled it in. */
export interface TrailStep {
  cell: bigint
  filled: boolean
}

/** Extends a trail by one fix, closing a gap with the grid path when the fix is not a neighbour. */
export function extendTrail(
  trail: TrailStep[],
  next: bigint,
  neighbours: (a: bigint, b: bigint) => boolean,
  path: (a: bigint, b: bigint) => BigUint64Array,
): TrailStep[] {
  const head = trail[trail.length - 1]
  if (head === undefined) return [{ cell: next, filled: false }]
  if (head.cell === next) return trail
  if (neighbours(head.cell, next)) return [...trail, { cell: next, filled: false }]

  const between = path(head.cell, next)
  const filled: TrailStep[] = []
  for (let index = 1; index < between.length - 1; index++) {
    filled.push({ cell: between[index], filled: true })
  }
  return [...trail, ...filled, { cell: next, filled: false }]
}

/**
 * Answers the cells from `from` to `to`, or the two ends alone where H3 cannot walk a path.
 *
 * `gridPathCells` refuses a path it cannot express, and a location feed that was away for a while
 * comes back with exactly that: a fix on the other side of the country, which the trail then holds
 * as a jump rather than losing the fix to a call that threw. Only H3's own refusal is a jump;
 * `refuses` says which error that is, and anything else is a defect and goes back to the caller.
 *
 * @param from The head of the trail.
 * @param to The cell the fix landed in.
 * @param path Walks the grid path, which the act hands the timed `gridPathCells`.
 * @param refuses Answers whether an error is H3 refusing the path; the act tests it as `H3Error`.
 */
export function pathOrJump(
  from: bigint,
  to: bigint,
  path: (a: bigint, b: bigint) => BigUint64Array,
  refuses: (error: unknown) => boolean,
): BigUint64Array {
  try {
    return path(from, to)
  } catch (error) {
    if (!refuses(error)) throw error
    return BigUint64Array.from([from, to])
  }
}

/**
 * Drops the oldest cells off the tail, so the drawn trail never grows past `span` cells.
 *
 * One gap can fill in more cells than the span holds, which is why this cuts to the last `span`
 * rather than shifting one cell off.
 */
export function capTrail(trail: TrailStep[], span: number): TrailStep[] {
  if (trail.length <= span) return trail
  return trail.slice(trail.length - span)
}

/** Fixes the act remembers, roughly an hour of walking at a fix a second. */
export const FIX_HISTORY = 4_000

/**
 * Drops the oldest fixes so a long session neither grows without bound nor walks longer each time.
 *
 * A resolution change walks the whole history again, which is the one cost that would otherwise
 * scale with how long the act has been open. The cut happens in place, because the history is
 * appended to on every fix and copying it each time is what this bound is there to avoid.
 *
 * @param fixes The fixes taken so far, oldest first.
 * @param span Fixes to keep.
 */
export function capFixes(fixes: TrailFix[], span: number): void {
  if (fixes.length > span) fixes.splice(0, fixes.length - span)
}

/**
 * Answers the ramp bucket of a trail cell from its age, filled cells on their own lower band.
 *
 * The fade is normalised to the trail that is standing: the head takes the brightest step and the
 * oldest cell the darkest, whether the trail holds eight cells or the whole {@linkcode AGE_SPAN},
 * so the ramp reads on the first minute of a walk as well as on an hour of one. A cell the grid
 * path filled in was never measured, and stays under the measured cell of the same age by taking
 * {@linkcode FILLED_BAND} of the ramp instead of all of it.
 *
 * @param age Cells between this one and the head, `0` for the head itself.
 * @param filled Whether the grid path filled the cell in.
 * @param buckets Steps the ramp is cut into, which the caller takes from the theme.
 * @param span The age of the oldest cell standing, which is what the fade is spread over.
 */
export function bucketOfAge(age: number, filled: boolean, buckets: number, span: number): number {
  const top = filled ? Math.floor((buckets - 1) * FILLED_BAND) : buckets - 1
  // a trail of one cell is all head, and has no age to spread a ramp over
  if (span <= 0 || age <= 0) return top
  if (age >= span) return 0
  return Math.round(((span - age) / span) * top)
}

/** Answers the ramp bucket of every step of a trail, in the order the cells are drawn in. */
export function bucketsOfTrail(trail: readonly TrailStep[], buckets: number): Uint8Array {
  const of = new Uint8Array(trail.length)
  const span = trail.length - 1
  for (let index = 0; index < trail.length; index++) {
    of[index] = bucketOfAge(span - index, trail[index].filled, buckets, span)
  }
  return of
}

/**
 * Answers the pixel scale at which `cells` cells of a resolution span the narrow side of the view.
 *
 * The scene is measured in Web Mercator metres, of which a ground metre at `lat` spans one over the
 * cosine, which is why the latitude appears here at all. The edge length is passed in rather than
 * imported so the frame stays testable without the native module.
 *
 * @param width The viewport width in points.
 * @param height The viewport height in points.
 * @param lat The latitude the trail stands at.
 * @param edgeLengthM The average edge length of a resolution.
 * @param res The resolution the trail is walked at.
 * @param cells Cells the frame fits, {@linkcode TRAIL_CELLS_ACROSS} when the act opens.
 */
export function scaleForTrail(
  width: number,
  height: number,
  lat: number,
  edgeLengthM: (res: number) => number,
  res: number,
  cells = TRAIL_CELLS_ACROSS,
): number {
  const spacing = (CELL_SPACING * edgeLengthM(res)) / Math.cos(lat * DEG_TO_RAD)
  return (Math.min(width, height) * FIT_MARGIN) / (cells * spacing)
}

/**
 * Answers the height the camera holds the head at, midway between the panel and the readout.
 *
 * The expanded panel's height is set by what it says rather than by the viewport, so the point is
 * measured rather than taken as a fraction of the screen: the same panel leaves more room under it
 * on a tall phone than on a short one, and a folded panel leaves more again.
 *
 * @param height The viewport height in points.
 * @param panelBottom The lower edge of the HUD panel, in points from the top.
 * @param readoutBand Points the blocked readout takes along the bottom edge.
 */
export function headHeight(height: number, panelBottom: number, readoutBand: number): number {
  const readoutTop = height - readoutBand
  // a panel that reaches the readout leaves no band, and the head stands on the readout's edge
  if (panelBottom >= readoutTop) return readoutTop
  return (panelBottom + readoutTop) / 2
}

/** Holds where the camera stands: its offset in points and its pixel scale. */
export interface CameraPlacement {
  x: number
  y: number
  scale: number
}

/** Points a finger may travel before it counts as a pan rather than a tap. */
export const TAP_SLOP = 6

/** The fraction of the scale a pinch has to change before it counts as one. */
export const PINCH_TOLERANCE = 0.002

/**
 * Answers whether the camera under the finger has left where the act last placed it.
 *
 * A pan begins on touch down, so a plain tap on the scene reaches the act as a gesture that has
 * moved nothing; only a camera that has actually travelled or zoomed takes the follow away.
 *
 * @param now Where the camera stands.
 * @param placed Where the act last put it, `scale` of `0` before it has framed anything.
 */
export function cameraTaken(now: CameraPlacement, placed: CameraPlacement): boolean {
  'worklet'
  if (placed.scale <= 0) return false
  if (Math.abs(now.x - placed.x) > TAP_SLOP || Math.abs(now.y - placed.y) > TAP_SLOP) return true
  return Math.abs(now.scale - placed.scale) > placed.scale * PINCH_TOLERANCE
}

/** Answers the cells of a trail as the buffer the batch calls take. */
export function cellsOfTrail(trail: readonly TrailStep[]): BigUint64Array {
  const cells = new BigUint64Array(trail.length)
  for (let index = 0; index < trail.length; index++) cells[index] = trail[index].cell
  return cells
}

/** Counts the cells of a trail the grid path filled in rather than a fix landing in them. */
export function filledCells(trail: readonly TrailStep[]): number {
  let count = 0
  for (const step of trail) if (step.filled) count += 1
  return count
}
