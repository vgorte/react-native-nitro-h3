import {
  Camera,
  type FillLayerSpecification,
  GeoJSONSource,
  type InitialViewState,
  Layer,
  type LineLayerSpecification,
  Map as MapLibreMap,
  type MapRef,
  type PressEvent,
  type PressEventWithFeatures,
  type StyleSpecification,
  type ViewState,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type NativeSyntheticEvent, StyleSheet, View } from 'react-native'
import {
  cellToCenterChild,
  cellToChildren,
  cellToParent,
  cellToString,
  getHexagonEdgeLengthAvgM,
  getResolution,
  gridDisk,
  gridDiskDistances,
  latLngToCell,
} from 'react-native-nitro-h3'
import { boundariesOf, bucketOfBaseCell, diskAround, timed } from '../engine/cells'
import { cellsToFeatureCollection } from '../engine/geojson'
import { neighbourhoodOf } from '../engine/inspect'
import { bucketForDistance, PATCH_RINGS } from '../engine/mesh'
import { DEG_TO_RAD, EARTH_RADIUS_M, resolutionForZoom } from '../engine/projection'
import { formatCount, formatMs } from '../engine/stats'
import { plainAttribution } from '../engine/tiles/source'
import { BlockedReadout } from '../render/BlockedReadout'
import { Attribution } from '../render/hud/Attribution'
import { FinePrint } from '../render/hud/FinePrint'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { Row } from '../render/hud/Row'
import { CELL_FILL_OPACITY, colours, rampColours } from '../theme/tokens'
import { lastPlanetPosition, rememberPlanetPosition } from './planetPosition'
import type { ActProps } from './types'

/** Caps the disk this act asks for, the interactive ceiling every act shares. */
export const ATLAS_CELL_CAP = 20_000

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'
const DEFAULT_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles, data from OpenStreetMap'

const BERLIN = { lat: 52.52, lng: 13.405 }
const START_ZOOM = 11
const MIN_START_ZOOM = 4
const MAX_START_ZOOM = 16

// MapLibre counts zoom against a 512 point tile, the projection helpers against a 256 point one
const ZOOM_OFFSET = 1
const CELL_SPACING = Math.sqrt(3)
// a disk of k rings is a hexagon of cells, and only its apothem is covered in every direction
const DISK_APOTHEM = Math.sqrt(3) / 2
// the largest k whose disk of 3k(k + 1) + 1 cells still fits under the cap, k = 81
const MAX_K = Math.floor((Math.sqrt((4 * ATLAS_CELL_CAP - 1) / 3) - 1) / 2)

// resolutions between a cell and the patch it is coloured in, so a patch holds 343 cells
const PATCH_DEPTH = 3
// one ramp step per ring of a patch, plus the step every cell outside one takes
const PATCH_BUCKETS = PATCH_RINGS + 1

const CELL_LINE_WIDTH = 0.5
const PICK_LINE_WIDTH = 1.5
const NEIGHBOUR_LINE_WIDTH = 1
const CHILD_FILL_OPACITY = 0.28
const PARENT_LINE_OPACITY = 0.7
const PANEL_TOP = 104
const PRINT_WIDTH = 268

const EMPTY_COLLECTION = '{"type":"FeatureCollection","features":[]}'
// the highlight's own cell carries no ring distance, and its layer draws no fill
const ONE_BUCKET = new Uint8Array(1)

const NOTES = [
  'the classic path: cells become a GeoJSON string the renderer parses; the Skia acts skip this step',
  'the applied rows run to the last frame the map drew for it, basemap tiles it fetched included',
  'a tap hands the map one cell of its own, which it draws sooner than a filter over the whole set',
]

// frames of nothing after which the map counts as done with what it was handed
const QUIET_MS = 200

type FillPaint = NonNullable<FillLayerSpecification['paint']>
type LinePaint = NonNullable<LineLayerSpecification['paint']>

/**
 * Builds the fill colour: one ramp stop per ring bucket, matched on the property the cells carry.
 *
 * The style spec types an expression as a union of tuples, which an array built in a loop cannot
 * be inferred into, so the built expression is asserted here and nowhere else.
 */
function rampExpression(stops: readonly string[]): FillPaint['fill-color'] {
  const match: (string | number | string[])[] = ['match', ['get', 'bucket']]
  for (const [bucket, colour] of stops.entries()) match.push(bucket, colour)
  match.push(stops[stops.length - 1])
  return match as FillPaint['fill-color']
}

const CELL_FILL: FillPaint = {
  'fill-color': rampExpression(rampColours(PATCH_BUCKETS)),
  'fill-opacity': CELL_FILL_OPACITY,
}

