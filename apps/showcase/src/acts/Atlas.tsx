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
  type ViewState,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type NativeSyntheticEvent, StyleSheet, View } from 'react-native'
import { cellToString, getHexagonEdgeLengthAvgM, latLngToCell } from 'react-native-nitro-h3'
import {
  ATLAS_CELL_CAP,
  closeWait,
  coverage,
  noteFrame,
  noWait,
  openWait,
  type Wait,
} from '../engine/atlas'
import { boundariesOf, diskAround, PATCH_CALLS } from '../engine/cells'
import { cellsToFeatureCollection, utf8Length } from '../engine/geojson'
import { PATCH_BUCKETS, patchBuckets } from '../engine/patches'
import { resolutionForZoom } from '../engine/projection'
import { formatCount, formatMs } from '../engine/stats'
import { timed } from '../engine/timed'
import { BlockedReadout } from '../render/BlockedReadout'
import { type Basemap, loadBasemap, PLAIN_BASEMAP } from '../render/basemap'
import { Attribution } from '../render/hud/Attribution'
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
  oneCellCollection,
} from '../render/inspectSources'
import { CELL_FILL_OPACITY, colours, rampColours } from '../theme/tokens'
import { lastMapPosition, rememberMapPosition } from './mapPosition'
import type { ActProps } from './types'

// the act's published contract names this; the rules that use it live in engine/atlas.ts
export { ATLAS_CELL_CAP } from '../engine/atlas'

const BERLIN = { lat: 52.52, lng: 13.405 }
const START_ZOOM = 11
const MIN_START_ZOOM = 4
const MAX_START_ZOOM = 16

// MapLibre counts zoom against a 512 point tile, the projection helpers against a 256 point one
const ZOOM_OFFSET = 1

const CELL_LINE_WIDTH = 0.5
const PICK_LINE_WIDTH = 1.5
const PANEL_TOP = 104
const PRINT_WIDTH = 268

const NOTES = [
  'the classic path: cells become a GeoJSON string the renderer parses; the Skia acts skip this step',
  'the applied rows run to the last frame the map drew for it, basemap tiles it fetched included',
  'a tap hands the map one cell of its own, which it draws sooner than a filter over the whole set',
]

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

/** Holds the cell a tap landed on: the outline the map draws and the index the HUD shows. */
interface Picked {
  data: string
  index: string
}

/** Answers the camera the act opens on: the position the shared store holds, or Berlin. */
function openingView(): InitialViewState {
  const last = lastMapPosition()
  const zoom = last === null ? 0 : last.zoom - ZOOM_OFFSET
  // a global position names no place, so the act opens on a city rather than on an ocean
  if (last === null || zoom < MIN_START_ZOOM) {
    return { center: [BERLIN.lng, BERLIN.lat], zoom: START_ZOOM }
  }
  return { center: [last.centre.lng, last.centre.lat], zoom: Math.min(MAX_START_ZOOM, zoom) }
}

/**
 * Draws the same cells as the Skia acts on a MapLibre basemap, the way a map stack takes them.
 *
 * Every rebuild waits for the map to settle, walks the grid around the view centre, turns the
 * boundaries into one GeoJSON string and hands that to a `GeoJSONSource`. The HUD keeps the H3
 * calls and the two costs the classic path adds apart, because the second pair is what this act
 * exists to show, and nothing here animates on its own.
 */
export function Atlas({ active, inspected, onInspect }: ActProps) {
  const map = useRef<MapRef>(null)
  const scene = useRef<Scene | null>(null)
  const mapWait = useRef<Wait>(noWait())
  const pickWait = useRef<Wait>(noWait())
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
        setBasemap(PLAIN_BASEMAP)
      })
  }, [active, opening])

  const rebuild = useCallback((view: ViewState): void => {
    const [lng, lat] = view.center
    // the store keeps the app's own zoom, so a later act reads it the way the projection does
    rememberMapPosition({ centre: { lat, lng }, zoom: view.zoom + ZOOM_OFFSET })
    const res = resolutionForZoom(view.zoom + ZOOM_OFFSET, lat, getHexagonEdgeLengthAvgM)
    const k = coverage(view, res, getHexagonEdgeLengthAvgM)
    const disk = diskAround(latLngToCell(lat, lng, res), k)
    const cells = disk.value
    if (cells.length > ATLAS_CELL_CAP) return

    const patched = patchBuckets(cells, res, PATCH_CALLS)
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
      bytes: utf8Length(json.value),
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

  // an act that goes away leaves no timer behind, and no open wait for its return to report
  useEffect(() => {
    const waits = [mapWait.current, pickWait.current]
    if (!active) for (const wait of waits) closeWait(wait)
    return () => {
      for (const wait of waits) closeWait(wait)
    }
  }, [active])

  const press = useCallback(
    (event: NativeSyntheticEvent<PressEvent | PressEventWithFeatures>): void => {
      const at = performance.now()
      const current = scene.current
      if (current === null) return
      const [lng, lat] = event.nativeEvent.lngLat
      const cell = latLngToCell(lat, lng, current.res)
      onInspect(cell)

      // a second tap on the same cell hands the map what it already holds, so it opens no wait
      const index = cellToString(cell)
      if (index === pickedIndex.current) return
      pickedIndex.current = index
      // a tap this early leaves the map wait no frame to report, and the guard below stops it
      if (mapWait.current.timer === null) mapWait.current.from = 0
      openWait(pickWait.current, at)
      setPicked({ data: oneCellCollection(cell), index })
    },
    [onInspect],
  )

  const highlight = useMemo(() => (inspected === null ? null : highlightOf(inspected)), [inspected])

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
          // the map stays mounted off screen, where a frame it draws has no wait to report
          onDidFinishRenderingFrameFully={active ? applied : undefined}
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
          {/* what the inspected cell stands between, in the order the Skia acts draw them */}
          <GeoJSONSource
            id="atlas-inspect-neighbours"
            data={highlight?.neighbours ?? EMPTY_COLLECTION}
          >
            <Layer id="atlas-inspect-neighbours-fill" type="fill" paint={NEIGHBOUR_FILL} />
            <Layer id="atlas-inspect-neighbours-line" type="line" paint={NEIGHBOUR_LINE} />
          </GeoJSONSource>
          <GeoJSONSource id="atlas-inspect-children" data={highlight?.children ?? EMPTY_COLLECTION}>
            <Layer id="atlas-inspect-children-fill" type="fill" paint={CHILD_FILL} />
          </GeoJSONSource>
          <GeoJSONSource id="atlas-inspect-parent" data={highlight?.parent ?? EMPTY_COLLECTION}>
            <Layer id="atlas-inspect-parent-line" type="line" paint={GHOST_LINE} />
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
  print: {
    width: PRINT_WIDTH,
    marginTop: 4,
  },
})
