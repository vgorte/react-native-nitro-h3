import { metresPerPixel, zoomForMetresPerPixel } from './projection'

/** The resolution the trail opens at, a cell about 57 m across. */
export const TRAIL_RES = 11

/** The coarsest resolution the control offers, a cell about 2.4 km across. */
export const MIN_TRAIL_RES = 7

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

/** Cells of a new resolution that must still fit across the view before the camera re-fits. */
export const MIN_CELLS_ACROSS = 4

/** Zoom levels a re-frame may travel over before it is taken as a cut rather than a flight. */
export const ZOOM_CUT_LEVELS = 3

/**
 * Cells the fade is spread over while the time lapse runs.
 *
 * The trail keeps {@linkcode AGE_SPAN} cells and the time-lapse frame holds a fraction of them, so
 * a ramp spread over the whole trail leaves everything on screen at its brightest end. Twice the
 * framed stretch puts the dark end of the ramp just outside the frame, and the tail fades inside it.
 */
export const TIME_LAPSE_FADE_SPAN = TIME_LAPSE_CELLS_ACROSS * 2

// the time-lapse frame follows the trail in steps, so a growing one re-frames a few times a run
const CELLS_ACROSS_STEP = 10

/**
 * Milliseconds a replay lets pass between two renders, which is what one timer tick is worth.
 *
 * A time lapse packs a tick full, and the whole batch reaches the trail in a single pass. The tick
 * paces the renders only; the ride itself runs off the wall clock, so a tick that came late catches
 * up.
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

/**
 * Appends steps to a trail, moving a cell it already stood in to its new place at the head.
 *
 * A ride that crosses itself comes back into cells it left earlier, and a coarse resolution turns a
 * whole loop into a handful of them. Holding such a cell twice would draw it once and count it
 * twice, so the older step gives way to the newer one and the trail holds every standing cell once.
 */
