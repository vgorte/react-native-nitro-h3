import { describe, expect, test } from 'bun:test'
import {
  bucketOfRing,
  cellSpacingM,
  cellsInRings,
  GRID_RES,
  gridReads,
  MAX_K,
  MIN_K,
  OPEN_K,
  RING_PERIOD,
  ringsToKeep,
  scaleForDisk,
} from '../engine/rings'

// the average edge of a resolution, an aperture of seven below the resolution 0 average
const EDGE_M = (res: number) => 1_107_712.591 / 7 ** (res / 2)

const BUCKETS = 16
const LAT = 52.52
const WIDTH = 402
const HEIGHT = 874

// a ground metre at `LAT` spans one over the cosine of the scene's own Web Mercator metres
const SCENE_M = 1 / Math.cos((LAT * Math.PI) / 180)
// the scene metres a disk spans: a ring of cells either side of the centre, plus a margin ring
const spanOf = (rings: number) => 2 * (rings + 1) * Math.sqrt(3) * EDGE_M(GRID_RES) * SCENE_M

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
  test('runs the ramp from the centre to the darkest step and back every period', () => {
    expect(bucketOfRing(0, BUCKETS)).toBe(BUCKETS - 1)
    expect(bucketOfRing(RING_PERIOD / 2, BUCKETS)).toBe(0)
    expect(bucketOfRing(RING_PERIOD, BUCKETS)).toBe(BUCKETS - 1)
    expect(bucketOfRing(RING_PERIOD + RING_PERIOD / 2, BUCKETS)).toBe(0)
  })

  test('spreads most of the ramp over the disk the act opens on', () => {
    const steps = []
    for (let ring = 0; ring <= OPEN_K; ring++) steps.push(bucketOfRing(ring, BUCKETS))

    expect(steps).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7])
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

describe('scaleForDisk', () => {
  test('opens with a cell about 24 points across', () => {
    const across = 2 * EDGE_M(GRID_RES) * SCENE_M * scaleForDisk(WIDTH, HEIGHT, LAT, EDGE_M, OPEN_K)

    expect(across).toBeGreaterThan(20)
    expect(across).toBeLessThan(28)
  })

  test('frames the disk it is asked for inside the viewport', () => {
    for (const rings of [OPEN_K, 20, MAX_K]) {
      const span = spanOf(rings) * scaleForDisk(WIDTH, HEIGHT, LAT, EDGE_M, rings)

      expect(span).toBeLessThanOrEqual(WIDTH)
      expect(span).toBeGreaterThan(WIDTH * 0.75)
    }
  })

  test('zooms out as the disk grows, so a raised k never frames tighter', () => {
    const opening = scaleForDisk(WIDTH, HEIGHT, LAT, EDGE_M, OPEN_K)

    expect(scaleForDisk(WIDTH, HEIGHT, LAT, EDGE_M, OPEN_K + 1)).toBeLessThan(opening)
    expect(scaleForDisk(WIDTH, HEIGHT, LAT, EDGE_M, MAX_K)).toBeLessThan(opening)
  })

  test('fits the narrow side, so a viewport turned on its side still holds the disk', () => {
    const span = spanOf(MAX_K) * scaleForDisk(HEIGHT, WIDTH, LAT, EDGE_M, MAX_K)

    expect(span).toBeLessThanOrEqual(WIDTH)
  })
})

describe('gridReads', () => {
  const spacing = cellSpacingM(LAT, EDGE_M)

  test('has the grid on at the opening, where a cell is two dozen points across', () => {
    expect(gridReads(spacing, scaleForDisk(WIDTH, HEIGHT, LAT, EDGE_M, OPEN_K))).toBe(true)
  })

  test('drops the grid once the disk has grown past what a line every cell can carry', () => {
    expect(gridReads(spacing, scaleForDisk(WIDTH, HEIGHT, LAT, EDGE_M, MAX_K))).toBe(false)
  })
})
