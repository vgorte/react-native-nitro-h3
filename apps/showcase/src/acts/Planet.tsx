import {
  BlendMode,
  Circle,
  PaintStyle,
  Picture,
  Skia,
  type SkPaint,
  type SkPicture,
  type SkPoint,
  VertexMode,
} from '@shopify/react-native-skia'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import {
  getBaseCellNumber,
  getHexagonEdgeLengthAvgM,
  type LatLng,
  latLngToCell,
} from 'react-native-nitro-h3'
import { runOnJS, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated'
import { boundariesOf, centresOf, diskDistancesAround, earthAt, timed } from '../engine/cells'
import {
  buildGlobeFrame,
  createGlobeFrame,
  type GlobeCells,
  type GlobeFrame,
  toGlobeCells,
} from '../engine/globe'
import { createLandRuns, type LandRuns, loadLand, projectLand } from '../engine/land'
import { buildMesh, buildOutlinePath, fillMesh, type MeshOptions } from '../engine/mesh'
import {
  cullCells,
  DEG_TO_RAD,
  EARTH_RADIUS_M,
  type GlobeView,
  handoffCamera,
  handoffEase,
  lerpPositions,
  mercatorX,
  mercatorY,
  type ProjectedCells,
  projectCells,
  projectCellsCity,
  projectCellsOrthographic,
  RAD_TO_DEG,
  resolutionForZoom,
  zoomForMetresPerPixel,
} from '../engine/projection'
import { formatCount, formatMs, median, percentile } from '../engine/stats'
import {
  classesForZoom,
  createTileSource,
  type StyleClass,
  TILE_MIN_ZOOM,
  type TileId,
  visibleTiles,
} from '../engine/tiles'
import { resetWorstGap } from '../render/BlockedReadout'
import { CellPictures, type CellScene, recordCellScene } from '../render/CellPictures'
import { EngineCanvas } from '../render/EngineCanvas'
import { type GlowImage, GlowLayer, renderGlow } from '../render/GlowLayer'
import { Attribution } from '../render/hud/Attribution'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { Row } from '../render/hud/Row'
import { TileLayer } from '../render/TileLayer'
import { type CameraAnchor, SETTLE_MS, sceneViewport, useCamera } from '../render/useCamera'
import { BUCKETS, colours, rampColours } from '../theme/tokens'
import { rememberPlanetPosition } from './planetPosition'
import type { ActProps } from './types'

/** Caps the cells city mode may build around the view centre. */
export const PLANET_CELL_CAP = 12_000

/** Milliseconds the resolution 2 to 3 handoff blends over. */
export const HANDOFF_MS = 250

/**
 * States whether the globe turns on its own, which it does not.
 *
 * Spike 3 measured the worklet frame at 8.51 ms on the simulator, above the 8 ms bar, so the
 * globe turns under a finger and stands still otherwise.
 */
export const IDLE_ROTATION = false

const GLOBE_MAX_RESOLUTION = 2
const CITY_MIN_RESOLUTION = 3
const CITY_MAX_RESOLUTION = 9
const START_ANCHOR: CameraAnchor = { lat: 20, lng: 10 }
// the globe leaves a twelfth of the space it is given free
const GLOBE_MARGIN = 0.88
const GLOBE_MIN_SCALE = 0.4
const GLOBE_MAX_SCALE = 8
// a global view reads at a smaller cell than a city view, and keeps the earth on screen
const GLOBE_TARGET_PX = 18
const PANEL_TOP = 104
const PANEL_GAP = 16
// the panel is measured, and this is what it takes before the first layout
const PANEL_HEIGHT = 268
// clears the blocked readout, which stands 58 pt tall 48 pt off the bottom
const READOUT_GAP = 122
const CHUNK_SIZE = 10_000
const INSET = 0.08
const OUTLINE_EDGES = 3
const OUTLINE_LIMIT = 20_000
// the mesh reaches past the viewport, so a small pan needs no rebuild
const CULL_MARGIN = 1.5
const REBUILD_DRIFT = 0.25
// the basemap has to read through the cells, which carry the ring index and nothing else
const CITY_OPACITY = 0.35
const FRAME_SAMPLES = 120
const FRAME_REPORT_MS = 250
// the tilt stops at the Web Mercator limit, so the handoff always lands on a usable camera
const MAX_TILT = 85.05112878 * DEG_TO_RAD
const CELL_SPACING = Math.sqrt(3)
const MAX_K = Math.floor((Math.sqrt((4 * PLANET_CELL_CAP - 1) / 3) - 1) / 2)

type Mode = 'globe' | 'handoff' | 'city'

const BUCKET_PAINTS: SkPaint[] = rampColours(BUCKETS).map((colour) => {
  const paint = Skia.Paint()
  paint.setColor(Skia.Color(colour))
  paint.setAntiAlias(true)
  return paint
})

const COAST_PAINT = (() => {
  const paint = Skia.Paint()
  paint.setColor(Skia.Color(colours.hairline))
  paint.setStyle(PaintStyle.Stroke)
  paint.setStrokeWidth(1)
  paint.setAntiAlias(true)
  return paint
})()

const EMPTY_PICTURE = (() => {
  const recorder = Skia.PictureRecorder()
  recorder.beginRecording(Skia.XYWHRect(0, 0, 1, 1))
  return recorder.finishRecordingAsPicture()
})()

/** Holds the globe of one resolution together with the durations that built it. */
interface GlobeData {
  cells: GlobeCells
  frame: GlobeFrame
  cellCount: number
  earth: string
  earthMs: number
  boundariesMs: number
  centresMs: number
  bucketsMs: number
  meshMs: number
}

/** Holds what city mode builds around: the view centre, the resolution and the disk radius. */
interface BuildRequest {
  centre: LatLng
  res: number
  k: number
  /** Half the viewport, in Web Mercator metres. */
  halfWidthM: number
  halfHeightM: number
}

/** Holds a built city scene together with the durations that built it. */
interface CityScene {
  cells: CellScene
  cellCount: number
  rings: string
  ringsMs: number
  boundariesMs: number
  meshMs: number
  res: number
}

/** Builds the whole earth at a resolution as unit-sphere geometry, once per resolution. */
function buildGlobe(res: number): GlobeData {
  const earth = earthAt(res)
  const boundaries = boundariesOf(earth.value)
  const centres = centresOf(earth.value)
  const buckets = timed('getBaseCellNumber', () => {
    const values = new Uint8Array(earth.value.length)
    for (let cell = 0; cell < values.length; cell++) {
      values[cell] = getBaseCellNumber(earth.value[cell]) % BUCKETS
    }
    return values
  })
  const mesh = timed('mesh', () => {
    const cells = toGlobeCells(boundaries.value, centres.value, buckets.value)
    return { cells, frame: createGlobeFrame(cells, BUCKETS) }
  })

  return {
    cells: mesh.value.cells,
    frame: mesh.value.frame,
    cellCount: earth.value.length,
    earth: earth.label,
    earthMs: earth.ms,
    boundariesMs: boundaries.ms,
    centresMs: centres.ms,
    bucketsMs: buckets.ms,
    meshMs: mesh.ms,
  }
}

/**
 * Flattens the rings of a disk into one cell list and the colour bucket of each cell.
 *
 * The ramp runs from the brightest stop at the view centre outward, so the colour carries the ring
 * distance and nothing else.
 */
function ringBuckets(rings: BigUint64Array[]): { cells: BigUint64Array; buckets: Uint8Array } {
  let total = 0
  for (const ring of rings) total += ring.length
  const cells = new BigUint64Array(total)
  const buckets = new Uint8Array(total)
  const last = Math.max(1, rings.length - 1)
  let cursor = 0

  for (let ring = 0; ring < rings.length; ring++) {
    cells.set(rings[ring], cursor)
    buckets.fill(
      BUCKETS - 1 - Math.round((ring / last) * (BUCKETS - 1)),
      cursor,
      cursor + rings[ring].length,
    )
    cursor += rings[ring].length
  }

  return { cells, buckets }
}

/** Builds the city-mode disk of a request, culled to the viewport it was requested for. */
function buildCity(anchor: CameraAnchor, request: BuildRequest): CityScene {
  const { centre, res, k } = request
  const rings = diskDistancesAround(latLngToCell(centre.lat, centre.lng, res), k)
  const disk = ringBuckets(rings.value)
  const boundaries = boundariesOf(disk.cells)
  const projected = projectCells(boundaries.value, anchor)
  const offsetX = mercatorX(centre.lng) - mercatorX(anchor.lng)
  const offsetY = mercatorY(anchor.lat) - mercatorY(centre.lat)
  const sources = new Uint32Array(projected.cellCount)
  const culled = cullCells(
    projected,
    {
      minX: offsetX - request.halfWidthM * CULL_MARGIN,
      maxX: offsetX + request.halfWidthM * CULL_MARGIN,
      minY: offsetY - request.halfHeightM * CULL_MARGIN,
      maxY: offsetY + request.halfHeightM * CULL_MARGIN,
    },
    sources,
  )
  const bucketOf = new Uint8Array(culled.cellCount)
  for (let cell = 0; cell < culled.cellCount; cell++) bucketOf[cell] = disk.buckets[sources[cell]]

  // the inset stands in for the outline above the ceiling
  const outlined = culled.cellCount <= OUTLINE_LIMIT
  const mesh = timed('mesh', () =>
    buildMesh(culled, {
      chunkSize: CHUNK_SIZE,
      buckets: BUCKETS,
      inset: outlined ? 0 : INSET,
      bucketOf,
    }),
  )

  return {
    cells: recordCellScene(
      mesh.value,
      culled.bounds,
      outlined ? buildOutlinePath(culled, OUTLINE_EDGES) : null,
    ),
    cellCount: culled.cellCount,
    rings: rings.label,
    ringsMs: rings.ms,
    boundariesMs: boundaries.ms,
    meshMs: mesh.ms,
    res,
  }
}

/** Records the filled frame buffers as one picture, one batch per colour bucket. */
function recordGlobe(frame: GlobeFrame, runs: LandRuns, view: GlobeView): SkPicture {
  'worklet'
  const recorder = Skia.PictureRecorder()
  const canvas = recorder.beginRecording(
    Skia.XYWHRect(view.cx - view.radius, view.cy - view.radius, view.radius * 2, view.radius * 2),
  )

  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    const used = frame.pointCounts[bucket]
    if (used === 0) continue

    const positions = frame.positions[bucket]
    const points = new Array<SkPoint>(used)
    for (let point = 0; point < used; point++) {
      points[point] = { x: positions[point * 2], y: positions[point * 2 + 1] }
    }

    const fan = frame.indices[bucket]
    const indexCount = frame.indexCounts[bucket]
    const indices = new Array<number>(indexCount)
    for (let index = 0; index < indexCount; index++) indices[index] = fan[index]

    canvas.drawVertices(
      Skia.MakeVertices(VertexMode.Triangles, points, undefined, undefined, indices, true),
      BlendMode.SrcOver,
      BUCKET_PAINTS[bucket],
    )
  }

  const builder = Skia.PathBuilder.Make()
  for (let run = 0; run < runs.runCount[0]; run++) {
    const first = runs.starts[run]
    const line = new Array<SkPoint>((runs.starts[run + 1] - first) / 2)
    for (let point = 0; point < line.length; point++) {
      line[point] = { x: runs.points[first + point * 2], y: runs.points[first + point * 2 + 1] }
    }
    builder.addPoly(line, false)
  }
  canvas.drawPath(builder.detach(), COAST_PAINT)

  const picture = recorder.finishRecordingAsPicture()
  recorder.dispose()
  return picture
}

