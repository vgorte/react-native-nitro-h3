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
import { BLEED, type Calibrated, FAR_PLAIN, MIN_HEX_PX } from './scene'

export type Sparkle = { x: number; y: number; ph: number; sp: number; r: number; d: number }
export type LitCell = { q: number; r: number; ph: number; sp: number }
export type Pulse = { t: number; a: number; d: number }
export type GridBuild = { litCells: LitCell[]; cells: number; buildMs: number }

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

/**
 * The build's depth ramp, resolved to this many steps and precomputed once. A cell then costs a
 * table lookup instead of two colour strings, and the state only changes where the step does.
 * Sixteen keeps the quantisation invisible: the stroke alpha step is 0.013 and the blur step
 * 0.44 px.
 */
const DEPTH_STEPS = 16

type DepthStyle = {
  stroke: string
  dot: string
  lineWidth: number
  blur: number
  dotRadius: number
}

function depthStyle(d: number): DepthStyle {
  return {
    stroke: `rgba(80,160,255,${(0.13 + 0.21 * d).toFixed(3)})`,
    dot: `rgba(170,215,255,${(0.05 + 0.09 * d).toFixed(3)})`,
    lineWidth: 0.8 + 1.1 * d,
    blur: 3 + 7 * d,
    dotRadius: 0.9 + 0.9 * d,
  }
}

const DEPTH_STYLES: readonly DepthStyle[] = Array.from({ length: DEPTH_STEPS }, (_, i) =>
  depthStyle((i + 0.5) / DEPTH_STEPS),
)

/** Stands in for an index the clamp cannot produce, so the sweep never carries an optional. */
const FAR_STYLE = depthStyle(0)

/**
 * A blurred draw under `'lighter'` is what the frame's cost is made of: measured in the page, the
 * frame interval's p95 falls from 33 ms to 9 ms with `shadowBlur` forced to zero. So nothing in the
 * frame blurs. A disc and its glow are the same shape every frame, so they are baked once into a
 * sprite; an outline's glow is approximated by two wider strokes at a fraction of the alpha.
 */
export type GlowSprite = { canvas: HTMLCanvasElement; half: number }

export type GlowSprites = {
  sparkle: readonly GlowSprite[]
  vertex: readonly GlowSprite[]
  centre: readonly GlowSprite[]
}

/** Steps the focus depth is resolved to for the two sprite banks that follow it. */
const GLOW_STEPS = 8

/**
 * Bakes a disc and its glow at full alpha. Both the shadow and the disc scale linearly with the
 * source alpha, so drawing the sprite with `globalAlpha` reproduces what the blurred draw did at
 * that alpha. The bake composites with `'lighter'` for the same reason the frame does.
 */
function bakeGlow(
  radius: number,
  blur: number,
  fill: string,
  shadow: string,
  dpr: number,
): GlowSprite {
  // `shadowBlur` is twice the Gaussian's standard deviation, so three sigma is 1.5 blur widths.
  const half = Math.ceil(radius + 1.5 * blur + 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(half * 2 * dpr)
  canvas.height = Math.round(half * 2 * dpr)
  const g = canvas.getContext('2d')
  if (g) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.globalCompositeOperation = 'lighter'
    g.fillStyle = fill
    g.shadowColor = shadow
    g.shadowBlur = blur
    g.beginPath()
    g.arc(half, half, radius, 0, 6.29)
    g.fill()
  }
  return { canvas, half }
}

/** The frame's three families of glowing disc, baked for the current sparkles and device ratio. */
export function makeGlows(sparkles: readonly Sparkle[], dpr: number): GlowSprites {
  const byDepth = (
    radius: (fd: number) => number,
    blur: (fd: number) => number,
    fill: string,
    shadow: string,
  ): GlowSprite[] =>
    Array.from({ length: GLOW_STEPS }, (_, i) => {
      const fd = (i + 0.5) / GLOW_STEPS
      return bakeGlow(radius(fd), blur(fd), fill, shadow, dpr)
    })
  return {
    // A sparkle keeps one radius for the life of the plate, so it gets its own sprite.
    sparkle: sparkles.map((sparkle) => bakeGlow(sparkle.r, 8, 'rgb(190,225,255)', '#5fb0ff', dpr)),
    vertex: byDepth(
      (fd) => 1.7 + 1.3 * fd,
      (fd) => 6 + 6 * fd,
      'rgb(232,244,255)',
      '#8ec5ff',
    ),
    centre: byDepth(
      (fd) => 2.6 + 1.2 * fd,
      (fd) => 10 + 10 * fd,
      'rgb(240,248,255)',
      '#9fd0ff',
    ),
  }
}

