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
import { formatCount, formatMs, formatUs } from '../engine/stats'
import { timed } from '../engine/timed'
import {
  AGE_SPAN,
  capFixes,
  capTrail,
  extendTrail,
  FIX_HISTORY,
  filledCells,
  MAX_TRAIL_RES,
  MIN_TRAIL_RES,
  pathOrJump,
  TRAIL_RES,
  type TrailFix,
  type TrailStep,
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

// MapLibre counts zoom against a 512 point tile, the projection helpers against a 256 point one
const ZOOM_OFFSET = 1

const RES_OPTIONS: readonly ChoiceOption<number>[] = [
  { value: MIN_TRAIL_RES, label: `${MIN_TRAIL_RES}` },
  { value: TRAIL_RES, label: `${TRAIL_RES}` },
  { value: MAX_TRAIL_RES, label: `${MAX_TRAIL_RES}` },
]

const PANEL_TOP = 104
const PRINT_WIDTH = 268
// clears the licence line, which stands over the blocked readout at the other edge
const CONTROL_BOTTOM = 136
// the head is a dot the size of a fingertip's centre, in points
const HEAD_RADIUS_PT = 5

const PIXEL_RATIO = PixelRatio.get()

const NOTES = [
  'a fix that is not a neighbour of the head is joined with gridPathCells',
  'a fix a second lands in the same cell or a neighbour, so only a gap asks',
  'those filled cells take the lower half of the ramp, measured ones all of it',
  'without a live location, a recorded route plays at the pace it was walked',
  'the trail is one image, redrawn when the trail gains a cell',
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

/** Answers the trail a whole run of fixes builds at one resolution, which a new one rebuilds. */
function walkRoute(fixes: readonly TrailFix[], res: number): Walk {
  let walk: Walk = { trail: [], locateMs: 0, gap: null }
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
 * {@linkcode REPLAY_ROUTE} at the pace it was recorded.
 */
export function Trail({ active, inspected, onInspect }: ActProps) {
  const { width, height } = useWindowDimensions()
  const [source, setSource] = useState<Source | null>(null)
  const [res, setRes] = useState(TRAIL_RES)
  const [trail, setTrail] = useState<TrailStep[]>([])
  const [reading, setReading] = useState<Reading>(NOTHING)
  const [scene, setScene] = useState<TrailScene | null>(null)
  const [following, setFollowing] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
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
  // the resolution the act last framed for, and `null` until it has framed anything
  const framed = useRef<number | null>(null)
  const started = useRef<number | null>(null)
  const played = useRef(0)
  // when the next replay fix is due, so a return to the act waits out the rest of that interval
  const due = useRef(0)
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

  const loaded = useCallback((): void => {
    map.current
      ?.getViewState()
      .then(reframe)
      .catch(() => {
        // a view state the map will not answer leaves the first frame to the next settle
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
      move({ center: [centre.lng, centre.lat], zoom, duration, padding })
    },
    [move, padding],
  )

  // the two sources reach for the standing resolution rather than depend on it, so a change of it
  // neither resubscribes the watcher nor knocks the replay off its pace
  const resolution = useRef(res)
  useEffect(() => {
    resolution.current = res
  }, [res])

  const take = useCallback((fix: TrailFix) => {
    fixes.current.push(fix)
    capFixes(fixes.current, FIX_HISTORY)
    counted.current += 1
    if (RECORDING) console.log('trail fix', JSON.stringify(fix))
    // the first fix says where the act stands, and the metre frame is measured from there
    if (counted.current === 1) {
      anchored.current = { lat: fix.lat, lng: fix.lng }
      setAnchor(anchored.current)
      // the permission dialog and the first fix both hold the app, and neither gap is the act's
      resetWorstGap()
    }
    const walked = walkFix(held.current, fix, resolution.current)
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
    const walked = walkRoute(fixes.current, res)
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
        take({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          t: position.timestamp - started.current,
        })
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

  // the replay keeps the pace it was recorded at, and holds where it stands while the act is away
  useEffect(() => {
    if (!active || source !== 'replay') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = (delay: number) => {
      due.current = Date.now() + delay
      timer = setTimeout(play, delay)
    }
    const play = () => {
      const index = played.current
      const fix = REPLAY_ROUTE[index]
      if (fix === undefined) return
      played.current = index + 1
      take(fix)
      const next = REPLAY_ROUTE[index + 1]
      if (next !== undefined) schedule(Math.max(0, next.t - fix.t))
    }
    // an act that comes back mid-interval waits out the rest of it rather than jumping a fix ahead
    schedule(Math.max(0, due.current - Date.now()))
    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [active, source, take])

  useEffect(() => {
    if (!active) return
    // the gaps of the builds that follow belong to this act, and to no act before it
    resetWorstGap()
  }, [active])

  // a gesture takes the camera off the head, and only the recentre control gives it back
  const grabbed = useCallback((event: NativeSyntheticEvent<ViewStateChangeEvent>): void => {
    if (event.nativeEvent.userInteraction) setFollowing(false)
  }, [])

  // the opening fix and a change of resolution both re-frame, so a cell keeps reading at the size
  // the act opened on, unless the visitor is holding the camera
  useEffect(() => {
    const head = trail[trail.length - 1]
    if (head === undefined) return
    const opening = framed.current === null
    if (opening || (following && framed.current !== res)) {
      framed.current = res
      const zoom =
        zoomForTrail(width, height, anchored.current.lat, getHexagonEdgeLengthAvgM, res) -
        ZOOM_OFFSET
      centreOn(head.cell, zoom, opening ? 0 : FOLLOW_MS)
      return
    }
    if (following) centreOn(head.cell, undefined, FOLLOW_MS)
  }, [trail, following, res, width, height, centreOn])

  // the offscreen draw, the PNG encode and the write are one block of the JS thread, so a walk
  // that crosses a cell a second gets one image every `REDRAW_MS` carrying the trail it ended on; a
  // re-anchor moves the metre frame under the image and is drawn at once
  useEffect(() => {
    if (trail.length === 0) {
      setScene(null)
      return
    }
    const build = (): void => {
      drawn.current = { at: performance.now(), anchor }
      setScene(buildTrailScene(trail, anchor))
    }
    const waited = performance.now() - drawn.current.at
    if (drawn.current.anchor !== anchor || waited >= REDRAW_MS) {
      build()
      return
    }
    const timer = setTimeout(build, REDRAW_MS - waited)
    return () => clearTimeout(timer)
  }, [trail, anchor])

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

  const head = useMemo<LatLng | null>(() => {
    const last = trail[trail.length - 1]
    return last === undefined ? null : cellToLatLng(last.cell)
  }, [trail])

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
  const filled = useMemo(() => filledCells(trail), [trail])

  return (
    <View style={styles.root}>
      {basemap === null || !active ? null : (
        <MapLibreMap
          ref={map}
          style={StyleSheet.absoluteFill}
          mapStyle={basemap.style}
          attribution={false}
          logo={false}
          compass={false}
          touchRotate={false}
          touchPitch={false}
          onPress={press}
          onRegionWillChange={grabbed}
          onRegionDidChange={settle}
          onDidFinishLoadingMap={loaded}
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
              <Choice label="resolution" options={RES_OPTIONS} value={res} onChange={setRes} />
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
