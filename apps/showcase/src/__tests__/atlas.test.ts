import { describe, expect, test } from 'bun:test'
import {
  coverage,
  MAX_K,
  noteFrame,
  noWait,
  openWait,
  QUIET_MS,
  type ViewExtent,
} from '../engine/atlas'

// the average edge of a resolution, an aperture of seven below the resolution 0 average
const EDGE_M = (res: number) => 1_107_712.591 / 7 ** (res / 2)

/** Answers a view of `span` degrees either side of a centre, the shape the map reports. */
function viewAround(lat: number, lng: number, span: number): ViewExtent {
  return { bounds: [lng - span, lat - span, lng + span, lat + span], center: [lng, lat] }
}

const RES = 9

describe('coverage', () => {
  test('reaches the corner of the view it is sized from', () => {
    const view = viewAround(52.52, 13.405, 0.01)
    const rings = coverage(view, RES, EDGE_M)
    // the diagonal to the corner, in ground metres, which the disk has to cover
    const metres = 6378137 * (Math.PI / 180) * Math.hypot(0.01, 0.01 * Math.cos(0.9167))
    const apothem = rings * Math.sqrt(3) * EDGE_M(RES) * (Math.sqrt(3) / 2)

    expect(apothem).toBeGreaterThan(metres)
  })

  test('grows with the view and never shrinks as it widens', () => {
    let held = 0
    for (const span of [0.005, 0.01, 0.05, 0.2, 1]) {
      const rings = coverage(viewAround(52.52, 13.405, span), RES, EDGE_M)

      expect(rings).toBeGreaterThanOrEqual(held)
      held = rings
    }
  })

  test('asks for at least the centre ring on a view of nothing', () => {
    expect(coverage(viewAround(52.52, 13.405, 0), RES, EDGE_M)).toBe(1)
  })

  test('stops at the ring count the cap allows, whatever the view asks for', () => {
    expect(coverage(viewAround(0, 0, 90), RES, EDGE_M)).toBe(MAX_K)
  })

  test('holds a disk of MAX_K rings under twenty thousand cells', () => {
    expect(3 * MAX_K * (MAX_K + 1) + 1).toBeLessThanOrEqual(20_000)
    expect(3 * (MAX_K + 1) * (MAX_K + 2) + 1).toBeGreaterThan(20_000)
  })

  test('reads a view across the antimeridian as one view rather than the whole world', () => {
    const across: ViewExtent = { bounds: [179.99, 52.51, -179.99, 52.53], center: [-180, 52.52] }
    const beside = viewAround(52.52, 0, 0.01)

    expect(coverage(across, RES, EDGE_M)).toBe(coverage(beside, RES, EDGE_M))
  })
})

describe('openWait', () => {
  test('opens on the moment it was handed and holds nothing yet', () => {
    const wait = noWait()

    openWait(wait, 1_000)

    expect(wait).toEqual({ from: 1_000, last: 0, timer: null })
  })

  test('drops what an unfinished wait had collected', () => {
    const wait = noWait()
    openWait(wait, 1_000)
    noteFrame(wait, 1_040, () => {})

    openWait(wait, 2_000)

    expect(wait.last).toBe(0)
    expect(wait.timer).toBeNull()
  })
})

describe('noteFrame', () => {
  test('ignores a frame while no wait is open', () => {
    const wait = noWait()
    let reported: number | null = null

    noteFrame(wait, 1_040, (ms) => {
      reported = ms
    })

    expect(wait.timer).toBeNull()
    expect(reported).toBeNull()
  })

  test('reports the last frame once the map has been quiet, and closes the wait', async () => {
    const wait = noWait()
    const reported: number[] = []
    openWait(wait, performance.now())
    noteFrame(wait, performance.now() + 40, (ms) => reported.push(ms))
    noteFrame(wait, performance.now() + 90, (ms) => reported.push(ms))

    await new Promise((resolve) => setTimeout(resolve, QUIET_MS * 2))

    expect(reported).toHaveLength(1)
    expect(reported[0]).toBeGreaterThan(80)
    expect(wait.from).toBe(0)
    expect(wait.timer).toBeNull()
  })
})