function drawGlow(
  g: CanvasRenderingContext2D,
  sprite: GlowSprite | undefined,
  x: number,
  y: number,
  alpha: number,
): void {
  if (!sprite) return
  g.globalAlpha = alpha
  g.drawImage(sprite.canvas, x - sprite.half, y - sprite.half, sprite.half * 2, sprite.half * 2)
}

const glowStep = (fd: number): number => Math.min(GLOW_STEPS - 1, (fd * GLOW_STEPS) | 0)

/**
 * The three passes that stand in for a blurred stroke, as a staircase under the bell the shadow
 * would have drawn. `shadowBlur` is twice the Gaussian's standard deviation, so a stroke of width
 * `w` blurred by `b` keeps a peak of `w / (sqrt(2 pi) * b / 2)` of its own alpha and reaches about
 * `b` pixels to each side. The three widths sample that bell at roughly 0.7, 1.3 and 2.2 sigma, and
 * the three shares add up to its peak.
 */
const GLOW_PASSES = [
  { width: 2, share: 0.34 },
  { width: 1.1, share: 0.39 },
  { width: 0.5, share: 0.27 },
] as const

type GlowPass = { colour: string; lineWidth: number }

function glowPasses(rgb: string, alpha: number, lineWidth: number, blur: number): GlowPass[] {
  const peak = (0.798 * alpha * lineWidth) / blur
  return GLOW_PASSES.map((pass) => ({
    colour: `rgba(${rgb},${(peak * pass.share).toFixed(4)})`,
    lineWidth: lineWidth + pass.width * blur,
  }))
}

/** The energy patch's alpha ramp, resolved to this many steps and precomputed once. */
const ENERGY_STEPS = 16

type EnergyStyle = { stroke: string; lineWidth: number; glow: readonly GlowPass[] }

const ENERGY_STYLES: readonly EnergyStyle[] = Array.from({ length: ENERGY_STEPS }, (_, i) => {
  const e = (i + 0.5) / ENERGY_STEPS
  const alpha = 0.12 + 0.45 * e
  const lineWidth = 0.8 + 1.8 * e
  return {
    stroke: `rgba(140,195,255,${alpha.toFixed(3)})`,
    lineWidth,
    glow: glowPasses('61,139,255', alpha, lineWidth, 3 + 12 * e),
  }
})

/** The fill follows the product of energy and depth, so it gets its own ramp of the same size. */
const ENERGY_FILLS: readonly string[] = Array.from(
  { length: ENERGY_STEPS },
  (_, i) => `rgba(60,140,255,${(0.02 + (0.15 * (i + 0.5)) / ENERGY_STEPS).toFixed(3)})`,
)

