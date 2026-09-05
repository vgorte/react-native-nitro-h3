import { Skia, type SkPath } from '@shopify/react-native-skia'
import { boundariesOf, ringAt } from '../engine/cells'
import { buildMesh, buildOutlinePath } from '../engine/mesh'
import { projectCells } from '../engine/projection'
import { bucketOfRing } from '../engine/rings'
import { BUCKETS } from '../theme/tokens'
import { type CellScene, disposeCellScene, recordCellScene } from './CellPictures'
import type { CameraAnchor } from './useCamera'

const CHUNK_SIZE = 10_000
// three edges a cell cover a tiling of one resolution once, which halves the anti-aliasing work
const OUTLINE_EDGES = 3

/** Holds one ring recorded for the scene, together with what building it cost. */
export interface RingLayer {
  /** The ring's distance from the centre cell, which is also its place in the scene. */
  ring: number
  cells: number
  scene: CellScene
  /**
   * Answers the grid over the ring, drawn by the act so it can carry the camera's own line width.
   *
   * The path is built on the first frame that asks for it and kept afterwards, because most rings
   * are drawn at a scale where a line every cell would cover the colour it sits over. The ring's
   * projected points are held for that first build, which is the deliberate cost of waiting.
   */
  outlineOf(): SkPath | null
  /** Frees the ring's pictures and the outline if one was ever built; it is not drawn again. */
  dispose(): void
  /** What `gridRing` took. */
  ringMs: number
  /** What `cellsToBoundaries` took. */
  boundariesMs: number
  /** Everything the build took: the two calls, the projection, the mesh and the recording. */
  buildMs: number
}

/**
 * Builds one ring around a centre cell: its cells, the picture they are drawn from and their grid.
 *
 * A ring is recorded on its own so the act can fade it in and drop it without touching the rings
 * around it, and every cell of it carries the one colour its distance stands for.
 *
 * @param centre The cell the rings are walked from.
 * @param ring The ring's distance from that cell, `0` for the centre cell itself.
 * @param anchor The coordinate the scene's metre space is measured from.
 */
export function buildRing(centre: bigint, ring: number, anchor: CameraAnchor): RingLayer {
  const started = performance.now()
  const cells = ringAt(centre, ring)
  const boundaries = boundariesOf(cells.value)
  const projected = projectCells(boundaries.value, anchor)
  const buckets = new Uint8Array(cells.value.length).fill(bucketOfRing(ring, BUCKETS))
  const mesh = buildMesh(projected, {
    chunkSize: CHUNK_SIZE,
    buckets: BUCKETS,
    inset: 0,
    bucketOf: buckets,
  })
  let outline: SkPath | null | undefined
  const scene = recordCellScene(mesh, projected.bounds, null)
  return {
    ring,
    cells: cells.value.length,
    scene,
    outlineOf() {
      if (outline === undefined) {
        outline = Skia.Path.MakeFromSVGString(buildOutlinePath(projected, OUTLINE_EDGES))
      }
      return outline
    },
    dispose() {
      disposeCellScene(scene)
      outline?.dispose()
    },
    ringMs: cells.ms,
    boundariesMs: boundaries.ms,
    buildMs: performance.now() - started,
  }
}
