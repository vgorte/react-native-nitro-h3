import { describe, expect, test } from 'bun:test'
import {
  bucketOfRing,
  cellSpacingM,
  cellsInRings,
  GRID_RES,
  gridReads,
  MAX_K,
  MIN_K,
  openingScale,
  ringsToKeep,
} from '../engine/rings'

// the average edge of a resolution, an aperture of seven below the resolution 0 average
const EDGE_M = (res: number) => 1_107_712.591 / 7 ** (res / 2)

const BUCKETS = 16
const LAT = 52.52
const WIDTH = 402
const HEIGHT = 874

// the scene metres the widest disk spans: a ring of cells either side of the centre, plus a margin
// ring, in Web Mercator metres, of which a ground metre at `LAT` spans one over the cosine
const DISK_SPAN_M =
  (2 * (MAX_K + 1) * Math.sqrt(3) * EDGE_M(GRID_RES)) / Math.cos((LAT * Math.PI) / 180)

describe('ringsToKeep', () => {
  test('appends only the rings a larger k adds', () => {
    expect(ringsToKeep([0, 1, 2], 4)).toEqual([0, 1, 2, 3, 4])
  })

  test('drops the rings a smaller k removes and rebuilds nothing', () => {
    expect(ringsToKeep([0, 1, 2, 3, 4], 2)).toEqual([0, 1, 2])
  })

  test('answers the centre and its first ring from nothing at the opening k', () => {
    expect(ringsToKeep([], MIN_K)).toEqual([0, 1])
  })

  test('answers every ring of the widest disk', () => {
    expect(ringsToKeep([], MAX_K)).toHaveLength(MAX_K + 1)
  })
})

describe('bucketOfRing', () => {
  test('puts the centre on the brightest step and the outermost ring on the darkest', () => {
    expect(bucketOfRing(0, BUCKETS)).toBe(BUCKETS - 1)
    expect(bucketOfRing(MAX_K, BUCKETS)).toBe(0)
  })

  test('never brightens outward, and steps down about every third ring', () => {
    let previous = BUCKETS
    const steps = new Set<number>()
    for (let ring = 0; ring <= MAX_K; ring++) {
      const bucket = bucketOfRing(ring, BUCKETS)
      expect(bucket).toBeLessThanOrEqual(previous)
      previous = bucket
      steps.add(bucket)
    }
    expect(steps.size).toBe(BUCKETS)
  })

  test('holds a ring past the widest disk on the darkest step', () => {
    expect(bucketOfRing(MAX_K + 10, BUCKETS)).toBe(0)
  })
})

describe('cellsInRings', () => {
  test('sums the ring lengths of a walk', () => {
    expect(cellsInRings([{ length: 1 }, { length: 6 }, { length: 12 }])).toBe(19)
  })

  test('answers nothing for a walk of no rings', () => {
    expect(cellsInRings([])).toBe(0)
  })
})

describe('openingScale', () => {
  test('opens at a scale where the widest disk fits inside the viewport', () => {
    const span = DISK_SPAN_M * openingScale(WIDTH, HEIGHT, LAT, EDGE_M)
    expect(span).toBeLessThanOrEqual(WIDTH)
    expect(span).toBeGreaterThan(WIDTH * 0.75)
  })

  test('fits the narrow side, so a viewport turned on its side still holds the disk', () => {
    const span = DISK_SPAN_M * openingScale(HEIGHT, WIDTH, LAT, EDGE_M)
    expect(span).toBeLessThanOrEqual(WIDTH)
  })
})

describe('gridReads', () => {
  const spacing = cellSpacingM(LAT, EDGE_M)
  const opening = openingScale(WIDTH, HEIGHT, LAT, EDGE_M)

  test('leaves the grid out at the opening scale, where a cell is a few points across', () => {
    expect(spacing * opening).toBeLessThan(6)
    expect(gridReads(spacing, opening)).toBe(false)
  })

  test('brings the grid in once a pinch has made the cells wide enough to read', () => {
    expect(gridReads(spacing, opening * 8)).toBe(true)
  })
})
