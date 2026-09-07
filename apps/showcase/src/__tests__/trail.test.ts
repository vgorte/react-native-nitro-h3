import { describe, expect, test } from 'bun:test'
import { metresPerPixel } from '../engine/projection'
import {
  AGE_SPAN,
  bucketOfAge,
  bucketsOfTrail,
  CAMERA_STEP_LEAD,
  CAMERA_STEP_MS,
  capFixes,
  capTrail,
  cellsOfTrail,
  extendTrail,
  FIX_HISTORY,
  fadeSpan,
  filledCells,
  fixAhead,
  fixesDue,
  isZoomCut,
  MAX_TRAIL_RES,
  MIN_CELLS_ACROSS,
  MIN_TRAIL_RES,
  pathOrJump,
  RECORDED_PACE,
  REPLAY_TICK_MS,
  routeTimeAt,
  TIME_LAPSE_CELLS_ACROSS,
  TIME_LAPSE_FADE_SPAN,
  TIME_LAPSE_PACE,
  TRAIL_CELLS_ACROSS,
  TRAIL_RES,
  type TrailFix,
  type TrailStep,
  timeLapseCellsAcross,
  ZOOM_CUT_LEVELS,
  zoomForResolution,
  zoomForTrail,
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

  test('moves a cell the ride comes back to, rather than holding it twice', () => {
    const walked = [
      { cell: 5n, filled: false },
      { cell: 6n, filled: false },
      { cell: 7n, filled: false },
    ]
    const trail = extendTrail(walked, 6n, neighbours, path)

    expect(trail.map((step) => step.cell)).toEqual([5n, 7n, 6n])
  })

  test('holds every standing cell once, so the count is what is drawn', () => {
    let trail = extendTrail([], 5n, neighbours, path)
    for (const cell of [6n, 7n, 6n, 5n, 6n, 7n]) {
      trail = extendTrail(trail, cell, neighbours, path)
    }

    expect(trail).toHaveLength(new Set(trail.map((step) => step.cell)).size)
    expect(trail.map((step) => step.cell)).toEqual([5n, 6n, 7n])
  })

  test('moves the cells a grid path crosses again as well', () => {
    const walked = [
      { cell: 5n, filled: false },
      { cell: 22n, filled: true },
      { cell: 20n, filled: false },
    ]
    const trail = extendTrail(walked, 23n, neighbours, path)

    expect(trail.map((step) => step.cell)).toEqual([5n, 20n, 21n, 22n, 23n])
    expect(trail).toHaveLength(new Set(trail.map((step) => step.cell)).size)
  })

  test('keeps a cell a fix landed in measured when a grid path crosses it again', () => {
    const walked = [
      { cell: 6n, filled: false },
      { cell: 5n, filled: false },
    ]
    const trail = extendTrail(walked, 8n, neighbours, path)

    expect(trail.map((step) => step.cell)).toEqual([5n, 6n, 7n, 8n])
    // cell 6 was walked into before the path filled it in, and the trail says so
    expect(trail.map((step) => step.filled)).toEqual([false, false, true, false])
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

  test('gives a cell older than the span the darkest step as well, which a lapse relies on', () => {
    expect(bucketOfAge(8, false, BUCKETS, 7)).toBe(0)
    expect(bucketOfAge(AGE_SPAN, false, BUCKETS, TIME_LAPSE_FADE_SPAN)).toBe(0)
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

  test('follows the order a revisited cell was moved into', () => {
    let trail = extendTrail([], 5n, neighbours, path)
    for (const cell of [6n, 7n, 6n]) trail = extendTrail(trail, cell, neighbours, path)
    const buckets = bucketsOfTrail(trail, BUCKETS)

    // cell 6 is the head now, so it takes the brightest step and cell 7 the one before it
    expect(trail.map((step) => step.cell)).toEqual([5n, 7n, 6n])
    expect(buckets[2]).toBe(BUCKETS - 1)
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

/** Answers a route of `count` fixes a second apart, which is the cadence the route was recorded at. */
const ridden = (count: number): TrailFix[] =>
  Array.from({ length: count }, (_, index) => ({ lat: 0, lng: 0, t: index * 1_000 }))

describe('routeTimeAt', () => {
  test('stands where it was read when no time has passed', () => {
    expect(routeTimeAt({ at: 1_000, t: 4_000 }, 1_000, TIME_LAPSE_PACE)).toBe(4_000)
  })

  test('runs with the wall clock at the recorded pace', () => {
    expect(routeTimeAt({ at: 1_000, t: 4_000 }, 3_500, RECORDED_PACE)).toBe(6_500)
  })

  test('runs the pace faster in a time lapse', () => {
    expect(routeTimeAt({ at: 0, t: 0 }, 1_000, TIME_LAPSE_PACE)).toBe(60_000)
  })

  test('never runs backwards on a clock that stepped back', () => {
    expect(routeTimeAt({ at: 5_000, t: 4_000 }, 1_000, TIME_LAPSE_PACE)).toBe(4_000)
  })

  test('holds the whole route to the wall clock the pace asks for', () => {
    const route = ridden(2_536)
    const span = route[route.length - 1].t

    // the replay is done once the clock has run the recording's own length over the pace
    expect(routeTimeAt({ at: 0, t: 0 }, span / TIME_LAPSE_PACE, TIME_LAPSE_PACE)).toBeCloseTo(
      span,
      6,
    )
  })
})

describe('fixesDue', () => {
  test('answers the fixes whose time has come, and no more', () => {
    const route = ridden(10)

    expect(fixesDue(route, 0, 0)).toBe(1)
    expect(fixesDue(route, 0, 2_500)).toBe(3)
    expect(fixesDue(route, 3, 5_000)).toBe(3)
  })

  test('answers nothing before the next fix is due', () => {
    expect(fixesDue(ridden(10), 4, 3_999)).toBe(0)
  })

  test('answers nothing past the end of the route', () => {
    expect(fixesDue(ridden(2), 2, 600_000)).toBe(0)
  })

  test('hands over the whole tick in one batch during a time lapse', () => {
    const route = ridden(100)
    // 100 ms of wall clock at sixty times the pace is six seconds of the ride
    const routeMs = routeTimeAt({ at: 0, t: 0 }, REPLAY_TICK_MS, TIME_LAPSE_PACE)

    expect(fixesDue(route, 0, routeMs)).toBe(7)
  })

  test('catches up rather than falling behind when a tick came late', () => {
    const route = ridden(100)
    const onTime = fixesDue(route, 0, routeTimeAt({ at: 0, t: 0 }, 100, TIME_LAPSE_PACE))
    const late = fixesDue(route, 0, routeTimeAt({ at: 0, t: 0 }, 300, TIME_LAPSE_PACE))

    expect(late).toBeGreaterThan(onTime)
  })

  test('walks a route the way the act does, fix for fix', () => {
    const route = ridden(50)
    let index = 0
    for (let step = 0; index < route.length; step++) {
      index += fixesDue(route, index, routeTimeAt({ at: 0, t: 0 }, step * 100, TIME_LAPSE_PACE))
    }

    expect(index).toBe(route.length)
  })
})

describe('timeLapseCellsAcross', () => {
  test('never frames less than the stretch the act opens on', () => {
    expect(timeLapseCellsAcross(0)).toBe(TRAIL_CELLS_ACROSS)
    expect(timeLapseCellsAcross(9)).toBe(TRAIL_CELLS_ACROSS)
  })

  test('never frames more than the time lapse asks for', () => {
    expect(timeLapseCellsAcross(600)).toBe(TIME_LAPSE_CELLS_ACROSS)
    expect(timeLapseCellsAcross(10_000)).toBe(TIME_LAPSE_CELLS_ACROSS)
  })

  test('follows the trail between the two, in steps', () => {
    expect(timeLapseCellsAcross(30)).toBe(30)
    expect(timeLapseCellsAcross(39)).toBe(30)
    expect(timeLapseCellsAcross(40)).toBe(40)
  })

  test('never widens as the trail grows shorter', () => {
    let last = 0
    for (let standing = 0; standing <= 700; standing += 7) {
      const across = timeLapseCellsAcross(standing)
      expect(across).toBeGreaterThanOrEqual(last)
      last = across
    }
  })
})

describe('fixAhead', () => {
  test('stands still at the recorded pace, where a step is shorter than a fix', () => {
    const route = ridden(10)

    expect(fixAhead(route, 3, RECORDED_PACE, CAMERA_STEP_MS)).toBe(route[3])
  })

  test('leads the head by the route time a step covers in a time lapse', () => {
    const route = ridden(100)

    // half a second at sixty times the pace is thirty seconds of the ride, so thirty fixes on
    expect(fixAhead(route, 10, TIME_LAPSE_PACE, CAMERA_STEP_MS)).toBe(route[40])
  })

  test('stops on the last fix rather than running off the route', () => {
    const route = ridden(20)

    expect(fixAhead(route, 10, TIME_LAPSE_PACE, CAMERA_STEP_MS)).toBe(route[19])
  })

  test('answers nothing where the head stands past the end', () => {
    expect(fixAhead(ridden(3), 3, TIME_LAPSE_PACE, CAMERA_STEP_MS)).toBeUndefined()
  })

  test('leads far enough that a step is issued before the one before it lands', () => {
    const route = ridden(200)
    const first = fixAhead(route, 0, TIME_LAPSE_PACE, CAMERA_STEP_MS)
    // the next step goes out after the lead share of the one standing, from the head of that moment
    const reissued = Math.round((CAMERA_STEP_MS * CAMERA_STEP_LEAD * TIME_LAPSE_PACE) / 1_000)
    const second = fixAhead(route, reissued, TIME_LAPSE_PACE, CAMERA_STEP_MS)

    expect(CAMERA_STEP_LEAD).toBeLessThan(1)
    expect(second?.t).toBeGreaterThan(first?.t ?? 0)
  })
})

describe('zoomForTrail', () => {
  test('fits the asked-for cells across the narrow side, less the margin', () => {
    const across = 20 * Math.sqrt(3) * EDGE_M(TRAIL_RES)
    const zoom = zoomForTrail(WIDTH, HEIGHT, LAT, EDGE_M, TRAIL_RES, 20)

    expect(metresPerPixel(zoom, LAT) * WIDTH * 0.9).toBeCloseTo(across, 6)
  })

  test('answers a finer resolution a higher zoom, cell for cell', () => {
    const coarse = zoomForTrail(WIDTH, HEIGHT, LAT, EDGE_M, MIN_TRAIL_RES)
    const fine = zoomForTrail(WIDTH, HEIGHT, LAT, EDGE_M, MAX_TRAIL_RES)

    expect(fine).toBeGreaterThan(coarse)
    // a resolution is an aperture of seven, which is half a step of zoom either way
    expect(fine - coarse).toBeCloseTo(((MAX_TRAIL_RES - MIN_TRAIL_RES) * Math.log2(7)) / 2, 6)
  })

  test('fits the narrow side, so a viewport turned on its side frames the same stretch', () => {
    expect(zoomForTrail(HEIGHT, WIDTH, LAT, EDGE_M, TRAIL_RES)).toBe(
      zoomForTrail(WIDTH, HEIGHT, LAT, EDGE_M, TRAIL_RES),
    )
  })

  test('opens on the stretch the act frames when no cells are asked for', () => {
    expect(zoomForTrail(WIDTH, HEIGHT, LAT, EDGE_M, TRAIL_RES)).toBe(
      zoomForTrail(WIDTH, HEIGHT, LAT, EDGE_M, TRAIL_RES, TRAIL_CELLS_ACROSS),
    )
  })

  test('pulls back for the time lapse, by the ratio of the two stretches', () => {
    const opened = zoomForTrail(WIDTH, HEIGHT, LAT, EDGE_M, MAX_TRAIL_RES, TRAIL_CELLS_ACROSS)
    const lapsed = zoomForTrail(WIDTH, HEIGHT, LAT, EDGE_M, MAX_TRAIL_RES, TIME_LAPSE_CELLS_ACROSS)

    expect(lapsed).toBeLessThan(opened)
    expect(opened - lapsed).toBeCloseTo(Math.log2(TIME_LAPSE_CELLS_ACROSS / TRAIL_CELLS_ACROSS), 6)
  })
})

describe('zoomForResolution', () => {
  /** Answers the zoom at which `cells` cells of a resolution span the narrow side. */
  const zoomFitting = (cells: number, res: number) =>
    zoomForTrail(WIDTH, HEIGHT, LAT, EDGE_M, res, cells)

  test('keeps the view where the new cells still read on it', () => {
    const standing = zoomFitting(TRAIL_CELLS_ACROSS, TRAIL_RES)

    expect(zoomForResolution(standing, WIDTH, HEIGHT, LAT, EDGE_M, TRAIL_RES)).toBeNull()
  })

  test('never zooms in, however much finer the new resolution is', () => {
    const standing = zoomFitting(TRAIL_CELLS_ACROSS, MIN_TRAIL_RES)

    for (let res = MIN_TRAIL_RES; res <= MAX_TRAIL_RES; res++) {
      expect(zoomForResolution(standing, WIDTH, HEIGHT, LAT, EDGE_M, res)).toBeNull()
    }
  })

  test('re-fits where fewer than the least cells would span the view', () => {
    const standing = zoomFitting(TRAIL_CELLS_ACROSS, MAX_TRAIL_RES)
    const next = zoomForResolution(standing, WIDTH, HEIGHT, LAT, EDGE_M, MIN_TRAIL_RES)

    expect(next).not.toBeNull()
    expect(next).toBe(zoomFitting(TRAIL_CELLS_ACROSS, MIN_TRAIL_RES))
    expect(next as number).toBeLessThan(standing)
  })

  test('holds the view just above the least cells, and gives it up just below them', () => {
    // the threshold counts the stretch `zoomForTrail` fits cells into, margin and all, so the two
    // agree cell for cell; the edge itself is a float and is approached from either side
    const over = zoomFitting(MIN_CELLS_ACROSS + 0.01, TRAIL_RES)
    const under = zoomFitting(MIN_CELLS_ACROSS - 0.01, TRAIL_RES)

    expect(zoomForResolution(over, WIDTH, HEIGHT, LAT, EDGE_M, TRAIL_RES)).toBeNull()
    expect(zoomForResolution(under, WIDTH, HEIGHT, LAT, EDGE_M, TRAIL_RES)).not.toBeNull()
    // and a stretch that fits five cells is comfortably above it, a stretch that fits three below
    expect(
      zoomForResolution(
        zoomFitting(MIN_CELLS_ACROSS + 1, TRAIL_RES),
        WIDTH,
        HEIGHT,
        LAT,
        EDGE_M,
        TRAIL_RES,
      ),
    ).toBeNull()
    expect(
      zoomForResolution(
        zoomFitting(MIN_CELLS_ACROSS - 1, TRAIL_RES),
        WIDTH,
        HEIGHT,
        LAT,
        EDGE_M,
        TRAIL_RES,
      ),
    ).not.toBeNull()
  })
})

describe('fadeSpan', () => {
  test('spreads the fade over the standing trail at the recorded pace', () => {
    expect(fadeSpan(8, false)).toBe(7)
    expect(fadeSpan(AGE_SPAN, false)).toBe(AGE_SPAN - 1)
  })

  test('caps the fade at what a time lapse frames', () => {
    expect(fadeSpan(AGE_SPAN, true)).toBe(TIME_LAPSE_FADE_SPAN)
  })

  test('spreads a trail shorter than the cap over itself, whatever the pace', () => {
    expect(fadeSpan(8, true)).toBe(7)
  })

  test('holds at zero for a trail of one cell or none', () => {
    expect(fadeSpan(1, true)).toBe(0)
    expect(fadeSpan(0, false)).toBe(0)
  })

  test('darkens the cells outside the framed span in a lapse', () => {
    const trail = measured(AGE_SPAN)
    const buckets = bucketsOfTrail(trail, BUCKETS, fadeSpan(trail.length, true))

    // the head is brightest, the oldest cell the frame holds is darkest, and everything before it
    expect(buckets[AGE_SPAN - 1]).toBe(BUCKETS - 1)
    expect(buckets[AGE_SPAN - 1 - TIME_LAPSE_FADE_SPAN]).toBe(0)
    expect(buckets[0]).toBe(0)
    expect(new Set(buckets).size).toBe(BUCKETS)
  })
})

describe('isZoomCut', () => {
  test('takes a re-frame the map has no standing view for as a cut', () => {
    expect(isZoomCut(9, null)).toBe(true)
  })

  test('glides over a re-frame inside the levels a stop may travel', () => {
    expect(isZoomCut(12, 12)).toBe(false)
    expect(isZoomCut(12 - ZOOM_CUT_LEVELS, 12)).toBe(false)
    expect(isZoomCut(12 + ZOOM_CUT_LEVELS, 12)).toBe(false)
  })

  test('cuts a re-frame that travels further than that, either way', () => {
    expect(isZoomCut(12 - ZOOM_CUT_LEVELS - 0.01, 12)).toBe(true)
    expect(isZoomCut(12 + ZOOM_CUT_LEVELS + 0.01, 12)).toBe(true)
  })

  test('cuts the ladder end to end, which is what it is there for', () => {
    const coarse = zoomForTrail(WIDTH, HEIGHT, LAT, EDGE_M, MIN_TRAIL_RES)
    const fine = zoomForTrail(WIDTH, HEIGHT, LAT, EDGE_M, MAX_TRAIL_RES)

    expect(isZoomCut(coarse, fine)).toBe(true)
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
