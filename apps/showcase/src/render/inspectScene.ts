import type { SkPath } from '@shopify/react-native-skia'
import { cellToChildren, cellToParent, getResolution, gridDisk } from 'react-native-nitro-h3'
import { boundariesOf } from '../engine/cells'
import { neighbourhoodOf } from '../engine/inspect'
import { buildMesh } from '../engine/mesh'
import { projectCells } from '../engine/projection'
import { BUCKETS } from '../theme/tokens'
import { type CellScene, recordCellScene } from './CellPictures'
import { outlinePath } from './fractalScene'
import type { CameraAnchor } from './useCamera'

const CHUNK_SIZE = 10_000

/** Alpha the children are filled at, baked into the paint, so the cell under them still reads. */
const CHILD_ALPHA = 0.45

// the highlight is a handful of cells, so every one of them takes the brightest step of the ramp
const TOP_BUCKET = BUCKETS - 1

/** Holds the highlight one inspected cell casts over the scene it stands in. */
export interface Highlight {
  /** The children, filled at {@linkcode CHILD_ALPHA}, `null` at resolution 15. */
  children: CellScene | null
  /** The ring of the parent, which is drawn as an outline, `null` at resolution 0. */
  parent: SkPath | null
  /** The rings of the neighbours, which are drawn filled in the contrast colour. */
  neighbours: SkPath
}

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

/**
 * Builds the layer the Skia acts draw over their scene while the Inspector stands open.
 *
 * @param cell The cell the sheet stands on.
 * @param anchor The coordinate the scene's metre space is measured from.
 */
export function buildHighlight(cell: bigint, anchor: CameraAnchor): Highlight {
  const around = neighbourhoodOf(cell, { getResolution, cellToParent, cellToChildren, gridDisk })
  return {
    children: around.children.length === 0 ? null : fillOf(around.children, anchor),
    parent: around.parent === null ? null : ringsOf(BigUint64Array.of(around.parent), anchor),
    neighbours: ringsOf(around.neighbours, anchor),
  }
}
