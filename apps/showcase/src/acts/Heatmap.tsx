import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { aggregateCells } from '../engine/aggregate'
import { cellsFromPoints } from '../engine/cells'
import {
  BERLIN,
  blocksOf,
  boxBounds,
  bucketsOfCounts,
  centreOf,
  pointStream,
} from '../engine/points'
import { formatCount, formatMs } from '../engine/stats'
import { resetWorstGap } from '../render/BlockedReadout'
import { CellPictures } from '../render/CellPictures'
import { EngineCanvas } from '../render/EngineCanvas'
import { buildHeatScene, type HeatScene } from '../render/heatScene'
import { Choice, type ChoiceOption } from '../render/hud/Choice'
import { FinePrint } from '../render/hud/FinePrint'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { Row } from '../render/hud/Row'
import { type CameraAnchor, useCamera } from '../render/useCamera'
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
} from '../engine/points'

/** The seed the act opens on, which the reseed control bumps. */
const OPEN_SEED = 1

/** Points and resolution the act opens on, one unchunked block of a city's worth of cells. */
const OPEN_POINTS = 100_000
const OPEN_RES = 9

/** Points and resolution of the push-it step, the largest set the act builds. */
const PUSH_POINTS = 1_000_000
const PUSH_RES = 10

const POINT_OPTIONS: readonly ChoiceOption<number>[] = [
  { value: 100_000, label: '100,000' },
  { value: 1_000_000, label: '1,000,000' },
]

const RES_OPTIONS: readonly ChoiceOption<number>[] = [
  { value: 7, label: '7' },
  { value: 8, label: '8' },
  { value: 9, label: '9' },
]

// the scene stands in the frame of the box's own centre, which is where the camera opens
const CENTRE: CameraAnchor = centreOf(BERLIN)

const PANEL_TOP = 104
const PRINT_WIDTH = 268
// clears the blocked readout, which stands on the same line at the other edge
const CONTROL_BOTTOM = 118

const NOTES = [
  'the points are synthetic, drawn from twelve gaussian hotspots over the Berlin box',
  'above 100,000 points the run generates and locates in blocks and yields between them',
  'the sort and the count run once over the whole buffer, which is the block the readout reports',
  'above 20,000 cells the grid comes off and every cell is drawn inset instead',
]

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Holds what one run has measured, a field per stage, filled in as the stages finish. */
interface Run {
  /** Points generated and located so far, which grows block by block. */
  points: number
  generateMs: number
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
  cellsMs: 0,
  distinct: 0,
  aggregateMs: 0,
  coloursMs: 0,
  boundariesMs: 0,
  meshMs: 0,
  busiest: 0,
  done: false,
}

/** Carries a run's cancellation, and whether it got far enough to leave a scene standing. */
interface Signal {
  aborted: boolean
  finished: boolean
}

/** Names the geometry the cell count picked: the strip up to the ceiling, the inset above it. */
function gridOf(scene: HeatScene | null): string {
  if (scene === null) return '-'
  return scene.outlined ? 'outline strip' : 'inset cells'
}

/**
 * Drops a million synthetic points on Berlin and colours the cells they land in.
 *
 * One tap on a control starts a run, and a run is the whole pipeline in stages the HUD names one by
 * one: the points are drawn, `latLngsToCells` locates them, one sort plus a run-length count answers
 * the distinct cells and how busy each is, the counts become colours on a logarithmic ramp, and
 * `cellsToBoundaries` and the mesh turn them into what is drawn. Past {@linkcode BLOCK} points the
 * first two stages run block by block with a turn of the loop between them, so the act keeps
 * answering while a million points are placed; the sort that follows is one unchunked pass, and the
 * readout beside it says what that costs.
 */
