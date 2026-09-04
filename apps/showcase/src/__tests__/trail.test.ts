import { describe, expect, test } from 'bun:test'
import {
  AGE_SPAN,
  bucketOfAge,
  bucketsOfTrail,
  capTrail,
  cellsOfTrail,
  extendTrail,
  filledCells,
  MAX_TRAIL_RES,
  MIN_TRAIL_RES,
  scaleForTrail,
  TRAIL_RES,
  type TrailStep,
} from '../engine/trail'

const BUCKETS = 16
const LAT = 37.33
const WIDTH = 402
const HEIGHT = 874

// the average edge of a resolution, an aperture of seven below the resolution 0 average
const EDGE_M = (res: number) => 1_107_712.591 / 7 ** (res / 2)

const neighbours = (a: bigint, b: bigint): boolean => (a > b ? a - b : b - a) === 1n
const path = (a: bigint, b: bigint): BigUint64Array => {
  const cells: bigint[] = []
  for (let cell = a; cell <= b; cell++) cells.push(cell)
  return BigUint64Array.from(cells)
}

/** Answers a trail of `count` measured cells, oldest first, which is the order the act holds. */
const measured = (count: number): TrailStep[] =>
  Array.from({ length: count }, (_, index) => ({ cell: BigInt(index), filled: false }))

describe('extendTrail', () => {
  test('ignores a repeated fix', () => {
    const trail = extendTrail([{ cell: 5n, filled: false }], 5n, neighbours, path)

    expect(trail).toHaveLength(1)
  })

  test('appends a neighbour as a measured cell', () => {
    const trail = extendTrail([{ cell: 5n, filled: false }], 6n, neighbours, path)

    expect(trail).toEqual([
      { cell: 5n, filled: false },
      { cell: 6n, filled: false },
    ])
  })

  test('closes a gap with the grid path and marks the filled cells', () => {
    const trail = extendTrail([{ cell: 5n, filled: false }], 9n, neighbours, path)

    expect(trail.map((step) => step.cell)).toEqual([5n, 6n, 7n, 8n, 9n])
    expect(trail.map((step) => step.filled)).toEqual([false, true, true, true, false])
  })

  test('starts the trail from the first fix', () => {
    expect(extendTrail([], 5n, neighbours, path)).toEqual([{ cell: 5n, filled: false }])
  })
})

describe('capTrail', () => {
  test('leaves a trail shorter than the span alone', () => {
    const trail = measured(3)

    expect(capTrail(trail, AGE_SPAN)).toBe(trail)
  })

  test('drops the oldest cells off the tail and keeps the head', () => {
    const capped = capTrail(measured(AGE_SPAN + 10), AGE_SPAN)

    expect(capped).toHaveLength(AGE_SPAN)
    expect(capped[0].cell).toBe(10n)
    expect(capped[capped.length - 1].cell).toBe(BigInt(AGE_SPAN + 9))
  })

  test('caps a gap that fills more cells than the span in one step', () => {
    expect(capTrail(measured(AGE_SPAN * 3), AGE_SPAN)).toHaveLength(AGE_SPAN)
  })
})

describe('bucketOfAge', () => {
  test('gives the head the brightest step of the ramp', () => {
    expect(bucketOfAge(0, false, BUCKETS)).toBe(BUCKETS - 1)
  })

  test('gives a cell a whole span old the darkest step', () => {
    expect(bucketOfAge(AGE_SPAN, false, BUCKETS)).toBe(0)
    expect(bucketOfAge(AGE_SPAN * 2, false, BUCKETS)).toBe(0)
  })

  test('never brightens as a cell ages', () => {
    let last = BUCKETS
    for (let age = 0; age <= AGE_SPAN; age += 7) {
      const bucket = bucketOfAge(age, false, BUCKETS)
      expect(bucket).toBeLessThanOrEqual(last)
      last = bucket
    }
  })

  test('holds a filled cell under a measured cell of the same age', () => {
    for (let age = 0; age < AGE_SPAN; age += 25) {
      const measuredBucket = bucketOfAge(age, false, BUCKETS)
      const filledBucket = bucketOfAge(age, true, BUCKETS)
      expect(filledBucket).toBeLessThanOrEqual(measuredBucket)
      // the two bands only meet where the ramp itself has run out of steps to tell them apart
      if (measuredBucket > 1) expect(filledBucket).toBeLessThan(measuredBucket)
    }
  })

  test('keeps a filled cell inside the lower half of the ramp', () => {
    expect(bucketOfAge(0, true, BUCKETS)).toBeLessThanOrEqual((BUCKETS - 1) / 2)
  })
})

describe('bucketsOfTrail', () => {
  test('answers one bucket a step, brightest at the head', () => {
    const buckets = bucketsOfTrail(measured(5), BUCKETS)

    expect(buckets).toHaveLength(5)
    expect(buckets[4]).toBe(BUCKETS - 1)
    expect(buckets[0]).toBe(bucketOfAge(4, false, BUCKETS))
  })

  test('reads a filled step on the lower band', () => {
    const trail: TrailStep[] = [
      { cell: 1n, filled: true },
      { cell: 2n, filled: false },
    ]
    const buckets = bucketsOfTrail(trail, BUCKETS)

    expect(buckets[0]).toBe(bucketOfAge(1, true, BUCKETS))
    expect(buckets[1]).toBe(BUCKETS - 1)
  })
})

describe('scaleForTrail', () => {
  test('fits the asked-for cells across the narrow side, less the margin', () => {
    const spacing = (Math.sqrt(3) * EDGE_M(TRAIL_RES)) / Math.cos((LAT * Math.PI) / 180)
    const scale = scaleForTrail(WIDTH, HEIGHT, LAT, EDGE_M, TRAIL_RES, 20)

    expect(20 * spacing * scale).toBeCloseTo(WIDTH * 0.9, 6)
  })

  test('answers a finer resolution a larger scale, cell for cell', () => {
    const coarse = scaleForTrail(WIDTH, HEIGHT, LAT, EDGE_M, MIN_TRAIL_RES)
    const fine = scaleForTrail(WIDTH, HEIGHT, LAT, EDGE_M, MAX_TRAIL_RES)

    expect(fine).toBeGreaterThan(coarse)
  })
})

describe('cellsOfTrail', () => {
  test('answers the cells in the order they were walked', () => {
    expect(Array.from(cellsOfTrail(measured(3)))).toEqual([0n, 1n, 2n])
  })
})

describe('filledCells', () => {
  test('counts the cells the grid path filled in', () => {
    const trail = extendTrail([{ cell: 5n, filled: false }], 9n, neighbours, path)

    expect(filledCells(trail)).toBe(3)
    expect(filledCells(measured(4))).toBe(0)
  })
})

describe('the act constants', () => {
  test('put the default resolution between the two the control offers', () => {
    expect(MIN_TRAIL_RES).toBeLessThan(TRAIL_RES)
    expect(TRAIL_RES).toBeLessThan(MAX_TRAIL_RES)
  })
})
