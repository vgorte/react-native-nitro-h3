import { describe, expect, test } from 'bun:test'
import { aggregateCells, emptyCells } from '../engine/aggregate'

/** Counts occurrences the obvious way, as the reference the fast path is checked against. */
function naive(cells: BigUint64Array): Map<bigint, number> {
  const counts = new Map<bigint, number>()
  for (const cell of cells) counts.set(cell, (counts.get(cell) ?? 0) + 1)
  return counts
}

describe('aggregateCells', () => {
  test('counts a hand-written set', () => {
    const result = aggregateCells(new BigUint64Array([7n, 3n, 7n, 7n, 3n, 9n]))

    expect(Array.from(result.cells)).toEqual([3n, 7n, 9n])
    expect(Array.from(result.counts)).toEqual([2, 3, 1])
    expect(result.low).toBe(1)
    expect(result.max).toBe(3)
  })

  test('answers the range of the counts, the last run included', () => {
    const result = aggregateCells(new BigUint64Array([1n, 1n, 1n, 2n, 2n, 3n, 3n, 3n, 3n]))

    expect(Array.from(result.counts)).toEqual([3, 2, 4])
    expect(result.low).toBe(2)
    expect(result.max).toBe(4)
  })

  test('answers one count as both ends of the range', () => {
    const result = aggregateCells(new BigUint64Array([5n, 5n]))

    expect(result.low).toBe(2)
    expect(result.max).toBe(2)
  })

  test('matches a naive Map on random input', () => {
    const cells = new BigUint64Array(20_000)
    let seed = 0x2f6e2b1
    for (let index = 0; index < cells.length; index++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      // a spread wide enough to make both repeats and singletons likely
      cells[index] = BigInt(seed % 4096) | (0x8928308280fffffn & ~0xfffn)
    }
    const expected = naive(cells)

    const result = aggregateCells(cells)

    expect(result.cells.length).toBe(expected.size)
    for (let index = 0; index < result.cells.length; index++) {
      // an unseen cell reads 0 here, never a real run length
      expect(result.counts[index]).toBe(expected.get(result.cells[index]) ?? 0)
    }
    expect(result.low).toBe(Math.min(...expected.values()))
    expect(result.max).toBe(Math.max(...expected.values()))
  })

  test('answers an empty result for an empty input', () => {
    const result = aggregateCells(new BigUint64Array(0))

    expect(result.cells.length).toBe(0)
    expect(result.low).toBe(0)
    expect(result.max).toBe(0)
  })
})

describe('emptyCells', () => {
  test('keeps the covered cells no point landed in, in the order they were walked', () => {
    const covered = BigUint64Array.from([9n, 4n, 7n, 1n])
    const busy = BigUint64Array.from([4n, 9n])

    expect(Array.from(emptyCells(covered, busy))).toEqual([7n, 1n])
  })

  test('hands the ramp no cell of no points, whatever the run counted', () => {
    const covered = BigUint64Array.from([1n, 2n, 3n, 4n, 5n])
    const busy = BigUint64Array.from([2n, 4n])

    for (const cell of emptyCells(covered, busy)) {
      expect(busy.includes(cell)).toBe(false)
    }
  })

  test('answers every covered cell where the run counted none of them', () => {
    const covered = BigUint64Array.from([5n, 6n])

    expect(Array.from(emptyCells(covered, new BigUint64Array(0)))).toEqual([5n, 6n])
  })

  test('answers nothing where every covered cell is busy', () => {
    const cells = BigUint64Array.from([1n, 2n, 3n])

    expect(emptyCells(cells, cells)).toHaveLength(0)
  })

  test('answers nothing where nothing was covered', () => {
    expect(emptyCells(new BigUint64Array(0), BigUint64Array.from([1n]))).toHaveLength(0)
  })
})
