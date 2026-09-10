import {
  type Camera,
  homographyFrom,
  type Matrix3,
  matInv,
  matMul,
  proj,
  type Quad,
  type Resolution,
  SIZES,
  U0,
  unproj,
  V0,
  vsFor,
} from './geometry'

export type Mode = 'desk' | 'mob'

type Scene = {
  /** Radial mountain fade, as fractions: the centre of x by W and y by H, both radii by W. */
  mask: { cx: number; cy: number; r0: number; r1: number }
  /** Rings lit per resolution. The hero reads `RES`; the others carry the scale, like `SIZES`. */
  litR: Record<Resolution, number>
  litCap: number
  dock: boolean
}

export type Calibrated = Scene & {
  W: number
  H: number
  Hm: Matrix3
  Hi: Matrix3
  VS: number
  PVMIN: number
  PVMAX: number
  PU_MIN: number
  PU_MAX: number
  PV_MIN2: number
  PV_MAX2: number
  clampU: readonly [number, number]
  clampV: readonly [number, number]
  horizonY: number
  /** The vertical fade ends of the grid mask, in canvas pixels. */
  fy0: number
  fy1: number
}

export const SCENES: Record<Mode, Scene> = {
  desk: {
    mask: { cx: 0.281, cy: 1.063, r0: 0.34, r1: 0.777 },
    // Rings of ground lit around the pointer, per resolution, so the patch keeps its screen size.
    litR: { 6: 1, 9: 2, 12: 3 },
    litCap: 600,
    dock: false,
  },
  mob: {
    mask: { cx: 0.5, cy: 0.829, r0: 0.876, r1: 2.304 },
    // The portrait crop is narrow, so the patch stays a small cluster around the pressed cell.
    litR: { 6: 1, 9: 1, 12: 2 },
    litCap: 300,
    dock: true,
  },
}

/** The ground rectangle on the terrain plate, in image pixels, far edge first. */
export const QUAD: Quad = [
  [509, 265],
  [914, 265],
  [1576, 850],
  [-16, 850],
]

const CAMERA: Camera = { yHorizon: 65, xVp: 688, focal: 1032 }

/** The image the four reference points were measured on. */
const IMG_W = 1376
const IMG_H = 768

/** The terrain layer is this much larger than the stage on every side. */
const GROW = 0.08
/** The canvas overhangs the stage by this fraction. It has to stay under `GROW / 2`. */
export const BLEED = 0.035

/** The far `v` the grid is built to, a little past the reference rectangle. */
const V_BUILD_FAR = -0.6
/** The lateral rail, past which far cells cost time and draw nothing. */
const PU_LIMIT = 3.2
/** A cell whose screen width falls below this many canvas pixels is not drawn. */
export const MIN_HEX_PX = 5
/** Below this depth a cell is a plain hairline, without glow and without vertex dots. */
export const FAR_PLAIN = 0.16

/** Maps image pixels to canvas pixels: the cover fit the layer uses, grown by `GROW`. */
function imageCoverFit(W: number, H: number): Matrix3 {
  const s = Math.max(W / IMG_W, H / IMG_H)
  const k = 1 + GROW
  return [
    [k * s, 0, (k * (W - IMG_W * s)) / 2 - (GROW / 2) * W],
    [0, k * s, (k * (H - IMG_H * s)) / 2 - (GROW / 2) * H],
    [0, 0, 1],
  ]
}

/**
 * Derives everything that depends on the four reference points and the measured stage box, so the
 * only hand-set numbers left are those points, the camera and the mask shape.
 */
export function calibrate(scene: Scene, W: number, H: number): Calibrated {
  const VS = vsFor(CAMERA, QUAD)
  const Hm = matMul(imageCoverFit(W, H), homographyFrom(QUAD))
  const Hi = matInv(Hm)
  const span = 1 / VS
  const pvFar = (0 - V0) / VS
  const pvNear = (1 - V0) / VS
  // The plane is sampled depth by depth: the widest u range sits at the far end, where a row
  // spans a fraction of the frame and a screen-row sampler would step straight over it.
  const spanOver = (vFrom: number, vTo: number): readonly [number, number] => {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (let i = 0; i <= 24; i++) {
      const v = vFrom + ((vTo - vFrom) * i) / 24
      const y = proj(Hm, 0.5, v)[1]
      const a = unproj(Hi, 0, y)[0]
      const b = unproj(Hi, W, y)[0]
      lo = Math.min(lo, a - U0, b - U0)
      hi = Math.max(hi, a - U0, b - U0)
    }
    return [lo, hi]
  }
  const wide = spanOver(V_BUILD_FAR, 1)
  const near = spanOver(0.35, 1)
  // One extra ring on each side, so the grid runs off both stage edges instead of ending inside.
  const ring = 1.5 * SIZES[12]
  const PU_MIN = Math.max(wide[0] - ring, -PU_LIMIT)
  const PU_MAX = Math.min(wide[1] + ring, PU_LIMIT)
  return {
    ...scene,
    W,
    H,
    Hm,
    Hi,
    VS,
    PVMIN: pvFar + 0.03 * span,
    PVMAX: pvNear - 0.025 * span,
    PU_MIN,
    PU_MAX,
    PV_MIN2: (V_BUILD_FAR - V0) / VS,
    PV_MAX2: pvNear + 0.02 * span,
    // The 0.02 inset keeps the pointer clamp inside the near field, not on its very edge.
    clampU: [Math.max(near[0] + 0.02, PU_MIN), Math.min(near[1] - 0.02, PU_MAX)],
    clampV: [(0.028 - V0) / VS, (0.934 - V0) / VS],
    horizonY: proj(Hm, 0.5, V_BUILD_FAR - 0.7)[1],
    fy0: proj(Hm, 0.5, V_BUILD_FAR)[1],
    fy1: proj(Hm, 0.5, 0.35)[1],
  }
}

/** The one query that decides the mode. The CSS uses the same string, so they cannot disagree. */
export const MODE_QUERY = '(orientation: portrait), (max-width: 49.9375rem)'

/**
 * Picks the mode from `MODE_QUERY`. `?mode=desk` and `?mode=mob` stay as a test aid and take
 * precedence over the query.
 */
export function pickMode(params: URLSearchParams): Mode {
  const forced = params.get('mode')
  if (forced === 'mob' || forced === 'mobile') return 'mob'
  if (forced === 'desk' || forced === 'desktop') return 'desk'
  return matchMedia(MODE_QUERY).matches ? 'mob' : 'desk'
}