/** Answers the resolution a zoom asks for, capped where the act stops following it. */
function resolutionFor(zoom: number, lat: number): number {
  return Math.min(CITY_MAX_RESOLUTION, resolutionForZoom(zoom, lat, getHexagonEdgeLengthAvgM))
}

/** Answers the zoom a globe of `radius` pixels stands at. */
function globeZoom(radius: number, lat: number): number {
  return zoomForMetresPerPixel(EARTH_RADIUS_M / radius, lat)
}

/**
 * Answers the resolution a globe of `radius` pixels shows.
 *
 * Above {@linkcode GLOBE_MAX_RESOLUTION} the answer is the signal to hand over to city mode, and
 * both directions read it, so the two modes cannot disagree about where the boundary is.
 */
function globeResolution(radius: number, lat: number): number {
  return resolutionForZoom(globeZoom(radius, lat), lat, getHexagonEdgeLengthAvgM, GLOBE_TARGET_PX)
}

/** Answers the request that covers a viewport, with the disk radius under the cell cap. */
function requestFor(
  centre: LatLng,
  res: number,
  scale: number,
  width: number,
  height: number,
): BuildRequest {
  const halfWidthM = width / 2 / scale
  const halfHeightM = height / 2 / scale
  const groundRadiusM = Math.hypot(halfWidthM, halfHeightM) * Math.cos(centre.lat * DEG_TO_RAD)
  const spacing = CELL_SPACING * getHexagonEdgeLengthAvgM(res)
  return {
    centre,
    res,
    k: Math.max(1, Math.min(MAX_K, Math.ceil(groundRadiusM / spacing) + 1)),
    halfWidthM,
    halfHeightM,
  }
}

