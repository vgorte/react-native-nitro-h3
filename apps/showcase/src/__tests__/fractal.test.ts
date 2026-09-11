import { describe, expect, test } from 'bun:test'
import {
  bucketOfResolution,
  CEILING_NOTE,
  coverage,
  FLOOR_NOTE,
  FRACTAL_CELL_CAP,
  leafFrom,
  leavesOf,
  MAX_K,
  MAX_RES,
  OPEN_CELL_PX,
  openingScale,
  reachOf,
  replaceLeaf,
  START_RES,
  TOP_NOTE,
  withoutBranch,
} from '../engine/fractal'

// a stand-in hierarchy: the low nibble carries the resolution, every level up drops three path bits
const resolutionOf = (cell: bigint): number => Number(cell & 0xfn)

function parentOf(cell: bigint, res: number): bigint {
  const dropped = BigInt(3 * (resolutionOf(cell) - res))
  return (((cell >> 4n) >> dropped) << 4n) | BigInt(res)
}

/** Answers the stand-in cell at `res` whose path is `path`. */
function cellAt(res: number, path: number): bigint {
  return (BigInt(path) << 4n) | BigInt(res)
}

/** Answers the eight children the stand-in hierarchy gives a cell. */
function childrenAt(cell: bigint): bigint[] {
  const res = resolutionOf(cell) + 1
  const path = cell >> 4n
  return Array.from(
    { length: 8 },
    (_, child) => (((path << 3n) | BigInt(child)) << 4n) | BigInt(res),
  )
}

const BUCKETS = 16
const EDGE_M = (res: number) => 1_107_712.591 / 2 ** (res * 0.5) / 1.5

describe('bucketOfResolution', () => {
  test('puts the opening resolution on the darkest step and the floor on the brightest', () => {
    expect(bucketOfResolution(START_RES, BUCKETS)).toBe(0)
    expect(bucketOfResolution(MAX_RES, BUCKETS)).toBe(BUCKETS - 1)
  })

  test('keeps a cell folded above the opening resolution on the darkest step', () => {
    expect(bucketOfResolution(START_RES - 1, BUCKETS)).toBe(0)
    expect(bucketOfResolution(0, BUCKETS)).toBe(0)
  })

  test('gives every resolution below the opening one its own step', () => {
    const steps = []
    for (let res = START_RES; res <= MAX_RES; res++) steps.push(bucketOfResolution(res, BUCKETS))

    expect(steps).toEqual([0, 2, 3, 5, 7, 8, 10, 12, 13, 15])
    expect(new Set(steps).size).toBe(steps.length)
  })
})

describe('leavesOf', () => {
  test('reads the colours and the resolution range of a mixed set in one pass', () => {
    const cells = BigUint64Array.from([cellAt(6, 1), cellAt(9, 2), cellAt(7, 3)])

    const leaves = leavesOf(cells, BUCKETS, resolutionOf)

    expect(leaves.shallowest).toBe(6)
    expect(leaves.deepest).toBe(9)
    expect(Array.from(leaves.buckets)).toEqual([0, 5, 2])
    expect(leaves.member.has(cellAt(9, 2))).toBe(true)
    expect(leaves.member.has(cellAt(9, 3))).toBe(false)
  })
})

describe('reachOf', () => {
  test('lets a fresh opening set both split and fold, with nothing to say', () => {
    const leaves = leavesOf(BigUint64Array.from([cellAt(6, 1)]), BUCKETS, resolutionOf)

    expect(reachOf(leaves)).toEqual({ split: true, fold: true, note: null })
  })

  test('stops the split at the ceiling, before a call is made', () => {
    const cells = BigUint64Array.from(
      Array.from({ length: FRACTAL_CELL_CAP - 5 }, (_, index) => cellAt(6, index)),
    )

    const reach = reachOf(leavesOf(cells, BUCKETS, resolutionOf))

    expect(reach.split).toBe(false)
    expect(reach.fold).toBe(true)
    expect(reach.note).toBe(CEILING_NOTE)
  })

  test('stops the split at the floor', () => {
    const leaves = leavesOf(BigUint64Array.from([cellAt(15, 1)]), BUCKETS, resolutionOf)

    expect(reachOf(leaves)).toEqual({ split: false, fold: true, note: FLOOR_NOTE })
  })

  test('stops the fold at the ceiling of the ladder', () => {
    const leaves = leavesOf(BigUint64Array.from([cellAt(0, 1)]), BUCKETS, resolutionOf)

    expect(reachOf(leaves)).toEqual({ split: true, fold: false, note: TOP_NOTE })
  })
})

