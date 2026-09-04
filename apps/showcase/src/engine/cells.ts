import type { CellBoundaries } from 'react-native-nitro-h3'
import {
  cellsToBoundaries,
  cellsToLatLngs,
  cellToChildren,
  cellToParent,
  compactCells,
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

/** Holds a call's result together with the milliseconds it took and the name it is shown under. */
export interface Timed<T> {
  label: string
  value: T
  ms: number
}

// resolved once, so no property lookup happens inside a timed window
const now = performance.now.bind(performance)

/** Runs a call inside a `performance.now()` window and labels its duration. */
export function timed<T>(label: string, call: () => T): Timed<T> {
  const start = now()
  const value = call()
  return { label, value, ms: now() - start }
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

export function compactOf(cells: BigUint64Array): Timed<BigUint64Array> {
  return timed('compactCells', () => compactCells(cells))
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
