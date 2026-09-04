import type { CellBoundaries } from 'react-native-nitro-h3'
import { boundariesOf, type Timed } from '../engine/cells'
import { buildMesh, buildOutlinePath } from '../engine/mesh'
import { OUTLINE_MAX_CELLS } from '../engine/points'
import { type ProjectedCells, projectCells } from '../engine/projection'
import { BUCKETS } from '../theme/tokens'
import { type CellScene, recordCellScene } from './CellPictures'
import type { CameraAnchor } from './useCamera'

const CHUNK_SIZE = 10_000
// three edges a cell cover a tiling of one resolution once, which halves the anti-aliasing work
const OUTLINE_EDGES = 3
// the fraction spike 1 measured the inset variant at, where it held 60 fps at 128,000 cells
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
 * it the strip comes off and every cell is drawn inset instead, which is the split spike 1
 * measured: the strip at that size cost a third of the frame rate, the inset none of it.
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
    scene: recordCellScene(mesh, bounds, outline),
    outlined,
    boundariesMs,
    meshMs: performance.now() - started,
  }
}
