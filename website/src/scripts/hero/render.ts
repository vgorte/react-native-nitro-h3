import type { EnergyState } from './energy'
import {
  centerOf,
  depth,
  type Hexagon,
  hexPts,
  inKeepOut,
  KO_FEATHER,
  type Point,
  proj,
  type Rect,
  screenOf,
} from './geometry'
import { BLEED, type Calibrated } from './scene'

export type Sparkle = { x: number; y: number; ph: number; sp: number; r: number; d: number }
export type LitCell = { q: number; r: number; ph: number; sp: number }
export type Pulse = { t: number; a: number; d: number }

/** The prototype's Lehmer generator, so the picked cells and sparkles reproduce exactly. */
function lcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

function tracePolygon(g: CanvasRenderingContext2D, points: readonly Point[]): void {
  g.beginPath()
  for (const [i, point] of points.entries()) {
    if (i === 0) g.moveTo(point[0], point[1])
    else g.lineTo(point[0], point[1])
  }
  g.closePath()
}

/** The bleed margin in canvas pixels, rounded so the drawing origin lands on whole pixels. */
export function bleedOf(W: number, H: number): Point {
  return [Math.round(BLEED * W), Math.round(BLEED * H)]
}

/**
 * Sizes the backing store to the bled stage box and leaves the context in stage CSS pixels, with
 * the stage's own top left at the origin and the bled area simply negative.
 */
export function sizeCanvas(
  canvas: HTMLCanvasElement,
  W: number,
  H: number,
  dpr: number,
): CanvasRenderingContext2D {
  const [bx, by] = bleedOf(W, H)
  canvas.width = Math.round((W + 2 * bx) * dpr)
  canvas.height = Math.round((H + 2 * by) * dpr)
  const g = canvas.getContext('2d')
  if (!g) throw new Error('the hero needs a 2d canvas context')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.translate(bx, by)
  return g
}

/** Clears the whole backing store, ignoring the drawing transform. */
export function clearAll(g: CanvasRenderingContext2D): void {
  g.save()
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, g.canvas.width, g.canvas.height)
  g.restore()
}

/**
 * Paints the keep-out mask over the bled canvas box. The blur eats into the rectangle from both
 * sides, so the rectangle is grown by the feather before it is drawn.
 */
export function buildKeepOut(mask: HTMLCanvasElement, W: number, H: number, ko: Rect | null): void {
  const [bx, by] = bleedOf(W, H)
  mask.width = W + 2 * bx
  mask.height = H + 2 * by
  if (!ko) return
  const g = mask.getContext('2d')
  if (!g) return
  g.setTransform(1, 0, 0, 1, bx, by)
  const o = KO_FEATHER
  g.filter = `blur(${KO_FEATHER / 2}px)`
  g.fillStyle = '#000'
  g.fillRect(ko.left - o, ko.top - o, ko.right - ko.left + o * 2, ko.bottom - ko.top + o * 2)
  g.filter = 'none'
}

export function punchKeepOut(
  g: CanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  ko: Rect | null,
  bleed: Point,
  offset: Point,
): void {
  if (!ko) return
  g.globalCompositeOperation = 'destination-out'
  g.drawImage(mask, offset[0] - bleed[0], offset[1] - bleed[1])
  g.globalCompositeOperation = 'source-over'
}

/** The mask in canvas pixels: the radial fade's centre and radii, and the two linear fade rows. */
export function maskGeometry(scene: Calibrated): {
  cx: number
  cy: number
  r0: number
  r1: number
  fy0: number
  fy1: number
} {
  return {
    cx: scene.mask.cx * scene.W,
    cy: scene.mask.cy * scene.H,
    r0: scene.mask.r0 * scene.W,
    r1: scene.mask.r1 * scene.W,
    fy0: scene.fy0,
    fy1: scene.fy1,
  }
}

function pickLitCells(scene: Calibrated, s: number): LitCell[] {
  const rnd = lcg(40 + Math.round(s * 10000))
  const cells: LitCell[] = []
  for (let i = 0; i < 5; i++) {
    const pu = scene.clampU[0] + rnd() * (scene.clampU[1] - scene.clampU[0])
    const pv = scene.PVMIN + rnd() * (scene.PVMAX - scene.PVMIN)
    const q = Math.round(pu / (1.5 * s))
    const r = Math.round(pv / (s * Math.sqrt(3)) - q / 2)
    cells.push({ q, r, ph: rnd() * 6.28, sp: 0.25 + rnd() * 0.5 })
  }
  return cells
}

