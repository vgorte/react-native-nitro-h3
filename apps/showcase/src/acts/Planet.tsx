import {
  BlendMode,
  Circle,
  Fill,
  PaintStyle,
  Path,
  Picture,
  Skia,
  type SkPaint,
  type SkPath,
  type SkPicture,
  type SkPoint,
  VertexMode,
} from '@shopify/react-native-skia'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import {
  cellToCenterChild,
  cellToParent,
  getHexagonEdgeLengthAvgM,
  gridDiskDistances,
  type LatLng,
  latLngToCell,
} from 'react-native-nitro-h3'
import { runOnJS, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated'
import { boundariesOf, bucketOfBaseCell, centresOf, diskAround, earthAt } from '../engine/cells'
import {
  buildGlobeFrame,
  createGlobeFrame,
  type GlobeCells,
  type GlobeFrame,
  toGlobeCells,
} from '../engine/globe'
import {
  createLandRuns,
  type LandRings,
  type LandRuns,
  loadLand,
  projectLand,
} from '../engine/land'
import { bucketForDistance, buildMesh, buildOutlinePath, PATCH_RINGS } from '../engine/mesh'
import {
  type Bounds,
  cullCells,
  DEG_TO_RAD,
  EARTH_RADIUS_M,
  type GlobeView,
  latLngToXyz,
  project,
  projectCellsGlobeLocal,
  RAD_TO_DEG,
  radiusForResolution,
  resolutionForZoom,
  rotateToView,
  unproject,
  type VertexProjector,
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
import { timed } from '../engine/timed'
import { BLOCKED_READOUT_BAND, resetWorstGap } from '../render/BlockedReadout'
import { CellPictures, type CellScene, recordCellScene } from '../render/CellPictures'
import { EngineCanvas } from '../render/EngineCanvas'
import { Attribution } from '../render/hud/Attribution'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { Row } from '../render/hud/Row'
import { TileLayer } from '../render/TileLayer'
import { type CameraAnchor, SETTLE_MS, useCamera } from '../render/useCamera'
import { BUCKETS, CELL_FILL_OPACITY, colours, rampColours } from '../theme/tokens'
import { rememberMapPosition } from './mapPosition'
import type { ActProps } from './types'

/** Caps the cells the surface scene may build around the view centre. */
export const PLANET_CELL_CAP = 12_000

/**
 * Caps the resolution the per-frame globe loop draws.
 *
 * Above it the same orthographic view is rebuilt on settle instead, so the projection never
 * changes and the camera carries the motion between two rebuilds.
 */
export const GLOBE_LOOP_MAX_RES = 2

/**
 * States whether the globe turns on its own, which it does not.
 *
 * The frame was measured at 8.51 ms on the iPhone 17 Pro simulator, above the 8 ms bar, so the
 * globe turns under a finger and stands still otherwise.
 */
export const IDLE_ROTATION = false

const SURFACE_MIN_RESOLUTION = 3
const SURFACE_MAX_RESOLUTION = 9
const START_ANCHOR: CameraAnchor = { lat: 20, lng: 10 }
// the globe leaves a twelfth of the space it is given free
const GLOBE_MARGIN = 0.88
const GLOBE_MIN_SCALE = 0.4
// the globe must be able to grow past the last globe resolution on any screen, with room to spare
const GLOBE_MAX_MARGIN = 1.25
// a global view reads at a smaller cell than a close view, and keeps the earth on screen
const GLOBE_TARGET_PX = 18
const PANEL_TOP = 104
const PANEL_GAP = 16
// the panel is measured, and this is what it takes before the first layout
const PANEL_HEIGHT = 268
const CHUNK_SIZE = 10_000
const INSET = 0.08
const OUTLINE_EDGES = 3
const OUTLINE_LIMIT = 20_000
// the scene reaches past the viewport, so a small pan needs no rebuild
const CULL_MARGIN = 1.5
const REBUILD_DRIFT = 0.25
// a quarter of a resolution step of zoom before the projection is worth redoing
const REBUILD_ZOOM = 0.24
// resolutions up to the ancestor whose centre child every patch of colour is measured from
const PATCH_DEPTH = 3
const FRAME_SAMPLES = 120
const FRAME_REPORT_MS = 250
// the tilt stops at the Web Mercator limit, so a coordinate the act hands on stays usable
const MAX_TILT = 85.05112878 * DEG_TO_RAD
const CELL_SPACING = Math.sqrt(3)
// a disk of k rings is a hexagon of cells, and only its apothem is covered in every direction
const DISK_APOTHEM = Math.sqrt(3) / 2
// the disk has to reach every corner of the viewport, whichever is furthest from its centre
const CORNERS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
]
// the limb itself cannot be unprojected, so a point that reaches it stops just inside
const LIMB_MARGIN = 0.999
const MAX_K = Math.floor((Math.sqrt((4 * PLANET_CELL_CAP - 1) / 3) - 1) / 2)

type Mode = 'globe' | 'surface'

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

/** Holds the settled view a surface scene stands in, and the disk it was built from. */
interface SurfaceView {
  /**
   * The coordinate the projection is tangent to, and the origin of the scene's pixel frame.
   *
   * It stays where the globe's own centre is, so crossing into the surface changes nothing but
   * the resolution.
   */
  centre: LatLng
  /** The coordinate under the middle of the viewport, which the disk is built around. */
  middle: LatLng
  /** The globe radius in pixels the scene was projected at. */
  radius: number
  res: number
  k: number
  /** Increments on every rebuild, so no tile path of an older view is drawn. */
  epoch: number
}

/** Holds a built surface scene together with the durations that built it. */
interface SurfaceScene {
  cells: CellScene
  coast: SkPath
  cellCount: number
  disk: string
  diskMs: number
  patchMs: number
  ringsMs: number
  boundariesMs: number
  projectMs: number
  meshMs: number
  buildMs: number
}

/** Answers the view of a settled scene, whose pixel frame the anchor sits at the origin of. */
function localView(view: SurfaceView): GlobeView {
  return {
    lambda0: view.centre.lng * DEG_TO_RAD,
    phi0: view.centre.lat * DEG_TO_RAD,
    cx: 0,
    cy: 0,
    radius: view.radius,
  }
}

/** Builds the whole earth at a resolution as unit-sphere geometry, once per resolution. */
function buildGlobe(res: number): GlobeData {
  const earth = earthAt(res)
  const boundaries = boundariesOf(earth.value)
  const centres = centresOf(earth.value)
  const buckets = timed('getBaseCellNumber', () => {
    const values = new Uint8Array(earth.value.length)
    for (let cell = 0; cell < values.length; cell++) {
      values[cell] = bucketOfBaseCell(earth.value[cell], BUCKETS)
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

/** Builds the coastline of one settle as a path, dropping the segments the rectangle misses. */
function coastPath(runs: LandRuns, rect: Bounds): SkPath {
  const builder = Skia.PathBuilder.Make()
  const { points, starts } = runs

  for (let run = 0; run < runs.runCount[0]; run++) {
    let open = false
    for (let slot = starts[run]; slot + 3 < starts[run + 1]; slot += 2) {
      const fromX = points[slot]
      const fromY = points[slot + 1]
      const toX = points[slot + 2]
      const toY = points[slot + 3]
      if (
        Math.max(fromX, toX) < rect.minX ||
        Math.min(fromX, toX) > rect.maxX ||
        Math.max(fromY, toY) < rect.minY ||
        Math.min(fromY, toY) > rect.maxY
      ) {
        open = false
        continue
      }
      if (!open) {
        builder.moveTo(fromX, fromY)
        open = true
      }
      builder.lineTo(toX, toY)
    }
  }

  return builder.detach()
}

/** Builds the disk of a settled view, projected onto the sphere and culled to the viewport. */
function buildSurface(
  view: SurfaceView,
  land: LandRings,
  runs: LandRuns,
  rect: Bounds,
): SurfaceScene {
  const started = performance.now()
  const at = localView(view)
  const disk = diskAround(latLngToCell(view.middle.lat, view.middle.lng, view.res), view.k)
  const boundaries = boundariesOf(disk.value)
  const projected = timed('projection', () =>
    projectCellsGlobeLocal(boundaries.value, at, view.centre),
  )
  const sources = new Uint32Array(projected.value.cellCount)
  const culled = cullCells(projected.value, rect, sources)

  const cells = new BigUint64Array(culled.cellCount)
  for (let cell = 0; cell < culled.cellCount; cell++) cells[cell] = disk.value[sources[cell]]
  const patches = timed('cellToParent', () => {
    const ancestors = new BigUint64Array(cells.length)
    for (let cell = 0; cell < cells.length; cell++) {
      ancestors[cell] = cellToParent(cells[cell], view.res - PATCH_DEPTH)
    }
    return ancestors
  })

  const index = new Map<bigint, number>()
  for (let cell = 0; cell < cells.length; cell++) index.set(cells[cell], cell)
  const bucketOf = new Uint8Array(cells.length).fill(bucketForDistance(PATCH_RINGS, BUCKETS))
  const rings = timed('gridDiskDistances', () => {
    const seen = new Set<bigint>()
    for (const ancestor of patches.value) {
      if (seen.has(ancestor)) continue
      seen.add(ancestor)
      const patch = gridDiskDistances(cellToCenterChild(ancestor, view.res), PATCH_RINGS)
      for (let ring = 0; ring < patch.length; ring++) {
        const bucket = bucketForDistance(ring, BUCKETS)
        for (const member of patch[ring]) {
          const found = index.get(member)
          if (found !== undefined) bucketOf[found] = bucket
        }
      }
    }
  })

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
  projectLand(land, at, runs)

  // the cells are a tint once there is a basemap under them, and the outline carries the grid
  const solid = globeZoom(view.radius, view.middle.lat) < TILE_MIN_ZOOM

  return {
    cells: recordCellScene(
      mesh.value,
      culled.bounds,
      outlined ? buildOutlinePath(culled, OUTLINE_EDGES) : null,
      solid ? 1 : CELL_FILL_OPACITY,
    ),
    coast: coastPath(runs, rect),
    cellCount: culled.cellCount,
    disk: disk.label,
    diskMs: disk.ms,
    patchMs: patches.ms,
    ringsMs: rings.ms,
    boundariesMs: boundaries.ms,
    projectMs: projected.ms,
    meshMs: mesh.ms,
    buildMs: performance.now() - started,
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
  return Math.min(SURFACE_MAX_RESOLUTION, resolutionForZoom(zoom, lat, getHexagonEdgeLengthAvgM))
}

/** Answers the zoom a globe of `radius` pixels stands at. */
function globeZoom(radius: number, lat: number): number {
  return zoomForMetresPerPixel(EARTH_RADIUS_M / radius, lat)
}

/** Answers the resolution a globe of `radius` pixels shows, up to the loop's last one. */
function globeResolution(radius: number, lat: number): number {
  return Math.min(
    GLOBE_LOOP_MAX_RES,
    resolutionForZoom(globeZoom(radius, lat), lat, getHexagonEdgeLengthAvgM, GLOBE_TARGET_PX),
  )
}

/**
 * Answers whether a view has zoomed past the globe loop, which is the surface scene's own question.
 *
 * The switch waits for the drawn cell size rather than the globe's own target, so resolution 3
 * arrives at the size it is drawn at; asking for it earlier means a disk wide enough to reach a
 * pentagon, where `gridDiskDistances` costs hundreds of milliseconds instead of one.
 */
function pastTheGlobe(zoom: number, lat: number): boolean {
  return resolutionFor(zoom, lat) >= SURFACE_MIN_RESOLUTION
}

/** Wraps a longitude the rotation has run past into the range the library takes. */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

/**
 * Draws the earth under one orthographic projection, from the whole globe down to the street.
 *
 * Up to {@linkcode GLOBE_LOOP_MAX_RES} a worklet rebuilds the globe every frame on the UI thread;
 * above it the same view is rebuilt on settle in a pixel frame anchored at the view centre, and
 * the camera carries the pan and the pinch in between. The pager does not mount this act, which
 * stands as the reference for the globe and the tile pipeline behind it.
 */
export function Planet({ active }: ActProps) {
  const { width, height } = useWindowDimensions()
  const [panelHeight, setPanelHeight] = useState(PANEL_HEIGHT)
  // the globe takes the space the HUD leaves, so no reading sits over a cell
  const globeTop = PANEL_TOP + panelHeight + PANEL_GAP
  const globeBottom = height - BLOCKED_READOUT_BAND
  const cx = width / 2
  const cy = (globeTop + globeBottom) / 2
  const baseRadius = Math.min(width / 2, (globeBottom - globeTop) / 2) * GLOBE_MARGIN
  // a fixed multiple leaves the surface out of reach on a short screen, so the range follows
  // the ladder itself
  const range = useMemo(
    () => ({
      scale: Math.max(
        1,
        (radiusForResolution(SURFACE_MIN_RESOLUTION, getHexagonEdgeLengthAvgM) * GLOBE_MAX_MARGIN) /
          baseRadius,
      ),
      radius: radiusForResolution(SURFACE_MAX_RESOLUTION + 1, getHexagonEdgeLengthAvgM),
    }),
    [baseRadius],
  )

  const [mode, setMode] = useState<Mode>('globe')
  const [globeRes, setGlobeRes] = useState(() => globeResolution(baseRadius, START_ANCHOR.lat))
  const [surface, setSurface] = useState<SurfaceView | null>(null)
  const [tiles, setTiles] = useState<TileId[]>([])
  const [classes, setClasses] = useState<StyleClass[]>([])
  const [reading, setReading] = useState({ median: 0, p95: 0, visible: 0 })
  const [basemapMs, setBasemapMs] = useState(0)
  const [settle, setSettle] = useState(0)

  const land = useMemo(() => loadLand(), [])
  const globeRuns = useMemo(() => createLandRuns(land), [land])
  // its own buffers, so a settle rebuild never writes what the globe worklet is reading
  const surfaceRuns = useMemo(() => createLandRuns(land), [land])
  const globe = useMemo(() => buildGlobe(globeRes), [globeRes])
  const samples = useMemo(() => new Float64Array(FRAME_SAMPLES), [])
  // the epoch has to outlive a round trip through the globe, or a cached path lands in a new view
  const epoch = useRef(0)
  const decoded = useRef<() => void>(() => {})
  const source = useMemo(() => createTileSource(() => decoded.current()), [])

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
  // the camera keeps its Mercator anchor, which its own re-anchor would rewrite; the reset to
  // identity on every rebuild keeps the drift it measures far under the limit that fires it
  const camera = useCamera({ anchor: START_ANCHOR, onSettle: bumpSettle })
  const { translateX, translateY, scale } = camera

  // the scene reaches a margin past the viewport, measured from the anchor at the disk centre
  const cull = useMemo<Bounds>(() => {
    const marginX = (width * (CULL_MARGIN - 1)) / 2
    const marginY = (height * (CULL_MARGIN - 1)) / 2
    return {
      minX: -cx - marginX,
      maxX: width - cx + marginX,
      minY: -cy - marginY,
      maxY: height - cy + marginY,
    }
  }, [width, height, cx, cy])

  const scene = useMemo(
    () => (surface === null ? null : buildSurface(surface, land, surfaceRuns, cull)),
    [surface, land, surfaceRuns, cull],
  )

  // one tuple is reused per call, which `buildTilePaths` reads before it asks for the next vertex
  const projectVertex = useMemo<VertexProjector>(() => {
    if (surface === null) return () => undefined
    const at = localView(surface)
    const origin = rotateToView(latLngToXyz(surface.centre.lat, surface.centre.lng), at)
    const screen: [number, number] = [0, 0]
    return (lng, lat) => {
      const rotated = rotateToView(latLngToXyz(lat, lng), at)
      if (rotated.z <= 0) return undefined
      screen[0] = at.radius * (rotated.x - origin.x)
      screen[1] = -at.radius * (rotated.y - origin.y)
      return screen
    }
  }, [surface])

  // building the paths before the layer draws them times the build and leaves the layer a read
  const warmTiles = useCallback(
    (visible: TileId[], styles: StyleClass[], project: VertexProjector, at: number) => {
      if (visible.length === 0) return
      const started = performance.now()
      for (const tile of visible) source.paths(tile, styles, project, at)
      setBasemapMs(performance.now() - started)
    },
    [source],
  )

  /** Picks the tiles a settled view covers, from the centre and radius that settle answered. */
  const refreshTiles = useCallback(
    (middle: LatLng, radius: number, at: number) => {
      if (!active) return
      const zoom = globeZoom(radius, middle.lat)
      if (zoom < TILE_MIN_ZOOM) {
        setTiles([])
        return
      }
      const visible = visibleTiles(middle, zoom, width, height)
      const styles = classesForZoom(zoom)
      setTiles(visible)
      setClasses(styles)
      for (const tile of visible) source.request(tile)
      warmTiles(visible, styles, projectVertex, at)
    },
    [active, width, height, source, warmTiles, projectVertex],
  )

  // a tile that lands after the settle is projected here, so the redraw that follows is a read
  useEffect(() => {
    decoded.current = () => {
      warmTiles(tiles, classes, projectVertex, surface?.epoch ?? 0)
      setTiles((current) => [...current])
    }
  })

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
      projectLand(land, view, globeRuns)
      picture.value = recordGlobe(buffers, globeRuns, view)
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
    globeRuns,
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

  // a rebuilt scene stands in its own frame, so the camera starts from it again
  useEffect(() => {
    if (surface === null) return
    translateX.value = cx
    translateY.value = cy
    scale.value = 1
  }, [surface, cx, cy, translateX, translateY, scale])

  useEffect(() => {
    if (!active || surface === null) return
    refreshTiles(surface.middle, surface.radius, surface.epoch)
    // the build cost lands before the first frame, and is no run
    resetWorstGap()
  }, [active, surface, refreshTiles])

  /** Answers the view a settle asks for, with a disk that reaches the viewport corners. */
  function viewFor(centre: LatLng, radius: number, stamp: number): SurfaceView {
    const at = { lambda0: centre.lng * DEG_TO_RAD, phi0: centre.lat * DEG_TO_RAD, cx, cy, radius }
    // a corner past the limb is pulled onto it, so no disk has to span a hemisphere
    const onDisk = (x: number, y: number): LatLng => {
      const reachX = x - cx
      const reachY = y - cy
      const far = Math.hypot(reachX, reachY)
      const held = far <= LIMB_MARGIN * radius ? 1 : (LIMB_MARGIN * radius) / far
      return unproject(cx + reachX * held, cy + reachY * held, at) ?? centre
    }

    const middle = onDisk(width / 2, height / 2)
    const from = latLngToXyz(middle.lat, middle.lng)
    let reach = 0
    for (const corner of CORNERS) {
      const point = onDisk(corner.x * width, corner.y * height)
      const to = latLngToXyz(point.lat, point.lng)
      reach = Math.max(reach, Math.acos(Math.min(1, from.x * to.x + from.y * to.y + from.z * to.z)))
    }
    const res = resolutionFor(globeZoom(radius, centre.lat), centre.lat)
    const spacing = CELL_SPACING * getHexagonEdgeLengthAvgM(res)
    return {
      centre,
      middle,
      radius,
      res,
      k: Math.max(
        1,
        Math.min(MAX_K, Math.ceil((EARTH_RADIUS_M * reach) / (spacing * DISK_APOTHEM)) + 1),
      ),
      epoch: stamp,
    }
  }

  /** Answers whether a settle asks for geometry the built scene does not already carry. */
  function needsRebuild(current: SurfaceView, next: SurfaceView): boolean {
    if (current.res !== next.res || current.k !== next.k) return true
    if (Math.abs(Math.log(next.radius / current.radius)) > REBUILD_ZOOM) return true
    const moved = project(next.centre.lat, next.centre.lng, localView(current))
    return Math.hypot(moved.x, moved.y) > Math.min(width, height) * REBUILD_DRIFT
  }

  function returnToGlobe(centre: LatLng, radius: number): void {
    globeScale.value = Math.min(range.scale, Math.max(GLOBE_MIN_SCALE, radius / baseRadius))
    lambda0.value = centre.lng * DEG_TO_RAD
    phi0.value = centre.lat * DEG_TO_RAD
    setGlobeRes(globeResolution(radius, centre.lat))
    setTiles([])
    setSurface(null)
    setMode('globe')
  }

  function settleGlobe(): void {
    const radius = baseRadius * globeScale.value
    const centre = { lat: phi0.value * RAD_TO_DEG, lng: wrapLng(lambda0.value * RAD_TO_DEG) }
    const zoom = globeZoom(radius, centre.lat)
    rememberMapPosition({ centre, zoom })
    if (!pastTheGlobe(zoom, centre.lat)) {
      setGlobeRes(globeResolution(radius, centre.lat))
      return
    }
    epoch.current += 1
    setSurface(viewFor(centre, radius, epoch.current))
    setMode('surface')
  }

  function settleSurface(): void {
    if (surface === null) return
    // the camera holds the offset since the last settle, so the view centre is read back through it
    const at = { ...localView(surface), cx, cy }
    const pointX = cx + (cx - translateX.value) / scale.value
    const pointY = cy + (cy - translateY.value) / scale.value
    const centre = unproject(pointX, pointY, at) ?? surface.centre
    const radius = Math.min(range.radius, surface.radius * scale.value)
    const zoom = globeZoom(radius, centre.lat)
    const next = viewFor(centre, radius, epoch.current + 1)
    rememberMapPosition({ centre: next.middle, zoom })
    if (!pastTheGlobe(zoom, centre.lat)) {
      returnToGlobe(centre, radius)
      return
    }
    if (needsRebuild(surface, next)) {
      epoch.current = next.epoch
      setSurface(next)
      return
    }
    // the scene stands, so the tiles follow the settle's own centre in the scene's own projection
    refreshTiles(next.middle, radius, surface.epoch)
    resetWorstGap()
  }

  const handled = useRef(0)
  useEffect(() => {
    if (settle === handled.current) return
    handled.current = settle
    if (!active) return
    if (mode === 'globe') settleGlobe()
    else settleSurface()
  })

  const radius = useDerivedValue(() => baseRadius * globeScale.value)
  // the coastline keeps its width while the camera zooms between two settles
  const coastWidth = useDerivedValue(() => 1 / scale.value)

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
        globeScale.value = Math.max(GLOBE_MIN_SCALE, Math.min(range.scale, next))
      })
      .onFinalize(() => {
        'worklet'
        turning.value = false
      })
    return Gesture.Simultaneous(pan, pinch)
  }, [baseRadius, range.scale, globeScale, lambda0, phi0, turning])

  const surfaceLayers = useMemo(
    () =>
      scene === null || surface === null ? null : (
        <>
          {/* the sphere already covers the viewport at this radius, so its disk is a fill */}
          <Fill color={colours.vignette} />
          <TileLayer
            source={source}
            tiles={tiles}
            classes={classes}
            project={projectVertex}
            epoch={surface.epoch}
          />
          {/* no glow here: it would sit over the basemap the translucent cells uncover */}
          <CellPictures scene={scene.cells} />
          <Path
            path={scene.coast}
            color={colours.hairline}
            style="stroke"
            strokeWidth={coastWidth}
          />
        </>
      ),
    [source, tiles, classes, scene, surface, projectVertex, coastWidth],
  )

  const overlay = useMemo(
    () =>
      mode === 'surface' ? null : (
        <>
          <Circle cx={cx} cy={cy} r={radius} color={colours.vignette} />
          <Picture picture={picture} />
          <Circle
            cx={cx}
            cy={cy}
            r={radius}
            color={colours.hairline}
            style="stroke"
            strokeWidth={1}
          />
        </>
      ),
    [mode, cx, cy, radius, picture],
  )

  // an act off screen keeps its mesh and draws nothing
  if (!active) return <View style={styles.root} />

  return (
    <View style={styles.root}>
      <EngineCanvas
        camera={camera}
        gesture={mode === 'surface' ? undefined : gesture}
        overlay={overlay}
      >
        {mode === 'surface' ? surfaceLayers : null}
      </EngineCanvas>
      <View
        style={styles.panel}
        onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height)}
      >
        <Panel>
          {mode === 'surface' && scene !== null && surface !== null ? (
            <>
              <Metric value={formatCount(scene.cellCount)} caption="cells drawn" />
              <Row label="resolution" value={`${surface.res}`} />
              <Row label="disk" value={formatMs(scene.diskMs)} call={scene.disk} />
              <Row label="patches" value={formatMs(scene.patchMs)} call="cellToParent" />
              <Row label="rings" value={formatMs(scene.ringsMs)} call="gridDiskDistances" />
              <Row
                label="boundaries"
                value={formatMs(scene.boundariesMs)}
                call="cellsToBoundaries"
              />
              <Row label="projection" value={formatMs(scene.projectMs)} />
              <Row label="mesh" value={formatMs(scene.meshMs)} />
              <Row label="rebuild" value={formatMs(scene.buildMs)} />
              <Row label="basemap" value={formatMs(basemapMs)} call="buildTilePaths" />
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
      {tiles.length > 0 ? <Attribution text={source.attribution} /> : null}
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
