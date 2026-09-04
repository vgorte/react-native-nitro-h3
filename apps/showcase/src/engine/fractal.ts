import { formatCount } from './stats'

/** Points across which a tapped cell is zoomed to, wide enough to read its children inside it. */
export const TARGET_CELL_PX = 120

/** The coarsest resolution a long press can fold up to. */
export const MIN_RES = 0

/** The finest resolution a tap can split down to. */
export const MAX_RES = 15

/** Caps the leaf cells the act draws, the interactive ceiling every act shares. */
export const FRACTAL_CELL_CAP = 20_000

/** The resolution the act opens on, the one its disk of cells is built at. */
export const START_RES = 6

/** H3 has an aperture of 7, so a hexagon splits into seven children and a pentagon into six. */
export const APERTURE = 7

/**
 * Points across which a cell of the opening resolution is drawn.
 *
 * It is the size a child settles at after its parent has been zoomed to
 * {@linkcode TARGET_CELL_PX}, so the opening screen already stands where the first split leaves it
 * and a fold that frames its cell at this size is the exact inverse of the split that made it.
 */
export const OPEN_CELL_PX = TARGET_CELL_PX / Math.sqrt(APERTURE)

/** Resolutions between the opening set and the floor, over which the colour ramp is spread. */
export const DEPTH_STEPS = MAX_RES - START_RES

/** The largest k whose disk of 3k(k + 1) + 1 cells still fits under the cap, k = 81. */
export const MAX_K = Math.floor((Math.sqrt((4 * FRACTAL_CELL_CAP - 1) / 3) - 1) / 2)

export const FLOOR_NOTE = `resolution ${MAX_RES} is the floor, so this cell does not split`
export const TOP_NOTE = `resolution ${MIN_RES} is the ceiling, so there is nothing to fold up to`
export const CEILING_NOTE = `the ceiling of ${formatCount(FRACTAL_CELL_CAP)} leaf cells stops the next split`

const CELL_SPACING = Math.sqrt(3)
// a disk of k rings is a hexagon of cells, and only its apothem is covered in every direction
const DISK_APOTHEM = Math.sqrt(3) / 2
const DEG_TO_RAD = Math.PI / 180

/** Answers the resolution of a cell, as `getResolution` gives it. */
export type ResolutionOf = (cell: bigint) => number

/** Answers a cell's ancestor at a resolution, as `cellToParent` gives it. */
export type ParentOf = (cell: bigint, res: number) => bigint

/** Holds the leaf cells an act draws, which stand at every resolution the visitor has opened. */
export interface Leaves {
  cells: BigUint64Array
  /** The ramp bucket of every cell, how far its resolution stands below the opening one. */
  buckets: Uint8Array
  member: Set<bigint>
  deepest: number
  shallowest: number
}

/** Holds everything an act draws: the leaves its gestures act on, and the cells already split. */
export interface Tree {
  leaves: Leaves
  /** The split cells, shallowest first, drawn as a fill under the leaves. */
  ancestors: BigUint64Array
}

/** Holds how far a leaf set can still be taken, and the one line that says where it stops. */
export interface Reach {
  split: boolean
  fold: boolean
  note: string | null
}

/**
 * Answers the ramp bucket of a leaf, the ramp spread over the resolutions below the opening one.
 *
 * The opening set takes the darkest step and the floor the brightest, so the depth a visitor has
 * opened is what the colour carries; a cell folded above the opening resolution keeps the darkest.
 *
 * @param res The cell's resolution.
 * @param buckets Steps the ramp is cut into, which the caller takes from the theme.
 */
export function bucketOfResolution(res: number, buckets: number): number {
  const depth = Math.max(0, Math.min(DEPTH_STEPS, res - START_RES))
  return Math.round((depth / DEPTH_STEPS) * (buckets - 1))
}

/**
 * Reads the resolutions of a cell set once, into the colours and the range the gestures ask for.
 *
 * @param cells The drawn leaves, in the order they are drawn.
 * @param buckets Steps the ramp is cut into.
 * @param resolutionOf The resolution of a cell, which the act hands in as `getResolution`.
 */
export function leavesOf(
  cells: BigUint64Array,
  buckets: number,
  resolutionOf: ResolutionOf,
): Leaves {
  const of = new Uint8Array(cells.length)
  const member = new Set<bigint>()
  let deepest = MIN_RES
  let shallowest = MAX_RES
  for (let cell = 0; cell < cells.length; cell++) {
    const res = resolutionOf(cells[cell])
    of[cell] = bucketOfResolution(res, buckets)
    member.add(cells[cell])
    if (res > deepest) deepest = res
    if (res < shallowest) shallowest = res
  }
  return { cells, buckets: of, member, deepest, shallowest }
}

