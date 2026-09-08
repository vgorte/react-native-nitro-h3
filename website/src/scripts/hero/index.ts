import { createEnergy, decayEnergy, markPatch } from './energy'
import {
  axialAt,
  type ClearContext,
  centerOf,
  copyColumn,
  depth,
  escapeKeepOut,
  inCopyColumn,
  type Point,
  planeOf,
  proj,
  pushOut,
  RES,
  type Rect,
  SIZES,
  screenOf,
  shiftRect,
  slideRight,
} from './geometry'
import { attachInput, createHint } from './input'
import {
  cloudTransform,
  createLayerState,
  layerMatrix,
  PARA_REF_W,
  PRESETS,
  stepParallax,
  terrainTransform,
  toCanvas,
  toStagePoint,
} from './parallax'
import { bakeCloudPlate, CLOUD_PLATE } from './plates'
import { anchorCard, leaderAnchors, type ReadoutElements, segBox, updateReadout } from './readout'
import {
  bleedOf,
  buildGrid,
  buildKeepOut,
  buildSignature,
  drawLeader,
  drawScene,
  type GlowSprites,
  type LitCell,
  type MaskExtent,
  makeGlows,
  makeSparkles,
  maskFactors,
  type Pulse,
  type Sparkle,
  sizeCanvas,
} from './render'
import { type Calibrated, calibrate, type Mode, pickMode, SCENES } from './scene'

const RESIZE_DEBOUNCE_MS = 150
const BREATH_RAMP_MS = 600
const PULSE_MS = 620
const PERF_SAMPLE = 300
const DPR_CAP = 1

