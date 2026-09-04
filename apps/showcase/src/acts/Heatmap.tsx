import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { withTiming } from 'react-native-reanimated'
import type { Aggregate } from '../engine/aggregate'
import { aggregateCells } from '../engine/aggregate'
import { cellsFromPoints } from '../engine/cells'
import {
  BERLIN,
  blocksOf,
  boxBounds,
  centreOf,
  type PointCache,
  pointStream,
  servesRun,
} from '../engine/points'
import {
  type Change,
  isPushed,
  nextSettings,
  OPEN_SETTINGS,
  POINT_CHOICES,
  PUSH_CELLS,
  PUSH_POINTS,
  PUSH_RES,
  RES_CHOICES,
  type Settings,
} from '../engine/settings'
import { formatCount, formatMs } from '../engine/stats'
import { yieldToLoop } from '../engine/yield'
import { resetWorstGap } from '../render/BlockedReadout'
import { CellPictures } from '../render/CellPictures'
import { EngineCanvas } from '../render/EngineCanvas'
import { bucketsOfCounts } from '../render/heatColours'
import { buildHeatScene, type HeatScene } from '../render/heatScene'
import { Choice, type ChoiceOption } from '../render/hud/Choice'
import { FinePrint } from '../render/hud/FinePrint'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { Row } from '../render/hud/Row'
import { type CameraAnchor, fitTo, useCamera } from '../render/useCamera'
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

const PUSH_NOTE =
  `push it runs ${formatCount(PUSH_POINTS)} points at resolution ${PUSH_RES}, ` +
  `about ${formatCount(PUSH_CELLS)} cells`

/** Milliseconds the camera takes to re-frame the box when a run starts. */
const FIT_MS = 200

// the scene stands in the frame of the box's own centre, which is where the camera opens
const CENTRE: CameraAnchor = centreOf(BERLIN)

const PANEL_TOP = 104
const PRINT_WIDTH = 268
// clears the blocked readout, which stands on the same line at the other edge
const CONTROL_BOTTOM = 118

// the panel already carries eleven rows, so four notes fit a line each and only the last wraps
const NOTES = [
  'the points are synthetic: twelve hotspots over Berlin',
  'past 100,000 points the run works in blocks',
  'the sort and the count then run unchunked on purpose',
  'above 20,000 cells the grid comes off, cells go inset',
  'pans over the push-it scene ran near 40 fps on the emulator, 60 on the simulator',
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
 * one: the points are drawn, `latLngsToCells` locates them, one sort plus a run-length count
 * answers the distinct cells and how busy each is, the counts become colours on a log ramp, and
 * `cellsToBoundaries` and the mesh turn them into what is drawn. Past {@linkcode BLOCK} points the
 * first two stages run block by block with a turn of the loop between them, so the act keeps
 * answering while a million points are placed; the sort that follows is one unchunked pass, and the
 * readout beside it says what that costs.
 */
export function Heatmap({ active }: ActProps) {
  const { width, height } = useWindowDimensions()
  const [settings, setSettings] = useState<Settings>(OPEN_SETTINGS)
  const [run, setRun] = useState<Run | null>(null)
  const [scene, setScene] = useState<HeatScene | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  // the run standing on screen, so paging back to the act does not rebuild what it already holds
  const built = useRef<string | null>(null)
  const framed = useRef(false)
  // the points the last run drew, which a run of the same seed and count locates again
  const drawn = useRef<PointCache | null>(null)

  // the scene stands in the anchor's own metre frame, so a settle has nothing to rebuild
  const settle = useCallback(() => {}, [])
  const camera = useCamera({ anchor: CENTRE, onSettle: settle })
  const { anchor, scale, translateX, translateY } = camera

  /**
   * Frames the whole box, so a run never builds into a view that has been panned off it.
   *
   * The opening frame is written straight, because there is nothing on screen to move away from;
   * every run after it animates, so the visitor sees where the camera went.
   */
  const frameBox = useCallback(
    (animated: boolean) => {
      const fitted = fitTo(boxBounds(BERLIN), width, height)
      if (!animated) {
        scale.value = fitted.scale
        translateX.value = fitted.translateX
        translateY.value = fitted.translateY
        return
      }
      scale.value = withTiming(fitted.scale, { duration: FIT_MS })
      translateX.value = withTiming(fitted.translateX, { duration: FIT_MS })
      translateY.value = withTiming(fitted.translateY, { duration: FIT_MS })
    },
    [width, height, scale, translateX, translateY],
  )

  /** Runs one whole pipeline, reporting the stages as they finish and stopping where cancelled. */
  const execute = useCallback(
    async (wanted: Settings, frame: CameraAnchor, signal: Signal): Promise<void> => {
      // the gaps that follow belong to this run, and the sort is the one it is measured by
      resetWorstGap()
      setScene(null)
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
        const placed = block.from + block.count
        setRun({ ...NOTHING, points: placed, generateMs, cellsMs, cached: held !== null })

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

      const heat = buildHeatScene(aggregate.cells, buckets, frame)

      // the distinct cells, their counts and their colours are dead once the mesh is recorded: the
      // scene holds its own copies, and only the drawn points are kept for the next resolution
      aggregate = null
      buckets = null

      setScene(heat)
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
    },
    [],
  )

  const { seed, points, res } = settings
  const key = `${seed}/${points}/${res}/${anchor.lat},${anchor.lng}`

  useEffect(() => {
    if (!active || built.current === key) return
    frameBox(framed.current)
    framed.current = true
    const signal: Signal = { aborted: false, finished: false }
    void execute({ seed, points, res }, anchor, signal).then(() => {
      if (signal.finished) built.current = key
    })
    return () => {
      signal.aborted = true
    }
  }, [active, key, seed, points, res, anchor, execute, frameBox])

  // every control answers through the one rule, so no control can leave a state the row cannot show
  const change = useCallback((made: Change) => setSettings((held) => nextSettings(held, made)), [])
  const pushed = isPushed(settings)

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
          <Row label="busiest cell" value={stage((of) => `${formatCount(of.busiest)} points`)} />
          <Row label="grid" value={gridOf(scene)} tone="muted" />
          <View style={styles.print}>
            <FinePrint notes={NOTES} />
          </View>
        </Panel>
      </View>
      <View style={styles.control}>
        <Panel align="right">
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
          <Text style={styles.hint}>{PUSH_NOTE}</Text>
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
