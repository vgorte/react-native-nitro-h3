import type { SkPath } from '@shopify/react-native-skia'
import { boundariesOf, NEIGHBOURHOOD_CALLS } from '../engine/cells'
import { type Highlight, neighbourhoodOf } from '../engine/inspect'
import { buildMesh } from '../engine/mesh'
import { projectCells } from '../engine/projection'
import { BUCKETS } from '../theme/tokens'
import { type CellScene, disposeCellScene, recordCellScene } from './CellPictures'
import { outlinePath } from './fractalScene'
import type { CameraAnchor } from './useCamera'

const CHUNK_SIZE = 10_000

/** Alpha the children are filled at, baked into the paint, so the cell under them still reads. */
const CHILD_ALPHA = 0.45

// the highlight is a handful of cells, so every one of them takes the brightest step of the ramp
const TOP_BUCKET = BUCKETS - 1

/** Holds what a Skia act draws around an inspected cell: pictures for a fill, paths for a ring. */
export type SkiaHighlight = Highlight<CellScene, SkPath>

/** Records a cell set as one picture layer, every cell in the brightest colour of the ramp. */
function fillOf(cells: BigUint64Array, anchor: CameraAnchor): CellScene {
  const projected = projectCells(boundariesOf(cells).value, anchor)
  const mesh = buildMesh(projected, {
    chunkSize: CHUNK_SIZE,
    buckets: BUCKETS,
    inset: 0,
    bucketOf: new Uint8Array(cells.length).fill(TOP_BUCKET),
  })
  return recordCellScene(mesh, projected.bounds, null, CHILD_ALPHA)
}

/** Answers the closed rings of a cell set in the scene's own metre frame. */
function ringsOf(cells: BigUint64Array, anchor: CameraAnchor): SkPath {
  return outlinePath(projectCells(boundariesOf(cells).value, anchor))
}

/** Frees a highlight the sheet has moved off, its two outlines and the fill of the children. */
export function disposeHighlight(highlight: SkiaHighlight | null): void {
  if (highlight === null) return
  highlight.neighbours.dispose()
  disposeCellScene(highlight.children)
  highlight.parent?.dispose()
}

/**
 * Builds the layer the Skia acts draw over their scene while the Inspector stands open.
 *
 * @param cell The cell the sheet stands on.
 * @param anchor The coordinate the scene's metre space is measured from.
 */
export function buildHighlight(cell: bigint, anchor: CameraAnchor): SkiaHighlight {
  const around = neighbourhoodOf(cell, NEIGHBOURHOOD_CALLS)
  return {
    neighbours: ringsOf(around.neighbours, anchor),
    children: around.children.length === 0 ? null : fillOf(around.children, anchor),
    parent: around.parent === null ? null : ringsOf(BigUint64Array.of(around.parent), anchor),
  }
}
