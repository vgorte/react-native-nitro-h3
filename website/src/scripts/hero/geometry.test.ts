import { describe, expect, test } from 'bun:test'
import {
  axialAt,
  cellClear,
  centerOf,
  hexPts,
  homographyFrom,
  KO_CLEAR,
  type Matrix3,
  matInv,
  matMul,
  planeOf,
  proj,
  pushOut,
  SIZES,
  screenOf,
  unproj,
} from './geometry'
import { calibrate, QUAD, SCENES } from './scene'

/** The prototype's Lehmer generator, so every sampled point is reproducible. */
function lcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

const desk = calibrate(SCENES.desk, 1440, 810)
const mob = calibrate(SCENES.mob, 430, 800)
const BOXES = [desk, mob] as const

describe('the homography', () => {
  test('maps the unit square onto the four reference points', () => {
    const m = homographyFrom(QUAD)
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const
    for (const [i, corner] of corners.entries()) {
      const point = proj(m, corner[0], corner[1])
      const want = QUAD[i]
      if (!want) throw new Error('the reference quad has four points')
      expect(Math.abs(point[0] - want[0])).toBeLessThan(1e-6)
      expect(Math.abs(point[1] - want[1])).toBeLessThan(1e-6)
    }
  })

  test('matMul of a calibrated matrix with its inverse is the identity', () => {
    const identity: Matrix3 = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    for (const scene of BOXES) {
      const product = matMul(scene.Hm, matInv(scene.Hm))
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const row = product[i]
          const want = identity[i]
          if (!row || !want) throw new Error('a 3x3 matrix has three rows')
          expect(Math.abs((row[j] ?? 0) - (want[j] ?? 0))).toBeLessThan(1e-12)
        }
      }
    }
  })

  test('unproj inverts proj over the unit square and twenty seeded points', () => {
    for (const scene of BOXES) {
      const rnd = lcg(12345)
      const points: [number, number][] = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]
      for (let i = 0; i < 20; i++) points.push([rnd(), rnd()])
      for (const [u, v] of points) {
        const screen = proj(scene.Hm, u, v)
        const back = unproj(scene.Hi, screen[0], screen[1])
        expect(Math.abs(back[0] - u)).toBeLessThan(1e-9)
        expect(Math.abs(back[1] - v)).toBeLessThan(1e-9)
      }
    }
  })
})

describe('calibrate', () => {
  test('the box independent values hold in both modes', () => {
    for (const scene of BOXES) {
      expect(scene.VS).toBeCloseTo(0.5274, 3)
      expect(scene.PVMIN).toBeCloseTo(-0.7337, 3)
      expect(scene.PVMAX).toBeCloseTo(1.0581, 3)
      expect(scene.PV_MIN2).toBeCloseTo(-1.9283, 3)
      expect(scene.PV_MAX2).toBeCloseTo(1.1434, 3)
      expect(scene.clampV[0]).toBeCloseTo(-0.7375, 3)
      expect(scene.clampV[1]).toBeCloseTo(0.9803, 3)
    }
  })

  test('desk at 1440 x 810 derives the spec table', () => {
    expect(desk.PU_MIN).toBeCloseTo(-2.2617, 3)
    expect(desk.PU_MAX).toBeCloseTo(2.3447, 3)
    expect(desk.clampU[0]).toBeCloseTo(-1.0917, 3)
    expect(desk.clampU[1]).toBeCloseTo(1.1751, 3)
    expect(desk.horizonY).toBeCloseTo(157.5463, 3)
    expect(desk.fy0).toBeCloseTo(199.1784, 3)
    expect(desk.fy1).toBeCloseTo(349.7332, 3)
  })

  test('mob at 430 x 800 derives the spec table', () => {
    expect(mob.PU_MIN).toBeCloseTo(-0.6858, 3)
    expect(mob.PU_MAX).toBeCloseTo(0.7687, 3)
    expect(mob.clampU[0]).toBeCloseTo(-0.287, 3)
    expect(mob.clampU[1]).toBeCloseTo(0.3704, 3)
    expect(mob.horizonY).toBeCloseTo(155.6013, 3)
    expect(mob.fy0).toBeCloseTo(196.7194, 3)
    expect(mob.fy1).toBeCloseTo(345.4155, 3)
  })

  test('the lateral rail clamps neither box', () => {
    for (const scene of BOXES) {
      expect(scene.PU_MIN).toBeGreaterThan(-3.2)
      expect(scene.PU_MAX).toBeLessThan(3.2)
    }
  })
})

describe('the plane mapping', () => {
  test('planeOf inverts screenOf across the clamped plane box', () => {
    for (const scene of BOXES) {
      for (let i = 0; i <= 10; i++) {
        for (let j = 0; j <= 10; j++) {
          const pu = scene.clampU[0] + (scene.clampU[1] - scene.clampU[0]) * (i / 10)
          const pv = scene.clampV[0] + (scene.clampV[1] - scene.clampV[0]) * (j / 10)
          const screen = screenOf(scene, pu, pv)
          const back = planeOf(scene, screen[0], screen[1])
          expect(Math.abs(back[0] - pu)).toBeLessThan(1e-9)
          expect(Math.abs(back[1] - pv)).toBeLessThan(1e-9)
        }
      }
    }
  })
})

describe('the axial lattice', () => {
  test('axialAt inverts centerOf at every size', () => {
    for (const s of [SIZES[6], SIZES[9], SIZES[12]]) {
      for (let q = -6; q <= 6; q++) {
        for (let r = -6; r <= 6; r++) {
          const centre = centerOf(q, r, s)
          expect(axialAt(centre[0], centre[1], s)).toEqual([q, r])
        }
      }
    }
  })

  test('hexPts returns six points and starts at the vertex on the plane u axis', () => {
    const s = SIZES[12]
    const points = hexPts(desk, 0.1, 0.05, s)
    expect(points).toHaveLength(6)
    expect(points[0]).toEqual(screenOf(desk, 0.1 + s, 0.05))
  })
})

describe('pushOut', () => {
  const s = SIZES[12]

  test('returns its input when no keep-out is set', () => {
    const context = { plane: desk, s, ko: null, W: desk.W, H: desk.H }
    expect(pushOut(context, 2, -3, 0, 0)).toEqual([2, -3])
  })

  test('leaves the keep-out box behind, feather included', () => {
    const ko = { left: 620, top: 330, right: 900, bottom: 500 }
    const context = { plane: desk, s, ko, W: desk.W, H: desk.H }
    const plane = planeOf(desk, 760, 415)
    const startCell = axialAt(plane[0], plane[1], s)
    const moved = pushOut(context, startCell[0], startCell[1], 760, 415)
    expect(cellClear(context, moved[0], moved[1])).toBeGreaterThanOrEqual(0)
    const centre = centerOf(moved[0], moved[1], s)
    for (const point of hexPts(desk, centre[0], centre[1], s)) {
      const insideX = point[0] > ko.left - KO_CLEAR && point[0] < ko.right + KO_CLEAR
      const insideY = point[1] > ko.top - KO_CLEAR && point[1] < ko.bottom + KO_CLEAR
      expect(insideX && insideY).toBe(false)
    }
  })
})
