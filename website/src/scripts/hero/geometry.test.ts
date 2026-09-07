import { describe, expect, test } from 'bun:test'
import {
  axialAt,
  cellClear,
  centerOf,
  coverFit,
  hexPts,
  KO_CLEAR,
  planeOf,
  proj,
  pushOut,
  SIZES,
  screenOf,
  toDesign,
  toStage,
  U0,
  unproj,
  V0,
} from './geometry'
import { SCENES } from './scene'

/** The prototype's Lehmer generator, so every sampled point is reproducible. */
function lcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

const CORNERS = {
  desk: [
    [0, 0, 650, 390],
    [1, 0, 1585, 390],
    [0, 1, 120, 1005],
    [1, 1, 2230, 1005],
    [U0, V0, 1010, 538],
  ],
  mob: [
    [0, 0, -80, 780],
    [1, 0, 1790, 780],
    [0, 1, -1140, 2010],
    [1, 1, 3080, 2010],
    [U0, V0, 640, 1076],
  ],
} as const

describe('proj and unproj', () => {
  test('proj returns the calibration reference points in both modes', () => {
    for (const mode of ['desk', 'mob'] as const) {
      for (const [u, v, x, y] of CORNERS[mode]) {
        const point = proj(SCENES[mode].Hm, u, v)
        expect(Math.abs(point[0] - x)).toBeLessThan(1e-6)
        expect(Math.abs(point[1] - y)).toBeLessThan(1e-6)
      }
    }
  })

  test('unproj inverts proj at the corners and at twenty seeded points', () => {
    for (const mode of ['desk', 'mob'] as const) {
      const rnd = lcg(12345)
      const points: [number, number][] = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]
      for (let i = 0; i < 20; i++) points.push([rnd(), rnd()])
      for (const [u, v] of points) {
        const screen = proj(SCENES[mode].Hm, u, v)
        const back = unproj(SCENES[mode].Hi, screen[0], screen[1])
        expect(Math.abs(back[0] - u)).toBeLessThan(1e-9)
        expect(Math.abs(back[1] - v)).toBeLessThan(1e-9)
      }
    }
  })

  test('planeOf inverts screenOf across the clamped plane box', () => {
    for (const mode of ['desk', 'mob'] as const) {
      const scene = SCENES[mode]
      for (let i = 0; i <= 10; i++) {
        for (let j = 0; j <= 10; j++) {
          const pu = scene.clampU[0] + (scene.clampU[1] - scene.clampU[0]) * (i / 10)
          const pv = scene.clampV[0] + (scene.clampV[1] - scene.clampV[0]) * (j / 10)
          const screen = screenOf(scene.Hm, pu, pv)
          const back = planeOf(scene.Hi, screen[0], screen[1])
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
    const points = hexPts(SCENES.desk.Hm, 0.1, 0.05, s)
    expect(points).toHaveLength(6)
    expect(points[0]).toEqual(screenOf(SCENES.desk.Hm, 0.1 + s, 0.05))
  })
})

describe('coverFit', () => {
  test('a stage wider than the design space fills the width and crops the height', () => {
    const fit = coverFit(1672, 941, 3000, 400)
    expect(fit.scale).toBeCloseTo(3000 / 1672, 12)
    expect(fit.offsetX).toBeCloseTo(0, 12)
    expect(fit.vis.left).toBeCloseTo(0, 12)
    expect(fit.vis.right).toBeCloseTo(1672, 12)
    expect((fit.vis.top + fit.vis.bottom) / 2).toBeCloseTo(941 / 2, 12)
  })

  test('a stage narrower than the design space fills the height and crops the width', () => {
    const fit = coverFit(1672, 941, 430, 932)
    expect(fit.scale).toBeCloseTo(932 / 941, 12)
    expect(fit.offsetY).toBeCloseTo(0, 12)
    expect(fit.vis.top).toBeCloseTo(0, 12)
    expect(fit.vis.bottom).toBeCloseTo(941, 12)
    expect((fit.vis.left + fit.vis.right) / 2).toBeCloseTo(1672 / 2, 12)
  })

  test('toDesign and toStage are inverses', () => {
    const fit = coverFit(1672, 941, 1440, 900)
    const design = toDesign(fit, 512, 333)
    const stage = toStage(fit, design[0], design[1])
    expect(Math.abs(stage[0] - 512)).toBeLessThan(1e-9)
    expect(Math.abs(stage[1] - 333)).toBeLessThan(1e-9)
  })
})

describe('pushOut', () => {
  const scene = SCENES.desk
  const fit = coverFit(scene.W, scene.H, scene.W, scene.H)
  const s = SIZES[12]

  test('returns its input when no keep-out is set', () => {
    const context = { Hm: scene.Hm, s, ko: null, vis: fit.vis }
    expect(pushOut(context, 2, -3, 0, 0)).toEqual([2, -3])
  })

  test('leaves the keep-out box behind, feather included', () => {
    const ko = { left: 800, top: 500, right: 1300, bottom: 800 }
    const context = { Hm: scene.Hm, s, ko, vis: fit.vis }
    const plane = planeOf(scene.Hi, 1050, 650)
    const startCell = axialAt(plane[0], plane[1], s)
    const moved = pushOut(context, startCell[0], startCell[1], 1050, 650)
    expect(cellClear(context, moved[0], moved[1])).toBeGreaterThanOrEqual(0)
    const centre = centerOf(moved[0], moved[1], s)
    for (const point of hexPts(scene.Hm, centre[0], centre[1], s)) {
      const insideX = point[0] > ko.left - KO_CLEAR && point[0] < ko.right + KO_CLEAR
      const insideY = point[1] > ko.top - KO_CLEAR && point[1] < ko.bottom + KO_CLEAR
      expect(insideX && insideY).toBe(false)
    }
  })
})