/** Draws the static grid into its own canvas and returns the five slow-breathing lit cells. */
export function buildGrid(
  g: CanvasRenderingContext2D,
  scene: Calibrated,
  s: number,
  mask: HTMLCanvasElement,
  ko: Rect | null,
  koOffset: Point,
): LitCell[] {
  const { W, H } = scene
  const [bx, by] = bleedOf(W, H)
  clearAll(g)
  g.globalCompositeOperation = 'lighter'
  const q0 = Math.floor(scene.PU_MIN / (1.5 * s)) - 1
  const q1 = Math.ceil(scene.PU_MAX / (1.5 * s)) + 1
  const kk = s * Math.sqrt(3)
  for (let q = q0; q <= q1; q++) {
    const r0 = Math.floor(scene.PV_MIN2 / kk - q / 2) - 1
    const r1 = Math.ceil(scene.PV_MAX2 / kk - q / 2) + 1
    for (let r = r0; r <= r1; r++) {
      const centre = centerOf(q, r, s)
      if (centre[0] < scene.PU_MIN || centre[0] > scene.PU_MAX) continue
      if (centre[1] < scene.PV_MIN2 || centre[1] > scene.PV_MAX2) continue
      const screen = screenOf(scene, centre[0], centre[1])
      if (screen[0] < -bx - 120 || screen[0] > W + bx + 120) continue
      if (screen[1] < -by - 120 || screen[1] > H + by + 120) continue
      const points = hexPts(scene, centre[0], centre[1], s * 0.985)
      const d = depth(scene, centre[1])
      tracePolygon(g, points)
      g.strokeStyle = `rgba(80,160,255,${(0.13 + 0.21 * d).toFixed(3)})`
      g.lineWidth = 0.8 + 1.1 * d
      g.shadowColor = '#2f7dff'
      g.shadowBlur = 3 + 7 * d
      g.stroke()
      g.shadowBlur = 0
      g.fillStyle = `rgba(170,215,255,${(0.05 + 0.09 * d).toFixed(3)})`
      for (const [x, y] of points) {
        g.beginPath()
        g.arc(x, y, 0.9 + 0.9 * d, 0, 6.29)
        g.fill()
      }
    }
  }
  g.globalCompositeOperation = 'destination-in'
  const mk = maskGeometry(scene)
  const radial = g.createRadialGradient(mk.cx, mk.cy, mk.r0, mk.cx, mk.cy, mk.r1)
  radial.addColorStop(0, 'rgba(0,0,0,1)')
  radial.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = radial
  g.fillRect(-bx, -by, W + 2 * bx, H + 2 * by)
  const linear = g.createLinearGradient(0, mk.fy0, 0, mk.fy1)
  linear.addColorStop(0, 'rgba(0,0,0,0.04)')
  linear.addColorStop(1, 'rgba(0,0,0,1)')
  g.fillStyle = linear
  g.fillRect(-bx, -by, W + 2 * bx, H + 2 * by)
  g.globalCompositeOperation = 'source-over'
  punchKeepOut(g, mask, ko, [bx, by], koOffset)
  return pickLitCells(scene, s)
}

export function makeSparkles(scene: Calibrated): Sparkle[] {
  const rnd = lcg(7)
  const sparkles: Sparkle[] = []
  for (let i = 0; i < 18; i++) {
    const u = 0.06 + rnd() * 0.96
    const v = 0.1 + rnd() * 0.8
    const [x, y] = proj(scene.Hm, u, v)
    const d = Math.min(1, Math.max(0, (v - 0.05) / 0.91))
    if (x < -20 || x > scene.W + 20 || y < -20 || y > scene.H + 20) continue
    sparkles.push({
      x,
      y,
      ph: rnd() * 6.28,
      sp: 0.6 + rnd() * 1.2,
      r: (1.2 + rnd() * 1.6) * (0.7 + 0.5 * d),
      d,
    })
  }
  return sparkles
}

export type FrameInput = {
  ctx: CanvasRenderingContext2D
  grid: HTMLCanvasElement
  mask: HTMLCanvasElement
  scene: Calibrated
  ko: Rect | null
  koOffset: Point
  energy: EnergyState
  sparkles: readonly Sparkle[]
  litCells: readonly LitCell[]
  pulses: Pulse[]
  focus: { cu: number; cv: number; s: number }
  breath: number
  t: number
  reduced: boolean
}

