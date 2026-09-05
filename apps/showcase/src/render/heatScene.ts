import type { CellBoundaries } from 'react-native-nitro-h3'
import { boundariesOf } from '../engine/cells'
import { buildMesh, buildOutlinePath } from '../engine/mesh'
import { OUTLINE_MAX_CELLS } from '../engine/points'
import { type ProjectedCells, projectCells } from '../engine/projection'
import type { Timed } from '../engine/timed'
import { BUCKETS } from '../theme/tokens'
import { type CellScene, recordCellScene } from './CellPictures'
import { EMPTY_ALPHA, EMPTY_COLOUR, heatPalette } from './heatColours'
import type { CameraAnchor } from './useCamera'

// alpha the counted cells are drawn at, so the streets under the field still place it
const BUSY_ALPHA = 0.7

const CHUNK_SIZE = 10_000
// three edges a cell cover a tiling of one resolution once, which halves the anti-aliasing work
const OUTLINE_EDGES = 3
// the inset measured at 60 fps on the emulator with 128,000 cells, where the strip fell to 33.5
const INSET = 0.08

/** Holds the recorded cells of one run together with what the two stages behind them took. */
export interface HeatScene {
  scene: CellScene
  /** Whether the outline strip was drawn, which the cell count decides. */
  outlined: boolean
  /** What `cellsToBoundaries` took. */
  boundariesMs: number
  /** What the projection, the mesh and the recording took. */
  meshMs: number
}

/**
 * Records the cells of one run, each in the colour the points that landed in it stand for.
 *
 * Up to {@linkcode OUTLINE_MAX_CELLS} the cells are drawn full size under an outline strip. Above
 * it the strip comes off and every cell is drawn inset instead: the strip at that size cost a
 * third of the frame rate, the inset none of it.
 *
 * @param cells The distinct cells of the run, in the order their colours are given in.
 * @param buckets The ramp bucket of every cell, from the counts on the logarithmic ramp.
 * @param anchor The coordinate the scene's metre space is measured from.
 */
export function buildHeatScene(
  cells: BigUint64Array,
  buckets: Uint8Array,
  anchor: CameraAnchor,
): HeatScene {
  let boundaries: Timed<CellBoundaries> | null = boundariesOf(cells)
  const boundariesMs = boundaries.ms
  const started = performance.now()
  let projected: ProjectedCells | null = projectCells(boundaries.value, anchor)
  // the boundaries are dead the moment they are projected, and they are the heaviest buffer of the
  // run: twenty megabytes of doubles at the push-it size, against ten for the projection
  boundaries = null

  const outlined = cells.length <= OUTLINE_MAX_CELLS
  const mesh = buildMesh(projected, {
    chunkSize: CHUNK_SIZE,
    buckets: BUCKETS,
    inset: outlined ? 0 : INSET,
    bucketOf: buckets,
  })
  const outline = outlined ? buildOutlinePath(projected, OUTLINE_EDGES) : null
  const { bounds } = projected
  // and the projection is dead once the mesh and the outline hold their own copies, which is
  // before the recording allocates a point object per vertex
  projected = null

  return {
    scene: recordCellScene(mesh, bounds, outline, BUSY_ALPHA, heatPalette),
    outlined,
    boundariesMs,
    meshMs: performance.now() - started,
  }
}

/** Holds the recorded coverage of the cells no point landed in, and what building it took. */
export interface EmptyScene {
  scene: CellScene
  /** What the boundaries, the projection, the mesh and the recording took together. */
  ms: number
}

/**
 * Records the covered cells no point of the run landed in, as the empty step under the grid strip.
 *
 * They are one colour rather than a step of the ramp, because a cell of no points stands for no
 * count at all; the strip over them is what carries the tiling where the fills are this quiet.
 *
 * @param cells The covered cells the run counted nothing in, from `emptyCells`.
 * @param anchor The coordinate the scene's metre space is measured from.
 */
export function buildEmptyScene(cells: BigUint64Array, anchor: CameraAnchor): EmptyScene {
  const started = performance.now()
  let boundaries: Timed<CellBoundaries> | null = boundariesOf(cells)
  let projected: ProjectedCells | null = projectCells(boundaries.value, anchor)
  boundaries = null

  const mesh = buildMesh(projected, { chunkSize: CHUNK_SIZE, buckets: 1, inset: 0 })
  const outline = buildOutlinePath(projected, OUTLINE_EDGES)
  const { bounds } = projected
  projected = null

  return {
    scene: recordCellScene(mesh, bounds, outline, EMPTY_ALPHA, [EMPTY_COLOUR]),
    ms: performance.now() - started,
  }
}