const CELL_LINE: LinePaint = {
  'line-color': colours.hairline,
  'line-width': CELL_LINE_WIDTH,
}

const PICK_LINE: LinePaint = {
  'line-color': colours.text,
  'line-width': PICK_LINE_WIDTH,
}

const CHILD_FILL: FillPaint = {
  'fill-color': colours.text,
  'fill-opacity': CHILD_FILL_OPACITY,
}

const NEIGHBOUR_LINE: LinePaint = {
  'line-color': colours.contrast,
  'line-width': NEIGHBOUR_LINE_WIDTH,
}

const PARENT_LINE: LinePaint = {
  'line-color': colours.text,
  'line-width': PICK_LINE_WIDTH,
  'line-opacity': PARENT_LINE_OPACITY,
}

/** Holds the basemap the act draws on and the line its licence requires. */
interface Basemap {
  /** The recoloured style, or the plain URL where the style could not be read. */
  style: string | StyleSpecification
  attribution: string
}

/** Holds one settle's cells together with what every step of the classic path cost. */
interface Scene {
  data: string
  cells: number
  res: number
  diskMs: number
  patchMs: number | null
  ringsCall: string
  ringsMs: number
  boundariesMs: number
  jsonMs: number
  bytes: number
}

/** Holds the colour of every cell and what the calls behind it cost. */
interface PatchBuckets {
  buckets: Uint8Array
  /** The call the second duration belongs to, which a global view answers differently. */
  call: string
  /** Absent where the view is global and no ancestor was climbed to. */
  patchMs: number | null
  ringsMs: number
}

/**
 * Holds one wait on the map: when it was handed something and how long it has been drawing since.
 *
 * The map renders on its own thread and a frame already in flight lands in the same queue, so a
 * wait cannot end on the first frame it sees. It ends where the frames stop instead, which covers
 * the parse and the re-tile the renderer does off the main thread.
 */
interface Wait {
  from: number
  last: number
  timer: ReturnType<typeof setTimeout> | null
}

/** Opens a wait, dropping whatever an unfinished one had collected. */
function openWait(wait: Wait, at: number): void {
  if (wait.timer !== null) clearTimeout(wait.timer)
  wait.timer = null
  wait.from = at
  wait.last = 0
}

/** Notes a rendered frame and reports the wait once the map has been quiet for a moment. */
function noteFrame(wait: Wait, at: number, report: (ms: number) => void): void {
  if (wait.from === 0) return
  wait.last = at - wait.from
  if (wait.timer !== null) clearTimeout(wait.timer)
  wait.timer = setTimeout(() => {
    wait.timer = null
    wait.from = 0
    report(wait.last)
  }, QUIET_MS)
}

/** Holds the cell a tap landed on: the outline the map draws and the index the HUD shows. */
interface Picked {
  data: string
  index: string
}

/** Holds what the map draws around an inspected cell, one collection a layer. */
interface Highlight {
  parent: string
  children: string
  neighbours: string
}

/** Builds the one-feature collection of a cell set, which the highlight layers draw from. */
function collectionOf(cells: BigUint64Array): string {
  return cellsToFeatureCollection(boundariesOf(cells).value, new Uint8Array(cells.length))
}

/** Answers the three collections the sheet's highlight is drawn from. */
function highlightOf(cell: bigint): Highlight {
  const around = neighbourhoodOf(cell, { getResolution, cellToParent, cellToChildren, gridDisk })
  return {
    parent:
      around.parent === null ? EMPTY_COLLECTION : collectionOf(BigUint64Array.of(around.parent)),
    children: around.children.length === 0 ? EMPTY_COLLECTION : collectionOf(around.children),
    neighbours: collectionOf(around.neighbours),
  }
}

/** Pulls the style's ground and water toward the theme, which is all the spec lets us restate. */
function recolour(style: StyleSpecification): StyleSpecification {
  const layers = style.layers.map((layer) => {
    if (layer.type === 'background') {
      return { ...layer, paint: { ...layer.paint, 'background-color': colours.ground } }
    }
    if (layer.type === 'fill' && layer.id === 'water') {
      return { ...layer, paint: { ...layer.paint, 'fill-color': colours.vignette } }
    }
    if (layer.type === 'line' && layer.id === 'waterway') {
      return { ...layer, paint: { ...layer.paint, 'line-color': colours.vignette } }
    }
    return layer
  })
  return { ...style, layers }
}

