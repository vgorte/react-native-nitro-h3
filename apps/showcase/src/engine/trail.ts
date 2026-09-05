import { zoomForMetresPerPixel } from './projection'

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

/** How much faster than the recording the time lapse plays the route. */
export const TIME_LAPSE_PACE = 60

/** The pace a replay keeps when it plays the route the way it was ridden. */
export const RECORDED_PACE = 1

/**
 * Cells the time lapse fits across the narrow side, wide enough to hold the tail behind the head.
 *
 * At {@linkcode TIME_LAPSE_PACE} a ride recorded at 8 m/s covers about 480 m a second, so a frame
 * this wide takes the head about three seconds to cross at {@linkcode MAX_TRAIL_RES}.
 */
export const TIME_LAPSE_CELLS_ACROSS = 60

/**
 * Milliseconds a replay lets pass between two renders, which is what one timer tick is worth.
 *
 * At the recorded pace a fix arrives every second and a tick holds one of them. A time lapse packs
 * a tick full instead, and the whole batch reaches the trail in a single pass. The camera is put on
 * the new head once a tick, and the map draws about a frame for each, so a longer tick reads as a
 * coarser follow and a shorter one only crowds the thread.
 */
export const REPLAY_TICK_MS = 100

/** Milliseconds one step of the time-lapse follow runs for, and how far ahead of the head it aims. */
export const CAMERA_STEP_MS = 500

/**
 * The share of a step after which the next one is issued, so the camera is never left standing.
 *
 * A step that is allowed to land waits for the timer that follows it, and an image render can hold
 * that timer for most of a frame budget; the overlap keeps one glide running into the next.
 */
export const CAMERA_STEP_LEAD = 0.8

// the fraction of the ramp a filled cell may reach, so a grid-path cell reads under a measured one
const FILLED_BAND = 0.5

// the framed stretch keeps a tenth of the narrow side free
const FIT_MARGIN = 0.9
const CELL_SPACING = Math.sqrt(3)

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
 * Answers the milliseconds a replay waits between two fixes, the recorded gap divided by the pace.
 *
 * @param from The fix the replay last delivered.
 * @param to The fix that comes after it.
 * @param pace How much faster than the recording the replay runs, {@linkcode RECORDED_PACE} for
 *   the pace it was ridden at.
 */
export function replayDelayMs(from: TrailFix, to: TrailFix, pace: number): number {
  return Math.max(0, (to.t - from.t) / pace)
}

/**
 * Counts the fixes from `index` that fall due inside one tick, never fewer than the one at `index`.
 *
 * A time lapse makes fixes arrive faster than a frame, and a render each would leave the JS thread
 * no time for anything else. The whole tick's worth is taken in one pass instead, so the trail
 * grows by a batch and React renders once; at the recorded pace a tick holds a single fix and this
 * answers `1`.
 *
 * @param route The recorded route, oldest fix first.
 * @param index The fix the replay stands on.
 * @param pace How much faster than the recording the replay runs.
 * @param tickMs The tick the replay renders on, {@linkcode REPLAY_TICK_MS} in the act.
 */
export function fixesInTick(
  route: readonly TrailFix[],
  index: number,
  pace: number,
  tickMs: number,
): number {
  const first = route[index]
  if (first === undefined) return 0
  let count = 1
  while (
    index + count < route.length &&
    replayDelayMs(first, route[index + count], pace) < tickMs
  ) {
    count += 1
  }
  return count
}

/**
 * Answers the fix a replay will stand on `aheadMs` after the one at `index`, the last one at the end.
 *
 * A camera that is put on the head every time the trail grows starts a new glide before the last
 * one has run, which reads as a stutter. A time lapse aims a step at where the head will be when
 * the step ends instead, and this is the fix the replay will have reached by then.
 *
 * @param route The recorded route, oldest fix first.
 * @param index The fix the head stands in.
 * @param pace How much faster than the recording the replay runs.
 * @param aheadMs Wall-clock milliseconds to look ahead, {@linkcode CAMERA_STEP_MS} in the act.
 */
export function fixAhead(
  route: readonly TrailFix[],
  index: number,
  pace: number,
  aheadMs: number,
): TrailFix | undefined {
  const from = route[index]
  if (from === undefined) return undefined
  let at = index
  while (at + 1 < route.length && replayDelayMs(from, route[at + 1], pace) <= aheadMs) at += 1
  return route[at]
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
 * Answers the zoom at which `cells` cells of a resolution span the narrow side of the view.
 *
 * The answer counts against a 256 point tile grid, the one the projection helpers measure in, so a
 * map that counts against a 512 point one takes it one step lower. The edge length is passed in
 * rather than imported so the frame stays testable without the native module.
 *
 * @param width The viewport width in points.
 * @param height The viewport height in points.
 * @param lat The latitude the trail stands at.
 * @param edgeLengthM The average edge length of a resolution.
 * @param res The resolution the trail is walked at.
 * @param cells Cells the frame fits, {@linkcode TRAIL_CELLS_ACROSS} when the act opens.
 */
export function zoomForTrail(
  width: number,
  height: number,
  lat: number,
  edgeLengthM: (res: number) => number,
  res: number,
  cells = TRAIL_CELLS_ACROSS,
): number {
  const across = cells * CELL_SPACING * edgeLengthM(res)
  return zoomForMetresPerPixel(across / (Math.min(width, height) * FIT_MARGIN), lat)
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