/** Answers whether a settle asks for geometry the built scene does not already cover. */
function needsRebuild(current: BuildRequest | null, next: BuildRequest): boolean {
  if (current === null) return true
  if (current.res !== next.res || current.k !== next.k) return true
  if (Math.abs(current.halfWidthM - next.halfWidthM) > current.halfWidthM * REBUILD_DRIFT) {
    return true
  }
  const drift = Math.hypot(
    mercatorX(next.centre.lng) - mercatorX(current.centre.lng),
    mercatorY(next.centre.lat) - mercatorY(current.centre.lat),
  )
  return drift > current.halfWidthM * REBUILD_DRIFT
}

/** Wraps a longitude the rotation has run past into the range the library takes. */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

/**
 * Draws the earth: a rotating globe up to resolution 2, a Web Mercator disk from resolution 3.
 *
 * The globe's per-frame loop runs as a worklet on the UI thread, so a rotation costs the JS
 * thread nothing and no H3 call happens inside a frame.
 */
export function Planet({ active }: ActProps) {
  const { width, height } = useWindowDimensions()
  const [panelHeight, setPanelHeight] = useState(PANEL_HEIGHT)
  // the globe takes the space the HUD leaves, so no reading sits over a cell
  const globeTop = PANEL_TOP + panelHeight + PANEL_GAP
  const globeBottom = height - READOUT_GAP
  const cx = width / 2
  const cy = (globeTop + globeBottom) / 2
  const baseRadius = Math.min(width / 2, (globeBottom - globeTop) / 2) * GLOBE_MARGIN

  const [mode, setMode] = useState<Mode>('globe')
  const [globeRes, setGlobeRes] = useState(() =>
    Math.min(GLOBE_MAX_RESOLUTION, globeResolution(baseRadius, START_ANCHOR.lat)),
  )
  const [build, setBuild] = useState<BuildRequest | null>(null)
  const [handoff, setHandoff] = useState<CellScene | null>(null)
  const [glow, setGlow] = useState<GlowImage | null>(null)
  const [tiles, setTiles] = useState<TileId[]>([])
  const [classes, setClasses] = useState<StyleClass[]>([])
  const [reading, setReading] = useState({ median: 0, p95: 0, visible: 0 })
  const [settle, setSettle] = useState(0)

  const land = useMemo(() => loadLand(), [])
  const runs = useMemo(() => createLandRuns(land), [land])
  const globe = useMemo(() => buildGlobe(globeRes), [globeRes])
  const samples = useMemo(() => new Float64Array(FRAME_SAMPLES), [])
  // a fresh array draws the tiles that arrived since the last render
  const source = useMemo(() => createTileSource(() => setTiles((current) => [...current])), [])

  const picture = useSharedValue<SkPicture>(EMPTY_PICTURE)
  const lambda0 = useSharedValue(START_ANCHOR.lng * DEG_TO_RAD)
  const phi0 = useSharedValue(START_ANCHOR.lat * DEG_TO_RAD)
  const globeScale = useSharedValue(1)
  const turning = useSharedValue(false)
  const running = useSharedValue(active)
  const onGlobe = useSharedValue(true)
  const lastLambda = useSharedValue(Number.NaN)
  const lastPhi = useSharedValue(0)
  const lastRadius = useSharedValue(0)
  const settleAt = useSharedValue(0)
  const facing = useSharedValue(0)
  const sampleCursor = useSharedValue(0)
  const sampleCount = useSharedValue(0)
  const reportedAt = useSharedValue(0)

  const bumpSettle = useCallback(() => setSettle((count) => count + 1), [])
  const camera = useCamera({ anchor: START_ANCHOR, onSettle: bumpSettle })
  const { centreOf, zoomAt, anchor } = camera
  const scene = useMemo(() => (build === null ? null : buildCity(anchor, build)), [anchor, build])

  const refreshTiles = useCallback(() => {
    if (!active) return
    const centre = centreOf(width, height)
    const zoom = zoomAt(centre.lat)
    if (zoom < TILE_MIN_ZOOM) {
      setTiles([])
      return
    }
    const visible = visibleTiles(centre, zoom, width, height)
    setTiles(visible)
    setClasses(classesForZoom(zoom))
    for (const tile of visible) source.request(tile)
  }, [active, width, height, source, centreOf, zoomAt])

  const paintGlow = useCallback(
    (cells: CellScene) => {
      const values = {
        translateX: camera.translateX.value,
        translateY: camera.translateY.value,
        scale: camera.scale.value,
      }
      setGlow(renderGlow(cells, sceneViewport(width, height, values), values.scale))
    },
    [width, height, camera.translateX, camera.translateY, camera.scale],
  )

  const report = useCallback((values: number[], visible: number) => {
    setReading({ median: median(values), p95: percentile(values, 0.95), visible })
  }, [])

  const { cells, frame: buffers } = globe

  // the rotation lives in shared values the pan writes; the rebuild runs on the UI thread once
  // per frame while the globe is on screen and never touches React state
  const onFrame = useCallback(() => {
    'worklet'
    if (!running.value || !onGlobe.value) return
    const radius = baseRadius * globeScale.value
    if (
      lambda0.value !== lastLambda.value ||
      phi0.value !== lastPhi.value ||
      radius !== lastRadius.value
    ) {
      lastLambda.value = lambda0.value
      lastPhi.value = phi0.value
      lastRadius.value = radius
      const view = { lambda0: lambda0.value, phi0: phi0.value, cx, cy, radius }
      const started = performance.now()
      facing.value = buildGlobeFrame(cells, buffers, view)
      projectLand(land, view, runs)
      picture.value = recordGlobe(buffers, runs, view)
      samples[sampleCursor.value] = performance.now() - started
      sampleCursor.value = (sampleCursor.value + 1) % FRAME_SAMPLES
      if (sampleCount.value < FRAME_SAMPLES) sampleCount.value += 1
      const now = Date.now()
      settleAt.value = now + SETTLE_MS
      // the readout costs the JS thread four renders a second, whatever the frame rate is
      if (now - reportedAt.value < FRAME_REPORT_MS) return
      reportedAt.value = now
      const values: number[] = []
      for (let index = 0; index < sampleCount.value; index++) values.push(samples[index])
      runOnJS(report)(values, facing.value)
      return
    }
    if (settleAt.value === 0 || turning.value || Date.now() < settleAt.value) return
    settleAt.value = 0
    runOnJS(bumpSettle)()
  }, [
    cells,
    buffers,
    land,
    runs,
    samples,
    cx,
    cy,
    baseRadius,
    bumpSettle,
    running,
    onGlobe,
    lambda0,
    phi0,
    globeScale,
    lastLambda,
    lastPhi,
    lastRadius,
    picture,
    facing,
    report,
    reportedAt,
    sampleCursor,
    sampleCount,
    settleAt,
    turning,
  ])

  useFrameCallback(onFrame)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new globe redraws without being read here.
  useEffect(() => {
    running.value = active
    onGlobe.value = mode === 'globe'
    // a mode or a data change redraws, whatever the rotation is
    lastLambda.value = Number.NaN
    sampleCursor.value = 0
    sampleCount.value = 0
  }, [active, mode, globe, running, onGlobe, lastLambda, sampleCursor, sampleCount])

  useEffect(() => {
    if (!active || scene === null) return
    paintGlow(scene.cells)
    refreshTiles()
    // the build cost lands before the first frame, and is no run
    resetWorstGap()
  }, [active, scene, paintGlow, refreshTiles])

  function startHandoff(view: GlobeView, centre: LatLng): void {
    const target = handoffCamera(view, centre)
    const request = requestFor(centre, CITY_MIN_RESOLUTION, target.scale, width, height)
    const disk = ringBuckets(
      diskDistancesAround(latLngToCell(centre.lat, centre.lng, request.res), request.k).value,
    )
    const boundaries = boundariesOf(disk.cells).value
    const from = projectCellsOrthographic(boundaries, view)
    const to = projectCellsCity(boundaries, target)
    const blended = new Float32Array(from)
    const blending: ProjectedCells = {
      stride: boundaries.stride,
      points: blended,
      vertexCounts: boundaries.vertexCounts,
      cellCount: boundaries.vertexCounts.length,
      bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    }
    // the grouping and the fans do not move, so a step rewrites the vertices and records again
    const options: MeshOptions = { chunkSize: CHUNK_SIZE, buckets: BUCKETS, inset: 0 }
    const mesh = buildMesh(blending, options)
    const started = performance.now()

    setMode('handoff')
    const step = (): void => {
      const t = Math.min(1, (performance.now() - started) / HANDOFF_MS)
      lerpPositions(from, to, handoffEase(t), blended)
      fillMesh(mesh, blending, options)
      setHandoff(recordCellScene(mesh, blending.bounds, null))
      if (t < 1) {
        requestAnimationFrame(step)
        return
      }
      camera.setAnchor(centre)
      camera.scale.value = target.scale
      camera.translateX.value = target.cx
      camera.translateY.value = target.cy
      setBuild(request)
      setHandoff(null)
      setMode('city')
    }
    step()
  }

  function returnToGlobe(centre: LatLng): void {
    const radius = (camera.scale.value * EARTH_RADIUS_M) / Math.cos(centre.lat * DEG_TO_RAD)
    globeScale.value = Math.min(GLOBE_MAX_SCALE, Math.max(GLOBE_MIN_SCALE, radius / baseRadius))
    lambda0.value = centre.lng * DEG_TO_RAD
    phi0.value = centre.lat * DEG_TO_RAD
    setGlobeRes(Math.min(GLOBE_MAX_RESOLUTION, globeResolution(radius, centre.lat)))
    setTiles([])
    setBuild(null)
    setMode('globe')
  }

  function settleGlobe(): void {
    const radius = baseRadius * globeScale.value
    const centre = { lat: phi0.value * RAD_TO_DEG, lng: wrapLng(lambda0.value * RAD_TO_DEG) }
    rememberPlanetPosition({ centre, zoom: globeZoom(radius, centre.lat) })
    const res = globeResolution(radius, centre.lat)
    if (res <= GLOBE_MAX_RESOLUTION) {
      setGlobeRes(res)
      return
    }
    startHandoff({ lambda0: lambda0.value, phi0: phi0.value, cx, cy, radius }, centre)
  }

  function settleCity(): void {
    const centre = centreOf(width, height)
    const zoom = zoomAt(centre.lat)
    rememberPlanetPosition({ centre, zoom })
    const radius = (camera.scale.value * EARTH_RADIUS_M) / Math.cos(centre.lat * DEG_TO_RAD)
    if (globeResolution(radius, centre.lat) <= GLOBE_MAX_RESOLUTION) {
      returnToGlobe(centre)
      return
    }
    const res = Math.max(CITY_MIN_RESOLUTION, resolutionFor(zoom, centre.lat))
    const next = requestFor(centre, res, camera.scale.value, width, height)
    if (needsRebuild(build, next)) {
      setBuild(next)
      return
    }
    if (scene !== null) paintGlow(scene.cells)
    refreshTiles()
    resetWorstGap()
  }

  const handled = useRef(0)
  useEffect(() => {
    if (settle === handled.current) return
    handled.current = settle
    if (!active) return
    if (mode === 'globe') settleGlobe()
    else if (mode === 'city') settleCity()
  })

  const radius = useDerivedValue(() => baseRadius * globeScale.value)

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .onBegin(() => {
        'worklet'
        turning.value = true
      })
      .onChange((event) => {
        'worklet'
        // a pixel of drag is a pixel of surface, whatever the globe is scaled to
        const arc = baseRadius * globeScale.value
        lambda0.value -= event.changeX / arc
        phi0.value = Math.max(-MAX_TILT, Math.min(MAX_TILT, phi0.value + event.changeY / arc))
      })
      .onFinalize(() => {
        'worklet'
        turning.value = false
      })
    const pinch = Gesture.Pinch()
      .onBegin(() => {
        'worklet'
        turning.value = true
      })
      .onChange((event) => {
        'worklet'
        const next = globeScale.value * event.scaleChange
        globeScale.value = Math.max(GLOBE_MIN_SCALE, Math.min(GLOBE_MAX_SCALE, next))
      })
      .onFinalize(() => {
        'worklet'
        turning.value = false
      })
    return Gesture.Simultaneous(pan, pinch)
  }, [baseRadius, globeScale, lambda0, phi0, turning])

  const cityLayers = useMemo(
    () =>
      scene === null ? null : (
        <>
          <TileLayer source={source} tiles={tiles} classes={classes} anchor={anchor} />
          <GlowLayer glow={glow} />
          <CellPictures scene={scene.cells} opacity={CITY_OPACITY} />
        </>
      ),
    [source, tiles, classes, anchor, glow, scene],
  )

  const overlay = useMemo(
    () => (
      <>
        {mode === 'city' ? null : (
          <>
            <Circle cx={cx} cy={cy} r={radius} color={colours.vignette} />
            {mode === 'globe' ? <Picture picture={picture} /> : <CellPictures scene={handoff} />}
            <Circle
              cx={cx}
              cy={cy}
              r={radius}
              color={colours.hairline}
              style="stroke"
              strokeWidth={1}
            />
          </>
        )}
      </>
    ),
    [mode, cx, cy, radius, picture, handoff],
  )

  // an act off screen keeps its mesh and draws nothing
  if (!active) return <View style={styles.root} />

  return (
    <View style={styles.root}>
      <EngineCanvas
        camera={camera}
        gesture={mode === 'city' ? undefined : gesture}
        overlay={overlay}
      >
        {mode === 'city' ? cityLayers : null}
      </EngineCanvas>
      <View
        style={styles.panel}
        onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height)}
      >
        <Panel>
          {mode === 'city' && scene !== null ? (
            <>
              <Metric value={formatCount(scene.cellCount)} caption="cells drawn" />
              <Row label="resolution" value={`${scene.res}`} />
              <Row label="rings" value={formatMs(scene.ringsMs)} call={scene.rings} />
              <Row
                label="boundaries"
                value={formatMs(scene.boundariesMs)}
                call="cellsToBoundaries"
              />
              <Row label="mesh" value={formatMs(scene.meshMs)} />
            </>
          ) : (
            <>
              <Metric value={formatCount(globe.cellCount)} caption="cells on the globe" />
              <Row label="resolution" value={`${globeRes}`} />
              <Row label="facing the viewer" value={formatCount(reading.visible)} tone="muted" />
              <Row label="earth" value={formatMs(globe.earthMs)} call={globe.earth} />
              <Row
                label="boundaries"
                value={formatMs(globe.boundariesMs)}
                call="cellsToBoundaries"
              />
              <Row label="centres" value={formatMs(globe.centresMs)} call="cellsToLatLngs" />
              <Row label="buckets" value={formatMs(globe.bucketsMs)} call="getBaseCellNumber" />
              <Row label="mesh" value={formatMs(globe.meshMs)} />
              <Row
                label="frame median, p95"
                value={`${reading.median.toFixed(1)} / ${formatMs(reading.p95)}`}
              />
            </>
          )}
        </Panel>
      </View>
      {mode === 'city' ? <Attribution text={source.attribution} /> : null}
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
})
