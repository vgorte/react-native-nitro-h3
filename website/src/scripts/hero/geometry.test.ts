import { describe, expect, test } from 'bun:test'
import {
  axialAt,
  cellClear,
  cellUnderPoint,
  centerOf,
  copyColumn,
  escapeKeepOut,
  hexPts,
  homographyFrom,
  inCopyColumn,
  KO_CLEAR,
  KO_PAD,
  type Matrix3,
  matInv,
  matMul,
  type Point,
  planeOf,
  proj,
  pushOut,
  SIZES,
  screenOf,
  slideRight,
  unproj,
} from './geometry'
import { calibrate, QUAD, SCENES } from './scene'

/** A Lehmer generator, so every sampled point is reproducible. */
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

  test('the direction table matches the trigonometry it replaced', () => {
    // The per-call trigonometry the table stands in for.
    const trig = (plane: typeof desk, cu: number, cv: number, s: number): Point[] =>
      [0, 1, 2, 3, 4, 5].map((k) => {
        const a = (Math.PI / 180) * (60 * k)
        return screenOf(plane, cu + s * Math.cos(a), cv + s * Math.sin(a))
      })
    for (const scene of BOXES) {
      const rnd = lcg(99)
      for (let i = 0; i < 50; i++) {
        const cu = scene.clampU[0] + rnd() * (scene.clampU[1] - scene.clampU[0])
        const cv = scene.clampV[0] + rnd() * (scene.clampV[1] - scene.clampV[0])
        const s = SIZES[12] * (0.5 + rnd())
        const table = hexPts(scene, cu, cv, s)
        const want = trig(scene, cu, cv, s)
        for (const [k, point] of table.entries()) {
          expect(Math.abs(point[0] - (want[k]?.[0] ?? 0))).toBeLessThan(1e-9)
          expect(Math.abs(point[1] - (want[k]?.[1] ?? 0))).toBeLessThan(1e-9)
        }
      }
    }
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

describe('the copy column', () => {
  // The copy block measured on the real page at 1440 x 900, in canvas units.
  const page = calibrate(SCENES.desk, 1440, 900)
  const copy = { left: 77.6, top: 280.3, right: 477.3, bottom: 589.4 }
  const column = copyColumn(copy)
  const s = SIZES[12]
  const context = { plane: page, s, ko: column, W: page.W, H: page.H }

  const resolveCell = (px: number, py: number): { cell: Point; escaped: Point } => {
    const escaped = escapeKeepOut(column, px, py)
    const y = Math.max(escaped[1], page.horizonY)
    const plane = planeOf(page, escaped[0], y)
    const pu = Math.min(Math.max(plane[0], page.clampU[0]), page.clampU[1])
    const pv = Math.min(Math.max(plane[1], page.clampV[0]), page.clampV[1])
    const axial = axialAt(pu, pv, s)
    return { cell: slideRight(context, axial[0], axial[1]), escaped }
  }

  test('the column runs off the left edge and stops at the block plus the pad', () => {
    expect(column.left).toBe(-120)
    expect(column.top).toBeCloseTo(copy.top - KO_PAD, 9)
    expect(column.right).toBeCloseTo(copy.right + KO_PAD, 9)
    expect(column.bottom).toBeCloseTo(copy.bottom + KO_PAD, 9)
  })

  test('a point beside the copy block moves right on its own row', () => {
    for (const fy of [0.35, 0.55]) {
      for (const fx of [0.05, 0.15, 0.25]) {
        const { escaped } = resolveCell(fx * 1440, fy * 900)
        expect(escaped[1]).toBeCloseTo(fy * 900, 9)
        expect(escaped[0]).toBeGreaterThan(copy.right + KO_PAD)
      }
    }
  })

  test('a point below the copy block is returned unchanged', () => {
    for (const fx of [0.05, 0.15, 0.25]) {
      const px = fx * 1440
      const { escaped } = resolveCell(px, 0.85 * 900)
      expect(escaped[0]).toBeCloseTo(px, 9)
      expect(escaped[1]).toBeCloseTo(0.85 * 900, 9)
    }
  })

  test('none of the nine pointer points resolves into the column', () => {
    for (const fy of [0.35, 0.55, 0.85]) {
      for (const fx of [0.05, 0.15, 0.25]) {
        const { cell } = resolveCell(fx * 1440, fy * 900)
        const centre = centerOf(cell[0], cell[1], s)
        const screen = screenOf(page, centre[0], centre[1])
        expect(inCopyColumn(column, screen[0], screen[1])).toBe(false)
        expect(cellClear(context, cell[0], cell[1])).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('cellUnderPoint', () => {
  // The same page and copy block the column tests above are measured on.
  const page = calibrate(SCENES.desk, 1440, 900)
  const copy = { left: 77.6, top: 280.3, right: 477.3, bottom: 589.4 }
  const column = copyColumn(copy)
  const s = SIZES[12]
  const context = { plane: page, s, ko: column, W: page.W, H: page.H }

  const cellAt = (px: number, py: number): Point => {
    const plane = planeOf(page, px, py)
    return axialAt(plane[0], plane[1], s)
  }

  test('a point over a plain cell returns that cell', () => {
    for (const point of [
      [900, 700],
      [1100, 620],
      [700, 500],
    ] as const) {
      const cell = cellUnderPoint(page, context, point[0], point[1])
      expect(cell).toEqual(cellAt(point[0], point[1]))
    }
  })

  test('a point whose cell the column cuts returns null', () => {
    const px = copy.right - 30
    const py = column.bottom + 6
    const cut = cellAt(px, py)
    expect(cellClear(context, cut[0], cut[1])).toBe(-1)
    expect(cellUnderPoint(page, context, px, py)).toBeNull()
  })

  test('a point past a build limit returns null', () => {
    for (const py of [page.horizonY - 40, page.horizonY, page.fy0]) {
      expect(cellUnderPoint(page, context, 900, py)).toBeNull()
    }
    for (const pu of [page.clampU[0] - 0.05, page.clampU[1] + 0.05]) {
      const point = screenOf(page, pu, 0.2)
      expect(cellUnderPoint(page, context, point[0], point[1])).toBeNull()
    }
  })

  test('a point inside the column returns null', () => {
    for (const fy of [0.35, 0.55]) {
      for (const fx of [0.05, 0.15, 0.25]) {
        expect(cellUnderPoint(page, context, fx * 1440, fy * 900)).toBeNull()
      }
    }
  })

  test('a point just below the copy block never returns a cell right of it', () => {
    // The measured case: the row under the block used to hand back a cell 243 px to the right.
    expect(cellUnderPoint(page, context, 323, column.bottom + 2)).toBeNull()
    let returned = 0
    for (let px = 100; px <= copy.right - 40; px += 10) {
      for (const dy of [2, 30, 50, 70, 90]) {
        const cell = cellUnderPoint(page, context, px, column.bottom + dy)
        if (!cell) continue
        returned += 1
        expect(cell).toEqual(cellAt(px, column.bottom + dy))
        const centre = centerOf(cell[0], cell[1], s)
        expect(screenOf(page, centre[0], centre[1])[0]).toBeLessThan(copy.right)
      }
    }
    expect(returned).toBeGreaterThan(0)
  })

  test('no sampled point returns a cell other than the one it falls in', () => {
    for (let px = 20; px < 1440; px += 37) {
      for (let py = 200; py < 900; py += 29) {
        const cell = cellUnderPoint(page, context, px, py)
        if (cell) expect(cell).toEqual(cellAt(px, py))
      }
    }
  })
})
