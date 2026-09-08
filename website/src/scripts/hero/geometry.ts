export type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
]

export type Point = readonly [number, number]

export type Quad = readonly [Point, Point, Point, Point]

export type Hexagon = readonly [Point, Point, Point, Point, Point, Point]

export type Rect = { left: number; top: number; right: number; bottom: number }

export type Resolution = 6 | 9 | 12

/** The lens the ground plane is calibrated for, in image pixels. */
export type Camera = { yHorizon: number; xVp: number; focal: number }

/** The part of a calibrated scene the plane mapping needs. Keeps this file free of `scene.ts`. */
export type Plane = { Hm: Matrix3; Hi: Matrix3; VS: number; PVMIN: number; PVMAX: number }

/** Image `u` and `v` of the plane origin. The `v` scale is derived per calibration. */
export const U0 = 0.4003605167
export const V0 = 0.4169709918

/** Hex size in plane units per resolution. The hero draws 12; the others document the scale. */
export const SIZES = { 6: 0.156, 9: 0.0678, 12: 0.0295 } as const

export const RES = 12

/** The six axial neighbour steps, in the order a ring walk follows them. */
export const NBR = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const satisfies readonly Point[]

/** Canvas pixels the copy block's box grows by before it becomes the keep-out column. */
export const KO_PAD = 16
/** Blur width of the keep-out mask edge. */
export const KO_FEATHER = 40
/** One feather width, not two: two ate the whole band under the copy block. */
export const KO_CLEAR = KO_FEATHER

/** The homography that maps the unit square onto the four reference points, far edge first. */
export function homographyFrom(quad: Quad): Matrix3 {
  const [x0, y0] = quad[0]
  const [x1, y1] = quad[1]
  const [x2, y2] = quad[2]
  const [x3, y3] = quad[3]
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const sx = x0 - x1 + x2 - x3
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const sy = y0 - y1 + y2 - y3
  const den = dx1 * dy2 - dy1 * dx2
  const g = (sx * dy2 - sy * dx2) / den
  const h = (dx1 * sy - dy1 * sx) / den
  return [
    [x1 - x0 + g * x1, x3 - x0 + h * x3, x0],
    [y1 - y0 + g * y1, y3 - y0 + h * y3, y0],
    [g, h, 1],
  ]
}

export function matMul(a: Matrix3, b: Matrix3): Matrix3 {
  const at = (m: Matrix3, i: number, j: number): number => {
    const row = m[i]
    if (!row) throw new Error('a 3x3 matrix has three rows')
    return row[j] ?? 0
  }
  const cell = (i: number, j: number): number =>
    at(a, i, 0) * at(b, 0, j) + at(a, i, 1) * at(b, 1, j) + at(a, i, 2) * at(b, 2, j)
  return [
    [cell(0, 0), cell(0, 1), cell(0, 2)],
    [cell(1, 0), cell(1, 1), cell(1, 2)],
    [cell(2, 0), cell(2, 1), cell(2, 2)],
  ]
}

export function matInv(m: Matrix3): Matrix3 {
  const [a, b, c] = m[0]
  const [d, e, f] = m[1]
  const [g, h, i] = m[2]
  const A = e * i - f * h
  const B = f * g - d * i
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ]
}

/** Ground coordinates of an image point on the plane, in camera heights. */
export function groundPt(camera: Camera, point: Point): Point {
  const d = point[1] - camera.yHorizon
  return [(point[0] - camera.xVp) / d, camera.focal / d]
}

/**
 * One `pu` unit spans the quad's width, one `pv` unit spans this many quad depths. It is the
 * value that keeps a hexagon a hexagon on the ground, and the focal length does not cancel out.
 */
export function vsFor(camera: Camera, quad: Quad): number {
  const a = groundPt(camera, quad[3])
  const b = groundPt(camera, quad[2])
  const c = groundPt(camera, quad[0])
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.hypot(c[0] - a[0], c[1] - a[1])
}

export function proj(m: Matrix3, u: number, v: number): Point {
  const w = m[2][0] * u + m[2][1] * v + m[2][2]
  return [(m[0][0] * u + m[0][1] * v + m[0][2]) / w, (m[1][0] * u + m[1][1] * v + m[1][2]) / w]
}

export function unproj(mi: Matrix3, x: number, y: number): Point {
  const w = mi[2][0] * x + mi[2][1] * y + mi[2][2]
  return [
    (mi[0][0] * x + mi[0][1] * y + mi[0][2]) / w,
    (mi[1][0] * x + mi[1][1] * y + mi[1][2]) / w,
  ]
}

export function planeOf(plane: Plane, x: number, y: number): Point {
  const uv = unproj(plane.Hi, x, y)
  return [uv[0] - U0, (uv[1] - V0) / plane.VS]
}

export function screenOf(plane: Plane, pu: number, pv: number): Point {
  return proj(plane.Hm, U0 + pu, V0 + pv * plane.VS)
}

export function depth(plane: Plane, pv: number): number {
  return Math.min(1, Math.max(0, (pv - plane.PVMIN) / (plane.PVMAX - plane.PVMIN)))
}