/** Draws one frame and returns the focus hexagon, which the card anchoring needs. */
export function drawScene(input: FrameInput): Hexagon {
  const { ctx, scene, t, reduced } = input
  clearAll(ctx)
  const [bx, by] = bleedOf(scene.W, scene.H)
  // The plate is the same backing store, so it is blitted device pixel for device pixel; drawing
  // it under the scaled transform would apply the device ratio a second time.
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(input.grid, 0, 0)
  ctx.restore()
  ctx.globalCompositeOperation = 'lighter'

  for (const sparkle of input.sparkles) {
    const osc = reduced
      ? 0.35
      : 0.22 + 0.28 * (0.5 + 0.5 * Math.sin((t / 1000) * sparkle.sp + sparkle.ph))
    const a = osc * (0.45 + 0.55 * sparkle.d)
    ctx.shadowColor = '#5fb0ff'
    ctx.shadowBlur = 8
    ctx.fillStyle = `rgba(190,225,255,${a.toFixed(3)})`
    ctx.beginPath()
    ctx.arc(sparkle.x, sparkle.y, sparkle.r, 0, 6.29)
    ctx.fill()
  }
  ctx.shadowBlur = 0

  for (const lit of input.litCells) {
    const centre = centerOf(lit.q, lit.r, input.focus.s)
    const d = depth(scene, centre[1])
    const osc = reduced ? 0.7 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((t / 1000) * lit.sp + lit.ph))
    tracePolygon(ctx, hexPts(scene, centre[0], centre[1], input.focus.s * 0.985))
    ctx.fillStyle = `rgba(60,140,255,${((0.05 + 0.11 * d) * osc).toFixed(3)})`
    ctx.fill()
  }

  ctx.shadowColor = '#3d8bff'
  for (const cell of input.energy.cells.values()) {
    const centre = centerOf(cell.q, cell.r, input.focus.s)
    if (centre[0] < scene.PU_MIN || centre[0] > scene.PU_MAX) continue
    if (centre[1] < scene.PV_MIN2 || centre[1] > scene.PV_MAX2) continue
    const screen = screenOf(scene, centre[0], centre[1])
    if (inKeepOut(input.ko, screen[0], screen[1], 0)) continue
    const e = cell.e
    const d = depth(scene, centre[1])
    tracePolygon(ctx, hexPts(scene, centre[0], centre[1], input.focus.s * 0.985))
    ctx.fillStyle = `rgba(60,140,255,${(0.06 + 0.3 * e * d).toFixed(3)})`
    ctx.strokeStyle = `rgba(140,195,255,${(0.15 + 0.6 * e).toFixed(3)})`
    ctx.lineWidth = 0.8 + 2.2 * e
    ctx.shadowBlur = 4 + 14 * e
    ctx.fill()
    ctx.stroke()
  }
  ctx.shadowBlur = 0

  const { cu, cv, s } = input.focus
  const fd = depth(scene, cv)
  const fp = hexPts(scene, cu, cv, s)
  tracePolygon(ctx, fp)
  ctx.strokeStyle = `rgba(168,212,255,${input.breath.toFixed(3)})`
  ctx.lineWidth = 1.5 + 1.1 * fd
  ctx.shadowColor = '#6cb4ff'
  ctx.shadowBlur = 9 + 9 * fd
  ctx.stroke()

  for (const [x, y] of fp) {
    ctx.fillStyle = `rgba(232,244,255,${((0.55 + 0.35 * fd) * input.breath).toFixed(3)})`
    ctx.shadowColor = '#8ec5ff'
    ctx.shadowBlur = 6 + 6 * fd
    ctx.beginPath()
    ctx.arc(x, y, 1.7 + 1.3 * fd, 0, 6.29)
    ctx.fill()
  }
  const centreScreen = screenOf(scene, cu, cv)
  ctx.fillStyle = 'rgba(240,248,255,0.95)'
  ctx.shadowColor = '#9fd0ff'
  ctx.shadowBlur = 10 + 10 * fd
  ctx.beginPath()
  ctx.arc(centreScreen[0], centreScreen[1], 2.6 + 1.2 * fd, 0, 6.29)
  ctx.fill()
  ctx.shadowBlur = 0

  for (let i = input.pulses.length - 1; i >= 0; i--) {
    const pulse = input.pulses[i]
    if (!pulse) continue
    const e = (t - pulse.t) / pulse.d
    if (e >= 1) {
      input.pulses.splice(i, 1)
      continue
    }
    tracePolygon(ctx, hexPts(scene, cu, cv, s * (1 + e * 1.5)))
    ctx.strokeStyle = `rgba(140,195,255,${(0.55 * pulse.a * (1 - e)).toFixed(3)})`
    ctx.lineWidth = 2
    ctx.stroke()
  }

  ctx.globalCompositeOperation = 'source-over'
  punchKeepOut(ctx, input.mask, input.ko, [bx, by], input.koOffset)
  return fp
}

export function drawLeader(
  g: CanvasRenderingContext2D,
  hexAnchor: Point,
  cardAnchor: Point,
  docked: boolean,
): void {
  g.strokeStyle = 'rgba(150,195,255,0.5)'
  g.lineWidth = docked ? 2 : 1.2
  g.beginPath()
  g.moveTo(hexAnchor[0], hexAnchor[1])
  g.lineTo(cardAnchor[0], cardAnchor[1])
  g.stroke()
  g.fillStyle = 'rgba(190,220,255,0.85)'
  g.beginPath()
  g.arc(hexAnchor[0], hexAnchor[1], docked ? 3.5 : 2.2, 0, 6.29)
  g.fill()
}