export function Heatmap({ active }: ActProps) {
  const { width, height } = useWindowDimensions()
  const [seed, setSeed] = useState(OPEN_SEED)
  const [points, setPoints] = useState(OPEN_POINTS)
  const [res, setRes] = useState(OPEN_RES)
  const [run, setRun] = useState<Run | null>(null)
  const [scene, setScene] = useState<HeatScene | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  // the run standing on screen, so paging back to the act does not rebuild what it already holds
  const built = useRef<string | null>(null)
  const framed = useRef(false)

  // the scene stands in the anchor's own metre frame, so a settle has nothing to rebuild
  const settle = useCallback(() => {}, [])
  const camera = useCamera({ anchor: CENTRE, onSettle: settle })
  const { anchor, fit } = camera

  /** Runs one whole pipeline, reporting the stages as they finish and stopping where cancelled. */
  const execute = useCallback(
    async (
      wanted: { seed: number; points: number; res: number },
      frame: CameraAnchor,
      signal: Signal,
    ): Promise<void> => {
      // the gaps that follow belong to this run, and the sort is the one it is measured by
      resetWorstGap()
      setScene(null)
      setRun(NOTHING)

      const draw = pointStream(wanted.seed, BERLIN)
      const blocks = blocksOf(wanted.points)
      const cells = new BigUint64Array(wanted.points)
      let generateMs = 0
      let cellsMs = 0

      for (const block of blocks) {
        if (signal.aborted) return
        const started = performance.now()
        const drawn = draw(block.count)
        generateMs += performance.now() - started

        const located = cellsFromPoints(drawn, wanted.res)
        cellsMs += located.ms
        cells.set(located.value, block.from)
        setRun({ ...NOTHING, points: block.from + block.count, generateMs, cellsMs })

        // a chunked run leaves the loop a turn between blocks, so the act answers while it runs
        if (blocks.length > 1) await yieldToLoop()
      }
      if (signal.aborted) return

      const sorted = performance.now()
      const aggregate = aggregateCells(cells)
      const aggregateMs = performance.now() - sorted

      const coloured = performance.now()
      const buckets = bucketsOfCounts(aggregate.counts, aggregate.max, BUCKETS)
      const coloursMs = performance.now() - coloured

      const heat = buildHeatScene(aggregate.cells, buckets, frame)

      setScene(heat)
      setRun({
        points: wanted.points,
        generateMs,
        cellsMs,
        distinct: aggregate.cells.length,
        aggregateMs,
        coloursMs,
        boundariesMs: heat.boundariesMs,
        meshMs: heat.meshMs,
        busiest: aggregate.max,
        done: true,
      })
      signal.finished = true
    },
    [],
  )

  const key = `${seed}/${points}/${res}/${anchor.lat},${anchor.lng}`

  useEffect(() => {
    if (!active || built.current === key) return
    const signal: Signal = { aborted: false, finished: false }
    void execute({ seed, points, res }, anchor, signal).then(() => {
      if (signal.finished) built.current = key
    })
    return () => {
      signal.aborted = true
    }
  }, [active, key, seed, points, res, anchor, execute])

  // the act opens on the whole box, and keeps whatever the visitor has panned to afterwards
  useEffect(() => {
    if (!active || framed.current) return
    framed.current = true
    fit(boxBounds(BERLIN), width, height)
  }, [active, width, height, fit])

  const pushed = points === PUSH_POINTS && res === PUSH_RES
  const pushIt = useCallback(() => {
    setPoints(PUSH_POINTS)
    setRes(PUSH_RES)
  }, [])

  /** Reads a stage off the run, which only a finished run has measured. */
  const stage = (of: (run: Run) => string): string => (run?.done === true ? of(run) : '-')

  // an act off screen keeps its scene and draws nothing
  if (!active) return <View style={styles.root} />

  return (
    <View style={styles.root}>
      <EngineCanvas camera={camera}>
        <CellPictures scene={scene?.scene ?? null} />
      </EngineCanvas>
      {/* box-none leaves the scene every touch the panel head does not take */}
      <View style={styles.panel} pointerEvents="box-none">
        <Panel collapsible collapsed={collapsed} onToggle={() => setCollapsed((held) => !held)}>
          <Metric value={formatCount(run?.points ?? 0)} caption="points placed" />
          <Row label="resolution" value={`${res}`} />
          <Row label="generate" value={run === null ? '-' : formatMs(run.generateMs)} />
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
          <Row label="busiest cell" value={stage((of) => `${formatCount(of.busiest)} points`)} />
          <Row label="grid" value={gridOf(scene)} tone="muted" />
          <View style={styles.print}>
            <FinePrint notes={NOTES} />
          </View>
        </Panel>
      </View>
      <View style={styles.control}>
        <Panel align="right">
          <Choice label="points" options={POINT_OPTIONS} value={points} onChange={setPoints} />
          <Choice label="resolution" options={RES_OPTIONS} value={res} onChange={setRes} />
          <Text style={styles.hint}>push it runs 1,000,000 points at resolution 10</Text>
          <View style={styles.buttons}>
            <Pressable
              style={styles.button}
              onPress={() => setSeed((current) => current + 1)}
              accessibilityRole="button"
            >
              <Text style={styles.buttonLabel}>reseed</Text>
            </Pressable>
            <Pressable
              style={[styles.button, pushed ? styles.pushed : null]}
              onPress={pushIt}
              accessibilityRole="button"
            >
              <Text style={pushed ? styles.pushedLabel : styles.buttonLabel}>push it</Text>
            </Pressable>
          </View>
        </Panel>
      </View>
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
  hint: { ...type.label, color: colours.muted },
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
