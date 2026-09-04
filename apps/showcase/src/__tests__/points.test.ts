import { describe, expect, test } from 'bun:test'
import {
  BERLIN,
  BLOCK,
  blocksOf,
  boxBounds,
  bucketsOfCounts,
  centreOf,
  generatePoints,
  type PointCache,
  pointStream,
  servesRun,
} from '../engine/points'

const BUCKETS = 16

const CACHE: PointCache = { seed: 3, count: 100_000, blocks: [], ms: 42 }

describe('generatePoints', () => {
  test('answers two doubles per point inside the box', () => {
    const points = generatePoints(1_000, 7, BERLIN)

    expect(points.length).toBe(2_000)
    for (let index = 0; index < points.length; index += 2) {
      expect(points[index]).toBeGreaterThanOrEqual(BERLIN.south)
      expect(points[index]).toBeLessThanOrEqual(BERLIN.north)
      expect(points[index + 1]).toBeGreaterThanOrEqual(BERLIN.west)
      expect(points[index + 1]).toBeLessThanOrEqual(BERLIN.east)
    }
  })

  test('repeats exactly for one seed and differs for another', () => {
    expect(Array.from(generatePoints(50, 3, BERLIN))).toEqual(
      Array.from(generatePoints(50, 3, BERLIN)),
    )
    expect(Array.from(generatePoints(50, 4, BERLIN))).not.toEqual(
      Array.from(generatePoints(50, 3, BERLIN)),
    )
  })
})

describe('pointStream', () => {
  test('draws the same run block by block as in one call', () => {
    const draw = pointStream(9, BERLIN)
    const blocks = [...draw(30), ...draw(70)]

    expect(blocks).toEqual(Array.from(generatePoints(100, 9, BERLIN)))
  })
})

describe('blocksOf', () => {
  test('runs a count at the block size in one block', () => {
    expect(blocksOf(BLOCK)).toEqual([{ from: 0, count: BLOCK }])
  })

  test('cuts a million points into ten full blocks', () => {
    const blocks = blocksOf(1_000_000)

    expect(blocks).toHaveLength(10)
    expect(blocks[0]).toEqual({ from: 0, count: BLOCK })
    expect(blocks[9]).toEqual({ from: 900_000, count: BLOCK })
  })

  test('leaves the remainder in a shorter last block', () => {
    expect(blocksOf(250, 100)).toEqual([
      { from: 0, count: 100 },
      { from: 100, count: 100 },
      { from: 200, count: 50 },
    ])
  })

  test('answers no block for a run of no points', () => {
    expect(blocksOf(0)).toEqual([])
  })
})

describe('servesRun', () => {
  test('serves a run of the same seed and count, whatever resolution it asks for', () => {
    expect(servesRun(CACHE, 3, 100_000)).toBe(true)
  })

  test('refuses another seed and another count', () => {
    expect(servesRun(CACHE, 4, 100_000)).toBe(false)
    expect(servesRun(CACHE, 3, 1_000_000)).toBe(false)
  })

  test('refuses a run before anything has been drawn', () => {
    expect(servesRun(null, 3, 100_000)).toBe(false)
  })
})

describe('bucketsOfCounts', () => {
  test('takes the busiest cell to the brightest step and a single point to the darkest', () => {
    const buckets = bucketsOfCounts(new Uint32Array([1, 200]), 200, BUCKETS)

    expect(buckets[0]).toBe(0)
    expect(buckets[1]).toBe(BUCKETS - 1)
  })

  test('never falls as the count rises, and answers one bucket per cell', () => {
    const counts = new Uint32Array([1, 2, 5, 17, 60, 240, 1_000])
    const buckets = bucketsOfCounts(counts, 1_000, BUCKETS)

    expect(buckets).toHaveLength(counts.length)
    for (let cell = 1; cell < buckets.length; cell++) {
      expect(buckets[cell]).toBeGreaterThanOrEqual(buckets[cell - 1])
    }
  })

  test('spreads the low counts a linear ramp would leave at the darkest step', () => {
    const buckets = bucketsOfCounts(new Uint32Array([2, 8, 32]), 1_000_000, BUCKETS)

    expect(Array.from(buckets)).toEqual([1, 2, 4])
  })
})

describe('boxBounds', () => {
  test('answers a frame centred on the box, with north at the top', () => {
    const bounds = boxBounds(BERLIN)

    expect(bounds.minX).toBeCloseTo(-bounds.maxX, 6)
    // Mercator stretches northward, so the north edge stands further from the centre than the south
    expect(bounds.minY).toBeLessThan(-bounds.maxY)
    expect(bounds.maxX).toBeGreaterThan(0)
    expect(bounds.maxY).toBeGreaterThan(0)
  })

  test('spans the box: about 46 km across and 38 km down at Berlin', () => {
    const bounds = boxBounds(BERLIN)
    const scene = Math.cos((centreOf(BERLIN).lat * Math.PI) / 180)

    expect((bounds.maxX - bounds.minX) * scene).toBeCloseTo(45_700, -3)
    expect((bounds.maxY - bounds.minY) * scene).toBeCloseTo(37_500, -3)
  })
})

describe('centreOf', () => {
  test('answers the middle of the box', () => {
    expect(centreOf(BERLIN)).toEqual({
      lat: (BERLIN.south + BERLIN.north) / 2,
      lng: (BERLIN.west + BERLIN.east) / 2,
    })
  })
})
