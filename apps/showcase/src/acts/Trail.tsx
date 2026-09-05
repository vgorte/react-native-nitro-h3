import {
  Camera,
  type CameraRef,
  type CameraStop,
  GeoJSONSource,
  type InitialViewState,
  Layer,
  Map as MapLibreMap,
  type MapRef,
  type PressEvent,
  type PressEventWithFeatures,
  type ViewState,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native'
import { type SkCanvas, Skia } from '@shopify/react-native-skia'
import * as Location from 'expo-location'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type NativeSyntheticEvent,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import {
  areNeighborCells,
  cellAreaKm2,
  cellToLatLng,
  getHexagonEdgeLengthAvgM,
  H3Error,
  type LatLng,
  latLngToCell,
} from 'react-native-nitro-h3'
import { pathBetween } from '../engine/cells'
import {
  frameMatrix,
  type ImageFrame,
  imageFrameOf,
  MAX_IMAGE_PIXELS,
  projectPoints,
} from '../engine/imageLayer'
import { formatAreaKm2, formatCount, formatMs, formatUs } from '../engine/stats'
import { timed } from '../engine/timed'
import {
  AGE_SPAN,
  CAMERA_STEP_LEAD,
  CAMERA_STEP_MS,
  capFixes,
  capTrail,
  extendTrail,
  FIX_HISTORY,
  filledCells,
  fixAhead,
  fixesDue,
  MAX_TRAIL_RES,
  MIN_TRAIL_RES,
  pathOrJump,
  RECORDED_PACE,
  REPLAY_TICK_MS,
  type ReplayClock,
  routeTimeAt,
  TIME_LAPSE_PACE,
  TRAIL_CELLS_ACROSS,
  TRAIL_RES,
  type TrailFix,
  type TrailStep,
  timeLapseCellsAcross,
  zoomForResolution,
  zoomForTrail,
} from '../engine/trail'
import { BLOCKED_READOUT_BAND, BlockedReadout, resetWorstGap } from '../render/BlockedReadout'
import { type Basemap, loadBasemap, PLAIN_BASEMAP } from '../render/basemap'
import { disposeCellScene, drawCellScene } from '../render/CellPictures'
import { Attribution } from '../render/hud/Attribution'
import { Choice, type ChoiceOption } from '../render/hud/Choice'
import { FinePrint } from '../render/hud/FinePrint'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { Row } from '../render/hud/Row'
import { Slider } from '../render/hud/Slider'
import {
  CHILD_FILL,
  EMPTY_COLLECTION,
  GHOST_LINE,
  highlightOf,
  NEIGHBOUR_FILL,
  NEIGHBOUR_LINE,
} from '../render/inspectSources'
import { SceneImage } from '../render/SceneImage'
import { buildTrailScene, type TrailScene } from '../render/trailScene'
import { useDisposed } from '../render/useDisposed'
import { colours, glass, type } from '../theme/tokens'
import { REPLAY_ROUTE } from './replayRoute'
import type { ActProps } from './types'

// the act's published contract names these; the rules that use them live in engine/trail.ts
export {
  AGE_SPAN,
  extendTrail,
  MAX_TRAIL_RES,
  MIN_TRAIL_RES,
  TRAIL_RES,
  type TrailStep,
} from '../engine/trail'

/** Frees the trail the walker has grown past; the recording is never drawn again. */
function disposeTrailScene(held: TrailScene | null): void {
  disposeCellScene(held?.scene ?? null)
}

/** Set on a build that logs every fix it takes, which is how `replayRoute.ts` was recorded. */
const RECORDING = process.env.EXPO_PUBLIC_TRAIL_RECORD === '1'

// where the act stands until the first fix says where the visitor is
const BERLIN: LatLng = { lat: 52.52, lng: 13.405 }

/** Milliseconds the camera takes to glide onto a new head cell. */
const FOLLOW_MS = 400

/** Least time between two images of the trail, so a fast route cannot flood the JS thread. */
const REDRAW_MS = 300

/**
 * Least time between two images while the time lapse runs.
 *
 * The head marks the trail that was last drawn, so this is how far behind the ride the whole scene
 * stands, and a shorter one grows the trail in smaller steps. An image costs about 70 ms of it on
 * the simulator, which is time the replay's own timer does not get: at 150 ms the run plays at
 * about 41 times the recorded pace against the 60 it asks for, and at 200 ms about 48.
 */
const TIME_LAPSE_REDRAW_MS = 200

// MapLibre counts zoom against a 512 point tile, the projection helpers against a 256 point one
const ZOOM_OFFSET = 1

// the grace a glide is given to land before the frame is cut for where the map ended up
const FRAME_SETTLE_MS = 80

// zoom levels a re-frame may travel over before it is taken as a cut rather than a flight
const ZOOM_CUT_LEVELS = 3

const PACE_OPTIONS: readonly ChoiceOption<number>[] = [
  { value: RECORDED_PACE, label: 'recorded' },
  { value: TIME_LAPSE_PACE, label: `${TIME_LAPSE_PACE}x` },
]

const PANEL_TOP = 104
const PRINT_WIDTH = 268
const SLIDER_WIDTH = 168
// the coarsest resolution whose cell still reads as a fraction of a square kilometre
const KM2_FLOOR_RES = 9
// clears the licence line, which stands over the blocked readout at the other edge
const CONTROL_BOTTOM = 136
// the head is a dot the size of a fingertip's centre, in points
const HEAD_RADIUS_PT = 5

const PIXEL_RATIO = PixelRatio.get()

const NOTES = [
  'a fix that is not a neighbour of the head is joined with gridPathCells',
  'a fix a second lands in the same cell or a neighbour, so only a gap asks',
  'those filled cells take the lower half of the ramp, measured ones all of it',
  `without a live location, a recorded bicycle ride plays at its own pace or at ${TIME_LAPSE_PACE}x`,
  'the trail is one image, redrawn when the trail gains a cell',
  'a coarser resolution keeps the ride and drops the doorstep: the data minimisation GDPR asks for, and the cell area row says how much',
]

/** Names where the fixes come from: the device itself, or the route recorded on a simulated run. */
type Source = 'live' | 'replay'

/** Holds what one gap cost: the cells `gridPathCells` filled in, and what the call took. */
interface Gap {
  cells: number
  ms: number
}

/** Holds what the last fix measured, which is what the call rows report. */
interface Reading {
  fixes: number
  /** What `latLngToCell` took on the last fix. */
  locateMs: number
  /** The last gap the grid path closed, `null` while every fix has been a neighbour. */
  gap: Gap | null
}

const NOTHING: Reading = { fixes: 0, locateMs: 0, gap: null }

/** Holds a trail walked one fix further, together with what the two calls behind it took. */
interface Walk {
  trail: TrailStep[]
  locateMs: number
  gap: Gap | null
}

const headPaint = Skia.Paint()
headPaint.setColor(Skia.Color(colours.contrast))
headPaint.setAntiAlias(true)

/** Walks one fix onto the trail, timing the two calls the HUD names. */
function walkFix(trail: TrailStep[], fix: TrailFix, res: number): Walk {
  const located = timed('latLngToCell', () => latLngToCell(fix.lat, fix.lng, res))
  const closed: { gap: Gap | null } = { gap: null }
  const walked = extendTrail(trail, located.value, areNeighborCells, (from, to) =>
    pathOrJump(
      from,
      to,
      (a, b) => {
        const between = pathBetween(a, b)
        // the two ends of the path are the head and the fix, so the gap is what stands between them
        closed.gap = { cells: between.value.length - 2, ms: between.ms }
        return between.value
      },
      (error) => error instanceof H3Error,
    ),
  )
  return { trail: capTrail(walked, AGE_SPAN), locateMs: located.ms, gap: closed.gap }
}

/** Walks a run of fixes onto a trail, answering what the last of them measured. */
function walkFixes(trail: TrailStep[], fixes: readonly TrailFix[], res: number): Walk {
  let walk: Walk = { trail, locateMs: 0, gap: null }
  for (const fix of fixes) {
    const walked = walkFix(walk.trail, fix, res)
    walk = { trail: walked.trail, locateMs: walked.locateMs, gap: walked.gap ?? walk.gap }
  }
  return walk
}

/**
 * Draws the route the visitor walks as the cells it passes through, gap by gap.
 *
 * Every fix becomes one cell through `latLngToCell`, and a fix that is not a neighbour of the head
 * is joined to it with `gridPathCells`, whose cells draw on the lower half of the ramp: what was
 * measured and what was inferred are told apart on screen. The trail keeps its last
 * {@linkcode AGE_SPAN} cells and fades over them, it rides the basemap as one image the map warps
 * under a pinch and every settle redraws, the camera follows the head until the visitor takes it
 * over and the recentre control gives it back, and refusing the location plays
 * {@linkcode REPLAY_ROUTE} at the pace it was ridden or at {@linkcode TIME_LAPSE_PACE}, which
 * pulls the camera back to {@linkcode TIME_LAPSE_CELLS_ACROSS} cells.
 */
export function Trail({ active, inspected, onInspect }: ActProps) {
  const { width, height } = useWindowDimensions()
  const [source, setSource] = useState<Source | null>(null)
  const [res, setRes] = useState(TRAIL_RES)
  const [pace, setPace] = useState(RECORDED_PACE)
  const [trail, setTrail] = useState<TrailStep[]>([])
  const [reading, setReading] = useState<Reading>(NOTHING)
  const [scene, setScene] = useState<TrailScene | null>(null)
  const [following, setFollowing] = useState(true)
  // the act opens on its headline metric and the scene, and the rows are one tap away
  const [collapsed, setCollapsed] = useState(true)
  // the panel's own height, measured, because what it says decides it and the viewport does not
  const [panelHeight, setPanelHeight] = useState(0)
  const [basemap, setBasemap] = useState<Basemap | null>(null)
  const [frame, setFrame] = useState<ImageFrame | null>(null)
  const [imageMs, setImageMs] = useState<number | null>(null)
  // what a render that answered no image said, which stands in the row the time would have taken
  const [imageFailed, setImageFailed] = useState<string | null>(null)
  // the coordinate the scene's metre space is measured from, which the first fix sets
  const [anchor, setAnchor] = useState<LatLng>(BERLIN)
  // the opening frame is written once; every frame after it comes from a camera stop
  const [opening] = useState<InitialViewState>(() => ({
    center: [BERLIN.lng, BERLIN.lat],
    zoom:
      zoomForTrail(width, height, BERLIN.lat, getHexagonEdgeLengthAvgM, TRAIL_RES) - ZOOM_OFFSET,
  }))

  const map = useRef<MapRef>(null)
  const camera = useRef<CameraRef>(null)
  // the fixes the act still holds, which a change of resolution walks again
  const fixes = useRef<TrailFix[]>([])
  // every fix the act has taken, which the row counts and the bounded history no longer can
  const counted = useRef(0)
  // the standing trail, so a fix extends what is drawn without waiting for a render
  const held = useRef<TrailStep[]>([])
  const anchored = useRef<LatLng>(BERLIN)
  // the resolution and the stretch the act last framed for, and `null` until it framed anything
  const framed = useRef<{ res: number; pace: number; across: number } | null>(null)
  const started = useRef<number | null>(null)
  const played = useRef(0)
  // the replay's own clock, re-based whenever it is set going so time away is not ridden through
  const clock = useRef<ReplayClock>({ at: 0, t: 0 })
  // the zoom the map last reported, which a change of resolution decides against
  const viewed = useRef<number | null>(null)
  // the wait for the standing glide to land, after which the frame is cut for where it landed
  const landing = useRef<ReturnType<typeof setTimeout> | null>(null)
  // the ground and the viewport the standing image was cut for, so a settle that moved nothing
  // rebuilds nothing
  const cut = useRef('')
  // when the standing scene was recorded and the frame it stands in, which paces the next one
  const drawn = useRef<{ at: number; anchor: LatLng }>({ at: 0, anchor: BERLIN })

  // the act reaches for the basemap only once it has been opened, and keeps it afterwards
  useEffect(() => {
    if (!active || basemap !== null) return
    loadBasemap()
      .then(setBasemap)
      .catch(() => {
        // the map fetches the style itself, so it can still draw; the licence line stands either way
        setBasemap(PLAIN_BASEMAP)
      })
  }, [active, basemap])

  const reframe = useCallback(
    (view: ViewState): void => {
      viewed.current = view.zoom
      const [west, south, east, north] = view.bounds
      const key = `${west},${south},${east},${north}/${width}x${height}`
      if (key === cut.current) return
      cut.current = key
      setFrame(
        imageFrameOf(
          { ne: [east, north], sw: [west, south] },
          { width, height },
          PIXEL_RATIO,
          MAX_IMAGE_PIXELS,
        ),
      )
    },
    [width, height],
  )

  const settle = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>): void => {
      reframe(event.nativeEvent)
    },
    [reframe],
  )

  // a glide the map is still running has not settled, so it reports no region change and the frame
  // the image was cut for would stand where the camera left it: every redraw asks where the map is
  const refit = useCallback((): void => {
    map.current
      ?.getViewState()
      .then(reframe)
      .catch(() => {
        // a view state the map will not answer leaves the frame to the next settle
      })
  }, [reframe])

  const rendered = useCallback((ms: number): void => {
    setImageFailed(null)
    setImageMs(ms)
  }, [])

  const failed = useCallback((reason: string): void => setImageFailed(reason), [])

  // an act off screen gives its map back: a third live one costs the Skia acts their canvas on
  // Android, and the fix that comes while the act is away frames the camera again on its return
  useEffect(() => {
    if (active) return
    if (landing.current !== null) clearTimeout(landing.current)
    cut.current = ''
    framed.current = null
    setFrame(null)
  }, [active])

  // the head stands in the band the panel and the readout leave open, which the camera pads for
  const padding = useMemo(
    () => ({ top: PANEL_TOP + panelHeight, bottom: BLOCKED_READOUT_BAND, left: 0, right: 0 }),
    [panelHeight],
  )

  /** Moves the camera, and says nothing where the map has not mounted one yet. */
  const move = useCallback((stop: CameraStop): void => {
    try {
      void camera.current?.setStop(stop).catch(() => {
        // a stop the camera refuses leaves the view where the visitor last left it
      })
    } catch {
      // a camera the map has not mounted stands on the opening view state instead
    }
  }, [])

  const centreOn = useCallback(
    (cell: bigint, zoom: number | undefined, duration: number): void => {
      const centre = cellToLatLng(cell)
      // a stop with a duration and no easing is a jump on iOS, which is what a follow must not be.
      // A re-frame can cross seven zoom levels between the ends of the resolution ladder, which a
      // straight interpolation leaves the map unable to draw; that is the flight `fly` is for
      const easing = zoom === undefined ? 'linear' : 'fly'
      move({
        center: [centre.lng, centre.lat],
        zoom,
        duration,
        easing: duration > 0 ? easing : undefined,
        padding,
      })
      // the map reports no region change while it is gliding, so the frame the image is cut for is
      // asked for again once the stop it was given is due to have landed
      if (landing.current !== null) clearTimeout(landing.current)
      landing.current = setTimeout(refit, duration + FRAME_SETTLE_MS)
    },
    [move, padding, refit],
  )

  // the two sources reach for the standing resolution rather than depend on it, so a change of it
  // neither resubscribes the watcher nor knocks the replay off its pace
  const resolution = useRef(res)
  useEffect(() => {
    resolution.current = res
  }, [res])

  // a whole batch reaches the trail in one pass, so a time lapse costs one render rather than one
  // a fix; a live feed hands over a batch of one
  const take = useCallback((batch: readonly TrailFix[]) => {
    const first = batch[0]
    if (first === undefined) return
    for (const fix of batch) {
      fixes.current.push(fix)
      counted.current += 1
      if (RECORDING) console.log('trail fix', JSON.stringify(fix))
    }
    capFixes(fixes.current, FIX_HISTORY)
    // the first fix says where the act stands, and the metre frame is measured from there
    if (counted.current === batch.length) {
      anchored.current = { lat: first.lat, lng: first.lng }
      setAnchor(anchored.current)
      // the permission dialog and the first fix both hold the app, and neither gap is the act's
      resetWorstGap()
    }
    const walked = walkFixes(held.current, batch, resolution.current)
    held.current = walked.trail
    setTrail(walked.trail)
    setReading((before) => ({
      fixes: counted.current,
      locateMs: walked.locateMs,
      gap: walked.gap ?? before.gap,
    }))
  }, [])

  // a resolution is a tiling of its own, so the whole route is walked again at the new one
  useEffect(() => {
    const walked = walkFixes([], fixes.current, res)
    held.current = walked.trail
    setTrail(walked.trail)
    setReading((before) => ({ ...before, locateMs: walked.locateMs, gap: walked.gap }))
  }, [res])

  // anything but a granted permission starts the replay, so a refusal and a request that fails
  // outright leave the same act to draw
  useEffect(() => {
    if (!active || source !== null) return
    let cancelled = false
    const answer = (next: Source) => {
      if (cancelled) return
      setSource(next)
    }
    void Location.requestForegroundPermissionsAsync()
      .then(({ granted }) => answer(granted ? 'live' : 'replay'))
      .catch(() => answer('replay'))
    return () => {
      cancelled = true
    }
  }, [active, source])

  // the watcher belongs to the act on screen, and a device with location switched off altogether
  // fails the request, where the replay stands in for it
  useEffect(() => {
    if (!active || source !== 'live') return
    let watcher: Location.LocationSubscription | null = null
    let cancelled = false
    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0 },
      (position) => {
        if (cancelled) return
        started.current ??= position.timestamp
        take([
          {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            t: position.timestamp - started.current,
          },
        ])
      },
    )
      .then((opened) => {
        if (cancelled) opened.remove()
        else watcher = opened
      })
      .catch(() => {
        if (!cancelled) setSource('replay')
      })
    return () => {
      cancelled = true
      watcher?.remove()
    }
  }, [active, source, take])

  // the replay rides its own clock: a tick delivers every fix the wall clock says is due, so a tick
  // the image render held up hands over a bigger batch rather than playing the ride slower than the
  // pace says. The clock is re-based here, which keeps the position across a pace change and holds
  // the ride where it stands while the act is away
  useEffect(() => {
    if (!active || source !== 'replay') return
    clock.current = { at: Date.now(), t: clock.current.t }
    const tick = () => {
      const now = Date.now()
      clock.current = { at: now, t: routeTimeAt(clock.current, now, pace) }
      const index = played.current
      const batch = fixesDue(REPLAY_ROUTE, index, clock.current.t)
      if (batch === 0) return
      played.current = index + batch
      take(REPLAY_ROUTE.slice(index, index + batch))
    }
    tick()
    const timer = setInterval(tick, REPLAY_TICK_MS)
    return () => clearInterval(timer)
  }, [active, source, pace, take])

  useEffect(() => {
    if (!active) return
    // the gaps of the builds that follow belong to this act, and to no act before it
    resetWorstGap()
  }, [active])

  // a gesture takes the camera off the head, and only the recentre control gives it back
  const grabbed = useCallback((event: NativeSyntheticEvent<ViewStateChangeEvent>): void => {
    if (event.nativeEvent.userInteraction) setFollowing(false)
  }, [])

  // a time lapse outruns a frame that holds twenty cells, so it pulls the camera back far enough
  // for the head to take about three seconds across it and the fading tail to stand behind it, and
  // no further than the trail standing, which at a coarse resolution is a handful of cells
  const across = pace === RECORDED_PACE ? TRAIL_CELLS_ACROSS : timeLapseCellsAcross(trail.length)
  // a time lapse leads the head on its own steps rather than being put on it fix by fix
  const leading = source === 'replay' && pace !== RECORDED_PACE

  // the opening fix frames the act, a pace change frames the time lapse, and a resolution change
  // keeps the view unless the new cells no longer read on it; the visitor holding the camera keeps
  // it either way
  useEffect(() => {
    const head = trail[trail.length - 1]
    if (head === undefined) return
    const was = framed.current
    // both answers count against the projection's 256 point tile grid, which the map takes a step
    // lower
    const fit = () =>
      zoomForTrail(width, height, anchored.current.lat, getHexagonEdgeLengthAvgM, res, across)
    /** Answers the zoom the change asks for, or `null` where the view the visitor sees stands. */
    const framedZoom = (was: { res: number; pace: number }, standing: number | null) => {
      // a pace change is a re-frame of its own, and so is anything before the map has reported a view
      if (was.pace !== pace || standing === null) return fit()
      // the resolution is the privacy dial rather than a zoom, so it keeps the view of its own
      if (was.res !== res) {
        return zoomForResolution(
          standing + ZOOM_OFFSET,
          width,
          height,
          anchored.current.lat,
          getHexagonEdgeLengthAvgM,
          res,
        )
      }
      // the trail grew past what the frame held: the cap only ever pulls the camera back
      const wider = fit()
      return wider - ZOOM_OFFSET < standing ? wider : null
    }
    if (was === null) {
      framed.current = { res, pace, across }
      centreOn(head.cell, fit() - ZOOM_OFFSET, 0)
      return
    }
    if (following && (was.res !== res || was.pace !== pace || was.across !== across)) {
      framed.current = { res, pace, across }
      const standing = viewed.current
      const next = framedZoom(was, standing)
      if (next === null) {
        centreOn(head.cell, undefined, FOLLOW_MS)
        return
      }
      // the ladder spans seven zoom levels, and a flight over more than a few of them leaves the
      // map with no tiles drawn when it lands, so a long re-frame is a cut rather than a glide
      const far = standing === null || Math.abs(next - ZOOM_OFFSET - standing) > ZOOM_CUT_LEVELS
      centreOn(head.cell, next - ZOOM_OFFSET, far ? 0 : FOLLOW_MS)
      return
    }
    if (following && !leading) centreOn(head.cell, undefined, FOLLOW_MS)
  }, [trail, following, leading, res, pace, across, width, height, centreOn])

  // at sixty times the pace the trail grows ten times a second, and a camera put on each new head
  // cuts the glide it was running short: the map lands on the stop and stands there until the next
  // one, which reads as a stutter. The time lapse runs one glide at a time instead, linear over
  // `CAMERA_STEP_MS` onto the fix the replay will have reached by the end of it, and the step after
  // it is issued before it lands so the camera holds its velocity across an image render
  useEffect(() => {
    if (!active || !leading || !following) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const step = () => {
      const ahead = fixAhead(REPLAY_ROUTE, Math.max(0, played.current - 1), pace, CAMERA_STEP_MS)
      if (ahead !== undefined) {
        move({
          center: [ahead.lng, ahead.lat],
          duration: CAMERA_STEP_MS,
          easing: 'linear',
          padding,
        })
      }
      timer = setTimeout(step, CAMERA_STEP_MS * CAMERA_STEP_LEAD)
    }
    // the pace change re-frames first, and the steps take the camera over once that glide is done
    timer = setTimeout(step, FOLLOW_MS)
    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [active, leading, following, pace, move, padding])

  // the offscreen draw, the PNG encode and the write are one block of the JS thread, so a walk
  // that crosses a cell a second gets one image every `REDRAW_MS` carrying the trail it ended on,
  // and a time lapse one every `TIME_LAPSE_REDRAW_MS`; a re-anchor moves the metre frame under the
  // image and is drawn at once
  useEffect(() => {
    if (trail.length === 0) {
      setScene(null)
      return
    }
    const every = leading ? TIME_LAPSE_REDRAW_MS : REDRAW_MS
    const build = (): void => {
      refit()
      drawn.current = { at: performance.now(), anchor }
      setScene(buildTrailScene(trail, anchor))
    }
    const waited = performance.now() - drawn.current.at
    if (drawn.current.anchor !== anchor || waited >= every) {
      build()
      return
    }
    const timer = setTimeout(build, every - waited)
    return () => clearTimeout(timer)
  }, [trail, anchor, leading, refit])

  // a tap opens the sheet on the cell under it, and lands on the ground where the trail is not
  const press = useCallback(
    (event: NativeSyntheticEvent<PressEvent | PressEventWithFeatures>): void => {
      const [lng, lat] = event.nativeEvent.lngLat
      try {
        const cell = latLngToCell(lat, lng, res)
        if (held.current.some((step) => step.cell === cell)) onInspect(cell)
      } catch (error) {
        // a tap that inverts to a coordinate off the projection has no cell to inspect
        if (!(error instanceof H3Error)) throw error
      }
    },
    [res, onInspect],
  )

  useDisposed(scene, disposeTrailScene)

  // the dot marks the head of the trail that is on screen, not the fix the act has since taken: a
  // time lapse walks several cells between two images, and a dot on the newest fix would run ahead
  // of the cells behind it
  const head = useMemo<LatLng | null>(
    () => (scene?.head == null ? null : cellToLatLng(scene.head)),
    [scene],
  )

  const draw = useCallback(
    (canvas: SkCanvas): void => {
      if (frame === null) return
      if (scene !== null) {
        const [scaleX, scaleY, translateX, translateY] = frameMatrix(frame, anchor)
        canvas.save()
        canvas.translate(translateX, translateY)
        canvas.scale(scaleX, scaleY)
        drawCellScene(canvas, scene.scene)
        canvas.restore()
      }
      if (head === null) return
      // the head is a dot in the image's own pixels, so the fix reads wherever the cells are dim
      const at = new Float32Array(2)
      if (projectPoints(Float64Array.of(head.lat, head.lng), frame, at) === 0) return
      canvas.drawCircle(at[0], at[1], (HEAD_RADIUS_PT * frame.width) / width, headPaint)
    },
    [frame, scene, anchor, head, width],
  )

  const highlight = useMemo(() => (inspected === null ? null : highlightOf(inspected)), [inspected])
  const edgeM = useMemo(() => getHexagonEdgeLengthAvgM(res), [res])
  // the ground one fix stands for, measured on the cell the rider is in rather than on the average
  // of its resolution; a cell spans nine orders of magnitude over the ladder, so the fine end of it
  // reads in square metres
  const area = useMemo(() => {
    const cell = trail[trail.length - 1]?.cell
    if (cell === undefined) return null
    const measured = timed('cellAreaKm2', () => cellAreaKm2(cell))
    return {
      text:
        res > KM2_FLOOR_RES
          ? `${formatCount(Math.round(measured.value * 1e6))} m²`
          : formatAreaKm2(measured.value),
      ms: measured.ms,
    }
  }, [trail, res])
  const filled = useMemo(() => filledCells(trail), [trail])

  return (
    <View style={styles.root}>
      {basemap === null || !active ? null : (
        <MapLibreMap
          ref={map}
          style={styles.map}
          mapStyle={basemap.style}
          attribution={false}
          logo={false}
          compass={false}
          touchRotate={false}
          touchPitch={false}
          onPress={press}
          onRegionWillChange={grabbed}
          onRegionDidChange={settle}
          onDidFinishLoadingMap={refit}
        >
          <Camera ref={camera} initialViewState={opening} />
          {frame === null ? null : (
            <SceneImage
              id="trail-scene"
              frame={frame}
              draw={draw}
              onRendered={rendered}
              onFailed={failed}
            />
          )}
          {/* what the inspected cell stands between, in the order the Skia acts draw them */}
          <GeoJSONSource id="trail-neighbours" data={highlight?.neighbours ?? EMPTY_COLLECTION}>
            <Layer id="trail-neighbours-fill" type="fill" paint={NEIGHBOUR_FILL} />
            <Layer id="trail-neighbours-line" type="line" paint={NEIGHBOUR_LINE} />
          </GeoJSONSource>
          <GeoJSONSource id="trail-children" data={highlight?.children ?? EMPTY_COLLECTION}>
            <Layer id="trail-children-fill" type="fill" paint={CHILD_FILL} />
          </GeoJSONSource>
          <GeoJSONSource id="trail-parent" data={highlight?.parent ?? EMPTY_COLLECTION}>
            <Layer id="trail-parent-line" type="line" paint={GHOST_LINE} />
          </GeoJSONSource>
        </MapLibreMap>
      )}
      {!active ? null : (
        <>
          {/* box-none leaves the map every touch the panel head does not take */}
          <View
            style={styles.panel}
            pointerEvents="box-none"
            onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height)}
          >
            <Panel collapsible collapsed={collapsed} onToggle={() => setCollapsed((was) => !was)}>
              <Metric value={formatCount(trail.length)} caption="cells on the trail" />
              <Row label="fixes" value={formatCount(reading.fixes)} />
              <Row label="source" value={source ?? 'asking'} />
              <Row label="resolution" value={`${res}`} />
              <Row
                label="average edge"
                value={`${edgeM.toFixed(1)} m`}
                call="getHexagonEdgeLengthAvgM"
              />
              <Row
                label="cell area"
                value={area === null ? '-' : `${area.text} / ${formatUs(area.ms)}`}
                call="cellAreaKm2"
              />
              <Row
                label="locate"
                value={reading.fixes === 0 ? '-' : formatUs(reading.locateMs)}
                call="latLngToCell"
              />
              <Row
                label="grid path, last gap"
                value={
                  reading.gap === null
                    ? '-'
                    : `${formatCount(reading.gap.cells)} / ${formatUs(reading.gap.ms)}`
                }
                call="gridPathCells"
              />
              <Row label="grid path cells" value={formatCount(filled)} tone="muted" />
              <Row
                label="boundaries"
                value={scene === null ? '-' : formatMs(scene.boundariesMs)}
                call="cellsToBoundaries"
              />
              <Row label="mesh" value={scene === null ? '-' : formatMs(scene.meshMs)} />
              <Row
                label="image"
                call="Skia offscreen + encode + write"
                value={imageFailed ?? (imageMs === null ? '-' : formatMs(imageMs))}
                tone={imageFailed === null ? 'text' : 'contrast'}
              />
              <Row label="camera" value={following ? 'on the head' : 'yours'} tone="muted" />
              <View style={styles.print}>
                <FinePrint notes={NOTES} />
              </View>
            </Panel>
          </View>
          <View style={styles.control}>
            <Panel align="right">
              <Row label="resolution" value={`${res}`} />
              <Slider
                min={MIN_TRAIL_RES}
                max={MAX_TRAIL_RES}
                value={res}
                width={SLIDER_WIDTH}
                onChange={setRes}
                onSettle={setRes}
              />
              {/* a live feed arrives at the pace the visitor moves, so only a replay has one to set */}
              {source !== 'replay' ? null : (
                <Choice label="pace" options={PACE_OPTIONS} value={pace} onChange={setPace} />
              )}
              <Pressable
                style={[styles.button, following ? null : styles.away]}
                onPress={() => setFollowing(true)}
                accessibilityRole="button"
              >
                <Text style={following ? styles.buttonLabel : styles.awayLabel}>recentre</Text>
              </Pressable>
            </Panel>
          </View>
          <BlockedReadout />
          {basemap === null ? null : (
            <Attribution text={basemap.attribution} loaded={basemap.loaded} />
          )}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colours.ground,
  },
  // a style that will not load, or a renderer that draws nothing, shows the ground rather than white
  map: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colours.ground,
  },
  panel: {
    position: 'absolute',
    top: PANEL_TOP,
    right: 16,
  },
  control: {
    position: 'absolute',
    right: 16,
    bottom: CONTROL_BOTTOM,
  },
  print: {
    width: PRINT_WIDTH,
    marginTop: 4,
  },
  button: {
    borderWidth: 1,
    borderColor: glass.border,
    borderRadius: glass.radius,
    backgroundColor: glass.fill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  buttonLabel: { ...type.value, lineHeight: 16, color: colours.muted },
  away: { borderColor: colours.contrast },
  awayLabel: { ...type.value, lineHeight: 16, color: colours.contrast },
})