/** Reads the licence line off the style's sources, following a source's TileJSON where it has one. */
async function attributionOf(style: StyleSpecification): Promise<string> {
  const sources = Object.values(style.sources)
  for (const source of sources) {
    if ('attribution' in source && typeof source.attribution === 'string') {
      return plainAttribution(source.attribution)
    }
  }
  for (const source of sources) {
    if (!('url' in source) || typeof source.url !== 'string') continue
    const json = (await (await fetch(source.url)).json()) as { attribution?: string }
    if (typeof json.attribution === 'string') return plainAttribution(json.attribution)
  }
  return DEFAULT_ATTRIBUTION
}

/** Loads the basemap once: the style JSON in the theme's colours and the line under the map. */
async function loadBasemap(): Promise<Basemap> {
  const style = recolour((await (await fetch(STYLE_URL)).json()) as StyleSpecification)
  try {
    return { style, attribution: await attributionOf(style) }
  } catch {
    // a source whose TileJSON will not answer costs the licence line, not the recoloured style
    return { style, attribution: DEFAULT_ATTRIBUTION }
  }
}

/** Answers the camera the act opens on, the position the shared store holds or Berlin without one. */
function openingView(): InitialViewState {
  const last = lastPlanetPosition()
  const zoom = last === null ? 0 : last.zoom - ZOOM_OFFSET
  // a global position names no place, so the act opens on a city rather than on an ocean
  if (last === null || zoom < MIN_START_ZOOM) {
    return { center: [BERLIN.lng, BERLIN.lat], zoom: START_ZOOM }
  }
  return { center: [last.centre.lng, last.centre.lat], zoom: Math.min(MAX_START_ZOOM, zoom) }
}

/**
 * Answers the ramp bucket of every cell, its ring distance to the centre of the patch it lies in.
 *
 * A patch is the {@linkcode PATCH_DEPTH} generations up of a cell, so the pattern is anchored to
 * the grid rather than to the view: panning slides the bullseyes, it does not move them. Under that
 * depth there is no ancestor to climb to and the patches would overlap, so a global view falls back
 * on the base cell, which is what the globe colours by.
 *
 * @param cells The cells the collection is built from.
 * @param res The resolution they were asked for.
 */
function patchBuckets(cells: BigUint64Array, res: number): PatchBuckets {
  if (res < PATCH_DEPTH) {
    const buckets = new Uint8Array(cells.length)
    const global = timed('getBaseCellNumber', () => {
      for (let cell = 0; cell < cells.length; cell++) {
        buckets[cell] = bucketOfBaseCell(cells[cell], PATCH_BUCKETS)
      }
    })
    return { buckets, call: 'getBaseCellNumber', patchMs: null, ringsMs: global.ms }
  }

  const patches = timed('cellToParent', () => {
    const ancestors = new BigUint64Array(cells.length)
    for (let cell = 0; cell < cells.length; cell++) {
      ancestors[cell] = cellToParent(cells[cell], res - PATCH_DEPTH)
    }
    return ancestors
  })

  // the distinct ancestors are counted outside the window, so the row times H3 and nothing else
  const seen = new Set<bigint>()
  const ancestors: bigint[] = []
  for (const ancestor of patches.value) {
    if (seen.has(ancestor)) continue
    seen.add(ancestor)
    ancestors.push(ancestor)
  }

  const rings = timed('gridDiskDistances', () => {
    const walked = new Array<BigUint64Array[]>(ancestors.length)
    for (let patch = 0; patch < ancestors.length; patch++) {
      walked[patch] = gridDiskDistances(cellToCenterChild(ancestors[patch], res), PATCH_RINGS)
    }
    return walked
  })

  const index = new Map<bigint, number>()
  for (let cell = 0; cell < cells.length; cell++) index.set(cells[cell], cell)
  const buckets = new Uint8Array(cells.length)
  for (const patch of rings.value) {
    for (let ring = 0; ring < patch.length; ring++) {
      const bucket = bucketForDistance(ring, PATCH_BUCKETS)
      for (const member of patch[ring]) {
        const found = index.get(member)
        if (found !== undefined) buckets[found] = bucket
      }
    }
  }

  return { buckets, call: 'gridDiskDistances', patchMs: patches.ms, ringsMs: rings.ms }
}

