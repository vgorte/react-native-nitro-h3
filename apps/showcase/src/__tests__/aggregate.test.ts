import { describe, expect, test } from 'bun:test'
import { aggregateCells } from '../engine/aggregate'

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
    expect(result.max).toBe(3)
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
      // a cell the reference never saw answers 0, which no run length can match
      expect(result.counts[index]).toBe(expected.get(result.cells[index]) ?? 0)
    }
  })

  test('answers an empty result for an empty input', () => {
    const result = aggregateCells(new BigUint64Array(0))

    expect(result.cells.length).toBe(0)
    expect(result.max).toBe(0)
  })
})