export function start(): void {
  const stage = document.querySelector<HTMLElement>('.nh3-hero')
  const canvas = document.querySelector<HTMLCanvasElement>('.nh3-fx')
  const copy = document.querySelector<HTMLElement>('.nh3-copy')
  const card = document.querySelector<HTMLElement>('.nh3-readout')
  const hintEl = document.querySelector<HTMLElement>('.nh3-hint')
  const announceEl = document.querySelector<HTMLElement>('.nh3-announce')
  const terrainLayer = document.querySelector<HTMLElement>('.nh3-terrain')
  const cloudLayer = document.querySelector<HTMLElement>('.nh3-clouds')
  if (!stage || !canvas || !copy || !card || !terrainLayer || !cloudLayer) return
  const call = card.querySelector<HTMLElement>('.nh3-call')
  const idOut = card.querySelector<HTMLElement>('.nh3-id')
  if (!call || !idOut) return
  const readoutEls: ReadoutElements = { card, call, id: idOut, announce: announceEl }
  const cloudSource = document.querySelector<HTMLImageElement>('.nh3-cloud-source')
  const cloudPlate = document.querySelector<HTMLImageElement>('.nh3-cloud-plate')

  const params = new URLSearchParams(location.search)
  const perfLog = params.get('heroPerf') === '1'
  const debug = params.get('heroDebug') === '1'
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  let plateUrl: string | null = null
  const bake = (): void => {
    if (!cloudSource || !cloudPlate) return
    void bakeCloudPlate(cloudSource, CLOUD_PLATE).then(
      (url) => {
        if (plateUrl) URL.revokeObjectURL(plateUrl)
        plateUrl = url
        cloudPlate.src = url
      },
      // The stage never depends on the plate, so a failed bake leaves the layer empty and says so.
      (error: unknown) => {
        console.warn('the hero cloud plate did not bake', error)
      },
    )
  }
  if (cloudSource) {
    if (cloudSource.complete) bake()
    else cloudSource.addEventListener('load', bake, { once: true })
  }

  const grid = document.createElement('canvas')
  const mask = document.createElement('canvas')
  const hint = createHint(hintEl)

  let mode: Mode = pickMode(params)
  let scene: Calibrated = calibrate(SCENES[mode], 1, 1)
  let dpr = 1
  const layers = createLayerState()
  // `tilt` unless the performance gate fails, in which case this becomes `PRESETS.follow`.
  const PRESET = PRESETS.tilt
  let pointNX = 0
  let pointNY = 0
  let koOffset: Point = [0, 0]
  /** `ko` is the column at rest; `column` is it in canvas space, shifted once per frame. */
  let column: Rect | null = null
  let ctx: CanvasRenderingContext2D | null = null
  let ko: Rect | null = null
  /** The part of the mask canvas the punch has to composite. Null while there is no column. */
  let maskExtent: MaskExtent | null = null
  let litCells: LitCell[] = []
  let gridCells = 0
  let gridMs = 0
  let sparkles: Sparkle[] = []
  /** Baked with the sparkles, and only ever read after a rebuild has produced a context. */
  let glows: GlowSprites = { sparkle: [], vertex: [], centre: [] }
  const pulses: Pulse[] = []
  let energy = createEnergy()
  let focusQ = 0
  let focusR = 0
  let shownQ = Number.NaN
  let shownR = Number.NaN
  const sTarget: number = SIZES[RES]
  let sCur: number = SIZES[RES]
  let curU = 0
  let curV = 0
  let onStage = false
  let leftStageAt = performance.now()
  let cardX: number | null = null
  let cardY: number | null = null
  let cardSide: 1 | -1 = 1
  let lastT = 0
  let resetT = true
  /** The signature of the plate currently on the grid canvas. Empty until the first build. */
  let buildSig = ''
  let openingPending = false
  let raf = 0
  let frames = 0
  let costSum = 0

  const rectIn = (r: DOMRect, stageRect: DOMRect): Rect => ({
    left: r.left - stageRect.left,
    top: r.top - stageRect.top,
    right: r.right - stageRect.left,
    bottom: r.bottom - stageRect.top,
  })

  const rectOf = (el: Element, stageRect: DOMRect): Rect =>
    rectIn(el.getBoundingClientRect(), stageRect)

  /** The single place the layer offset is applied to the keep-out. */
  const shiftColumn = (): void => {
    column = ko ? shiftRect(ko, koOffset[0], koOffset[1]) : null
  }

  const clearContext = (): ClearContext => ({
    plane: scene,
    s: sTarget,
    ko: column,
    W: scene.W,
    H: scene.H,
  })

  /** The opening cell: the plane origin, pushed clear of the keep-out, with the readout written. */
  const placeOpening = (): void => {
    const pu = Math.min(Math.max(0, scene.clampU[0]), scene.clampU[1])
    const pv = Math.min(Math.max(0, scene.clampV[0]), scene.clampV[1])
    const opening = screenOf(scene, pu, pv)
    const axial = axialAt(pu, pv, sTarget)
    const start0 = pushOut(clearContext(), axial[0], axial[1], opening[0], opening[1])
    focusQ = start0[0]
    focusR = start0[1]
    const centre = centerOf(focusQ, focusR, sTarget)
    curU = centre[0]
    curV = centre[1]
    sCur = sTarget
    // A mode change and the first paint are not deliberate changes, so neither is announced.
    shownQ = focusQ
    shownR = focusR
    updateReadout(readoutEls, focusQ, focusR, false)
  }

  /** False when the stage has no layout yet, in which case the scene stays the placeholder. */
  const rebuild = (): boolean => {
    const stageRect = stage.getBoundingClientRect()
    if (stageRect.width < 1 || stageRect.height < 1) return false
    const nextDpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
    const nextKo = copyColumn(rectOf(copy, stageRect))
    // All three rebuild triggers stay; a trigger that reports the same box does no work twice.
    const sig = buildSignature(mode, stageRect.width, stageRect.height, nextDpr, nextKo)
    if (sig === buildSig) return true
    buildSig = sig
    dpr = nextDpr
    scene = calibrate(SCENES[mode], stageRect.width, stageRect.height)
    ctx = sizeCanvas(canvas, scene.W, scene.H, dpr)
    const gridCtx = sizeCanvas(grid, scene.W, scene.H, dpr)
    ko = nextKo
    shiftColumn()
    maskExtent = buildKeepOut(mask, scene.W, scene.H, ko)
    sparkles = makeSparkles(scene)
    glows = makeGlows(sparkles, dpr)
    // The hole is baked at the column's rest position. The layer moves it by at most 8 px, which
    // lies inside the 40 px feather, and the per-frame punch carries the live offset.
    const build = buildGrid(gridCtx, scene, sTarget, mask, maskExtent, [0, 0])
    litCells = build.litCells
    gridCells = build.cells
    gridMs = build.buildMs
    if (openingPending) {
      openingPending = false
      placeOpening()
    }
    return true
  }

  const refreshReadout = (announce: boolean): void => {
    if (!announce && focusQ === shownQ && focusR === shownR) return
    shownQ = focusQ
    shownR = focusR
    updateReadout(readoutEls, focusQ, focusR, announce)
  }

  const applyMode = (next: Mode): void => {
    mode = next
    stage.classList.toggle('mob', next === 'mob')
    energy = createEnergy()
    layers.terX = 0
    layers.terY = 0
    layers.cloX = 0
    layers.cloY = 0
    layers.tiltX = 0
    layers.tiltY = 0
    layers.idleX = 0
    layers.idleY = 0
    // Every component is zero on the line above, so the forward matrix is the identity and is
    // its own inverse.
    layers.inverse = layerMatrix(layers)
    koOffset = [0, 0]
    cardX = null
    cardY = null
    cardSide = 1
    card.style.left = ''
    card.style.top = ''
    // The mode is part of the signature; this is what also carries the reset state into the plate.
    buildSig = ''
    const ready = rebuild()
    placeOpening()
    // Without a laid out stage the opening cell came from the placeholder scene, so the first
    // rebuild that calibrates places it again.
    openingPending = !ready
  }

  /** The one canvas point to focus cell path. The pointer and the keyboard both go through it. */
  const resolveFocus = (px: number, py: number): void => {
    const escaped = escapeKeepOut(column, px, py)
    const x = escaped[0]
    const y = Math.max(escaped[1], scene.horizonY)
    const plane = planeOf(scene, x, y)
    const pu = Math.min(Math.max(plane[0], scene.clampU[0]), scene.clampU[1])
    const pv = Math.min(Math.max(plane[1], scene.clampV[0]), scene.clampV[1])
    const axial = axialAt(pu, pv, sTarget)
    const slid = slideRight(clearContext(), axial[0], axial[1])
    const cell = pushOut(clearContext(), slid[0], slid[1], x, y)
    focusQ = cell[0]
    focusR = cell[1]
  }

  const setFocusFromPoint = (clientX: number, clientY: number): void => {
    const stageRect = stage.getBoundingClientRect()
    const halfW = stageRect.width / 2
    const halfH = stageRect.height / 2
    pointNX = Math.max(-1, Math.min(1, (clientX - stageRect.left - halfW) / halfW))
    pointNY = Math.max(-1, Math.min(1, (clientY - stageRect.top - halfH) / halfH))
    const hit = toCanvas(layers.inverse, clientX, clientY, stageRect)
    resolveFocus(hit[0], hit[1])
  }

  const stepFocus = (dq: number, dr: number): void => {
    const centre = centerOf(focusQ + dq, focusR + dr, sTarget)
    const screen = screenOf(scene, centre[0], centre[1])
    resolveFocus(screen[0], screen[1])
  }

  const frame = (t: number): void => {
    const started = perfLog ? performance.now() : 0
    // A resumed tab or a clock adjustment can hand back a timestamp behind the last one.
    const dt = resetT ? 0.016 : Math.max(0, Math.min(0.05, (t - lastT) / 1000 || 0.016))
    resetT = false
    lastT = t
    if (!ctx) {
      raf = requestAnimationFrame(frame)
      return
    }

    const stageRect = stage.getBoundingClientRect()
    stepParallax(layers, {
      preset: PRESET,
      dt,
      t,
      stageWidth: stageRect.width,
      pointNX,
      pointNY,
      live: !reduced && !scene.dock,
      idle: !reduced,
      half: scene.dock,
      reduced,
    })
    // The copy block does not move with the layer, so its box enters canvas space the other way.
    koOffset = [-layers.terX, -layers.terY]
    shiftColumn()

    sCur += (sTarget - sCur) * (reduced ? 1 : Math.min(1, dt * 7))
    const centre = centerOf(focusQ, focusR, sCur)
    curU = centre[0]
    curV = centre[1]
    markPatch(energy, focusQ, focusR, scene.litR[RES])
    decayEnergy(energy, dt, scene.litCap, reduced)

    const breathMix = reduced || onStage ? 0 : Math.min(1, (t - leftStageAt) / BREATH_RAMP_MS)
    const breath = 1 - breathMix * 0.45 * (0.5 - 0.5 * Math.sin((t / 2600) * 6.2832))

    const fp = drawScene({
      ctx,
      grid,
      mask,
      maskExtent,
      glows,
      scene,
      ko: column,
      koOffset,
      energy,
      sparkles,
      litCells,
      pulses,
      focus: { cu: curU, cv: curV, s: sCur },
      breath,
      t,
      reduced,
    })

    // The card rect is read before it is moved, so the leader trails by one frame instead of
    // forcing a synchronous layout.
    const cardClient = card.getBoundingClientRect()
    const cardRect = rectIn(cardClient, stageRect)
    const hintRect = hintEl && !hintEl.hidden ? rectOf(hintEl, stageRect) : null
    const copyRect = rectOf(copy, stageRect)
    ko = copyColumn(copyRect)
    const copyBox = shiftRect(copyRect, koOffset[0], koOffset[1])
    const hintBox = hintRect ? shiftRect(hintRect, koOffset[0], koOffset[1]) : null
    const cardWidth = cardRect.right - cardRect.left
    const cardHeight = cardRect.bottom - cardRect.top

    let cardBox: Rect
    if (scene.dock) {
      // The docked card is a fixed rectangle rather than something that follows the cell, so it
      // goes through the exact inverse instead of the translation-only offset.
      const tl = toCanvas(layers.inverse, cardClient.left, cardClient.top, stageRect)
      const br = toCanvas(layers.inverse, cardClient.right, cardClient.bottom, stageRect)
      cardBox = { left: tl[0], top: tl[1], right: br[0], bottom: br[1] }
    } else {
      const keepOuts: { box: Rect; push: 1 | -1 }[] = [{ box: copyBox, push: 1 }]
      if (hintBox) keepOuts.push({ box: hintBox, push: -1 })
      const centreScreen = screenOf(scene, curU, curV)
      const anchor = anchorCard({
        fp,
        cellCenterX: centreScreen[0],
        W: scene.W,
        H: scene.H,
        cardWidth,
        cardHeight,
        hint: hintBox,
        copy: copyBox,
        keepOuts,
      })
      cardSide = anchor.side
      if (cardX === null || cardY === null) {
        cardX = anchor.x
        cardY = anchor.y
      }
      const k = reduced ? 1 : Math.min(1, dt * 9)
      cardX += (anchor.x - cardX) * k
      cardY += (anchor.y - cardY) * k
      const placed = toStagePoint(layers, cardX, cardY, stageRect)
      card.style.left = `${placed[0]}px`
      card.style.top = `${placed[1]}px`
      cardBox = { left: cardX, top: cardY, right: cardX + cardWidth, bottom: cardY + cardHeight }
    }

    const anchors = leaderAnchors(fp, cardBox, cardSide, scene.dock)
    const hex = anchors.hex
    const tip = anchors.card
    if (debug && segBox(hex[0], hex[1], tip[0], tip[1], copyBox)) {
      console.warn('leader crosses the copy block', { focusQ, focusR, hex, card: tip })
    }
    drawLeader(ctx, hex, tip, scene.dock)

    terrainLayer.style.transform = terrainTransform(layers, PRESET.tilt > 0)
    cloudLayer.style.transform = cloudTransform(layers)

    if (perfLog) {
      costSum += performance.now() - started
      frames += 1
      if (frames % PERF_SAMPLE === 0) {
        console.log(`hero frames ${frames}, mean ${(costSum / PERF_SAMPLE).toFixed(3)} ms`)
        costSum = 0
      }
    }
    raf = requestAnimationFrame(frame)
  }

  const stop = (): void => {
    if (!raf) return
    cancelAnimationFrame(raf)
    raf = 0
  }
  const play = (): void => {
    if (raf) return
    resetT = true
    raf = requestAnimationFrame(frame)
  }

  let visible = !document.hidden
  let onScreen = true
  const sync = (): void => {
    if (visible && onScreen) play()
    else stop()
  }
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden
    sync()
  })
  new IntersectionObserver(
    (entries) => {
      for (const entry of entries) onScreen = entry.isIntersecting
      sync()
    },
    { threshold: 0 },
  ).observe(stage)

  let resizeTimer = 0
  const onResize = (): void => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      const next = pickMode(new URLSearchParams(location.search))
      if (next !== mode) applyMode(next)
      else rebuild()
    }, RESIZE_DEBOUNCE_MS)
  }
  window.addEventListener('resize', onResize)
  // The stage can gain its size from a layout change that never resizes the window.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(stage)
  // The copy block changes size when the web fonts land, so the keep-out is measured again.
  void document.fonts.ready.then(() => {
    rebuild()
  })

  attachInput(
    stage,
    {
      setFocusFromPoint,
      stepFocus,
      updateReadout: refreshReadout,
      pulse: () => {
        pulses.push({ t: performance.now(), a: 1, d: PULSE_MS })
      },
      setOnStage: (on) => {
        if (on === onStage) return
        onStage = on
        if (!on) leftStageAt = performance.now()
      },
      clearPointer: () => {
        pointNX = 0
        pointNY = 0
      },
      isDocked: () => scene.dock,
      reduced,
    },
    hint,
  )

  if (debug) {
    const probes = window as unknown as Record<string, unknown>
    probes.heroSpec = () => ({
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
    })
    // Why a point on the plate is dark: is a cell built there at all, and what do the two
    // gradients leave of it. Stage-local canvas points in, factors out.
    probes.heroField = (pts: readonly Point[]) =>
      pts.map((p) => {
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
    // The plate is offscreen, so this reads back even when the tab is not the visible one.
    probes.heroRegion = (x0: number, x1: number, y0: number, y1: number) => {
      const [bx, by] = bleedOf(scene.W, scene.H)
      const g = grid.getContext('2d')
      if (!g) return null
      const cx0 = Math.max(0, Math.round((x0 + bx) * dpr))
      const cx1 = Math.min(grid.width, Math.round((x1 + bx) * dpr))
      const cy0 = Math.max(0, Math.round((y0 + by) * dpr))
      const cy1 = Math.min(grid.height, Math.round((y1 + by) * dpr))
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
    probes.heroBleed = (bleed: number) => {
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
        state.terX = PRESET.terrain * PRESET.tSign * amp * n[0]
        state.terY = PRESET.terrain * PRESET.tSign * amp * n[1]
        state.tiltX = -PRESET.tilt * n[1]
        state.tiltY = PRESET.tilt * n[0]
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

  applyMode(mode)
  play()
}
