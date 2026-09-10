import { type Matrix3, matInv, type Point, proj } from './geometry'

type Preset = {
  terrain: number
  tSign: -1 | 0 | 1
  clouds: number
  cSign: -1 | 0 | 1
  tau: number
  tilt: number
}

/** Only two ship. `tilt` unless the performance gate fails, in which case `follow`. */
export const PRESETS: Record<'tilt' | 'follow', Preset> = {
  tilt: { terrain: 8, tSign: -1, clouds: 20, cSign: -1, tau: 0.25, tilt: 1.5 },
  follow: { terrain: 8, tSign: 1, clouds: 20, cSign: 1, tau: 0.25, tilt: 0 },
}

/** The stage width both amplitudes were tuned at. Nothing derives from it. */
export const PARA_REF_W = 1672
const PARA_PERSPECTIVE = 1200
export const IDLE_X = 22
export const IDLE_Y = 11

const IDENTITY: Matrix3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

type LayerState = {
  terX: number
  terY: number
  cloX: number
  cloY: number
  tiltX: number
  tiltY: number
  idleX: number
  idleY: number
  /** The terrain layer's own transform, for `toStagePoint`. */
  matrix: Matrix3
  /** Its inverse, for `toCanvas`. */
  inverse: Matrix3
}

export function createLayerState(): LayerState {
  return {
    terX: 0,
    terY: 0,
    cloX: 0,
    cloY: 0,
    tiltX: 0,
    tiltY: 0,
    idleX: 0,
    idleY: 0,
    matrix: IDENTITY,
    inverse: IDENTITY,
  }
}

type ParallaxInput = {
  preset: Preset
  dt: number
  t: number
  stageWidth: number
  pointNX: number
  pointNY: number
  /** Pointer parallax runs: motion allowed and the mode is not docked. */
  live: boolean
  /** Idle drift runs: motion allowed. */
  idle: boolean
  /** The docked mode halves the idle amplitude. */
  half: boolean
  reduced: boolean
}

/** The two summed sines, in pixels, at amplitude factor `amp`. The periods never repeat visibly. */
export function idleOffset(t: number, amp: number): Point {
  const turn = 2 * Math.PI
  const x =
    (Math.sin((t / 14000) * turn) * 0.6 + Math.sin((t / 23000) * turn + 2.1) * 0.4) * IDLE_X * amp
  const y =
    (Math.sin((t / 23000) * turn) * 0.55 + Math.sin((t / 14000) * turn + 1.3) * 0.45) * IDLE_Y * amp
  return [x, y]
}

/**
 * CSS applies `perspective(d) * translate * rotateX(a) * rotateY(b)`, which is a plain homography,
 * so it inverts exactly and the cell under the cursor stays right while the layer is tilted.
 */
export function layerMatrix(state: LayerState): Matrix3 {
  const a = (state.tiltX * Math.PI) / 180
  const b = (state.tiltY * Math.PI) / 180
  const d = PARA_PERSPECTIVE
  return [
    [Math.cos(b), 0, state.terX],
    [Math.sin(a) * Math.sin(b), Math.cos(a), state.terY],
    [(Math.sin(b) * Math.cos(a)) / d, -Math.sin(a) / d, 1],
  ]
}

/** Eases every offset one frame and refreshes `state.inverse`. No DOM. */
export function stepParallax(state: LayerState, input: ParallaxInput): void {
  const p = input.preset
  const amp = Math.min(1.5, Math.max(0.5, input.stageWidth / PARA_REF_W))
  const nx = input.live ? input.pointNX : 0
  const ny = input.live ? input.pointNY : 0
  const k = input.reduced ? 1 : 1 - Math.exp(-input.dt / p.tau)
  const terrain = p.terrain * p.tSign * amp
  const clouds = p.clouds * p.cSign * amp
  state.terX += (terrain * nx - state.terX) * k
  state.terY += (terrain * ny - state.terY) * k
  state.cloX += (clouds * nx - state.cloX) * k
  state.cloY += (clouds * ny - state.cloY) * k
  state.tiltX += ((input.live ? -p.tilt * ny : 0) - state.tiltX) * k
  state.tiltY += ((input.live ? p.tilt * nx : 0) - state.tiltY) * k
  if (input.idle && !input.reduced) {
    const drift = idleOffset(input.t, amp * (input.half ? 0.5 : 1))
    state.idleX = drift[0]
    state.idleY = drift[1]
  } else {
    state.idleX = 0
    state.idleY = 0
  }
  // The forward matrix is kept because `toStagePoint` needs it later in the same frame.
  state.matrix = layerMatrix(state)
  state.inverse = matInv(state.matrix)
}

export function terrainTransform(state: LayerState, tilted: boolean): string {
  const move = `translate3d(${state.terX.toFixed(2)}px,${state.terY.toFixed(2)}px,0)`
  if (!tilted) return move
  const rx = `rotateX(${state.tiltX.toFixed(3)}deg)`
  const ry = `rotateY(${state.tiltY.toFixed(3)}deg)`
  return `perspective(${PARA_PERSPECTIVE}px) ${move} ${rx} ${ry}`
}

export function cloudTransform(state: LayerState): string {
  const x = state.cloX + state.idleX
  const y = state.cloY + state.idleY
  return `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`
}

/** The stage box as a pointer event sees it. A `DOMRect` satisfies it. */
type StageRect = { left: number; top: number; width: number; height: number }

/** A point on the screen, in the canvas coordinates the grid is drawn in. */
export function toCanvas(
  inverse: Matrix3,
  clientX: number,
  clientY: number,
  rect: StageRect,
): Point {
  const p = proj(
    inverse,
    clientX - rect.left - rect.width / 2,
    clientY - rect.top - rect.height / 2,
  )
  return [p[0] + rect.width / 2, p[1] + rect.height / 2]
}

/** The forward twin of `toCanvas`: a canvas point to the stage pixel the layer puts it at. */
export function toStagePoint(state: LayerState, x: number, y: number, rect: StageRect): Point {
  const p = proj(state.matrix, x - rect.width / 2, y - rect.height / 2)
  return [p[0] + rect.width / 2, p[1] + rect.height / 2]
}