/** Answers the ring count whose disk reaches every corner of the viewport, under the cap. */
function coverage(view: ViewState, res: number): number {
  const [west, south, east, north] = view.bounds
  const [lng, lat] = view.center
  // a viewport across the antimeridian answers an east that has wrapped
  const rightEdge = east < west ? east + 360 : east
  const centreLng = lng < west ? lng + 360 : lng
  const halfLat = Math.max(north - lat, lat - south)
  const halfLng = Math.max(rightEdge - centreLng, centreLng - west)
  const reach =
    EARTH_RADIUS_M * DEG_TO_RAD * Math.hypot(halfLat, halfLng * Math.cos(lat * DEG_TO_RAD))
  const spacing = CELL_SPACING * getHexagonEdgeLengthAvgM(res)
  return Math.max(1, Math.min(MAX_K, Math.ceil(reach / (spacing * DISK_APOTHEM)) + 1))
}

/**
 * Draws the same cells as the Skia acts on a MapLibre basemap, the way a map stack takes them.
 *
 * Every rebuild waits for the map to settle, walks the grid around the view centre, turns the
 * boundaries into one GeoJSON string and hands that to a `GeoJSONSource`. The HUD keeps the H3
 * calls and the two costs the classic path adds apart, because the second pair is what this act
 * exists to show. Nothing here animates on its own.
 */