/** Pointy-topped axial coordinates of the cell that contains the plane point, by cube rounding. */
export function axialAt(pu: number, pv: number, s: number): Point {
  const q = ((2 / 3) * pu) / s
  const r = (-(1 / 3) * pu + (Math.sqrt(3) / 3) * pv) / s
  const x = q
  const z = r
  const y = -x - z
  let rx = Math.round(x)
  const ry = Math.round(y)
  let rz = Math.round(z)
  const dx = Math.abs(rx - x)
  const dy = Math.abs(ry - y)
  const dz = Math.abs(rz - z)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dz > dy) rz = -rx - ry
  // Cube rounding can land on -0; a cell key must be one value per cell.
  return [rx || 0, rz || 0]
}

export function centerOf(q: number, r: number, s: number): Point {
  return [s * 1.5 * q, s * Math.sqrt(3) * (r + q / 2)]
}

export function hexPts(plane: Plane, cu: number, cv: number, s: number): Hexagon {
  const at = (k: number): Point => {
    const a = (Math.PI / 180) * (60 * k)
    return screenOf(plane, cu + s * Math.cos(a), cv + s * Math.sin(a))
  }
  return [at(0), at(1), at(2), at(3), at(4), at(5)]
}

/** The overlays sit outside the moving layer, so their boxes enter canvas space shifted. */
export function shiftRect(rect: Rect, dx: number, dy: number): Rect {
  return {
    left: rect.left + dx,
    top: rect.top + dy,
    right: rect.right + dx,
    bottom: rect.bottom + dy,
  }
}

export function inKeepOut(ko: Rect | null, x: number, y: number, grow: number): boolean {
  if (!ko) return false
  return x > ko.left - grow && x < ko.right + grow && y > ko.top - grow && y < ko.bottom + grow
}

export type ClearContext = { plane: Plane; s: number; ko: Rect | null; W: number; H: number }

/** -1 cut by the keep-out, 0 clear of it but touching the stage edge, 1 clear of both. */
export function cellClear(cx: ClearContext, q: number, r: number): -1 | 0 | 1 {
  const centre = centerOf(q, r, cx.s)
  const points = hexPts(cx.plane, centre[0], centre[1], cx.s)
  let whole = true
  for (const [x, y] of points) {
    if (inKeepOut(cx.ko, x, y, KO_CLEAR)) return -1
    if (x < 4 || x > cx.W - 4) whole = false
    if (y < 4 || y > cx.H - 4) whole = false
  }
  return whole ? 1 : 0
}

/**
 * The keep-out is the column the copy block stands in, sideways only: from off the left edge of
 * the canvas to the block's right edge plus the pad, over the block's own height plus the pad.
 */
export function copyColumn(copy: Rect): Rect {
  return {
    left: -3 * KO_FEATHER,
    top: copy.top - KO_PAD,
    right: copy.right + KO_PAD,
    bottom: copy.bottom + KO_PAD,
  }
}

/** True when the canvas point lies inside the column, feather included. */
export function inCopyColumn(ko: Rect | null, px: number, py: number): boolean {
  return inKeepOut(ko, px, py, KO_CLEAR)
}

/** Moves a sampled canvas point right, on the same row, out of the column. */
export function escapeKeepOut(ko: Rect | null, px: number, py: number): Point {
  if (!ko || !inCopyColumn(ko, px, py)) return [px, py]
  return [ko.right + KO_CLEAR + 1, py]
}

/**
 * Walks a cell right along its own row until it clears the column. Stepping `[1, 0]` and
 * `[1, -1]` alternately advances `pu` while `pv` stays put, so the focus keeps the row the
 * pointer is on instead of being dragged toward the camera.
 */
export function slideRight(cx: ClearContext, q: number, r: number): Point {
  let cq = q
  let cr = r
  for (let k = 0; k < 16; k++) {
    if (cellClear(cx, cq, cr) >= 0) return [cq, cr]
    cq += 1
    if (k % 2) cr -= 1
  }
  return [cq, cr]
}

/** The focus cell always renders whole, so the nearest fully clear cell to the pointer wins. */
export function pushOut(cx: ClearContext, q: number, r: number, px: number, py: number): Point {
  if (cellClear(cx, q, r) >= 0) return [q, r]
  let loose: Point | null = null
  for (let k = 1; k <= 14; k++) {
    let cq = q + NBR[4][0] * k
    let cr = r + NBR[4][1] * k
    let best: Point | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const step of NBR) {
      for (let j = 0; j < k; j++) {
        const ok = cellClear(cx, cq, cr)
        if (ok >= 0) {
          const centre = centerOf(cq, cr, cx.s)
          const screen = screenOf(cx.plane, centre[0], centre[1])
          const distance = (screen[0] - px) ** 2 + (screen[1] - py) ** 2
          if (ok === 1 && distance < bestDistance) {
            bestDistance = distance
            best = [cq, cr]
          } else if (loose === null) {
            loose = [cq, cr]
          }
        }
        cq += step[0]
        cr += step[1]
      }
    }
    if (best) return best
  }
  return loose ?? [q, r]
}