function appended(trail: readonly TrailStep[], steps: readonly TrailStep[]): TrailStep[] {
  const coming = new Set(steps.map((step) => step.cell))
  const kept: TrailStep[] = []
  const walked = new Set<bigint>()
  for (const step of trail) {
    if (!coming.has(step.cell)) kept.push(step)
    else if (!step.filled) walked.add(step.cell)
  }
  // a cell a fix once landed in stays measured, however the trail reaches it again
  const moved = steps.map((step) =>
    step.filled && walked.has(step.cell) ? { cell: step.cell, filled: false } : step,
  )
  return [...kept, ...moved]
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
  if (neighbours(head.cell, next)) return appended(trail, [{ cell: next, filled: false }])

  const between = path(head.cell, next)
  const steps: TrailStep[] = []
  for (let index = 1; index < between.length - 1; index++) {
    steps.push({ cell: between[index], filled: true })
  }
  steps.push({ cell: next, filled: false })
  return appended(trail, steps)
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

/** Holds where a replay's clock stands: the moment it was last read, and the route time then. */
export interface ReplayClock {
  /** The wall clock the reading was taken at. */
  at: number
  /** How far into the recording the replay had come by then. */
  t: number
}

/**
 * Answers how far into the recording a replay has come, its clock read at `now`.
 *
 * The route time runs off the wall clock rather than off a chain of timers, so a tick the image
 * render held up delivers a bigger batch instead of playing the ride slower than the pace says.
 *
 * @param clock Where the replay stood when its clock was last read.
 * @param now The wall clock to read it at.
 * @param pace How much faster than the recording the replay runs.
 */
export function routeTimeAt(clock: ReplayClock, now: number, pace: number): number {
  return clock.t + Math.max(0, now - clock.at) * pace
}

/** Counts the fixes from `index` whose time has come by `routeMs`, oldest first. */
export function fixesDue(route: readonly TrailFix[], index: number, routeMs: number): number {
  let count = 0
  while (index + count < route.length && route[index + count].t <= routeMs) count += 1
  return count
}

/**
 * Answers the cells a time lapse frames across the narrow side of the view.
 *
 * A ride at a coarse resolution stands in a handful of cells, and framing sixty of those would put
 * a whole state around a trail that fits in a district. The frame therefore holds
 * {@linkcode TIME_LAPSE_CELLS_ACROSS} cells at most and never fewer than the stretch the act opens
 * on, and the trail it follows is counted in steps so a growing one re-frames a few times a run.
 *
 * @param standing Cells of the trail that are drawn.
 */
export function timeLapseCellsAcross(standing: number): number {
  const stepped = Math.floor(standing / CELLS_ACROSS_STEP) * CELLS_ACROSS_STEP
  return Math.min(TIME_LAPSE_CELLS_ACROSS, Math.max(TRAIL_CELLS_ACROSS, stepped))
}

/**
 * Answers the zoom a change of resolution asks for, or `null` where the standing view still holds.
 *
 * The resolution is the act's privacy dial rather than its zoom, so the camera stays where the
 * visitor left it: a finer resolution only ever puts more cells on the screen, and a coarser one is
 * followed out only once fewer than {@linkcode MIN_CELLS_ACROSS} of its cells would fit across the
 * view, where it re-fits to the stretch the act opened on.
 *
 * @param zoom The standing zoom, counted against the 256 point tile grid.
 * @param width The viewport width in points.
 * @param height The viewport height in points.
 * @param lat The latitude the trail stands at.
 * @param edgeLengthM The average edge length of a resolution.
 * @param res The resolution the trail is walked at now.
 */
export function zoomForResolution(
  zoom: number,
  width: number,
  height: number,
  lat: number,
  edgeLengthM: (res: number) => number,
  res: number,
): number | null {
  // the framed stretch is what `zoomForTrail` fits cells into, margin and all, so both count alike
  const framed = Math.min(width, height) * FIT_MARGIN * metresPerPixel(zoom, lat)
  const fitting = framed / (CELL_SPACING * edgeLengthM(res))
  if (fitting >= MIN_CELLS_ACROSS) return null
  return zoomForTrail(width, height, lat, edgeLengthM, res)
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
  while (at + 1 < route.length && (route[at + 1].t - from.t) / pace <= aheadMs) at += 1
  return route[at]
}

/**
 * Answers the ramp bucket of a trail cell from its age, filled cells on their own lower band.
 *
 * The fade is normalised to the span the caller frames: the head takes the brightest step, a cell
 * that old takes the darkest, and anything older takes the darkest too. A cell the grid path filled
 * in was never measured, and stays under the measured cell of the same age by taking
 * {@linkcode FILLED_BAND} of the ramp.
 *
 * @param age Cells between this one and the head, `0` for the head itself.
 * @param filled Whether the grid path filled the cell in.
 * @param buckets Steps the ramp is cut into, which the caller takes from the theme.
 * @param span The age the fade is spread over; a cell at least that old takes the darkest step.
 */
export function bucketOfAge(age: number, filled: boolean, buckets: number, span: number): number {
  const top = filled ? Math.floor((buckets - 1) * FILLED_BAND) : buckets - 1
  // a trail of one cell is all head, and has no age to spread a ramp over
  if (span <= 0 || age <= 0) return top
  if (age >= span) return 0
  return Math.round(((span - age) / span) * top)
}

/**
 * Answers the ramp bucket of every step of a trail, in the order the cells are drawn in.
 *
 * @param trail The cells walked so far, oldest first.
 * @param buckets Steps the ramp is cut into, which the caller takes from the theme.
 * @param span The age the fade is spread over, the whole trail unless a caller frames less of it.
 */
export function bucketsOfTrail(
  trail: readonly TrailStep[],
  buckets: number,
  span = trail.length - 1,
): Uint8Array {
  const of = new Uint8Array(trail.length)
  const oldest = trail.length - 1
  for (let index = 0; index < trail.length; index++) {
    of[index] = bucketOfAge(oldest - index, trail[index].filled, buckets, span)
  }
  return of
}

/**
 * Answers the ages the fade is spread over: the trail standing, or the frame's own span in a lapse.
 *
 * @param standing Cells of the trail that are drawn.
 * @param lapse Whether the time lapse is running, which frames a fraction of the trail.
 */
export function fadeSpan(standing: number, lapse: boolean): number {
  const whole = Math.max(0, standing - 1)
  return lapse ? Math.min(whole, TIME_LAPSE_FADE_SPAN) : whole
}

/**
 * Answers whether a re-frame travels too far to be animated.
 *
 * A stop that interpolates over more than {@linkcode ZOOM_CUT_LEVELS} levels leaves the map with
 * no tiles drawn where it lands, so such a re-frame is issued as a cut instead.
 *
 * @param next The zoom the frame asks for.
 * @param standing The zoom the map is on, `null` where it has reported none yet.
 */
export function isZoomCut(next: number, standing: number | null): boolean {
  return standing === null || Math.abs(next - standing) > ZOOM_CUT_LEVELS
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