/**
 * Answers what the gestures may still do with a leaf set, and the line that says why one may not.
 *
 * A tap that no leaf set can answer leaves its gesture disabled rather than letting a call reach
 * the resolution ladder's end and come back as an `H3Error`.
 */
export function reachOf(leaves: Leaves): Reach {
  // every split but a pentagon's adds six leaves, so this is the last set a tap could act on
  const room = leaves.cells.length + APERTURE - 1 <= FRACTAL_CELL_CAP
  const split = room && leaves.shallowest < MAX_RES
  const fold = leaves.deepest > MIN_RES
  if (!room) return { split, fold, note: CEILING_NOTE }
  if (!split) return { split, fold, note: FLOOR_NOTE }
  if (!fold) return { split, fold, note: TOP_NOTE }
  return { split, fold, note: null }
}

/**
 * Answers the pixel scale at which a cell of the opening resolution reads at its settled size.
 *
 * The scene is measured in Web Mercator metres, of which a ground metre at `lat` spans one over the
 * cosine, which is why the latitude appears here at all.
 *
 * @param lat The latitude the act opens over.
 * @param edgeLengthM The average edge length of a resolution, as `getHexagonEdgeLengthAvgM` gives it.
 */
export function openingScale(lat: number, edgeLengthM: (res: number) => number): number {
  return (OPEN_CELL_PX * Math.cos(lat * DEG_TO_RAD)) / (2 * edgeLengthM(START_RES))
}

/**
 * Answers the ring count whose disk reaches every corner of the viewport, under the cap.
 *
 * @param width The viewport width in points.
 * @param height The viewport height in points.
 * @param scale Pixels per Web Mercator metre the scene is drawn at.
 * @param lat The latitude the disk is centred on.
 * @param edgeLengthM The average edge length of a resolution.
 */
export function coverage(
  width: number,
  height: number,
  scale: number,
  lat: number,
  edgeLengthM: (res: number) => number,
): number {
  const reach = ((Math.hypot(width, height) / 2) * Math.cos(lat * DEG_TO_RAD)) / scale
  const spacing = CELL_SPACING * edgeLengthM(START_RES)
  return Math.max(1, Math.min(MAX_K, Math.ceil(reach / (spacing * DISK_APOTHEM)) + 1))
}

/** Answers the set a split leaves behind: the cell gone, its children in its place. */
export function replaceLeaf(
  cells: BigUint64Array,
  cell: bigint,
  children: BigUint64Array,
): BigUint64Array {
  const next = new BigUint64Array(cells.length - 1 + children.length)
  let cursor = 0
  for (const leaf of cells) if (leaf !== cell) next[cursor++] = leaf
  next.set(children, cursor)
  return next
}

/**
 * Answers the cells that survive a fold: everything that does not descend from `parent`.
 *
 * A cell shallower than the fold cannot descend from it, and the parent itself is its own ancestor,
 * so this drops the whole branch including the cell the fold produces.
 *
 * @param cells The cells to filter, leaves or split ancestors.
 * @param parent The cell the fold produces.
 * @param res The resolution of `parent`.
 * @param resolutionOf The resolution of a cell.
 * @param parentOf A cell's ancestor at a resolution.
 */
export function withoutBranch(
  cells: BigUint64Array,
  parent: bigint,
  res: number,
  resolutionOf: ResolutionOf,
  parentOf: ParentOf,
): bigint[] {
  const kept: bigint[] = []
  for (const cell of cells) {
    if (resolutionOf(cell) >= res && parentOf(cell, res) === parent) continue
    kept.push(cell)
  }
  return kept
}

/**
 * Answers the leaf a cell lies in, by climbing from it until an ancestor is drawn.
 *
 * This is exact H3 containment rather than a hit test: a point on a shared edge belongs to the cell
 * H3 says it belongs to, and the walk costs one call per resolution rather than one per cell.
 *
 * @param cell The cell at the deepest resolution drawn, from `latLngToCell`.
 * @param leaves The drawn set the answer has to come from.
 * @param parentOf A cell's ancestor at a resolution.
 */
export function leafFrom(cell: bigint, leaves: Leaves, parentOf: ParentOf): bigint | null {
  let climbed = cell
  for (let res = leaves.deepest; res >= leaves.shallowest; res--) {
    if (leaves.member.has(climbed)) return climbed
    if (res > leaves.shallowest) climbed = parentOf(climbed, res - 1)
  }
  return null
}
