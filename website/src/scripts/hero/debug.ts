import {
  centerOf,
  depth,
  inCopyColumn,
  type Point,
  planeOf,
  proj,
  type Rect,
  screenOf,
} from './geometry'
import { createLayerState, layerMatrix, PARA_REF_W, type Preset } from './parallax'
import { bleedOf, maskFactors } from './render'
import { BLEED, type Calibrated, type Mode } from './scene'

/** Everything the probes read, taken from the running loop. */
export type ProbeState = {
  stage: HTMLElement
  canvas: HTMLCanvasElement
  grid: HTMLCanvasElement
  preset: Preset
  sTarget: number
  mode: Mode
  scene: Calibrated
  dpr: number
  focusQ: number
  focusR: number
  koOffset: Point
  column: Rect | null
  gridCells: number
  gridMs: number
}

/**
 * Installs the five inspection probes on `window`, behind the `heroDebug` query flag.
 *
 * The context is read once per probe call, so a probe never answers from a stale frame.
 */
export function installProbes(ctx: () => ProbeState): void {
  const probes = window as unknown as Record<string, unknown>
  probes.heroSpec = () => {
    const { mode, scene, gridCells, gridMs } = ctx()
    return {
      mode,
      W: scene.W,
      H: scene.H,
      VS: Number(scene.VS.toFixed(5)),
      PU_MIN: Number(scene.PU_MIN.toFixed(3)),
      PU_MAX: Number(scene.PU_MAX.toFixed(3)),
      PV_MIN2: Number(scene.PV_MIN2.toFixed(3)),
      PV_MAX2: Number(scene.PV_MAX2.toFixed(3)),
      PVMIN: Number(scene.PVMIN.toFixed(3)),
      PVMAX: Number(scene.PVMAX.toFixed(3)),
      clampU: scene.clampU.map((n) => Number(n.toFixed(3))),
      clampV: scene.clampV.map((n) => Number(n.toFixed(3))),
      horizonY: Number(scene.horizonY.toFixed(1)),
      fy0: Number(scene.fy0.toFixed(1)),
      fy1: Number(scene.fy1.toFixed(1)),
      cells: gridCells,
      buildMs: gridMs,
    }
  }
  // Why a point on the plate is dark: is a cell built there at all, and what do the two
  // gradients leave of it. Stage-local canvas points in, factors out.
  probes.heroField = (pts: readonly Point[]) => {
    const { scene } = ctx()
    return pts.map((p) => {
      const plane = planeOf(scene, p[0], p[1])
      const { fade, radial } = maskFactors(scene, p[0], p[1])
      const d = depth(scene, plane[1])
      return {
        canvas: [Math.round(p[0]), Math.round(p[1])],
        pu: Number(plane[0].toFixed(2)),
        pv: Number(plane[1].toFixed(2)),
        inU: plane[0] >= scene.PU_MIN && plane[0] <= scene.PU_MAX,
        inV: plane[1] >= scene.PV_MIN2 && plane[1] <= scene.PV_MAX2,
        depth: Number(d.toFixed(3)),
        fade: Number(fade.toFixed(3)),
        radial: Number(radial.toFixed(3)),
        product: Math.round((0.13 + 0.21 * d) * fade * radial * 255),
      }
    })
  }
  // The plate is offscreen, so this reads back even when the tab is not the visible one.
  probes.heroRegion = (x0: number, x1: number, y0: number, y1: number) => {
    const { scene, grid, dpr } = ctx()
    const [bx, by] = bleedOf(scene.W, scene.H)
    const g = grid.getContext('2d')
    if (!g) return null
    const cx0 = Math.max(0, Math.round((x0 + bx) * dpr))
    const cx1 = Math.min(grid.width, Math.round((x1 + bx) * dpr))
    const cy0 = Math.max(0, Math.round((y0 + by) * dpr))
    const cy1 = Math.min(grid.height, Math.round((y1 + by) * dpr))
    // A rectangle off the plate clamps to nothing, which `getImageData` refuses.
    if (cx1 <= cx0 || cy1 <= cy0) return null
    const data = g.getImageData(cx0, cy0, cx1 - cx0, cy1 - cy0).data
    const n = data.length / 4
    let over = 0
    let max = 0
    for (let i = 0; i < n; i++) {
      const a = data[i * 4 + 3] ?? 0
      if (a > max) max = a
      if (a > 20) over += 1
    }
    return {
      canvasRect: [cx0, cy0, cx1, cy1],
      px: n,
      maxAlpha: max,
      pctOver20: Number(((100 * over) / n).toFixed(2)),
    }
  }
  probes.heroFocus = () => {
    const { scene, sTarget, focusQ, focusR, koOffset, column } = ctx()
    const centre = centerOf(focusQ, focusR, sTarget)
    const screen = screenOf(scene, centre[0], centre[1])
    return {
      q: focusQ,
      r: focusR,
      canvas: [Number(screen[0].toFixed(1)), Number(screen[1].toFixed(1))],
      koOffset: koOffset.map((n) => Number(n.toFixed(1))),
      inCopyColumn: inCopyColumn(column, screen[0], screen[1]),
    }
  }
  // How far the canvas covers the stage for each pointer corner, per edge, in CSS pixels.
  // A positive number is a strip of bare stage the canvas does not reach.
  probes.heroBleed = (bleed: number = BLEED) => {
    const { stage, canvas, preset } = ctx()
    const rect = stage.getBoundingClientRect()
    const amp = Math.min(1.5, Math.max(0.5, rect.width / PARA_REF_W))
    const cw = rect.width * (1 + 2 * bleed)
    const ch = rect.height * (1 + 2 * bleed)
    const worst = { left: -1e9, right: -1e9, top: -1e9, bottom: -1e9 }
    const spots: Point[] = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]
    const rows = spots.map((n) => {
      const state = createLayerState()
      state.terX = preset.terrain * preset.tSign * amp * n[0]
      state.terY = preset.terrain * preset.tSign * amp * n[1]
      state.tiltX = -preset.tilt * n[1]
      state.tiltY = preset.tilt * n[0]
      const m = layerMatrix(state)
      const corners: Point[] = [
        [-cw / 2, -ch / 2],
        [cw / 2, -ch / 2],
        [cw / 2, ch / 2],
        [-cw / 2, ch / 2],
      ]
      const mapped = corners.map((c) => proj(m, c[0], c[1]))
      const gap = {
        left: Math.max(mapped[0]?.[0] ?? 0, mapped[3]?.[0] ?? 0) + rect.width / 2,
        right: rect.width / 2 - Math.min(mapped[1]?.[0] ?? 0, mapped[2]?.[0] ?? 0),
        top: Math.max(mapped[0]?.[1] ?? 0, mapped[1]?.[1] ?? 0) + rect.height / 2,
        bottom: rect.height / 2 - Math.min(mapped[2]?.[1] ?? 0, mapped[3]?.[1] ?? 0),
      }
      for (const key of ['left', 'right', 'top', 'bottom'] as const) {
        if (gap[key] > worst[key]) worst[key] = gap[key]
      }
      return { pointer: n, gap }
    })
    return {
      bleed,
      canvasCss: [cw, ch],
      canvasPx: [canvas.width, canvas.height],
      worstGap: worst,
      rows,
    }
  }
}
