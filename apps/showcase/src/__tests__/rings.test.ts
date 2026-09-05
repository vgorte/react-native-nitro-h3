import { describe, expect, test } from 'bun:test'
import {
  bandHeight,
  bucketOfRing,
  cellSpacingM,
  cellsInRings,
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
// the band an expanded panel and the readout leave open on the viewport above
const BAND = 560

// the scene metres a disk spans, counted in the spacing the act itself answers: a ring of cells
// either side of the centre, plus the margin ring the fit leaves free
const spanOf = (rings: number, lat = LAT) => 2 * (rings + 1) * cellSpacingM(lat, EDGE_M)

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
  test('opens with a cell about 24 points across, corner to corner', () => {
    // a hexagon is two edges across its corners and the square root of three between its centres
    const across =
      ((2 / Math.sqrt(3)) * spanOf(OPEN_K) * scaleForDisk(WIDTH, BAND, LAT, EDGE_M, OPEN_K)) /
      (2 * (OPEN_K + 1))

    expect(across).toBeGreaterThan(20)
    expect(across).toBeLessThan(28)
  })

  test('frames the disk it is asked for inside the viewport', () => {
    for (const rings of [OPEN_K, 20, MAX_K]) {
      const span = spanOf(rings) * scaleForDisk(WIDTH, BAND, LAT, EDGE_M, rings)

      expect(span).toBeLessThanOrEqual(WIDTH)
      expect(span).toBeGreaterThan(WIDTH * 0.75)
    }
  })

  test('zooms out in step with the disk, so twice the rings is half the scale', () => {
    const opening = scaleForDisk(WIDTH, BAND, LAT, EDGE_M, OPEN_K)
    const doubled = scaleForDisk(WIDTH, BAND, LAT, EDGE_M, 2 * OPEN_K + 1)

    expect(scaleForDisk(WIDTH, BAND, LAT, EDGE_M, OPEN_K + 1)).toBeLessThan(opening)
    expect(doubled).toBeCloseTo(opening / 2, 10)
  })

  test('draws the same disk at any latitude, because the scale carries the projection', () => {
    for (const lat of [0, 30, LAT, 70]) {
      const span = spanOf(OPEN_K, lat) * scaleForDisk(WIDTH, BAND, lat, EDGE_M, OPEN_K)

      expect(span).toBeCloseTo(WIDTH * 0.9, 9)
    }
  })

  test('fits the narrow side, so a viewport turned on its side still holds the disk', () => {
    const span = spanOf(MAX_K) * scaleForDisk(HEIGHT, WIDTH, LAT, EDGE_M, MAX_K)

    expect(span).toBeLessThanOrEqual(WIDTH)
  })

  test('fits the band where the panel has left less of it than the viewport is wide', () => {
    const narrow = 300
    const span = spanOf(MAX_K) * scaleForDisk(WIDTH, narrow, LAT, EDGE_M, MAX_K)

    expect(span).toBeLessThanOrEqual(narrow)
    expect(span).toBeGreaterThan(narrow * 0.75)
  })
})

describe('bandHeight', () => {
  test('answers what the panel and the readout leave between them', () => {
    expect(bandHeight(874, 600, 106)).toBe(168)
  })

  test('shrinks with a panel that grows', () => {
    expect(bandHeight(874, 700, 106)).toBeLessThan(bandHeight(874, 600, 106))
  })

  test('grows with the viewport at the same panel height', () => {
    expect(bandHeight(1000, 600, 106)).toBeGreaterThan(bandHeight(874, 600, 106))
  })

  test('answers nothing where the panel reaches the readout', () => {
    expect(bandHeight(874, 800, 106)).toBe(0)
  })
})

describe('gridReads', () => {
  const spacing = cellSpacingM(LAT, EDGE_M)

  test('has the grid on at the opening, where a cell is two dozen points across', () => {
    expect(gridReads(spacing, scaleForDisk(WIDTH, BAND, LAT, EDGE_M, OPEN_K))).toBe(true)
  })

  test('drops the grid once the disk has grown past what a line every cell can carry', () => {
    expect(gridReads(spacing, scaleForDisk(WIDTH, BAND, LAT, EDGE_M, MAX_K))).toBe(false)
  })

  test('crosses at about fifteen rings on the viewport the act is framed for', () => {
    const reads = (rings: number) =>
      gridReads(spacing, scaleForDisk(WIDTH, BAND, LAT, EDGE_M, rings))

    expect(reads(14)).toBe(true)
    expect(reads(15)).toBe(false)
  })
})
