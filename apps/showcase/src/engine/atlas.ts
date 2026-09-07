import { DEG_TO_RAD, EARTH_RADIUS_M, resolutionForZoom } from './projection'

/** Caps the disk the map act asks for, the interactive ceiling every act shares. */
export const ATLAS_CELL_CAP = 20_000

/** Resolutions between a cell and the patch it is coloured in, so a patch holds 343 cells. */
export const PATCH_DEPTH = 3

/** Frames of nothing after which the map counts as done with what it was handed. */
export const QUIET_MS = 200

// the largest k whose disk of 3k(k + 1) + 1 cells still fits under the cap, k = 81
export const MAX_K = Math.floor((Math.sqrt((4 * ATLAS_CELL_CAP - 1) / 3) - 1) / 2)

const CELL_SPACING = Math.sqrt(3)
// a disk of k rings is a hexagon of cells, and only its apothem is covered in every direction
const DISK_APOTHEM = Math.sqrt(3) / 2

/** Answers the average edge length of a resolution, as `getHexagonEdgeLengthAvgM` gives it. */
export type EdgeLengthM = (res: number) => number

/** Holds the ground a map view stands over: its corners and the point in the middle of them. */
export interface ViewExtent {
  /** West, south, east and north, in degrees, as the map answers them. */
  bounds: readonly [number, number, number, number]
  /** Longitude and latitude of the view centre, in degrees. */
  center: readonly [number, number]
}

/**
 * Answers the ring count whose disk reaches every corner of the viewport, under the cap.
 *
 * A disk of k rings covers its apothem in every direction rather than its full width, and one ring
 * of slack absorbs the average-edge-length approximation, so the disk always overshoots the corner
 * it is sized from.
 *
 * @param view The ground the map stands over.
 * @param res The resolution the disk is walked at.
 * @param edgeLengthM The average edge length of a resolution.
 */
export function coverage(view: ViewExtent, res: number, edgeLengthM: EdgeLengthM): number {
  const [west, south, east, north] = view.bounds
  const [lng, lat] = view.center
  // a viewport across the antimeridian answers an east that has wrapped
  const rightEdge = east < west ? east + 360 : east
  const centreLng = lng < west ? lng + 360 : lng
  const halfLat = Math.max(north - lat, lat - south)
  const halfLng = Math.max(rightEdge - centreLng, centreLng - west)
  const reach =
    EARTH_RADIUS_M * DEG_TO_RAD * Math.hypot(halfLat, halfLng * Math.cos(lat * DEG_TO_RAD))
  const spacing = CELL_SPACING * edgeLengthM(res)
  return Math.max(1, Math.min(MAX_K, Math.ceil(reach / (spacing * DISK_APOTHEM)) + 1))
}

/** Milliseconds a scene stands before a view that is still moving may ask for the next one. */
export const LIVE_REBUILD_MS = 120

/** Holds the scene a moving view is measured against: what it was walked from, and when. */
export interface BuiltScene {
  /** The resolution the scene was walked at. */
  res: number
  /** The cell the scene was centred on, at {@linkcode BuiltScene.res}. */
  centre: bigint
  /** The moment it was walked, on the clock the view is timed against. */
  at: number
}

/** Holds a view in motion: where it stands, and the zoom the resolution ladder is read at. */
export interface MovingView {
  /** Longitude and latitude of the view centre, in degrees. */
  center: readonly [number, number]
  /** The zoom {@linkcode resolutionForZoom} takes, which is the map's own zoom plus its offset. */
  zoom: number
}

/** Answers the cell a coordinate falls in, as `latLngToCell` gives it. */
export type CellAt = (lat: number, lng: number, res: number) => bigint

/**
 * Answers whether a view that is still moving has left the scene the map holds behind.
 *
 * A gesture asks on every frame it draws, so the throttle is read before anything is computed and
 * the resolution before the centre cell, which leaves the H3 call to the frames that got that far.
 *
 * @param built The scene the map holds, or `null` while it holds none.
 * @param view Where the moving view stands.
 * @param now The moment the view reported itself.
 * @param edgeLengthM The average edge length of a resolution.
 * @param cellAt The cell a coordinate falls in at a resolution.
 */
export function liveRebuildDue(
  built: BuiltScene | null,
  view: MovingView,
  now: number,
  edgeLengthM: EdgeLengthM,
  cellAt: CellAt,
): boolean {
  if (built === null) return true
  if (now - built.at < LIVE_REBUILD_MS) return false
  const [lng, lat] = view.center
  if (resolutionForZoom(view.zoom, lat, edgeLengthM) !== built.res) return true
  return cellAt(lat, lng, built.res) !== built.centre
}

/**
 * Holds one wait on the map: when it was handed something and how long it has been drawing since.
 *
 * The map renders on its own thread and a frame already in flight lands in the same queue, so a
 * wait cannot end on the first frame it sees. It ends where the frames stop instead, which covers
 * the parse and the re-tile the renderer does off the main thread.
 */
export interface Wait {
  from: number
  last: number
  timer: ReturnType<typeof setTimeout> | null
}

/** Answers a wait that has never been opened. */
export function noWait(): Wait {
  return { from: 0, last: 0, timer: null }
}

/** Closes a wait and drops what it had collected, so a later frame reports nothing. */
export function closeWait(wait: Wait): void {
  if (wait.timer !== null) clearTimeout(wait.timer)
  wait.timer = null
  wait.from = 0
  wait.last = 0
}

/** Opens a wait, dropping whatever an unfinished one had collected. */
export function openWait(wait: Wait, at: number): void {
  closeWait(wait)
  wait.from = at
}

/** Notes a rendered frame and reports the wait once the map has been quiet for a moment. */
export function noteFrame(wait: Wait, at: number, report: (ms: number) => void): void {
  if (wait.from === 0) return
  wait.last = at - wait.from
  if (wait.timer !== null) clearTimeout(wait.timer)
  wait.timer = setTimeout(() => {
    wait.timer = null
    wait.from = 0
    report(wait.last)
  }, QUIET_MS)
}
