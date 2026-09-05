/** Holds the distinct cells of a set in ascending order with the number of times each occurred. */
export interface Aggregate {
  cells: BigUint64Array
  counts: Uint32Array
  max: number
}

/**
 * Sorts a cell set in place and counts its runs.
 *
 * Hermes sorts a `BigUint64Array` natively when no comparator is given; the counting pass then
 * compares the two 32-bit words of each element, so no element is boxed as a `bigint`.
 */
export function aggregateCells(cells: BigUint64Array): Aggregate {
  if (cells.length === 0) {
    return { cells: new BigUint64Array(0), counts: new Uint32Array(0), max: 0 }
  }

  cells.sort()
  const words = new Uint32Array(cells.buffer, cells.byteOffset, cells.length * 2)
  const unique = new BigUint64Array(cells.length)
  const uniqueWords = new Uint32Array(unique.buffer)
  const counts = new Uint32Array(cells.length)

  let distinct = 0
  let run = 0
  let max = 0
  for (let index = 0; index < cells.length; index++) {
    const low = words[index * 2]
    const high = words[index * 2 + 1]
    const first = index === 0
    const same =
      !first &&
      low === uniqueWords[(distinct - 1) * 2] &&
      high === uniqueWords[(distinct - 1) * 2 + 1]
    if (same) {
      run += 1
    } else {
      uniqueWords[distinct * 2] = low
      uniqueWords[distinct * 2 + 1] = high
      distinct += 1
      run = 1
    }
    counts[distinct - 1] = run
    if (run > max) max = run
  }

  return { cells: unique.subarray(0, distinct), counts: counts.subarray(0, distinct), max }
}

/** Answers whether a cell stands in an ascending set, by halving the range it could be in. */
function holds(sorted: BigUint64Array, cell: bigint): boolean {
  let low = 0
  let high = sorted.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (sorted[middle] === cell) return true
    if (sorted[middle] < cell) low = middle + 1
    else high = middle - 1
  }
  return false
}

/**
 * Answers the covered cells that no point of the run landed in, in the order they were walked.
 *
 * The two sets are what the heat scene is cut along: a cell of the walk that the run counted is
 * drawn on the ramp, and every other one is drawn as the empty step, so no cell of no points is
 * ever handed a colour that stands for a count.
 *
 * @param covered The cells the coverage walked, in any order.
 * @param busy The distinct cells of the run, ascending, as {@linkcode aggregateCells} leaves them.
 */
export function emptyCells(covered: BigUint64Array, busy: BigUint64Array): BigUint64Array {
  const empty = new BigUint64Array(covered.length)
  let kept = 0
  for (const cell of covered) {
    if (holds(busy, cell)) continue
    empty[kept] = cell
    kept += 1
  }
  return empty.subarray(0, kept)
}
