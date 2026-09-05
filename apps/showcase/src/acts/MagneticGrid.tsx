import { Group, Paint, Path } from '@shopify/react-native-skia'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  bandHeight,
  cellSpacingM,
  cellsInRings,
  GRID_RES,
  gridReads,
  MAX_K,
  MIN_K,
  OPEN_K,
  REFIT_MS,
  RING_FADE_MS,
  ringsToKeep,
  scaleForDisk,
} from '../engine/rings'
import { formatCount, formatMs } from '../engine/stats'
import { BLOCKED_READOUT_BAND, resetWorstGap } from '../render/BlockedReadout'
import { CellPictures } from '../render/CellPictures'
import { EngineCanvas } from '../render/EngineCanvas'
import { FinePrint } from '../render/hud/FinePrint'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { Row } from '../render/hud/Row'
import { Slider } from '../render/hud/Slider'
import { buildRing, type RingLayer } from '../render/ringScene'
import { type CameraAnchor, useCamera } from '../render/useCamera'
import { useDisposedList } from '../render/useDisposed'
import { colours } from '../theme/tokens'
import type { ActProps } from './types'

// the act's published contract names these; the rules that use them live in engine/rings.ts
export { GRID_RES, MAX_K, MIN_K, RING_FADE_MS, ringsToKeep } from '../engine/rings'

/** Frees a ring the step has dropped; the layer is never in a later list. */
const disposeRing = (layer: RingLayer): void => layer.dispose()

const BERLIN: CameraAnchor = { lat: 52.52, lng: 13.405 }
const PANEL_TOP = 104
const PRINT_WIDTH = 268
const SLIDER_WIDTH = 200
// clears the blocked readout, which stands on the same line at the other edge
const CONTROL_BOTTOM = 118
// a scale this far from the one the act wrote can only have come from the visitor's own pinch
const PINCH_TOLERANCE = 0.002

// the rings still fading in, each held with the append that added it
const NO_RINGS: ReadonlyMap<number, number> = new Map()

