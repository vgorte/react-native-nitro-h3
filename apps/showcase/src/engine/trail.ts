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
 * comes back with exactly that: a fix on the other side of the country. The trail then holds the
 * jump as a jump rather than losing the fix to a call that threw.
 */
export function pathOrJump(
  from: bigint,
  to: bigint,
  path: (a: bigint, b: bigint) => BigUint64Array,
): BigUint64Array {
  try {
    return path(from, to)
  } catch {
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
