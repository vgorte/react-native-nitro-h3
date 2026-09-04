import { formatAreaKm2, median } from './stats'

/** Repeats per row, because one call sits at the resolution of the clock. */
export const REPEATS = 50

/** Milliseconds the sheet takes to rise from the bottom edge. */
export const SHEET_MS = 220

// the two ends of the ladder, where a cell has no parent above it or no children below it
const COARSEST_RES = 0
const FINEST_RES = 15

/** Holds one reading of the sheet: what it answers, the call behind it and what that call took. */
export interface InspectorRow {
  /** What the row answers, in sentence case. */
  label: string
  /** The call the value came from, absent where the row is not one call's answer. */
  call?: string
  value: string
  /** The median of {@linkcode REPEATS} runs in milliseconds, absent where nothing was timed. */
  ms?: number
}

/** The H3 calls the highlight around an inspected cell is built from. */
export interface NeighbourhoodCalls {
  getResolution(cell: bigint): number
  cellToParent(cell: bigint, res: number): bigint
  cellToChildren(cell: bigint, res: number): BigUint64Array
  gridDisk(cell: bigint, k: number): BigUint64Array
}

/** The H3 calls the rows are read and timed from, injected so the rules import no package. */
export interface InspectCalls {
  cellToString(cell: bigint): string
  getResolution(cell: bigint): number
  getBaseCellNumber(cell: bigint): number
  isPentagon(cell: bigint): boolean
  cellAreaKm2(cell: bigint): number
  getHexagonEdgeLengthAvgM(res: number): number
  cellToParent(cell: bigint, res: number): bigint
  cellToChildrenSize(cell: bigint, res: number): number
  gridDisk(cell: bigint, k: number): BigUint64Array
}

/** Holds what one inspected cell stands between: its parent, its children and its ring. */
export interface Neighbourhood {
  /** The cell one resolution up, `null` at resolution `0`. */
  parent: bigint | null
  /** The cells one resolution down, empty at resolution `15`. */
  children: BigUint64Array
  /** The ring around the cell, the cell itself left out. */
  neighbours: BigUint64Array
}

/** Answers the median duration of a call over `repeats` timed runs, in milliseconds. */
export function repeatMedianMs(call: () => unknown, repeats: number = REPEATS): number {
  call()
  const samples: number[] = []
  for (let repeat = 0; repeat < repeats; repeat++) {
    const start = performance.now()
    call()
    samples.push(performance.now() - start)
  }
  return median(samples)
}

/** Answers the literal shape of a call: what it was handed, what it answered and how wide that is. */
function shapeOf(argument: string, result: BigUint64Array | Float64Array): string {
  return `${argument} -> ${result.constructor.name} of ${result.length}, ${result.byteLength} bytes`
}

/**
 * Answers every reading the sheet lists for one cell, each timed over {@linkcode REPEATS} runs.
 *
 * The two ends of the ladder drop the row that has nothing to answer: resolution `0` has no parent
 * above it and resolution `15` no level below it. The last row is not a reading but the shape of the
 * call above it, so the visitor sees what an array call hands back and how wide that is.
 *
 * @param cell The cell the sheet stands on.
 * @param h3 The calls to read and time, which the act passes in from the package.
 */
export function inspectRows(cell: bigint, h3: InspectCalls): InspectorRow[] {
  const res = h3.getResolution(cell)
  const disk = h3.gridDisk(cell, 1)

  const rows: InspectorRow[] = [
    {
      label: 'index',
      call: 'cellToString',
      value: h3.cellToString(cell),
      ms: repeatMedianMs(() => h3.cellToString(cell)),
    },
    // the cell is a `bigint` on this side of the bridge, and the sheet says so rather than hiding it
    { label: 'decimal', value: cell.toString() },
    {
      label: 'resolution',
      call: 'getResolution',
      value: `${res}`,
      ms: repeatMedianMs(() => h3.getResolution(cell)),
    },
    {
      label: 'base cell',
      call: 'getBaseCellNumber',
      value: `${h3.getBaseCellNumber(cell)}`,
      ms: repeatMedianMs(() => h3.getBaseCellNumber(cell)),
    },
    {
      label: 'pentagon',
      call: 'isPentagon',
      value: h3.isPentagon(cell) ? 'yes' : 'no',
      ms: repeatMedianMs(() => h3.isPentagon(cell)),
    },
    {
      label: 'cell area',
      call: 'cellAreaKm2',
      value: formatAreaKm2(h3.cellAreaKm2(cell)),
      ms: repeatMedianMs(() => h3.cellAreaKm2(cell)),
    },
    {
      label: `average for res ${res}`,
      call: 'getHexagonEdgeLengthAvgM',
      value: `${h3.getHexagonEdgeLengthAvgM(res).toFixed(1)} m`,
      ms: repeatMedianMs(() => h3.getHexagonEdgeLengthAvgM(res)),
    },
  ]

  if (res > COARSEST_RES) {
    rows.push({
      label: 'parent',
      call: 'cellToParent',
      value: h3.cellToString(h3.cellToParent(cell, res - 1)),
      ms: repeatMedianMs(() => h3.cellToParent(cell, res - 1)),
    })
  }
  if (res < FINEST_RES) {
    rows.push({
      label: 'next level',
      call: 'cellToChildrenSize',
      value: `${h3.cellToChildrenSize(cell, res + 1)}`,
      ms: repeatMedianMs(() => h3.cellToChildrenSize(cell, res + 1)),
    })
  }

  rows.push(
    {
      label: 'neighbours',
      call: 'gridDisk',
      value: `${disk.length - 1}`,
      ms: repeatMedianMs(() => h3.gridDisk(cell, 1)),
    },
    { label: 'shape', value: shapeOf('bigint', disk) },
  )
  return rows
}

/**
 * Answers what the highlight around an inspected cell is drawn from.
 *
 * @param cell The cell the sheet stands on.
 * @param h3 The calls to walk the grid with, which the act passes in from the package.
 */
export function neighbourhoodOf(cell: bigint, h3: NeighbourhoodCalls): Neighbourhood {
  const res = h3.getResolution(cell)
  return {
    parent: res === COARSEST_RES ? null : h3.cellToParent(cell, res - 1),
    children: res === FINEST_RES ? new BigUint64Array(0) : h3.cellToChildren(cell, res + 1),
    neighbours: h3.gridDisk(cell, 1).filter((member) => member !== cell),
  }
}