// one line each, so the panel stops short of the disk the smallest k draws under it
const NOTES = [
  'a ring is built once, kept until a smaller k drops it',
  'the last three rows sum every ring the last step added',
  'the camera re-fits the disk until a pinch takes it over',
  'the grid lines stand while a cell can carry them',
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
 * smaller k drops it. Colour is the ring's own distance from the centre on a triangle wave over the
 * ramp, so the disk reads as a bullseye at every k and a ring keeps the colour it was recorded in;
 * the act opens framed on {@linkcode OPEN_K}, where a cell carries its own grid line, and re-fits
 * the frame whenever a raised k outgrows it, until the visitor pinches and takes the camera over.
 */
export function MagneticGrid({ active }: ActProps) {
  const { width, height } = useWindowDimensions()
  const [centre, setCentre] = useState<bigint | null>(null)
  const [k, setK] = useState(MIN_K)
  const [layers, setLayers] = useState<RingLayer[]>([])
  const [fading, setFading] = useState<ReadonlyMap<number, number>>(NO_RINGS)
  const [append, setAppend] = useState<Append | null>(null)
  const [walk, setWalk] = useState<Walk | null>(null)
  const [grid, setGrid] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  // the panel's own height, measured, because what it says decides it and the viewport does not
  const [panelHeight, setPanelHeight] = useState(0)

  // the rings already built, held outside the render so a rebuild of the act rebuilds no geometry
  const built = useRef<RingLayer[]>([])
  const frame = useRef<CameraAnchor | null>(null)
  const fades = useRef<ReturnType<typeof setTimeout>[]>([])
  const appends = useRef(0)
  const fits = useRef(0)
  // the act frames the opening disk once, after the panel has said how much room it leaves
  const opened = useRef(false)

  // the rings stand in the anchor's own metre frame, so a settle has nothing to rebuild
  const settle = useCallback(() => {}, [])
  const camera = useCamera({ anchor: BERLIN, onSettle: settle })
  const { anchor, translateX, translateY, scale } = camera

  // the scale the act itself last wrote, and zero until it has framed the disk for the first time
  const framed = useSharedValue(0)
  // true while a re-fit of the act's own is animating, where a moving scale is not a pinch
  const refitting = useSharedValue(false)
  // counts the re-fits, so the callback of one that was interrupted knows it is no longer the last
  const refits = useSharedValue(0)
  // set once the visitor has pinched, after which the camera is theirs until the act opens again
  const pinched = useSharedValue(false)

  const spacing = useMemo(() => cellSpacingM(BERLIN.lat, getHexagonEdgeLengthAvgM), [])

  // the disk is framed in the band the panel and the readout leave open, not in the whole viewport
  const panelBottom = PANEL_TOP + panelHeight
  const band = bandHeight(height, panelBottom, BLOCKED_READOUT_BAND)

  const fitFor = useCallback(
    (rings: number) => scaleForDisk(width, band, BERLIN.lat, getHexagonEdgeLengthAvgM, rings),
    [width, band],
  )

  const frameAt = useCallback(
    (fit: number, animated: boolean) => {
      if (!animated) {
        // the scale goes first, so no reaction over both of them ever runs against the old one
        scale.value = fit
        framed.value = fit
        return
      }
      // and here the flag goes first, so no frame of the animation below is read as a pinch
      refitting.value = true
      // the count is kept on the JS thread, where a write to a shared value is not read back
      fits.current += 1
      const generation = fits.current
      refits.value = generation
      framed.value = fit
      scale.value = withTiming(fit, { duration: REFIT_MS }, () => {
        'worklet'
        // a re-fit that was interrupted must not clear the flag the one that interrupted it set
        if (refits.value === generation) refitting.value = false
      })
    },
    [framed, refitting, refits, scale],
  )

  // only a pinch can leave a scale the act did not write, and waiting for the act's own first
  // frame keeps the opening scale and the re-fit animation from reading as one
  useAnimatedReaction(
    () => scale.value,
    (now) => {
      if (framed.value === 0 || pinched.value || refitting.value) return
      if (Math.abs(now - framed.value) > framed.value * PINCH_TOLERANCE) pinched.value = true
    },
  )

  // the grid answers the UI thread's own reading of the scale, so a pinch brings it in and out
  // without waiting for a settle, and the JS thread hears only the moments it crosses
  useAnimatedReaction(
    () => framed.value !== 0 && gridReads(spacing, scale.value),
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

  // the opening disk stands in the middle of the band, so the smallest disks are clear of the
  // panel instead of under it; it is framed once, and a later fold of the panel leaves it alone
  useEffect(() => {
    if (centre === null || panelHeight === 0 || opened.current) return
    opened.current = true
    translateX.value = width / 2
    translateY.value = panelBottom + band / 2
    frameAt(fitFor(OPEN_K), false)
  }, [centre, width, panelHeight, panelBottom, band, translateX, translateY, fitFor, frameAt])

  // a k that has outgrown the frame pulls the camera back to it, unless the visitor holds the zoom
  useEffect(() => {
    if (centre === null || framed.value === 0 || pinched.value) return
    const fit = fitFor(k)
    if (fit >= scale.value) return
    frameAt(fit, true)
  }, [centre, k, fitFor, frameAt, framed, pinched, scale])

  useEffect(() => {
    if (!active) return
    // the gaps of the builds that follow belong to this act, and to no act before it
    resetWorstGap()
    // an act opened again is the act's camera again
    pinched.value = false
  }, [active, pinched])

  // a fade that outlives its act would leave a ring composited through a layer it no longer needs
  useEffect(() => {
    const timers = fades
    return () => {
      for (const timer of timers.current) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (centre === null) return
    // a re-anchor moves the metre frame, so nothing built in the frame before it can be kept
    const current = frame.current === anchor ? built.current : []
    frame.current = anchor

    const held = new Map(current.map((layer) => [layer.ring, layer]))
    const started = performance.now()
    const added: number[] = []
    let ringMs = 0
    let boundariesMs = 0
    const next = ringsToKeep([...held.keys()], k).map((ring) => {
      const standing = held.get(ring)
      if (standing !== undefined) return standing
      const layer = buildRing(centre, ring, anchor)
      ringMs += layer.ringMs
      boundariesMs += layer.boundariesMs
      added.push(ring)
      return layer
    })

    built.current = next
    setLayers(next)
    // a step that only drops rings built nothing, and the rows that describe a build say so
    if (added.length === 0) {
      setAppend(null)
      return
    }
    setAppend({ ringMs, boundariesMs, buildMs: performance.now() - started })

    // one timer an append rather than one a ring, so a step that adds many ends in one render, and
    // a ring re-added inside the window carries the newer append its fade belongs to
    appends.current += 1
    const generation = appends.current
    setFading((current) => {
      const next = new Map(current)
      for (const ring of added) next.set(ring, generation)
      return next
    })
    const timer = setTimeout(() => {
      fades.current = fades.current.filter((held) => held !== timer)
      setFading((current) => {
        const left = new Map(current)
        for (const ring of added) if (left.get(ring) === generation) left.delete(ring)
        return left
      })
    }, RING_FADE_MS)
    fades.current.push(timer)
  }, [centre, anchor, k])

  const settleK = useCallback(
    (next: number) => {
      if (centre === null) return
      setWalk(walkOf(centre, next))
    },
    [centre],
  )

  useDisposedList(layers, disposeRing)

  const cells = useMemo(() => layers.reduce((total, layer) => total + layer.cells, 0), [layers])
  // the grid carries a tiling of one resolution, so it holds one point wide at any zoom
  const gridWidth = useDerivedValue(() => 1 / scale.value)

  // an act off screen keeps its rings and draws nothing
  if (!active) return <View style={styles.root} />

  return (
    <View style={styles.root}>
      <EngineCanvas camera={camera}>
        {layers.map((layer) => (
          <Ring
            key={layer.ring}
            layer={layer}
            width={gridWidth}
            grid={grid}
            fading={fading.has(layer.ring)}
          />
        ))}
      </EngineCanvas>
      {/* box-none leaves the scene every touch the panel head does not take */}
      <View
        style={styles.panel}
        pointerEvents="box-none"
        onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height)}
      >
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
  /** Whether the ring is still fading in, which is the only time it needs a layer. */
  fading: boolean
}

/**
 * Draws one ring, fading its cells in as it arrives.
 *
 * A recorded picture is drawn straight onto the canvas and takes no paint of its own, so the fade
 * has to come from a layer the picture is composited through. That layer costs an offscreen every
 * frame, which a ring that has finished fading no longer needs and no longer asks for.
 */
const Ring = memo(function Ring({ layer, width, grid, fading }: RingProps) {
  const alpha = useSharedValue(0)

  useEffect(() => {
    alpha.value = withTiming(1, { duration: RING_FADE_MS })
  }, [alpha])

  // asking for the outline is what builds it, so a ring never drawn with a grid never pays for one
  const outline = grid ? layer.outlineOf() : null
  const drawn = (
    <>
      <CellPictures scene={layer.scene} />
      {outline === null ? null : (
        <Path path={outline} color={colours.hairline} style="stroke" strokeWidth={width} />
      )}
    </>
  )

  if (!fading) return drawn
  return <Group layer={<Paint opacity={alpha} />}>{drawn}</Group>
})

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