export function Atlas({ active, inspected, onInspect }: ActProps) {
  const map = useRef<MapRef>(null)
  const scene = useRef<Scene | null>(null)
  const mapWait = useRef<Wait>({ from: 0, last: 0, timer: null })
  const pickWait = useRef<Wait>({ from: 0, last: 0, timer: null })
  const pickedIndex = useRef('')

  const [opening, setOpening] = useState<InitialViewState | null>(null)
  const [basemap, setBasemap] = useState<Basemap | null>(null)
  const [built, setBuilt] = useState<Scene | null>(null)
  const [appliedMs, setAppliedMs] = useState<number | null>(null)
  const [highlightMs, setHighlightMs] = useState<number | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  // the act reaches for the map only once it has been opened, and keeps it afterwards
  useEffect(() => {
    if (!active || opening !== null) return
    setOpening(openingView())
    loadBasemap()
      .then(setBasemap)
      .catch(() => {
        // a style that will not load leaves the map on the plain URL and the known licence line
        setBasemap({ style: STYLE_URL, attribution: DEFAULT_ATTRIBUTION })
      })
  }, [active, opening])

  const rebuild = useCallback((view: ViewState): void => {
    const [lng, lat] = view.center
    // the store keeps the app's own zoom, so a later act reads it the way the projection does
    rememberPlanetPosition({ centre: { lat, lng }, zoom: view.zoom + ZOOM_OFFSET })
    const res = resolutionForZoom(view.zoom + ZOOM_OFFSET, lat, getHexagonEdgeLengthAvgM)
    const disk = diskAround(latLngToCell(lat, lng, res), coverage(view, res))
    const cells = disk.value
    if (cells.length > ATLAS_CELL_CAP) return

    const patched = patchBuckets(cells, res)
    const boundaries = boundariesOf(cells)
    const json = timed('geojson', () => cellsToFeatureCollection(boundaries.value, patched.buckets))

    const next: Scene = {
      data: json.value,
      cells: cells.length,
      res,
      diskMs: disk.ms,
      patchMs: patched.patchMs,
      ringsCall: patched.call,
      ringsMs: patched.ringsMs,
      boundariesMs: boundaries.ms,
      jsonMs: json.ms,
      bytes: json.value.length,
    }
    // a settle that lands on the same cells hands the map nothing, so it opens no wait
    const changed = scene.current === null || scene.current.data !== json.value
    scene.current = next
    if (changed) openWait(mapWait.current, performance.now())
    setBuilt(next)
  }, [])

  const settle = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>): void => {
      rebuild(event.nativeEvent)
    },
    [rebuild],
  )

  const loaded = useCallback((): void => {
    if (scene.current !== null) return
    map.current
      ?.getViewState()
      .then(rebuild)
      .catch(() => {
        // a view state the map will not answer leaves the first build to the next settle
      })
  }, [rebuild])

  const applied = useCallback((): void => {
    const now = performance.now()
    // a tap owns the frames that follow it, so the map row never collects the highlight's tail
    if (pickWait.current.from === 0) noteFrame(mapWait.current, now, setAppliedMs)
    noteFrame(pickWait.current, now, setHighlightMs)
  }, [])

  // an act that goes away leaves no timer behind
  useEffect(() => {
    const waits = [mapWait.current, pickWait.current]
    return () => {
      for (const wait of waits) if (wait.timer !== null) clearTimeout(wait.timer)
    }
  }, [])

  const press = useCallback(
    (event: NativeSyntheticEvent<PressEvent | PressEventWithFeatures>): void => {
      const at = performance.now()
      const current = scene.current
      if (current === null) return
      const [lng, lat] = event.nativeEvent.lngLat
      const cell = latLngToCell(lat, lng, current.res)
      onInspect?.(cell)

      // a second tap on the same cell hands the map what it already holds, so it opens no wait
      const index = cellToString(cell)
      if (index === pickedIndex.current) return
      pickedIndex.current = index
      // a tap this early leaves the map wait no frame to report, and the guard below stops it
      if (mapWait.current.timer === null) mapWait.current.from = 0
      const boundaries = boundariesOf(new BigUint64Array([cell]))
      openWait(pickWait.current, at)
      setPicked({ data: cellsToFeatureCollection(boundaries.value, ONE_BUCKET), index })
    },
    [onInspect],
  )

  const highlight = useMemo(
    () => (inspected === null || inspected === undefined ? null : highlightOf(inspected)),
    [inspected],
  )

  return (
    <View style={styles.root}>
      {opening === null || basemap === null ? null : (
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
          onRegionDidChange={settle}
          onDidFinishLoadingMap={loaded}
          onDidFinishRenderingFrameFully={applied}
        >
          <Camera initialViewState={opening} />
          <GeoJSONSource id="atlas-cells" data={built?.data ?? EMPTY_COLLECTION}>
            <Layer id="atlas-cells-fill" type="fill" paint={CELL_FILL} />
            <Layer id="atlas-cells-line" type="line" paint={CELL_LINE} />
          </GeoJSONSource>
          {/* the highlight is its own one-feature source, which the map applies sooner */}
          <GeoJSONSource id="atlas-pick" data={picked?.data ?? EMPTY_COLLECTION}>
            <Layer id="atlas-pick-line" type="line" paint={PICK_LINE} />
          </GeoJSONSource>
          {/* what the inspected cell stands between, in the order the sheet names them */}
          <GeoJSONSource id="atlas-inspect-children" data={highlight?.children ?? EMPTY_COLLECTION}>
            <Layer id="atlas-inspect-children-fill" type="fill" paint={CHILD_FILL} />
          </GeoJSONSource>
          <GeoJSONSource
            id="atlas-inspect-neighbours"
            data={highlight?.neighbours ?? EMPTY_COLLECTION}
          >
            <Layer id="atlas-inspect-neighbours-line" type="line" paint={NEIGHBOUR_LINE} />
          </GeoJSONSource>
          <GeoJSONSource id="atlas-inspect-parent" data={highlight?.parent ?? EMPTY_COLLECTION}>
            <Layer id="atlas-inspect-parent-line" type="line" paint={PARENT_LINE} />
          </GeoJSONSource>
        </MapLibreMap>
      )}
      {!active ? null : (
        <>
          {/* box-none leaves the map every touch the panel itself does not take */}
          <View style={styles.panel} pointerEvents="box-none">
            <Panel
              collapsible
              collapsed={collapsed}
              onToggle={() => setCollapsed((folded) => !folded)}
            >
              <Metric value={formatCount(built?.cells ?? 0)} caption="cells on the map" />
              <Row label="resolution" value={built === null ? '-' : `${built.res}`} />
              <Row
                label="disk"
                value={built === null ? '-' : formatMs(built.diskMs)}
                call="gridDisk"
              />
              {built === null || built.patchMs === null ? null : (
                <Row label="patches" value={formatMs(built.patchMs)} call="cellToParent" />
              )}
              <Row
                label="rings"
                value={built === null ? '-' : formatMs(built.ringsMs)}
                call={built?.ringsCall ?? 'gridDiskDistances'}
              />
              <Row
                label="boundaries"
                value={built === null ? '-' : formatMs(built.boundariesMs)}
                call="cellsToBoundaries"
              />
              <Row
                label="geojson string, bytes"
                value={
                  built === null ? '-' : `${formatMs(built.jsonMs)} / ${formatCount(built.bytes)}`
                }
              />
              <Row
                label="map applied"
                value={appliedMs === null ? '-' : formatMs(appliedMs)}
                tone="muted"
              />
              {picked === null ? null : (
                <>
                  <Row
                    label="highlight applied"
                    value={highlightMs === null ? '-' : formatMs(highlightMs)}
                    tone="muted"
                  />
                  <Row label="tapped cell" value={picked.index} tone="muted" />
                </>
              )}
              <View style={styles.print}>
                <FinePrint notes={NOTES} />
              </View>
            </Panel>
          </View>
          <BlockedReadout />
          {basemap === null ? null : <Attribution text={basemap.attribution} />}
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
  print: {
    width: PRINT_WIDTH,
    marginTop: 4,
  },
})
