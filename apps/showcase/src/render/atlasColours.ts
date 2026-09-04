import { cellToCenterChild, cellToParent, gridDiskDistances } from 'react-native-nitro-h3'
import { PATCH_DEPTH } from '../engine/atlas'
import { bucketOfBaseCell, timed } from '../engine/cells'
import { bucketForDistance, PATCH_RINGS } from '../engine/mesh'

/** One ramp step per ring of a patch, plus the step every cell outside one takes. */
export const PATCH_BUCKETS = PATCH_RINGS + 1

/** Holds the colour of every cell and what the calls behind it cost. */
export interface PatchBuckets {
  buckets: Uint8Array
  /** The call the second duration belongs to, which a global view answers differently. */
  call: string
  /** Absent where the view is global and no ancestor was climbed to. */
  patchMs: number | null
  ringsMs: number
}

/**
 * Answers the ramp bucket of every cell, its ring distance to the centre of the patch it lies in.
 *
 * A patch is the {@linkcode PATCH_DEPTH} generations up of a cell, so the pattern is anchored to
 * the grid rather than to the view: panning slides the bullseyes, it does not move them. Under that
 * depth there is no ancestor to climb to and the patches would overlap, so a global view falls back
 * on the base cell, which is what the globe colours by.
 *
 * @param cells The cells the collection is built from.
 * @param res The resolution they were asked for.
 */
export function patchBuckets(cells: BigUint64Array, res: number): PatchBuckets {
  if (res < PATCH_DEPTH) {
    const buckets = new Uint8Array(cells.length)
    const global = timed('getBaseCellNumber', () => {
      for (let cell = 0; cell < cells.length; cell++) {
        buckets[cell] = bucketOfBaseCell(cells[cell], PATCH_BUCKETS)
      }
    })
    return { buckets, call: 'getBaseCellNumber', patchMs: null, ringsMs: global.ms }
  }

  const patches = timed('cellToParent', () => {
    const ancestors = new BigUint64Array(cells.length)
    for (let cell = 0; cell < cells.length; cell++) {
      ancestors[cell] = cellToParent(cells[cell], res - PATCH_DEPTH)
    }
    return ancestors
  })

  // the distinct ancestors are counted outside the window, so the row times H3 and nothing else
  const seen = new Set<bigint>()
  const ancestors: bigint[] = []
  for (const ancestor of patches.value) {
    if (seen.has(ancestor)) continue
    seen.add(ancestor)
    ancestors.push(ancestor)
  }

  // the centre child of each patch is climbed to outside the window too, so the row times the walk
  const centres = new BigUint64Array(ancestors.length)
  for (let patch = 0; patch < ancestors.length; patch++) {
    centres[patch] = cellToCenterChild(ancestors[patch], res)
  }

  const rings = timed('gridDiskDistances', () => {
    const walked = new Array<BigUint64Array[]>(ancestors.length)
    for (let patch = 0; patch < ancestors.length; patch++) {
      walked[patch] = gridDiskDistances(centres[patch], PATCH_RINGS)
    }
    return walked
  })

  const index = new Map<bigint, number>()
  for (let cell = 0; cell < cells.length; cell++) index.set(cells[cell], cell)
  const buckets = new Uint8Array(cells.length)
  for (const patch of rings.value) {
    for (let ring = 0; ring < patch.length; ring++) {
      const bucket = bucketForDistance(ring, PATCH_BUCKETS)
      for (const member of patch[ring]) {
        const found = index.get(member)
        if (found !== undefined) buckets[found] = bucket
      }
    }
  }

  return { buckets, call: 'gridDiskDistances', patchMs: patches.ms, ringsMs: rings.ms }
}
