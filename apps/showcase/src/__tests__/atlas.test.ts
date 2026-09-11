import { describe, expect, test } from 'bun:test'
import {
  closeWait,
  coverage,
  LIVE_REBUILD_MS,
  liveRebuildDue,
  MAX_K,
  noteFrame,
  noWait,
  openWait,
  QUIET_MS,
  type ViewExtent,
} from '../engine/atlas'
import { resolutionForZoom } from '../engine/projection'

// the average edge of a resolution, an aperture of seven below the resolution 0 average
const EDGE_M = (res: number) => 1_107_712.591 / 7 ** (res / 2)

/** Waits until a condition holds, so a test on a real timer costs what it takes and no more. */
async function until(holds: () => boolean, within: number): Promise<void> {
  const deadline = performance.now() + within
  while (!holds() && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** Answers a view of `span` degrees either side of a centre, the shape the map reports. */
function viewAround(lat: number, lng: number, span: number): ViewExtent {
  return { bounds: [lng - span, lat - span, lng + span, lat + span], center: [lng, lat] }
}

const RES = 9

describe('coverage', () => {
  test('reaches the corner of the view it is sized from', () => {
    const lat = 52.52
    const span = 0.01
    const view = viewAround(lat, 13.405, span)
    const rings = coverage(view, RES, EDGE_M)
    // the diagonal to the corner, in ground metres, which the disk has to cover
    const latRad = (lat * Math.PI) / 180
    const metres = 6378137 * (Math.PI / 180) * Math.hypot(span, span * Math.cos(latRad))
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

describe('liveRebuildDue', () => {
  const NOW = 10_000
  const BERLIN = [13.405, 52.52] as const
  // the zooms the ladder answers 9 and 10 for, at the latitude the view stands on
  const RES_9_ZOOM = 13
  const RES_10_ZOOM = 14
  const CENTRE = 0x89_1f_1d_48_88_3f_ff_ffn
  const ELSEWHERE = 0x89_1f_1d_48_88_7f_ff_ffn
  const standing = () => CENTRE
  const built = { res: 9, centre: CENTRE, at: NOW }

  test('stands on the resolutions the zooms beside it answer', () => {
    expect(resolutionForZoom(RES_9_ZOOM, BERLIN[1], EDGE_M)).toBe(9)
    expect(resolutionForZoom(RES_10_ZOOM, BERLIN[1], EDGE_M)).toBe(10)
  })

  test('asks for a scene while the map holds none, however young the clock is', () => {
    const due = liveRebuildDue(
      null,
      { center: BERLIN, zoom: RES_9_ZOOM },
      LIVE_REBUILD_MS - 1,
      EDGE_M,
      standing,
    )

    expect(due).toBe(true)
  })

  test('holds a view that has not waited the throttle out', () => {
    const due = liveRebuildDue(
      built,
      { center: BERLIN, zoom: RES_10_ZOOM },
      NOW + LIVE_REBUILD_MS - 1,
      EDGE_M,
      () => ELSEWHERE,
    )

    expect(due).toBe(false)
  })

  test('holds a view that stands on the built cell at the built resolution', () => {
    const due = liveRebuildDue(
      built,
      { center: BERLIN, zoom: RES_9_ZOOM },
      NOW + LIVE_REBUILD_MS,
      EDGE_M,
      standing,
    )

    expect(due).toBe(false)
  })

  test('asks once the view reads a resolution the scene was not walked at', () => {
    const due = liveRebuildDue(
      built,
      { center: BERLIN, zoom: RES_10_ZOOM },
      NOW + LIVE_REBUILD_MS,
      EDGE_M,
      standing,
    )

    expect(due).toBe(true)
  })

  test('asks once the centre stands in another cell of the built resolution', () => {
    const due = liveRebuildDue(
      built,
      { center: BERLIN, zoom: RES_9_ZOOM },
      NOW + LIVE_REBUILD_MS,
      EDGE_M,
      () => ELSEWHERE,
    )

    expect(due).toBe(true)
  })

  test('leaves the cell unasked where the resolution already answers', () => {
    const asked: number[] = []

    liveRebuildDue(
      built,
      { center: BERLIN, zoom: RES_10_ZOOM },
      NOW + LIVE_REBUILD_MS,
      EDGE_M,
      (_lat, _lng, res) => {
        asked.push(res)
        return CENTRE
      },
    )

    expect(asked).toEqual([])
  })

  test('asks for the centre the way H3 takes it, latitude first', () => {
    const asked: [number, number, number][] = []

    liveRebuildDue(
      built,
      { center: BERLIN, zoom: RES_9_ZOOM },
      NOW + LIVE_REBUILD_MS,
      EDGE_M,
      (lat, lng, res) => {
        asked.push([lat, lng, res])
        return CENTRE
      },
    )

    expect(asked).toEqual([[52.52, 13.405, 9]])
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

describe('closeWait', () => {
  test('leaves an open wait with nothing for a later frame to report', () => {
    const wait = noWait()
    let reported: number | null = null
    openWait(wait, 1_000)

    closeWait(wait)
    noteFrame(wait, 9_000, (ms) => {
      reported = ms
    })

    expect(wait.from).toBe(0)
    expect(wait.timer).toBeNull()
    expect(reported).toBeNull()
  })

  test('drops the frames a wait had already counted', () => {
    const wait = noWait()
    openWait(wait, 1_000)
    noteFrame(wait, 1_040, () => {})

    closeWait(wait)

    expect(wait).toEqual({ from: 0, last: 0, timer: null })
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

    await until(() => reported.length > 0, QUIET_MS * 4)

    expect(reported).toHaveLength(1)
    expect(reported[0]).toBeGreaterThan(80)
    expect(wait.from).toBe(0)
    expect(wait.timer).toBeNull()
  })
})
