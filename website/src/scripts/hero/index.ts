import { createEnergy, decayEnergy, markPatch } from './energy'
import {
  axialAt,
  type ClearContext,
  centerOf,
  copyColumn,
  escapeKeepOut,
  type Point,
  planeOf,
  pushOut,
  RES,
  type Rect,
  SIZES,
  screenOf,
  shiftRect,
  slideRight,
} from './geometry'
import { attachInput, createHint } from './input'
import { anchorCard, leaderAnchors, type ReadoutElements, updateReadout } from './readout'
import {
  buildGrid,
  buildKeepOut,
  drawLeader,
  drawScene,
  type LitCell,
  makeSparkles,
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
  if (!stage || !canvas || !copy || !card) return
  const call = card.querySelector<HTMLElement>('.nh3-call')
  const idOut = card.querySelector<HTMLElement>('.nh3-id')
  if (!call || !idOut) return
  const readoutEls: ReadoutElements = { card, call, id: idOut, announce: announceEl }

  const params = new URLSearchParams(location.search)
  const perfLog = params.get('heroPerf') === '1'
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  const grid = document.createElement('canvas')
  const mask = document.createElement('canvas')
  const hint = createHint(hintEl)

  let mode: Mode = pickMode(params)
  let scene: Calibrated = calibrate(SCENES[mode], 1, 1)
  let dpr = 1
  const koOffset: Point = [0, 0]
  /** `ko` is the column at rest; `column` is it in canvas space, shifted once per frame. */
  let column: Rect | null = null
  let ctx: CanvasRenderingContext2D | null = null
  let ko: Rect | null = null
  let litCells: LitCell[] = []
  let gridCells = 0
  let gridMs = 0
  let sparkles: Sparkle[] = []
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

  const rebuild = (): void => {
    const stageRect = stage.getBoundingClientRect()
    if (stageRect.width < 1 || stageRect.height < 1) return
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
    scene = calibrate(SCENES[mode], stageRect.width, stageRect.height)
    ctx = sizeCanvas(canvas, scene.W, scene.H, dpr)
    const gridCtx = sizeCanvas(grid, scene.W, scene.H, dpr)
    ko = copyColumn(rectOf(copy, stageRect))
    shiftColumn()
    buildKeepOut(mask, scene.W, scene.H, ko)
    sparkles = makeSparkles(scene)
    // The hole is baked at the column's rest position. The layer moves it by at most 8 px, which
    // lies inside the 40 px feather, and the per-frame punch carries the live offset.
    const build = buildGrid(gridCtx, scene, sTarget, mask, ko, [0, 0])
    litCells = build.litCells
    gridCells = build.cells
    gridMs = build.buildMs
  }

  const refreshReadout = (announce: boolean): void => {
    if (!announce && focusQ === shownQ && focusR === shownR) return
    shownQ = focusQ
    shownR = focusR
    updateReadout(readoutEls, focusQ, focusR, sTarget, announce)
  }

  const applyMode = (next: Mode): void => {
    mode = next
    stage.classList.toggle('mob', next === 'mob')
    energy = createEnergy()
    cardX = null
    cardY = null
    cardSide = 1
    card.style.left = ''
    card.style.top = ''
    rebuild()
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
    updateReadout(readoutEls, focusQ, focusR, sTarget, false)
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
    resolveFocus(clientX - stageRect.left, clientY - stageRect.top)
  }

  const stepFocus = (dq: number, dr: number): void => {
    const centre = centerOf(focusQ + dq, focusR + dr, sTarget)
    const screen = screenOf(scene, centre[0], centre[1])
    resolveFocus(screen[0], screen[1])
  }

  const frame = (t: number): void => {
    const started = perfLog ? performance.now() : 0
    const dt = resetT ? 0.016 : Math.min(0.05, (t - lastT) / 1000 || 0.016)
    resetT = false
    lastT = t
    if (!ctx) {
      raf = requestAnimationFrame(frame)
      return
    }

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

    // The two layout reads of the frame. The card rect is read before it is moved, so the leader
    // trails by one frame instead of forcing a synchronous layout.
    const stageRect = stage.getBoundingClientRect()
    const cardClient = card.getBoundingClientRect()
    const cardRect = rectIn(cardClient, stageRect)
    const hintRect = hintEl && !hintEl.hidden ? rectOf(hintEl, stageRect) : null

    if (!scene.dock) {
      const copyBox = rectOf(copy, stageRect)
      const keepOuts: { box: Rect; push: 1 | -1 }[] = [{ box: copyBox, push: 1 }]
      if (hintRect) keepOuts.push({ box: hintRect, push: -1 })
      const centreScreen = screenOf(scene, curU, curV)
      const anchor = anchorCard({
        fp,
        cellCenterX: centreScreen[0],
        W: scene.W,
        H: scene.H,
        cardWidth: cardRect.right - cardRect.left,
        cardHeight: cardRect.bottom - cardRect.top,
        hint: hintRect,
        keepOuts,
        copy: copyBox,
      })
      cardSide = anchor.side
      if (cardX === null || cardY === null) {
        cardX = anchor.x
        cardY = anchor.y
      }
      const k = reduced ? 1 : Math.min(1, dt * 9)
      cardX += (anchor.x - cardX) * k
      cardY += (anchor.y - cardY) * k
      card.style.left = `${cardX}px`
      card.style.top = `${cardY}px`
    }

    const anchors = leaderAnchors(fp, cardRect, cardSide, scene.dock)
    drawLeader(ctx, anchors.hex, anchors.card, scene.dock)

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
      isDocked: () => scene.dock,
      reduced,
    },
    hint,
  )

  applyMode(mode)
  play()
}
