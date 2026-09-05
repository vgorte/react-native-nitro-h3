import {
  Camera,
  type CircleLayerSpecification,
  GeoJSONSource,
  type InitialViewState,
  Layer,
  Map as MapLibreMap,
  type MapRef,
  type ViewState,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native'
import type { SkCanvas } from '@shopify/react-native-skia'
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
import { getHexagonEdgeLengthAvgM, latLngToCell } from 'react-native-nitro-h3'
import type { Aggregate } from '../engine/aggregate'
import { aggregateCells, emptyCells } from '../engine/aggregate'
import { closeWait, coverage, noteFrame, noWait, openWait, type Wait } from '../engine/atlas'
import { cellsFromPoints, diskAround } from '../engine/cells'
import { featureCollection, pointFeatures, utf8Length } from '../engine/geojson'
import {
  frameExtent,
  frameMatrix,
  frameMetresPerPoint,
  framePixelRatio,
  type ImageFrame,
  imageFrameOf,
  MAX_IMAGE_PIXELS,
  POINT_RADIUS_BOX_PT,
  pointRadiusPt,
  pointRadiusStops,
  projectPoints,
  sampleStride,
} from '../engine/imageLayer'
import {
  BERLIN,
  blocksOf,
  centreOf,
  HOTSPOTS,
  OUTLINE_MAX_CELLS,
  type PointCache,
  pointStream,
  servesRun,
  UNIFORM_SHARE,
} from '../engine/points'
import {
  type Change,
  isPushed,
  nextSettings,
  OPEN_SETTINGS,
  POINT_CHOICES,
  type PointsPath,
  PUSH_CELLS,
  PUSH_POINTS,
  PUSH_RES,
  RES_CHOICES,
  type Settings,
  type ViewMode,
} from '../engine/settings'
import { formatCount, formatMs } from '../engine/stats'
import { yieldToLoop } from '../engine/yield'
import { BLOCKED_READOUT_BAND, BlockedReadout, resetWorstGap } from '../render/BlockedReadout'
import { type Basemap, loadBasemap, PLAIN_BASEMAP } from '../render/basemap'
import { type CellScene, disposeCellScene, drawCellScene } from '../render/CellPictures'
import { bucketsOfCounts } from '../render/heatColours'
import { buildEmptyScene, buildHeatScene, type HeatScene } from '../render/heatScene'
import { Attribution } from '../render/hud/Attribution'
import { Choice, type ChoiceOption } from '../render/hud/Choice'
import { FinePrint } from '../render/hud/FinePrint'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { panelRoom } from '../render/hud/panelRoom'
import { Row } from '../render/hud/Row'
import { EMPTY_COLLECTION } from '../render/inspectSources'
import { drawPoints, POINT_ALPHA, POINT_COLOUR, pointsPaint } from '../render/pointsPicture'
import { SceneImage } from '../render/SceneImage'
import { useDisposed } from '../render/useDisposed'
import { BUCKETS, colours, glass, type } from '../theme/tokens'
import type { ActProps } from './types'

// the act's published contract names these; the rules that use them live in engine/points.ts
export {
  BERLIN,
  BLOCK,
  type BoundingBox,
  generatePoints,
  HOTSPOT_SIGMA_DEG,
  HOTSPOTS,
  OUTLINE_MAX_CELLS,
  UNIFORM_SHARE,
} from '../engine/points'

const POINT_OPTIONS: readonly ChoiceOption<number>[] = POINT_CHOICES.map((value) => ({
  value,
  label: formatCount(value),
}))

const RES_OPTIONS: readonly ChoiceOption<number>[] = RES_CHOICES.map((value) => ({
  value,
  label: `${value}`,
}))

// the push-it step stands where the three plain resolutions do, so its own step is lit like them
const PUSH_OPTIONS: readonly ChoiceOption<number>[] = [
  ...RES_OPTIONS,
  { value: PUSH_RES, label: `${PUSH_RES}` },
]

// the switch the act is built around: the cloud, what it aggregates into, and the two together
const VIEW_OPTIONS: readonly ChoiceOption<ViewMode>[] = [
  { value: 'points', label: 'points' },
  { value: 'heatmap', label: 'heatmap' },
  { value: 'both', label: 'both' },
]

const PATH_OPTIONS: readonly ChoiceOption<PointsPath>[] = [
  { value: 'image', label: 'image' },
  { value: 'native', label: 'native' },
]

// the two paths draw the same speck, so the circle layer ramps its radius over the stops the
// drawn points follow, which carry the map's own zooms
const POINT_CIRCLE: NonNullable<CircleLayerSpecification['paint']> = {
  'circle-radius': ['interpolate', ['linear'], ['zoom'], ...pointRadiusStops()],
  'circle-color': POINT_COLOUR,
  'circle-opacity': POINT_ALPHA,
}

/** Seconds the native path is given to draw its points before the run counts as not finished. */
const NATIVE_WAIT_S = 30

const PUSH_NOTE =
  `push it: ${formatCount(PUSH_POINTS)} at resolution ${PUSH_RES}, ` +
  `${formatCount(PUSH_CELLS)} cells`

/**
 * Points the image draws; above it the pass steps over as many as it has to.
 *
 * The pass is bound by the pixels it fills rather than by the count, and a point covers six times
 * the area at a city scale that it covers with the whole box in the viewport. This many cost 34 ms
 * of the image at the box scale on the emulator and hold the pass near the 400 ms a settle can
 * spend at the city scale, where the same points fill six times as much.
 */
const POINTS_MAX = 80_000

// the scene stands in the frame of the box's own centre, which is where the run is anchored
const CENTRE = centreOf(BERLIN)

/** Frees the heat scene a run has replaced. */
function disposeHeat(held: HeatScene | null): void {
  disposeCellScene(held?.scene ?? null)
}

/** Frees the empty cells of the settle before this one. */
function disposeCovered(held: Covered | null): void {
  disposeCellScene(held?.scene ?? null)
}

/** The camera the act opens on: the whole sample box, whatever the viewport is shaped like. */
const OPENING: InitialViewState = {
  bounds: [BERLIN.west, BERLIN.south, BERLIN.east, BERLIN.north],
}

const PANEL_TOP = 104
// clears the blocked readout, which stands over the licence line at the bottom edge
const CONTROL_BOTTOM = BLOCKED_READOUT_BAND + 12
const PRINT_WIDTH = 268

const PIXEL_RATIO = PixelRatio.get()

const NOTES = [
  `${HOTSPOTS} weighted hotspots and ${Math.round(UNIFORM_SHARE * 100)} percent uniform noise`,
  'past 100,000 the run chunks; the sort and count do not',
  `above ${formatCount(OUTLINE_MAX_CELLS)} cells: no empty grid, cells go inset`,
  'the cells and points are one image, redrawn on settle',
  'the image reaches half a screen past the map',
  `${formatCount(POINTS_MAX)} drawn; 34 ms of the image over the whole box`,
  'or the points draw as a circle layer of their own',
  'native at a million: a 115 MB string killed the emulator',
  PUSH_NOTE,
]

/** Holds what one run has measured, a field per stage, filled in as the stages finish. */
interface Run {
  /** Points generated and located so far, which grows block by block. */
  points: number
  generateMs: number
  /** Whether the points came from the last run's cache, in which case nothing was drawn. */
  cached: boolean
  cellsMs: number
  /** Cells the points landed in, distinct. */
  distinct: number
  aggregateMs: number
  coloursMs: number
  boundariesMs: number
  meshMs: number
  /** Points in the busiest cell, which the ramp's brightest step stands for. */
  busiest: number
  done: boolean
}

const NOTHING: Run = {
  points: 0,
  generateMs: 0,
  cached: false,
  cellsMs: 0,
  distinct: 0,
  aggregateMs: 0,
  coloursMs: 0,
  boundariesMs: 0,
  meshMs: 0,
  busiest: 0,
  done: false,
}

/** Names the geometry the cell count picked: the strip up to the ceiling, the inset above it. */
function gridOf(scene: HeatScene | null): string {
  if (scene === null) return '-'
  return scene.outlined ? 'outline strip' : 'inset cells'
}

/** Names the part of the settings a run is built from; the rest only decides what is drawn. */
type RunSettings = Pick<Settings, 'seed' | 'points' | 'res'>

/** Carries a run's cancellation, and whether it got far enough to leave a scene standing. */
interface Signal {
  aborted: boolean
  finished: boolean
}

/** Holds the run's points as the classic path writes them: the collection and what it cost. */
interface Native {
  /** The collection the map is handed, dropped where the path fell back to the image. */
  data: string | null
  /** What writing the string took, the turns of the loop between the blocks left out. */
  ms: number
  bytes: number
}

/** Holds the hexagons the frame is covered in beside the busy ones, and what walking them took. */
interface Covered {
  /** Cells the disk walked over the padded frame. */
  cells: number
  /** Cells of the walk the run counted points in, which the ramp draws. */
  busy: number
  diskMs: number
  /** Cells of the walk no point landed in, which are drawn as the empty step. */
  empty: number
  emptyMs: number
  scene: CellScene | null
}

/** Holds the run's points on the image: how many landed on it and what placing them took. */
interface Projected {
  xy: Float32Array
  count: number
  /** Points stepped over between two drawn ones, `1` while every one of them is drawn. */
  stride: number
  ms: number
}

/**
 * Drops a million synthetic points on Berlin and colours the cells they land in.
 *
 * One tap on a control starts a run, and a run is the whole pipeline in stages the HUD names one by
 * one: the points are drawn, `latLngsToCells` locates them, one sort plus a run-length count
 * answers the distinct cells and how busy each is, the counts become colours on a log ramp, and
 * `cellsToBoundaries` and the mesh turn them into what is drawn. Past {@linkcode BLOCK} points the
 * first two stages run block by block with a turn of the loop between them, so the act keeps
 * answering while a million points are placed; the sort that follows is one unchunked pass, and the
 * readout beside it says what that costs. The cells and the raw points are drawn into one image the
 * basemap carries, which every settle redraws for the ground the map has come to stand over.
 *
 * The act opens on the raw cloud, which reads as noise, and the switch to the hexagons is what it
 * has to show: `gridDisk` covers the frame in cells at the run's resolution, the ones the run
 * counted carry the ramp, and every other one is drawn as the quiet empty step under the same grid.
 */
export function Heatmap({ active }: ActProps) {
  const { width, height } = useWindowDimensions()
  const [settings, setSettings] = useState<Settings>(OPEN_SETTINGS)
  const [run, setRun] = useState<Run | null>(null)
  const [scene, setScene] = useState<HeatScene | null>(null)
  // names the points the cache holds, and `null` while a run is placing new ones
  const [placed, setPlaced] = useState<string | null>(null)
  const [native, setNative] = useState<Native | null>(null)
  // what the native path answered: the time the map took, or why it has no time to answer
  const [applied, setApplied] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  // the control panel is what the expanded panel has to stop above, and only it knows its height
  const [controlHeight, setControlHeight] = useState(0)
  const [basemap, setBasemap] = useState<Basemap | null>(null)
  const [frame, setFrame] = useState<ImageFrame | null>(null)
  // the distinct cells of the run, kept so a settle can tell a covered cell of points from an empty
  const [busy, setBusy] = useState<BigUint64Array | null>(null)
  const [imageMs, setImageMs] = useState<number | null>(null)
  // what a render that answered no image said, which stands in the row the time would have taken
  const [imageFailed, setImageFailed] = useState<string | null>(null)
  // the wait on the map drawing the image it was handed, from the url to the frames stopping
  const [handoverMs, setHandoverMs] = useState<number | null>(null)

  const map = useRef<MapRef>(null)
  // the run standing on screen, so paging back to the act does not rebuild what it already holds
  const built = useRef<string | null>(null)
  // the points the last run drew, which a run of the same seed and count locates again
  const drawn = useRef<PointCache | null>(null)
  // the ground and the viewport the frame was cut for, so a settle that moved nothing recuts none
  const framed = useRef('')
  // the projection buffer, kept across settles because a million points fill eight megabytes of it
  const xy = useRef(new Float32Array(0))
  // the wait on the map drawing the native points, which ends where its frames stop
  const nativeWait = useRef<Wait>(noWait())
  const nativeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // the wait on the map drawing the scene image, which stands beside the native one
  const imageWait = useRef<Wait>(noWait())

  const { seed, points, res, view, path } = settings
  const pushed = isPushed(settings)
  // the two paths are one control each, and neither of them draws where the points do not
  const imageDrawn = view !== 'heatmap' && path === 'image'
  const nativeDrawn = view !== 'heatmap' && path === 'native'

  // every control answers through the one rule, so no control can leave a state the rows cannot
  // show, and the two that only decide what is drawn leave the run they are read against alone
  const change = useCallback((made: Change) => setSettings((held) => nextSettings(held, made)), [])
  // a path the device cannot carry hands the points back to the image, through the same rule
  const fallBack = useCallback(() => {
    // the string is what the device could not carry, so it goes; its two numbers stay on the rows
    setNative((held) => (held === null ? null : { ...held, data: null }))
    setSettings((held) => nextSettings(held, { control: 'path', value: 'image' }))
  }, [])

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
      if (key === framed.current) return
      framed.current = key
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

  // the handover starts where the url is handed over, which is the moment the render reports
  const rendered = useCallback((ms: number): void => {
    setImageFailed(null)
    setImageMs(ms)
    setHandoverMs(null)
    openWait(imageWait.current, performance.now())
  }, [])

  const failed = useCallback((reason: string): void => setImageFailed(reason), [])

  /** Stops the guard that watches for a map which never draws what the native path handed it. */
  const stopGuard = useCallback((): void => {
    if (nativeTimer.current !== null) clearTimeout(nativeTimer.current)
    nativeTimer.current = null
  }, [])

  const drew = useCallback((): void => {
    const at = performance.now()
    noteFrame(imageWait.current, at, setHandoverMs)
    noteFrame(nativeWait.current, at, (ms) => {
      stopGuard()
      setApplied(formatMs(ms))
    })
  }, [stopGuard])

  // the classic path writes every point as a feature the map parses, which is what this mode is
  // here to show; a million of them is a hundred and fifteen megabytes of string, so the blocks
  // leave the loop a turn between them and a map that never draws them falls back to the image
  useEffect(() => {
    const cache = drawn.current
    if (!active || !nativeDrawn || placed === null || cache === null) return
    let cancelled = false

    const write = async (): Promise<void> => {
      const parts: string[] = []
      let ms = 0
      for (const block of cache.blocks) {
        if (cancelled) return
        const started = performance.now()
        parts.push(pointFeatures(block))
        ms += performance.now() - started
        if (cache.blocks.length > 1) await yieldToLoop()
      }
      if (cancelled) return
      const closed = performance.now()
      const data = featureCollection(parts)
      ms += performance.now() - closed

      // the byte count is walked outside the window, so it costs the string's time nothing
      setNative({ data, ms, bytes: utf8Length(data) })
      setApplied(null)
      openWait(nativeWait.current, performance.now())
      stopGuard()
      nativeTimer.current = setTimeout(() => {
        nativeTimer.current = null
        closeWait(nativeWait.current)
        setApplied(`nothing drawn in ${NATIVE_WAIT_S} s`)
        fallBack()
      }, NATIVE_WAIT_S * 1000)
    }

    void write().catch((error: unknown) => {
      if (cancelled) return
      // a string the device cannot hold is the measurement this mode was asked for, so it is said
      setApplied(error instanceof Error ? error.message : 'the string could not be written')
      fallBack()
    })

    return () => {
      cancelled = true
    }
  }, [active, nativeDrawn, placed, stopGuard, fallBack])

  // the act leaves no guard and no open wait behind for its return to report
  useEffect(() => {
    if (!active) {
      stopGuard()
      closeWait(nativeWait.current)
      closeWait(imageWait.current)
    }
    return () => {
      stopGuard()
      closeWait(nativeWait.current)
      closeWait(imageWait.current)
    }
  }, [active, stopGuard])

  // an act off screen gives its map back: a third live one costs the Skia acts their canvas on
  // Android, and the frame it was cut for is stale by the time the act comes round again
  useEffect(() => {
    if (active) return
    framed.current = ''
    setFrame(null)
  }, [active])

  /** Runs one whole pipeline, reporting the stages as they finish and stopping where cancelled. */
  const execute = useCallback(async (wanted: RunSettings, signal: Signal): Promise<void> => {
    // the gaps that follow belong to this run, and the sort is the one it is measured by
    resetWorstGap()
    setScene(null)
    setBusy(null)
    setPlaced(null)
    setNative(null)
    setApplied(null)
    setRun(NOTHING)

    // the points depend on the seed and the count alone, so a change of resolution reuses them
    const held = servesRun(drawn.current, wanted.seed, wanted.points) ? drawn.current : null
    const draw = pointStream(wanted.seed, BERLIN)
    const blocks = blocksOf(wanted.points)
    let cells: BigUint64Array | null = new BigUint64Array(wanted.points)
    const kept: Float64Array[] = []
    let generateMs = held === null ? 0 : held.ms
    let cellsMs = 0

    for (const [index, block] of blocks.entries()) {
      if (signal.aborted) return
      let coords: Float64Array
      if (held === null) {
        const started = performance.now()
        coords = draw(block.count)
        generateMs += performance.now() - started
        kept.push(coords)
      } else {
        coords = held.blocks[index]
      }

      const located = cellsFromPoints(coords, wanted.res)
      cellsMs += located.ms
      cells.set(located.value, block.from)
      const at = block.from + block.count
      setRun({ ...NOTHING, points: at, generateMs, cellsMs, cached: held !== null })

      // a chunked run leaves the loop a turn between blocks, so the act answers while it runs
      if (blocks.length > 1) await yieldToLoop()
    }
    if (signal.aborted) return
    if (held === null) {
      drawn.current = { seed: wanted.seed, count: wanted.points, blocks: kept, ms: generateMs }
    }

    const sorted = performance.now()
    let aggregate: Aggregate | null = aggregateCells(cells)
    const aggregateMs = performance.now() - sorted
    const distinct = aggregate.cells.length
    const busiest = aggregate.max
    // the sorted buffer is dead once the runs are counted, eight megabytes at a million points
    cells = null

    const coloured = performance.now()
    let buckets: Uint8Array | null = bucketsOfCounts(aggregate.counts, busiest, BUCKETS)
    const coloursMs = performance.now() - coloured

    const heat = buildHeatScene(aggregate.cells, buckets, CENTRE)
    // a copy of its own, because the aggregate's own view holds a buffer as long as the run
    setBusy(aggregate.cells.slice())

    // the distinct cells, their counts and their colours are dead once the mesh is recorded: the
    // scene holds its own copies, and only the drawn points are kept for the next resolution
    aggregate = null
    buckets = null

    setScene(heat)
    setPlaced(`${wanted.seed}/${wanted.points}`)
    setRun({
      points: wanted.points,
      generateMs,
      cached: held !== null,
      cellsMs,
      distinct,
      aggregateMs,
      coloursMs,
      boundariesMs: heat.boundariesMs,
      meshMs: heat.meshMs,
      busiest,
      done: true,
    })
    signal.finished = true
  }, [])

  const key = `${seed}/${points}/${res}`

  useEffect(() => {
    if (!active || built.current === key) return
    const signal: Signal = { aborted: false, finished: false }
    void execute({ seed, points, res }, signal).then(() => {
      if (signal.finished) built.current = key
    })
    return () => {
      signal.aborted = true
    }
  }, [active, key, seed, points, res, execute])

  // the hexagons stand over the whole padded frame, so every settle walks the ground it moved onto;
  // it answers where the projection does, so one settle commits one scene and renders one image
  const covered = useMemo<Covered | null>(() => {
    if (!active || view === 'points' || frame === null || busy === null || scene === null) {
      return null
    }
    // above the ceiling the strip is off and the busy cells are inset, which leaves no empty step
    if (!scene.outlined) return null
    const extent = frameExtent(frame)
    const [lng, lat] = extent.center
    const disk = diskAround(
      latLngToCell(lat, lng, res),
      coverage(extent, res, getHexagonEdgeLengthAvgM),
    )
    const blank = emptyCells(disk.value, busy)
    const built = blank.length === 0 ? null : buildEmptyScene(blank, CENTRE)
    return {
      cells: disk.value.length,
      busy: disk.value.length - blank.length,
      diskMs: disk.ms,
      empty: blank.length,
      emptyMs: built?.ms ?? 0,
      scene: built?.scene ?? null,
    }
  }, [active, view, frame, busy, scene, res])

  useDisposed(scene, disposeHeat)
  useDisposed(covered, disposeCovered)

  // the projection stands in the frame's own pixels, so every settle places the points again
  const projected = useMemo<Projected | null>(() => {
    const cache = drawn.current
    if (frame === null || !imageDrawn || placed === null || cache === null) return null
    let total = 0
    for (const block of cache.blocks) total += block.length / 2
    if (xy.current.length < total * 2) xy.current = new Float32Array(total * 2)

    const out = xy.current
    const started = performance.now()
    let count = 0
    for (const block of cache.blocks) count += projectPoints(block, frame, out.subarray(count * 2))
    return {
      xy: out,
      count,
      stride: sampleStride(count, POINTS_MAX),
      ms: performance.now() - started,
    }
  }, [frame, imageDrawn, placed])

  // a point keeps the size the scale asks for, whatever the frame was cut and capped at
  const paint = useMemo(
    () =>
      frame === null
        ? pointsPaint(1, POINT_RADIUS_BOX_PT)
        : pointsPaint(
            framePixelRatio(frame, width),
            pointRadiusPt(frameMetresPerPoint(frame, width)),
          ),
    [frame, width],
  )

  const draw = useCallback(
    (canvas: SkCanvas): void => {
      if (frame === null) return
      if (scene !== null && view !== 'points') {
        const [scaleX, scaleY, translateX, translateY] = frameMatrix(frame, CENTRE)
        canvas.save()
        canvas.translate(translateX, translateY)
        canvas.scale(scaleX, scaleY)
        // the empty step first, so the cells the run counted stand over the field of the others
        if (covered?.scene != null) drawCellScene(canvas, covered.scene)
        drawCellScene(canvas, scene.scene)
        canvas.restore()
      }
      // the points are projected into the image already, so they draw outside the scene's matrix
      if (projected !== null) {
        drawPoints(canvas, projected.xy, projected.count, projected.stride, paint)
      }
    },
    [frame, scene, view, covered, projected, paint],
  )

  // a fallback takes the mode back to the image, so the rows the attempt filled stay with it
  const nativeShown = nativeDrawn || native !== null || applied !== null

  /** Reads a stage off the run, which only a finished run has measured. */
  const stage = (of: (run: Run) => string): string => (run?.done === true ? of(run) : '-')

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
          onRegionDidChange={settle}
          onDidFinishLoadingMap={loaded}
          onDidFinishRenderingFrameFully={drew}
        >
          <Camera initialViewState={OPENING} />
          {frame === null ? null : (
            <SceneImage
              id="heat-scene"
              frame={frame}
              draw={draw}
              onRendered={rendered}
              onFailed={failed}
            />
          )}
          {/* the same points the classic way: one feature each, drawn by the map itself */}
          <GeoJSONSource
            id="heat-points"
            data={nativeDrawn ? (native?.data ?? EMPTY_COLLECTION) : EMPTY_COLLECTION}
          >
            <Layer id="heat-points-circle" type="circle" paint={POINT_CIRCLE} />
          </GeoJSONSource>
        </MapLibreMap>
      )}
      {!active ? null : (
        <>
          {/* box-none leaves the map every touch the head does not take */}
          <View style={styles.panel} pointerEvents="box-none">
            <Panel
              collapsible
              collapsed={collapsed}
              onToggle={() => setCollapsed((held) => !held)}
              maxHeight={panelRoom(height, PANEL_TOP, CONTROL_BOTTOM + controlHeight)}
            >
              <Metric value={formatCount(run?.points ?? 0)} caption="points placed" />
              <Row label="resolution" value={`${res}`} />
              {/* a cached run drew nothing, so its row says whose measurement it is showing */}
              <Row
                label={run?.cached === true ? 'generate, from the cache' : 'generate'}
                value={run === null ? '-' : formatMs(run.generateMs)}
                tone={run?.cached === true ? 'muted' : 'text'}
              />
              <Row
                label="locate"
                value={run === null ? '-' : formatMs(run.cellsMs)}
                call="latLngsToCells"
              />
              <Row
                label="distinct cells, sort plus count"
                value={stage((of) => `${formatCount(of.distinct)} / ${formatMs(of.aggregateMs)}`)}
              />
              <Row label="colours" value={stage((of) => formatMs(of.coloursMs))} />
              <Row
                label="boundaries"
                value={stage((of) => formatMs(of.boundariesMs))}
                call="cellsToBoundaries"
              />
              <Row label="mesh" value={stage((of) => formatMs(of.meshMs))} />
              <Row
                label="busiest cell"
                value={stage((of) => `${formatCount(of.busiest)} points`)}
              />
              <Row label="grid" value={gridOf(scene)} tone="muted" />
              <Row
                label="coverage"
                call="gridDisk"
                value={
                  covered === null
                    ? '-'
                    : `${formatCount(covered.cells)} / ${formatMs(covered.diskMs)}`
                }
              />
              <Row
                label="empty cells, boundaries plus mesh"
                value={
                  covered === null
                    ? '-'
                    : `${formatCount(covered.empty)} / ${formatMs(covered.emptyMs)}`
                }
              />
              <Row
                label="busy cells in the coverage"
                value={covered === null ? '-' : formatCount(covered.busy)}
              />
              {/* each path answers its own rows, so no row of the other one stands empty */}
              {nativeDrawn ? null : (
                <Row
                  label="points"
                  call="projectPoints"
                  value={
                    projected === null
                      ? '-'
                      : `${formatCount(projected.count)} / ${formatMs(projected.ms)}`
                  }
                  tone={imageDrawn ? 'text' : 'muted'}
                />
              )}
              <Row
                label="image"
                call="Skia offscreen + encode + write"
                value={imageFailed ?? (imageMs === null ? '-' : formatMs(imageMs))}
                tone={imageFailed === null ? 'text' : 'contrast'}
              />
              <Row label="image applied" value={handoverMs === null ? '-' : formatMs(handoverMs)} />
              {/* a fallback keeps the rows the attempt filled, which is what it was asked for */}
              {!nativeShown ? null : (
                <>
                  <Row
                    label="points, GeoJSON string"
                    value={
                      native === null
                        ? '-'
                        : `${formatMs(native.ms)} / ${formatCount(native.bytes)}`
                    }
                  />
                  <Row label="points applied" value={applied ?? '-'} />
                </>
              )}
              <View style={styles.print}>
                <FinePrint notes={NOTES} />
              </View>
            </Panel>
          </View>
          <View
            style={styles.control}
            onLayout={(event) => setControlHeight(event.nativeEvent.layout.height)}
          >
            <Panel align="right">
              <Choice
                label="draw"
                options={VIEW_OPTIONS}
                value={view}
                onChange={(value) => change({ control: 'view', value })}
              />
              <Choice
                label="points"
                options={POINT_OPTIONS}
                value={points}
                onChange={(value) => change({ control: 'points', value })}
              />
              {/* the push-it resolution joins the row while its step stands, and leaves with it */}
              <Choice
                label="resolution"
                options={pushed ? PUSH_OPTIONS : RES_OPTIONS}
                value={res}
                onChange={(value) => change({ control: 'res', value })}
              />
              <Choice
                label="raw points"
                options={PATH_OPTIONS}
                value={path}
                onChange={(value) => change({ control: 'path', value })}
              />
              <View style={styles.buttons}>
                <Pressable
                  style={styles.button}
                  onPress={() => change({ control: 'seed' })}
                  accessibilityRole="button"
                >
                  <Text style={styles.buttonLabel}>reseed</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, pushed ? styles.pushed : null]}
                  onPress={() => change({ control: 'push' })}
                  accessibilityRole="button"
                >
                  <Text style={pushed ? styles.pushedLabel : styles.buttonLabel}>push it</Text>
                </Pressable>
              </View>
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
  buttons: { flexDirection: 'row', gap: 8 },
  button: {
    borderWidth: 1,
    borderColor: glass.border,
    borderRadius: glass.radius,
    backgroundColor: glass.fill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  buttonLabel: { ...type.value, lineHeight: 16, color: colours.text },
  pushed: { borderColor: colours.contrast },
  pushedLabel: { ...type.value, lineHeight: 16, color: colours.contrast },
})
