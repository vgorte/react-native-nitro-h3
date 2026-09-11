import type { CellBoundaries } from 'react-native-nitro-h3'
import {
  cellsToBoundaries,
  cellsToLatLngs,
  cellToCenterChild,
  cellToChildren,
  cellToParent,
  getBaseCellNumber,
  getRes0Cells,
  getResolution,
  gridDisk,
  gridDiskDistances,
  gridPathCells,
  gridRing,
  latLngsToCells,
  uncompactCells,
} from 'react-native-nitro-h3'
import type { NeighbourhoodCalls } from './inspect'
import type { PatchCalls } from './patches'
import { type Timed, timed } from './timed'

/** Caps what any control in the app can allocate; passed to `configure` before the first call. */
export const MAX_CELL_COUNT = 1_500_000

/**
 * Bundles the calls a highlight walks the grid with, for the rules that take them injected.
 *
 * The rules live in `engine/inspect.ts`, which imports no package, so the bundle stands here where
 * the app's other package calls do.
 */
export const NEIGHBOURHOOD_CALLS: NeighbourhoodCalls = {
  getResolution,
  cellToParent,
  cellToChildren,
  gridDisk,
}

/** Bundles the calls the patch colouring reads the grid with, for the same reason. */
export const PATCH_CALLS: PatchCalls = {
  getBaseCellNumber,
  cellToParent,
  cellToCenterChild,
  gridDiskDistances,
}

export function diskAround(centre: bigint, k: number): Timed<BigUint64Array> {
  return timed('gridDisk', () => gridDisk(centre, k))
}

export function ringAt(centre: bigint, k: number): Timed<BigUint64Array> {
  return timed('gridRing', () => gridRing(centre, k))
}

export function diskDistancesAround(centre: bigint, k: number): Timed<BigUint64Array[]> {
  return timed('gridDiskDistances', () => gridDiskDistances(centre, k))
}

export function boundariesOf(cells: BigUint64Array): Timed<CellBoundaries> {
  return timed('cellsToBoundaries', () => cellsToBoundaries(cells))
}

export function centresOf(cells: BigUint64Array): Timed<Float64Array> {
  return timed('cellsToLatLngs', () => cellsToLatLngs(cells))
}

export function cellsFromPoints(coords: Float64Array, res: number): Timed<BigUint64Array> {
  return timed('latLngsToCells', () => latLngsToCells(coords, res))
}

export function childrenOf(cell: bigint, res: number): Timed<BigUint64Array> {
  return timed('cellToChildren', () => cellToChildren(cell, res))
}

export function pathBetween(from: bigint, to: bigint): Timed<BigUint64Array> {
  return timed('gridPathCells', () => gridPathCells(from, to))
}

/** Answers every cell of the earth at a resolution, res 0 straight from the table. */
export function earthAt(res: number): Timed<BigUint64Array> {
  if (res === 0) return timed('getRes0Cells', () => getRes0Cells())

  // read outside the window, so the duration covers `uncompactCells` alone
  const res0 = getRes0Cells()
  return timed('uncompactCells', () => uncompactCells(res0, res))
}

/**
 * Answers the ramp bucket of a cell by the base cell it descends from.
 *
 * A global view has no patch to colour by. The 122 base cells spread a world of cells over the ramp
 * on one call a cell, which is how the globe colours itself.
 */
export function bucketOfBaseCell(cell: bigint, buckets: number): number {
  return getBaseCellNumber(cell) % buckets
}
