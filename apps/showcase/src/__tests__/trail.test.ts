import { describe, expect, test } from 'bun:test'
import {
  AGE_SPAN,
  bucketOfAge,
  bucketsOfTrail,
  cameraTaken,
  capFixes,
  capTrail,
  cellsOfTrail,
  extendTrail,
  FIX_HISTORY,
  filledCells,
  headHeight,
  MAX_TRAIL_RES,
  MIN_TRAIL_RES,
  pathOrJump,
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

/** Stands in for the library refusing a path it cannot express. */
class Refusal extends Error {}

const refuse = (): BigUint64Array => {
  throw new Refusal('H3 could not walk this path')
}
const refuses = (error: unknown): boolean => error instanceof Refusal

describe('pathOrJump', () => {
  test('answers the path H3 walked', () => {
    expect(Array.from(pathOrJump(5n, 8n, path, refuses))).toEqual([5n, 6n, 7n, 8n])
  })

  test('answers the two ends where the path is refused', () => {
    expect(Array.from(pathOrJump(5n, 900n, refuse, refuses))).toEqual([5n, 900n])
  })

  test('leaves a refused jump without filled cells', () => {
    const trail = extendTrail([{ cell: 5n, filled: false }], 900n, neighbours, (from, to) =>
      pathOrJump(from, to, refuse, refuses),
    )

    expect(trail).toEqual([
      { cell: 5n, filled: false },
      { cell: 900n, filled: false },
    ])
  })

  test('hands back an error that is not the library refusing', () => {
    const broken = (): BigUint64Array => {
      throw new TypeError('a defect of the caller, not a jump')
    }

    expect(() => pathOrJump(5n, 900n, broken, refuses)).toThrow(TypeError)
  })
})

describe('headHeight', () => {
  test('stands midway between the panel and the readout', () => {
    // a panel ending at 600 of an 874 point viewport leaves a band from 600 to 768
    expect(headHeight(874, 600, 106)).toBe(684)
  })

  test('follows a panel that grows', () => {
    expect(headHeight(874, 700, 106)).toBeGreaterThan(headHeight(874, 600, 106))
  })

  test('follows the viewport at the same panel height', () => {
    expect(headHeight(1000, 600, 106)).toBeGreaterThan(headHeight(874, 600, 106))
  })

  test('stands on the readout where the panel reaches it', () => {
    expect(headHeight(874, 800, 106)).toBe(768)
  })
})

describe('cameraTaken', () => {
  const placed = { x: 100, y: 200, scale: 0.5 }

  test('leaves the camera where a tap moved nothing', () => {
    expect(cameraTaken({ ...placed }, placed)).toBe(false)
  })

  test('leaves the camera inside the slop of a finger that barely moved', () => {
    expect(cameraTaken({ x: 104, y: 203, scale: 0.5 }, placed)).toBe(false)
  })

  test('takes the camera on a pan past the slop', () => {
    expect(cameraTaken({ x: 130, y: 200, scale: 0.5 }, placed)).toBe(true)
    expect(cameraTaken({ x: 100, y: 160, scale: 0.5 }, placed)).toBe(true)
  })

  test('takes the camera on a pinch past the tolerance', () => {
    expect(cameraTaken({ x: 100, y: 200, scale: 0.55 }, placed)).toBe(true)
  })

  test('leaves the camera alone before the act has framed anything', () => {
    expect(cameraTaken({ x: 900, y: 900, scale: 3 }, { x: 0, y: 0, scale: 0 })).toBe(false)
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

describe('capFixes', () => {
  const walked = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ lat: 0, lng: 0, t: index }))

  test('leaves a history shorter than the span alone', () => {
    const fixes = walked(3)

    capFixes(fixes, FIX_HISTORY)

    expect(fixes).toHaveLength(3)
    expect(fixes[0].t).toBe(0)
  })

  test('drops the oldest fixes and keeps the newest, in place', () => {
    const fixes = walked(FIX_HISTORY + 5)

    capFixes(fixes, FIX_HISTORY)

    expect(fixes).toHaveLength(FIX_HISTORY)
    expect(fixes[0].t).toBe(5)
    expect(fixes[fixes.length - 1].t).toBe(FIX_HISTORY + 4)
  })

  test('holds at the span however many fixes arrive after it', () => {
    const fixes = walked(FIX_HISTORY)
    for (let fix = 0; fix < 20; fix++) {
      fixes.push({ lat: 0, lng: 0, t: FIX_HISTORY + fix })
      capFixes(fixes, FIX_HISTORY)
    }

    expect(fixes).toHaveLength(FIX_HISTORY)
    expect(fixes[fixes.length - 1].t).toBe(FIX_HISTORY + 19)
  })
})

describe('bucketOfAge', () => {
  test('gives the head the brightest step of the ramp, whatever the trail spans', () => {
    expect(bucketOfAge(0, false, BUCKETS, 0)).toBe(BUCKETS - 1)
    expect(bucketOfAge(0, false, BUCKETS, 7)).toBe(BUCKETS - 1)
    expect(bucketOfAge(0, false, BUCKETS, AGE_SPAN - 1)).toBe(BUCKETS - 1)
  })

  test('gives the oldest cell standing the darkest step, whatever the trail spans', () => {
    expect(bucketOfAge(7, false, BUCKETS, 7)).toBe(0)
    expect(bucketOfAge(AGE_SPAN - 1, false, BUCKETS, AGE_SPAN - 1)).toBe(0)
  })

  test('never brightens as a cell ages', () => {
    let last = BUCKETS
    for (let age = 0; age <= AGE_SPAN; age += 7) {
      const bucket = bucketOfAge(age, false, BUCKETS, AGE_SPAN)
      expect(bucket).toBeLessThanOrEqual(last)
      last = bucket
    }
  })

  test('holds a filled cell under a measured cell of the same age', () => {
    for (let age = 0; age < AGE_SPAN; age += 25) {
      const measuredBucket = bucketOfAge(age, false, BUCKETS, AGE_SPAN)
      const filledBucket = bucketOfAge(age, true, BUCKETS, AGE_SPAN)
      expect(filledBucket).toBeLessThanOrEqual(measuredBucket)
      // the two bands only meet where the ramp itself has run out of steps to tell them apart
      if (measuredBucket > 1) expect(filledBucket).toBeLessThan(measuredBucket)
    }
  })

  test('keeps a filled cell inside the lower half of the ramp', () => {
    expect(bucketOfAge(0, true, BUCKETS, AGE_SPAN)).toBeLessThanOrEqual((BUCKETS - 1) / 2)
  })
})

describe('bucketsOfTrail', () => {
  test('gives a trail of one cell the brightest step', () => {
    expect(Array.from(bucketsOfTrail(measured(1), BUCKETS))).toEqual([BUCKETS - 1])
  })

  test('spreads a trail of two cells over both ends of the ramp', () => {
    expect(Array.from(bucketsOfTrail(measured(2), BUCKETS))).toEqual([0, BUCKETS - 1])
  })

  test('runs a short trail over the whole ramp, head to tail', () => {
    const buckets = bucketsOfTrail(measured(8), BUCKETS)

    expect(buckets).toHaveLength(8)
    expect(buckets[7]).toBe(BUCKETS - 1)
    expect(buckets[0]).toBe(0)
    // every step down the trail is a step down the ramp, and none of them repeats
    expect(new Set(buckets).size).toBe(8)
  })

  test('runs a full trail over the whole ramp as well', () => {
    const buckets = bucketsOfTrail(measured(AGE_SPAN), BUCKETS)

    expect(buckets[AGE_SPAN - 1]).toBe(BUCKETS - 1)
    expect(buckets[0]).toBe(0)
    expect(new Set(buckets).size).toBe(BUCKETS)
  })

  test('spreads over the cells a capped trail kept, not over the ones it dropped', () => {
    const buckets = bucketsOfTrail(capTrail(measured(1_000), AGE_SPAN), BUCKETS)

    expect(buckets).toHaveLength(AGE_SPAN)
    expect(buckets[AGE_SPAN - 1]).toBe(BUCKETS - 1)
    expect(buckets[0]).toBe(0)
  })

  test('reads a filled step on the lower band', () => {
    const trail: TrailStep[] = [
      { cell: 1n, filled: false },
      { cell: 2n, filled: true },
      { cell: 3n, filled: false },
    ]
    const buckets = bucketsOfTrail(trail, BUCKETS)

    expect(buckets[1]).toBe(bucketOfAge(1, true, BUCKETS, 2))
    expect(buckets[1]).toBeLessThan(bucketOfAge(1, false, BUCKETS, 2))
    expect(buckets[2]).toBe(BUCKETS - 1)
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