describe('MAX_K', () => {
  test('is the largest disk that still fits under the cap with room for one split', () => {
    const disk = (k: number) => 3 * k * (k + 1) + 1

    expect(disk(MAX_K)).toBeLessThanOrEqual(FRACTAL_CELL_CAP)
    expect(disk(MAX_K + 1)).toBeGreaterThan(FRACTAL_CELL_CAP)
  })
})

describe('openingScale', () => {
  test('draws a cell of the opening resolution at the size a child settles at', () => {
    const lat = 52.52
    const scale = openingScale(lat, EDGE_M)

    const widthM = 2 * EDGE_M(START_RES)
    const pixels = (widthM * scale) / Math.cos((lat * Math.PI) / 180)

    expect(pixels).toBeCloseTo(OPEN_CELL_PX, 6)
  })
})

describe('coverage', () => {
  test('grows the disk as the viewport grows', () => {
    const scale = openingScale(0, EDGE_M)

    expect(coverage(800, 1600, scale, 0, EDGE_M)).toBeGreaterThan(
      coverage(400, 800, scale, 0, EDGE_M),
    )
  })

  test('keeps a margin ring on the smallest viewport and never crosses the cap', () => {
    expect(coverage(0, 0, openingScale(0, EDGE_M), 0, EDGE_M)).toBe(1)
    expect(coverage(1, 1, openingScale(0, EDGE_M), 0, EDGE_M)).toBe(2)
    expect(coverage(400, 800, 1e-9, 0, EDGE_M)).toBe(MAX_K)
  })
})

describe('replaceLeaf', () => {
  test('swaps the split cell for its children and keeps the order of the rest', () => {
    const cells = BigUint64Array.from([cellAt(6, 1), cellAt(6, 2), cellAt(6, 3)])
    const children = BigUint64Array.from(childrenAt(cellAt(6, 2)).slice(0, 3))

    const next = replaceLeaf(cells, cellAt(6, 2), children)

    expect(Array.from(next)).toEqual([cellAt(6, 1), cellAt(6, 3), ...Array.from(children)])
  })
})

describe('withoutBranch', () => {
  test('drops the cell a fold acts on, its siblings and their own descendants', () => {
    const parent = cellAt(6, 2)
    const [first, second] = childrenAt(parent)
    const cells = BigUint64Array.from([
      cellAt(6, 1),
      first,
      ...childrenAt(second),
      cellAt(6, 3),
      parent,
    ])

    const kept = withoutBranch(cells, parent, 6, resolutionOf, parentOf)

    expect(kept).toEqual([cellAt(6, 1), cellAt(6, 3)])
  })

  test('keeps a cell shallower than the fold, which cannot descend from it', () => {
    const cells = BigUint64Array.from([cellAt(4, 1), cellAt(7, 0)])

    expect(withoutBranch(cells, cellAt(6, 0), 6, resolutionOf, parentOf)).toEqual([cellAt(4, 1)])
  })
})

describe('leafFrom', () => {
  test('climbs from the deepest resolution until the cell is one of the leaves', () => {
    const shallow = cellAt(6, 1)
    const leaves = leavesOf(BigUint64Array.from([shallow, cellAt(9, 700)]), BUCKETS, resolutionOf)
    const deep = childrenAt(childrenAt(childrenAt(shallow)[2])[1])[4]

    expect(leafFrom(deep, leaves, parentOf)).toBe(shallow)
  })

  test('answers the cell itself where it is already a leaf', () => {
    const leaves = leavesOf(BigUint64Array.from([cellAt(9, 700)]), BUCKETS, resolutionOf)

    expect(leafFrom(cellAt(9, 700), leaves, parentOf)).toBe(cellAt(9, 700))
  })

  test('answers null where nothing on the path is drawn', () => {
    const leaves = leavesOf(BigUint64Array.from([cellAt(6, 1)]), BUCKETS, resolutionOf)

    expect(leafFrom(cellAt(9, 700), leaves, parentOf)).toBeNull()
  })
})
