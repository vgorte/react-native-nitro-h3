import { describe, expect, test } from 'bun:test'
import {
  BERLIN,
  BLOCK,
  blocksOf,
  centreOf,
  generatePoints,
  hotspotsOf,
  type PointCache,
  type PointMix,
  pointStream,
  servesRun,
  UNIFORM_SHARE,
} from '../engine/points'
import { bucketsOfCounts, heatPalette } from '../render/heatColours'
import { colours, ramp } from '../theme/tokens'

const BUCKETS = 16

// a mixture whose hotspots are points, so a drawn point is either on one of them or uniform
const TIGHT: PointMix = { hotspots: 3, sigmaDeg: 1e-6, uniformShare: UNIFORM_SHARE }

/** Answers how many of the drawn points sit on a hotspot of the mixture they were drawn from. */
function onHotspots(points: Float64Array, centres: Float64Array): number[] {
  const hits = new Array<number>(centres.length / 2).fill(0)
  for (let point = 0; point < points.length; point += 2) {
    for (let hotspot = 0; hotspot < hits.length; hotspot++) {
      const lat = centres[hotspot * 2]
      const lng = centres[hotspot * 2 + 1]
      if (Math.hypot(points[point] - lat, points[point + 1] - lng) < 1e-3) hits[hotspot] += 1
    }
  }
  return hits
}

const CACHE: PointCache = { seed: 3, count: 100_000, blocks: [], ms: 42 }

describe('generatePoints', () => {
  test('answers two doubles per point', () => {
    expect(generatePoints(1_000, 7, BERLIN).length).toBe(2_000)
  })

  test('lets a hotspot scatter past the box, which is only the frame the run opens on', () => {
    const points = generatePoints(20_000, 7, BERLIN)

    let outside = 0
    for (let index = 0; index < points.length; index += 2) {
      const out =
        points[index] < BERLIN.south ||
        points[index] > BERLIN.north ||
        points[index + 1] < BERLIN.west ||
        points[index + 1] > BERLIN.east
      if (out) outside += 1
    }
    expect(outside).toBeGreaterThan(0)
  })

  test('keeps the uniform share inside the box, which is the part the box still describes', () => {
    const { centres } = hotspotsOf(7, BERLIN, TIGHT)
    const points = generatePoints(4_000, 7, BERLIN, TIGHT)

    for (let index = 0; index < points.length; index += 2) {
      const near = onHotspots(points.subarray(index, index + 2), centres).some((hit) => hit === 1)
      if (near) continue
      expect(points[index]).toBeGreaterThanOrEqual(BERLIN.south)
      expect(points[index]).toBeLessThanOrEqual(BERLIN.north)
      expect(points[index + 1]).toBeGreaterThanOrEqual(BERLIN.west)
      expect(points[index + 1]).toBeLessThanOrEqual(BERLIN.east)
    }
  })

  test('draws the uniform share away from the hotspots and the rest around them', () => {
    const { centres } = hotspotsOf(7, BERLIN, TIGHT)
    const points = generatePoints(20_000, 7, BERLIN, TIGHT)
    const clustered = onHotspots(points, centres).reduce((sum, hits) => sum + hits, 0)

    expect(clustered / 20_000).toBeCloseTo(1 - UNIFORM_SHARE, 2)
  })

  test('gives every hotspot the share of the points its weight stands for', () => {
    const { centres, weights } = hotspotsOf(7, BERLIN, TIGHT)
    const hits = onHotspots(generatePoints(20_000, 7, BERLIN, TIGHT), centres)
    const drawn = hits.reduce((sum, hit) => sum + hit, 0)

    expect(weights.length).toBe(TIGHT.hotspots)
    for (const [hotspot, weight] of weights.entries()) {
      expect(hits[hotspot] / drawn).toBeCloseTo(weight, 1)
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

describe('heatPalette', () => {
  test('takes the hot end to the contrast colour and leaves the cold end on the ramp', () => {
    expect(heatPalette).toHaveLength(BUCKETS)
    expect(heatPalette[BUCKETS - 1]).toBe(colours.contrast)
    expect(heatPalette[0]).toBe(ramp[0].toLowerCase())
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
