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
