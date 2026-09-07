export type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
]

export type Point = readonly [number, number]

export type Hexagon = readonly [Point, Point, Point, Point, Point, Point]

export type Rect = { left: number; top: number; right: number; bottom: number }

export type Resolution = 6 | 9 | 12

/** Image `u` and `v` of the plane origin, and the plane `v` to image `v` scale. */
export const U0 = 0.4003605167
export const V0 = 0.4169709918
export const VS = 1.7348

/** Depth ramp ends, in plane `v`: 0 at the far edge of the ground, 1 at the near edge. */
export const PVMIN = -0.21
export const PVMAX = 0.31

/** Plane extent the grid is built over. */
export const PU_MIN = -0.42
export const PU_MAX = 0.6
export const PV_MIN2 = -0.26
export const PV_MAX2 = 0.36

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

/** Design pixels the copy block's box grows by before it becomes the keep-out. */
export const KO_PAD = 40
/** Blur width of the keep-out mask edge. */
export const KO_FEATHER = 60
/** The blurred edge still dims what it touches, so a clear cell has to stay this far out. */
export const KO_CLEAR = KO_FEATHER * 2

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

export function planeOf(mi: Matrix3, x: number, y: number): Point {
  const uv = unproj(mi, x, y)
  return [uv[0] - U0, (uv[1] - V0) / VS]
}

export function screenOf(m: Matrix3, pu: number, pv: number): Point {
  return proj(m, U0 + pu, V0 + pv * VS)
}

export function depth(pv: number): number {
  return Math.min(1, Math.max(0, (pv - PVMIN) / (PVMAX - PVMIN)))
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

export function hexPts(m: Matrix3, cu: number, cv: number, s: number): Hexagon {
  const at = (k: number): Point => {
    const a = (Math.PI / 180) * (60 * k)
    return screenOf(m, cu + s * Math.cos(a), cv + s * Math.sin(a))
  }
  return [at(0), at(1), at(2), at(3), at(4), at(5)]
}

export type Fit = {
  scale: number
  offsetX: number
  offsetY: number
  /** The design rectangle the stage actually shows, after the centred crop. */
  vis: Rect
}

/** Fits the design space to the stage the way CSS `object-fit: cover` fits an image. */
export function coverFit(W: number, H: number, stageWidth: number, stageHeight: number): Fit {
  const scale = Math.max(stageWidth / W, stageHeight / H)
  const visW = stageWidth / scale
  const visH = stageHeight / scale
  const offsetX = (W - visW) / 2
  const offsetY = (H - visH) / 2
  return {
    scale,
    offsetX,
    offsetY,
    vis: { left: offsetX, top: offsetY, right: offsetX + visW, bottom: offsetY + visH },
  }
}

/** Takes a point in stage-local CSS pixels to design units. */
export function toDesign(fit: Fit, x: number, y: number): Point {
  return [x / fit.scale + fit.offsetX, y / fit.scale + fit.offsetY]
}

/** Takes a point in design units to stage-local CSS pixels. */
export function toStage(fit: Fit, x: number, y: number): Point {
  return [(x - fit.offsetX) * fit.scale, (y - fit.offsetY) * fit.scale]
}

export function growRect(rect: Rect, pad: number): Rect {
  return {
    left: rect.left - pad,
    top: rect.top - pad,
    right: rect.right + pad,
    bottom: rect.bottom + pad,
  }
}

export function inKeepOut(ko: Rect | null, x: number, y: number, grow: number): boolean {
  if (!ko) return false
  return x > ko.left - grow && x < ko.right + grow && y > ko.top - grow && y < ko.bottom + grow
}

export type ClearContext = { Hm: Matrix3; s: number; ko: Rect | null; vis: Rect }

/** -1 cut by the keep-out, 0 clear of it but touching the crop edge, 1 clear of both. */
export function cellClear(cx: ClearContext, q: number, r: number): -1 | 0 | 1 {
  const centre = centerOf(q, r, cx.s)
  const points = hexPts(cx.Hm, centre[0], centre[1], cx.s)
  let whole = true
  for (const [x, y] of points) {
    if (inKeepOut(cx.ko, x, y, KO_CLEAR)) return -1
    if (x < cx.vis.left + 4 || x > cx.vis.right - 4) whole = false
    if (y < cx.vis.top + 4 || y > cx.vis.bottom - 4) whole = false
  }
  return whole ? 1 : 0
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
          const screen = screenOf(cx.Hm, centre[0], centre[1])
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
