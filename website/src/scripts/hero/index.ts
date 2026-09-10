import { createEnergy, decayEnergy, markPatch } from './energy'
import {
  axialAt,
  type ClearContext,
  cellUnderPoint,
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
  slideRight,
} from './geometry'
import { attachInput, createHint } from './input'
import {
  cloudTransform,
  createLayerState,
  layerMatrix,
  PRESETS,
  stepParallax,
  terrainTransform,
  toCanvas,
  toStagePoint,
} from './parallax'
import { anchorCard, leaderAnchors, type ReadoutElements, segBox, updateReadout } from './readout'
import {
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
  type Pulse,
  type Sparkle,
  sizeCanvas,
} from './render'
import { type Calibrated, calibrate, type Mode, pickMode, SCENES } from './scene'

const RESIZE_DEBOUNCE_MS = 150
const BREATH_RAMP_MS = 600
const PULSE_MS = 620
const PERF_SAMPLE = 300
// The plate is a full-stage canvas: at device ratio 2 it costs four times the fill for a grid of
// hairlines and glows that reads the same. Everything downstream may assume stage pixels.
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

  const params = new URLSearchParams(location.search)
  const perfLog = params.get('heroPerf') === '1'
  const debug = params.get('heroDebug') === '1'
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  const grid = document.createElement('canvas')
  const mask = document.createElement('canvas')
  const hint = createHint(hintEl)

  let mode: Mode = pickMode(params)
  let scene: Calibrated = calibrate(SCENES[mode], 1, 1)
  let dpr = 1
  const layers = createLayerState()
  // The tilted preset ships; this line is the only thing that chooses between the two.
  const PRESET = PRESETS.tilt
  let pointNX = 0
  let pointNY = 0
  let koOffset: Point = [0, 0]
  // `ko` is the column at rest; `column` is it in canvas space, shifted once per frame.
  let column: Rect | null = null
  // The rectangles the loop rewrites every frame instead of allocating. `columnRect` is the one
  // that outlives the frame, and it is the only rectangle `column` is ever allowed to point at.
  const columnRect: Rect = { left: 0, top: 0, right: 0, bottom: 0 }
  const cardScratch: Rect = { left: 0, top: 0, right: 0, bottom: 0 }
  const copyScratch: Rect = { left: 0, top: 0, right: 0, bottom: 0 }
  const hintScratch: Rect = { left: 0, top: 0, right: 0, bottom: 0 }
  const boxScratch: Rect = { left: 0, top: 0, right: 0, bottom: 0 }
  let ctx: CanvasRenderingContext2D | null = null
  let ko: Rect | null = null
  // The copy block and the hint pill in stage coordinates, both measured on a rebuild.
  let copyRect: Rect = { left: 0, top: 0, right: 0, bottom: 0 }
  let hintRect: Rect | null = null
  let hintHidden = true
  // The part of the mask canvas the punch has to composite. Null while there is no column.
  let maskExtent: MaskExtent | null = null
  let litCells: LitCell[] = []
  let gridCells = 0
  let gridMs = 0
  let sparkles: Sparkle[] = []
  // Baked with the sparkles, and only ever read after a rebuild has produced a context.
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
  // The signature of the plate currently on the grid canvas. Empty until the first build.
  let buildSig = ''
  // The last transform written to each layer, so an unchanged one is not written again.
  let lastTerrain = ''
  let lastClouds = ''
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

  // Writes a shifted copy of a rectangle into an existing one, so the loop allocates none.
  const intoRect = (out: Rect, r: Rect | DOMRect, dx: number, dy: number): Rect => {
    out.left = r.left + dx
    out.top = r.top + dy
    out.right = r.right + dx
    out.bottom = r.bottom + dy
    return out
  }

  // The single place the layer offset is applied to the keep-out.
  const shiftColumn = (): void => {
    column = ko ? intoRect(columnRect, ko, koOffset[0], koOffset[1]) : null
  }

  const clearContext = (): ClearContext => ({
    plane: scene,
    s: sTarget,
    ko: column,
    W: scene.W,
    H: scene.H,
  })

  // The opening cell: the plane origin, pushed clear of the keep-out, with the readout written.
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

  // False when the stage has no layout yet, in which case the scene stays the placeholder.
  const rebuild = (): boolean => {
    const stageRect = stage.getBoundingClientRect()
    if (stageRect.width < 1 || stageRect.height < 1) return false
    const nextDpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
    const nextCopy = rectOf(copy, stageRect)
    const nextKo = copyColumn(nextCopy)
    // All three rebuild triggers stay; a trigger that reports the same box does no work twice.
    const sig = buildSignature(mode, stageRect.width, stageRect.height, nextDpr, nextKo)
    if (sig === buildSig) return true
    buildSig = sig
    copyRect = nextCopy
    hintHidden = !hintEl || Boolean(hintEl.hidden)
    hintRect = hintHidden || !hintEl ? null : rectOf(hintEl, stageRect)
    dpr = nextDpr
    scene = calibrate(SCENES[mode], stageRect.width, stageRect.height)
    ctx = sizeCanvas(canvas, scene.W, scene.H, dpr)
    const gridCtx = sizeCanvas(grid, scene.W, scene.H, dpr)
    ko = nextKo
    shiftColumn()
    maskExtent = buildKeepOut(mask, scene.W, scene.H, ko)
    sparkles = makeSparkles(scene)
    glows = makeGlows(sparkles, dpr)
    // The hole is baked at the column's rest position. The layer moves it by at most 12 px, the
    // 8 px amplitude at the 1.5 cap, which lies inside the 40 px feather, and the per-frame punch
    // carries the live offset.
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
    // Every component was just zeroed, so the forward matrix is the identity and is its own
    // inverse.
    layers.matrix = layerMatrix(layers)
    layers.inverse = layers.matrix
    koOffset = [0, 0]
    cardX = null
    cardY = null
    cardSide = 1
    // The docked layout places the card from CSS, so the followed position has to go with the mode.
    card.style.transform = ''
    // The mode is part of the signature; this is what also carries the reset state into the plate.
    buildSig = ''
    const ready = rebuild()
    placeOpening()
    // Without a laid out stage the opening cell came from the placeholder scene, so the first
    // rebuild that calibrates places it again.
    openingPending = !ready
  }

  // The keyboard path. Arrow keys have to be able to leave the copy block, so a step that lands on
  // a blocked cell is carried out of the column and then to the nearest cell that renders whole.
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
    // A cell is selected only where the pointer really stands on it. Over the copy, past the far
    // limit or on a cell the copy cuts there is nothing to select, and the focus stays where it is.
    const cell = cellUnderPoint(scene, clearContext(), hit[0], hit[1])
    if (!cell) return
    focusQ = cell[0]
    focusR = cell[1]
  }

  const stepFocus = (dq: number, dr: number): void => {
    const centre = centerOf(focusQ + dq, focusR + dr, sTarget)
    const screen = screenOf(scene, centre[0], centre[1])
    resolveFocus(screen[0], screen[1])
  }

  const frame = (t: number): void => {
    const started = perfLog ? performance.now() : 0
    // A resumed tab or a clock adjustment can hand back a timestamp behind the last one.
    const step = Number.isFinite(t - lastT) ? (t - lastT) / 1000 : 0.016
    const dt = resetT ? 0.016 : Math.max(0, Math.min(0.05, step))
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
    // The copy block and the hint pill only move on a rebuild, so their boxes are cached there.
    // The pill's one other move is being hidden, and that is a property read, not a layout one.
    const nowHidden = !hintEl || Boolean(hintEl.hidden)
    if (nowHidden !== hintHidden) {
      hintHidden = nowHidden
      hintRect = nowHidden || !hintEl ? null : rectOf(hintEl, stageRect)
    }
    const copyBox = intoRect(copyScratch, copyRect, koOffset[0], koOffset[1])
    const hintBox = hintRect ? intoRect(hintScratch, hintRect, koOffset[0], koOffset[1]) : null

    let cardBox: Rect
    if (scene.dock) {
      // The docked card is a fixed rectangle rather than something that follows the cell, so it
      // goes through the exact inverse instead of the translation-only offset.
      const tl = toCanvas(layers.inverse, cardClient.left, cardClient.top, stageRect)
      const br = toCanvas(layers.inverse, cardClient.right, cardClient.bottom, stageRect)
      boxScratch.left = tl[0]
      boxScratch.top = tl[1]
      boxScratch.right = br[0]
      boxScratch.bottom = br[1]
      cardBox = boxScratch
    } else {
      const cardRect = intoRect(cardScratch, cardClient, -stageRect.left, -stageRect.top)
      const cardWidth = cardRect.right - cardRect.left
      const cardHeight = cardRect.bottom - cardRect.top
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
      // A transform, not `left` and `top`: the card carries a backdrop filter, and a layout
      // property would dirty layout for its subtree on every frame.
      card.style.transform = `translate3d(${placed[0].toFixed(1)}px,${placed[1].toFixed(1)}px,0)`
      boxScratch.left = cardX
      boxScratch.top = cardY
      boxScratch.right = cardX + cardWidth
      boxScratch.bottom = cardY + cardHeight
      cardBox = boxScratch
    }

    const anchors = leaderAnchors(fp, cardBox, cardSide, scene.dock)
    const hex = anchors.hex
    const tip = anchors.card
    // A standing diagnostic: the eased card motion can still take the leader across the copy block
    // at an extreme corner, and the flag is the only way to see it happen.
    if (debug && segBox(hex[0], hex[1], tip[0], tip[1], copyBox)) {
      console.warn('leader crosses the copy block', { focusQ, focusR, hex, card: tip })
    }
    drawLeader(ctx, hex, tip, scene.dock)

    // Under reduced motion every component is pinned, so neither string ever changes and neither
    // write happens.
    const terrain = terrainTransform(layers, PRESET.tilt > 0)
    if (terrain !== lastTerrain) {
      lastTerrain = terrain
      terrainLayer.style.transform = terrain
    }
    const clouds = cloudTransform(layers)
    if (clouds !== lastClouds) {
      lastClouds = clouds
      cloudLayer.style.transform = clouds
    }

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
    // The probes are only fetched when the flag is present, so the module stays out of the chunk
    // every visitor downloads.
    void import('./debug').then((probes) => {
      probes.installProbes(() => ({
        stage,
        canvas,
        grid,
        preset: PRESET,
        sTarget,
        mode,
        scene,
        dpr,
        focusQ,
        focusR,
        koOffset,
        column,
        gridCells,
        gridMs,
      }))
    })
  }

  applyMode(mode)
  play()
}
