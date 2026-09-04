import { Group, Paint, Path } from '@shopify/react-native-skia'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { getHexagonEdgeLengthAvgM, latLngToCell } from 'react-native-nitro-h3'
import {
  type DerivedValue,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { diskDistancesAround } from '../engine/cells'
import {
  cellSpacingM,
  cellsInRings,
  GRID_RES,
  gridReads,
  MAX_K,
  MIN_K,
  openingScale,
  RING_FADE_MS,
  ringsToKeep,
} from '../engine/rings'
import { formatCount, formatMs } from '../engine/stats'
import { resetWorstGap } from '../render/BlockedReadout'
import { CellPictures } from '../render/CellPictures'
import { EngineCanvas } from '../render/EngineCanvas'
import { FinePrint } from '../render/hud/FinePrint'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { Row } from '../render/hud/Row'
import { Slider } from '../render/hud/Slider'
import { buildRing, type RingLayer } from '../render/ringScene'
import { type CameraAnchor, useCamera } from '../render/useCamera'
import { colours } from '../theme/tokens'
import type { ActProps } from './types'

// the act's published contract names these; the rules that use them live in engine/rings.ts
export { GRID_RES, MAX_K, MIN_K, RING_FADE_MS, ringsToKeep } from '../engine/rings'

const BERLIN: CameraAnchor = { lat: 52.52, lng: 13.405 }
const PANEL_TOP = 104
const PRINT_WIDTH = 268
const SLIDER_WIDTH = 200
// clears the blocked readout, which stands on the same line at the other edge
const CONTROL_BOTTOM = 118

const NOTES = [
  'a ring is built once and kept, so raising k appends and lowering it drops',
  'the last three rows are the rings the last step added, not the whole disk',
  'the grid lines come in where a cell is wide enough to carry them, so pinch in to see the tiling',
]

/** Holds what one change of k built, which is what the three call rows report. */
interface Append {
  ringMs: number
  boundariesMs: number
  buildMs: number
}

/** Holds what the walk of the whole disk answered: its cells and what it took. */
interface Walk {
  cells: number
  ms: number
}

/** Answers the walk of a disk, the row the cell count is read off. */
function walkOf(centre: bigint, k: number): Walk {
  const walked = diskDistancesAround(centre, k)
  return { cells: cellsInRings(walked.value), ms: walked.ms }
}

/**
 * Grows a grid ring by ring around one cell, the way `gridRing` walks it.
 *
 * The slider sets k, and every step it crosses builds the rings that step adds and nothing else: a
 * ring is its own recorded picture, fades in over {@linkcode RING_FADE_MS} and is kept until a
 * smaller k drops it. Colour is the ring's own distance from the centre, so the disk reads as the
 * bullseye the walk describes. The camera is framed on the widest disk from the first frame and
 * never follows the slider, which leaves the growth to the geometry alone.
 */
export function MagneticGrid({ active }: ActProps) {
  const { width, height } = useWindowDimensions()
  const [centre, setCentre] = useState<bigint | null>(null)
  const [k, setK] = useState(MIN_K)
  const [layers, setLayers] = useState<RingLayer[]>([])
  const [append, setAppend] = useState<Append | null>(null)
  const [walk, setWalk] = useState<Walk | null>(null)
  const [grid, setGrid] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // the rings already built, held outside the render so a rebuild of the act rebuilds no geometry
  const built = useRef<RingLayer[]>([])
  const frame = useRef<CameraAnchor | null>(null)

  // the rings stand in the anchor's own metre frame, so a settle has nothing to rebuild
  const settle = useCallback(() => {}, [])
  const camera = useCamera({ anchor: BERLIN, onSettle: settle })
  const { anchor, translateX, translateY, scale } = camera

  const spacing = useMemo(() => cellSpacingM(BERLIN.lat, getHexagonEdgeLengthAvgM), [])

  // the grid appears and goes on the UI thread's own reading of the scale, so a pinch answers
  // without waiting for the settle, and the JS thread hears only the two moments it crosses
  useAnimatedReaction(
    () => gridReads(spacing, scale.value),
    (reads, before) => {
      if (reads !== before) runOnJS(setGrid)(reads)
    },
  )

  // the act reaches for H3 only once it is on screen, and keeps the centre afterwards
  useEffect(() => {
    if (!active || centre !== null) return
    const cell = latLngToCell(BERLIN.lat, BERLIN.lng, GRID_RES)
    setCentre(cell)
    setWalk(walkOf(cell, MIN_K))
  }, [active, centre])

  // the widest disk is framed from the first frame, its centre on the anchor's own origin
  useEffect(() => {
    if (centre === null) return
    translateX.value = width / 2
    translateY.value = height / 2
    scale.value = openingScale(width, height, BERLIN.lat, getHexagonEdgeLengthAvgM)
  }, [centre, width, height, translateX, translateY, scale])

  useEffect(() => {
    if (!active) return
    // the gaps of the builds that follow belong to this act, and to no act before it
    resetWorstGap()
  }, [active])

  useEffect(() => {
    if (centre === null) return
    // a re-anchor moves the metre frame, so nothing built in the frame before it can be kept
    const current = frame.current === anchor ? built.current : []
    frame.current = anchor

    const held = new Map(current.map((layer) => [layer.ring, layer]))
    const started = performance.now()
    let ringMs = 0
    let boundariesMs = 0
    let added = 0
    const next = ringsToKeep([...held.keys()], k).map((ring) => {
      const standing = held.get(ring)
      if (standing !== undefined) return standing
      const layer = buildRing(centre, ring, anchor)
      ringMs += layer.ringMs
      boundariesMs += layer.boundariesMs
      added += 1
      return layer
    })

    built.current = next
    setLayers(next)
    // a step that only drops rings built nothing, and the rows keep what the last build measured
    if (added > 0) setAppend({ ringMs, boundariesMs, buildMs: performance.now() - started })
  }, [centre, anchor, k])

  const settleK = useCallback(
    (next: number) => {
      if (centre === null) return
      setWalk(walkOf(centre, next))
    },
    [centre],
  )

  const cells = useMemo(() => layers.reduce((total, layer) => total + layer.cells, 0), [layers])
  // the grid carries a tiling of one resolution, so it holds one point wide at any zoom
  const gridWidth = useDerivedValue(() => 1 / scale.value)

  // an act off screen keeps its rings and draws nothing
  if (!active) return <View style={styles.root} />

  return (
    <View style={styles.root}>
      <EngineCanvas camera={camera}>
        {layers.map((layer) => (
          <Ring key={layer.ring} layer={layer} width={gridWidth} grid={grid} />
        ))}
      </EngineCanvas>
      {/* box-none leaves the scene every touch the panel head does not take */}
      <View style={styles.panel} pointerEvents="box-none">
        <Panel collapsible collapsed={collapsed} onToggle={() => setCollapsed((held) => !held)}>
          <Metric value={formatCount(cells)} caption="cells drawn" />
          <Row label="k" value={`${k}`} />
          <Row
            label="disk cells, walk"
            value={walk === null ? '-' : `${formatCount(walk.cells)} / ${formatMs(walk.ms)}`}
            call="gridDiskDistances"
          />
          <Row
            label="ring walk"
            value={append === null ? '-' : formatMs(append.ringMs)}
            call="gridRing"
          />
          <Row
            label="boundaries"
            value={append === null ? '-' : formatMs(append.boundariesMs)}
            call="cellsToBoundaries"
          />
          <Row label="ring build" value={append === null ? '-' : formatMs(append.buildMs)} />
          <View style={styles.print}>
            <FinePrint notes={NOTES} />
          </View>
        </Panel>
      </View>
      <View style={styles.control}>
        <Panel align="right">
          <Row label="rings from the centre" value={`${k}`} />
          <Slider
            min={MIN_K}
            max={MAX_K}
            value={k}
            width={SLIDER_WIDTH}
            onChange={setK}
            onSettle={settleK}
            blocks={camera.gesture}
          />
        </Panel>
      </View>
    </View>
  )
}

/** Configures {@linkcode Ring}. */
interface RingProps {
  layer: RingLayer
  /** The camera's own line width, one point at any zoom. */
  width: DerivedValue<number>
  /** Whether the cells are wide enough for the grid over them to read. */
  grid: boolean
}

/**
 * Draws one ring, fading its cells in as it arrives.
 *
 * A recorded picture is drawn straight onto the canvas and takes no paint of its own, so the fade
 * has to come from a layer the picture is composited through. That layer costs an offscreen every
 * frame, which a ring that has finished fading no longer needs and no longer asks for.
 */
function Ring({ layer, width, grid }: RingProps) {
  const alpha = useSharedValue(0)
  const [faded, setFaded] = useState(false)

  useEffect(() => {
    alpha.value = withTiming(1, { duration: RING_FADE_MS })
    const timer = setTimeout(() => setFaded(true), RING_FADE_MS)
    return () => clearTimeout(timer)
  }, [alpha])

  const drawn = (
    <>
      <CellPictures scene={layer.scene} />
      {grid && layer.outline !== null ? (
        <Path path={layer.outline} color={colours.hairline} style="stroke" strokeWidth={width} />
      ) : null}
    </>
  )

  if (faded) return drawn
  return <Group layer={<Paint opacity={alpha} />}>{drawn}</Group>
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
})