function addPolygon(path: Path2D, points: readonly Point[]): void {
  for (const [i, point] of points.entries()) {
    if (i === 0) path.moveTo(point[0], point[1])
    else path.lineTo(point[0], point[1])
  }
  path.closePath()
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

/** The part of the mask canvas that carries anything, in mask pixels. */
export type MaskExtent = { x: number; y: number; w: number; h: number }

/**
 * Paints the keep-out mask over the bled canvas box and returns the box it actually covered. The
 * blur eats into the rectangle from both sides, so the rectangle is grown by the feather before it
 * is drawn, and the extent adds the blur's own spread on top.
 */
export function buildKeepOut(
  mask: HTMLCanvasElement,
  W: number,
  H: number,
  ko: Rect | null,
): MaskExtent | null {
  const [bx, by] = bleedOf(W, H)
  // The same rounding `sizeCanvas` applies, so the mask cannot end up a pixel short of the canvas.
  mask.width = Math.round(W + 2 * bx)
  mask.height = Math.round(H + 2 * by)
  if (!ko) return null
  const g = mask.getContext('2d')
  if (!g) return null
  g.setTransform(1, 0, 0, 1, bx, by)
  const o = KO_FEATHER
  const sigma = KO_FEATHER / 2
  g.filter = `blur(${sigma}px)`
  g.fillStyle = '#000'
  g.fillRect(ko.left - o, ko.top - o, ko.right - ko.left + o * 2, ko.bottom - ko.top + o * 2)
  g.filter = 'none'
  // Three sigma leaves under one part in 255 of the fill, and two more pixels cover the rounding.
  const spread = Math.ceil(3 * sigma) + 2
  const x0 = Math.max(0, Math.floor(ko.left - o + bx - spread))
  const y0 = Math.max(0, Math.floor(ko.top - o + by - spread))
  const x1 = Math.min(mask.width, Math.ceil(ko.right + o + bx + spread))
  const y1 = Math.min(mask.height, Math.ceil(ko.bottom + o + by + spread))
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Erases the copy column from the canvas. The mask is transparent outside its extent, so the punch
 * reads and blends that box only instead of the whole surface.
 */
export function punchKeepOut(
  g: CanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  extent: MaskExtent | null,
  bleed: Point,
  offset: Point,
): void {
  if (!extent) return
  g.globalCompositeOperation = 'destination-out'
  g.drawImage(
    mask,
    extent.x,
    extent.y,
    extent.w,
    extent.h,
    offset[0] - bleed[0] + extent.x,
    offset[1] - bleed[1] + extent.y,
    extent.w,
    extent.h,
  )
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

/** What the two mask gradients leave of a cell at a canvas point, as the two factors. */
export function maskFactors(
  scene: Calibrated,
  x: number,
  y: number,
): { fade: number; radial: number } {
  const m = maskGeometry(scene)
  const fade = Math.min(1, Math.max(0.04, 0.04 + (0.96 * (y - m.fy0)) / (m.fy1 - m.fy0)))
  const dist = Math.hypot(x - m.cx, y - m.cy)
  return { fade, radial: Math.min(1, Math.max(0, 1 - (dist - m.r0) / (m.r1 - m.r0))) }
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

/**
 * Everything the grid canvas, the keep-out mask and the sparkles are derived from. Two builds with
 * the same signature produce the same plate, so the second one can be skipped. Rounded to whole
 * pixels: a sub-pixel box change moves nothing that is visible, and it is exactly the noise a
 * `ResizeObserver` reports when only a scrollbar or a font swap touches the layout.
 */
export function buildSignature(
  mode: string,
  W: number,
  H: number,
  dpr: number,
  ko: Rect | null,
): string {
  const column = ko
    ? `${Math.round(ko.left)},${Math.round(ko.top)},${Math.round(ko.right)},${Math.round(ko.bottom)}`
    : 'none'
  return `${mode}|${Math.round(W)}|${Math.round(H)}|${dpr}|${column}`
}

/** Draws the static grid into its own canvas and records what the build cost. */
export function buildGrid(
  g: CanvasRenderingContext2D,
  scene: Calibrated,
  s: number,
  mask: HTMLCanvasElement,
  maskExtent: MaskExtent | null,
  koOffset: Point,
): GridBuild {
  const { W, H } = scene
  const started = performance.now()
  let drawn = 0
  const [bx, by] = bleedOf(W, H)
  clearAll(g)
  g.globalCompositeOperation = 'lighter'
  const q0 = Math.floor(scene.PU_MIN / (1.5 * s)) - 1
  const q1 = Math.ceil(scene.PU_MAX / (1.5 * s)) + 1
  const kk = s * Math.sqrt(3)
  g.shadowColor = '#2f7dff'
  let step = -1
  let style = FAR_STYLE
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
      // A cell narrower than this is texture, not a hexagon, and only costs build time.
      if (Math.abs(points[0][0] - points[3][0]) < MIN_HEX_PX) continue
      const d = depth(scene, centre[1])
      const next = Math.min(DEPTH_STEPS - 1, (d * DEPTH_STEPS) | 0)
      if (next !== step) {
        step = next
        style = DEPTH_STYLES[next] ?? FAR_STYLE
        g.strokeStyle = style.stroke
        g.lineWidth = style.lineWidth
        g.fillStyle = style.dot
      }
      tracePolygon(g, points)
      // The glow and the vertex dots are what make the build expensive, and neither reads at the
      // far end, so distant cells are a plain hairline.
      if (d > FAR_PLAIN) {
        g.shadowBlur = style.blur
        g.stroke()
        g.shadowBlur = 0
        const rr = style.dotRadius
        // One path for the six dots of this cell, but not one across cells: neighbouring cells put
        // a dot on the same lattice vertex, and under `'lighter'` those add.
        g.beginPath()
        for (const [x, y] of points) {
          // Without the moveTo the arcs are joined by a line.
          g.moveTo(x + rr, y)
          g.arc(x, y, rr, 0, 6.29)
        }
        g.fill()
      } else {
        g.stroke()
      }
      drawn += 1
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
  punchKeepOut(g, mask, maskExtent, [bx, by], koOffset)
  return {
    litCells: pickLitCells(scene, s),
    cells: drawn,
    buildMs: Number((performance.now() - started).toFixed(1)),
  }
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
  maskExtent: MaskExtent | null
  glows: GlowSprites
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

  for (const [i, sparkle] of input.sparkles.entries()) {
    const osc = reduced
      ? 0.35
      : 0.22 + 0.28 * (0.5 + 0.5 * Math.sin((t / 1000) * sparkle.sp + sparkle.ph))
    drawGlow(ctx, input.glows.sparkle[i], sparkle.x, sparkle.y, osc * (0.45 + 0.55 * sparkle.d))
  }
  ctx.globalAlpha = 1

  for (const lit of input.litCells) {
    const centre = centerOf(lit.q, lit.r, input.focus.s)
    const d = depth(scene, centre[1])
    const osc = reduced ? 0.7 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((t / 1000) * lit.sp + lit.ph))
    tracePolygon(ctx, hexPts(scene, centre[0], centre[1], input.focus.s * 0.985))
    ctx.fillStyle = `rgba(60,140,255,${((0.05 + 0.11 * d) * osc).toFixed(3)})`
    ctx.fill()
  }

  // The patch is collected into one path per step of the ramp. Addition is commutative, so the
  // cells may be reordered freely, and the whole pass then costs a few state changes.
  const fillPaths: (Path2D | undefined)[] = []
  const strokePaths: (Path2D | undefined)[] = []
  for (const cell of input.energy.cells.values()) {
    const centre = centerOf(cell.q, cell.r, input.focus.s)
    if (centre[0] < scene.PU_MIN || centre[0] > scene.PU_MAX) continue
    if (centre[1] < scene.PV_MIN2 || centre[1] > scene.PV_MAX2) continue
    const screen = screenOf(scene, centre[0], centre[1])
    if (inKeepOut(input.ko, screen[0], screen[1], 0)) continue
    const e = cell.e
    const d = depth(scene, centre[1])
    const hex = new Path2D()
    addPolygon(hex, hexPts(scene, centre[0], centre[1], input.focus.s * 0.985))
    const fillStep = Math.min(ENERGY_STEPS - 1, (e * d * ENERGY_STEPS) | 0)
    const strokeStep = Math.min(ENERGY_STEPS - 1, (e * ENERGY_STEPS) | 0)
    const intoFill = fillPaths[fillStep] ?? new Path2D()
    intoFill.addPath(hex)
    fillPaths[fillStep] = intoFill
    const intoStroke = strokePaths[strokeStep] ?? new Path2D()
    intoStroke.addPath(hex)
    strokePaths[strokeStep] = intoStroke
  }
  // The step from an unlit cell to a lit one is what read as a slab, so the fill peak is low and
  // most of the highlight is carried by the outline and its glow.
  for (const [i, colour] of ENERGY_FILLS.entries()) {
    const path = fillPaths[i]
    if (!path) continue
    ctx.fillStyle = colour
    ctx.fill(path)
  }
  for (const [i, style] of ENERGY_STYLES.entries()) {
    const path = strokePaths[i]
    if (!path) continue
    for (const pass of style.glow) {
      ctx.strokeStyle = pass.colour
      ctx.lineWidth = pass.lineWidth
      ctx.stroke(path)
    }
    ctx.strokeStyle = style.stroke
    ctx.lineWidth = style.lineWidth
    ctx.stroke(path)
  }

  const { cu, cv, s } = input.focus
  const fd = depth(scene, cv)
  const fp = hexPts(scene, cu, cv, s)
  tracePolygon(ctx, fp)
  const focusWidth = 1.5 + 1.1 * fd
  for (const pass of glowPasses('108,180,255', input.breath, focusWidth, 9 + 9 * fd)) {
    ctx.strokeStyle = pass.colour
    ctx.lineWidth = pass.lineWidth
    ctx.stroke()
  }
  ctx.strokeStyle = `rgba(168,212,255,${input.breath.toFixed(3)})`
  ctx.lineWidth = focusWidth
  ctx.stroke()

  const step = glowStep(fd)
  const vertexAlpha = (0.55 + 0.35 * fd) * input.breath
  for (const [x, y] of fp) drawGlow(ctx, input.glows.vertex[step], x, y, vertexAlpha)
  const centreScreen = screenOf(scene, cu, cv)
  drawGlow(ctx, input.glows.centre[step], centreScreen[0], centreScreen[1], 0.95)
  ctx.globalAlpha = 1

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
  punchKeepOut(ctx, input.mask, input.maskExtent, [bx, by], input.koOffset)
  return fp
}

export function drawLeader(
  g: CanvasRenderingContext2D,
  hexAnchor: Point,
  cardAnchor: Point,
  docked: boolean,
): void {
  g.save()
  g.strokeStyle = 'rgba(180,215,255,0.95)'
  g.lineWidth = docked ? 2.2 : 1.8
  g.shadowColor = '#3d8bff'
  g.shadowBlur = 10
  g.beginPath()
  g.moveTo(hexAnchor[0], hexAnchor[1])
  g.lineTo(cardAnchor[0], cardAnchor[1])
  g.stroke()
  g.fillStyle = 'rgba(190,220,255,0.85)'
  g.beginPath()
  g.arc(hexAnchor[0], hexAnchor[1], 3, 0, 6.29)
  g.fill()
  g.beginPath()
  g.arc(cardAnchor[0], cardAnchor[1], 2.5, 0, 6.29)
  g.fill()
  g.restore()
}
