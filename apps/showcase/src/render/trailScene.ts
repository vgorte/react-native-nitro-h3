import { boundariesOf } from '../engine/cells'
import { buildMesh } from '../engine/mesh'
import { projectCells } from '../engine/projection'
import { bucketsOfTrail, cellsOfTrail, type TrailStep } from '../engine/trail'
import { BUCKETS } from '../theme/tokens'
import { type CellScene, recordCellScene } from './CellPictures'
import type { CameraAnchor } from './useCamera'

const CHUNK_SIZE = 10_000
// the trail is a chain rather than a tiling, so the cells stand apart instead of under a grid strip
const INSET = 0.08

/** Holds the recorded trail together with what the two stages behind it took. */
export interface TrailScene {
  scene: CellScene
  cells: number
  /** The cell the trail ended in, which is where the head reads on this recording. */
  head: bigint | null
  /** What `cellsToBoundaries` took. */
  boundariesMs: number
  /** What the projection, the mesh and the recording took. */
  meshMs: number
}

/**
 * Records the trail, every cell in the colour its age and its origin stand for.
 *
 * The cells are drawn inset rather than under an outline strip: a trail is a chain of cells and not
 * a tiling, so three edges a cell would leave a ragged grid, while the inset gives every cell of
 * the chain its own edge of ground.
 *
 * @param trail The cells walked so far, oldest first.
 * @param anchor The coordinate the scene's metre space is measured from.
 */
export function buildTrailScene(trail: readonly TrailStep[], anchor: CameraAnchor): TrailScene {
  const boundaries = boundariesOf(cellsOfTrail(trail))
  const started = performance.now()
  const projected = projectCells(boundaries.value, anchor)
  const mesh = buildMesh(projected, {
    chunkSize: CHUNK_SIZE,
    buckets: BUCKETS,
    inset: INSET,
    bucketOf: bucketsOfTrail(trail, BUCKETS),
  })

  return {
    scene: recordCellScene(mesh, projected.bounds, null),
    cells: trail.length,
    head: trail[trail.length - 1]?.cell ?? null,
    boundariesMs: boundaries.ms,
    meshMs: performance.now() - started,
  }
}
