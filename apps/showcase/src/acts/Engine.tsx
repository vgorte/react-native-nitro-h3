import { Canvas, Circle, Fill, RadialGradient, Rect, vec } from '@shopify/react-native-skia'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AppState,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import {
  FINALE,
  REFERENCE_CHUNK,
  type Result,
  runWorkload,
  WORKLOADS,
  type Workload,
} from '../engine/bench'
import { formatMs } from '../engine/stats'
import { BlockedReadout, resetWorstGap } from '../render/BlockedReadout'
import { barFraction, MIN_BAR_PX } from '../render/hud/barScale'
import { FinePrint } from '../render/hud/FinePrint'
import { colours, glass, ramp, type } from '../theme/tokens'
import type { ActProps } from './types'

/** Draws the package's bar in the ramp's third stop; h3-js takes the contrast colour. */
const PACKAGE_COLOUR = ramp[2]

const SIDE = 16
const CONTENT_TOP = 96
const METRIC_WIDTH = 124
const VALUE_WIDTH = 72
const COLUMN_GAP = 10
const BAR_LINE = 16
const BAR_HEIGHT = 10
const BAR_INSET = (BAR_LINE - BAR_HEIGHT) / 2
const BAR_LEFT = SIDE + METRIC_WIDTH + COLUMN_GAP
// the bars sit this far below their block's measured line, the offset their own style gives them
const BARS_TOP = 3

// the vignette reaches past the corners, as it does under every other act
const VIGNETTE_REACH = 0.7

const EMSCRIPTEN_NOTE =
  'h3-js is Emscripten output shipped as plain JavaScript, so both sides block the JS thread'

/** Holds the two medians a row's bars are drawn from, live while the workload runs. */
interface Reading {
  own: number
  reference: number
}

const NOTHING: Reading = { own: 0, reference: 0 }

function formatFactor(factor: number): string {
  return `${factor.toFixed(1)}×`
}

function formatReading(ms: number): string {
  return ms === 0 ? '' : formatMs(ms)
}

/**
 * Races the package against h3-js on the four documented workloads and on the finale.
 *
 * One tap runs one workload at exactly the size the benchmark report documents, so the factor this
 * device measures and the factor the report documents describe the same work; the two are labelled
 * apart and never equated. Every row carries its own scale: the h3-js bar is the full track and
 * this package's bar is the share of it that this package took.
 */
export function Engine({ active }: ActProps) {
  const { width, height } = useWindowDimensions()
  const [readings, setReadings] = useState<Record<string, Reading>>({})
  const [results, setResults] = useState<Record<string, Result>>({})
  const [running, setRunning] = useState<string | null>(null)
  const [share, setShare] = useState(0)
  const [armed, setArmed] = useState(false)
  const [blockTops, setBlockTops] = useState<Record<string, number>>({})
  const [barTops, setBarTops] = useState<Record<string, number>>({})
  const busy = useRef(false)
  const signal = useRef({ aborted: false })

  // a run that outlives its act would block the act that follows it
  useEffect(() => {
    if (!active) signal.current.aborted = true
  }, [active])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') signal.current.aborted = true
    })
    return () => subscription.remove()
  }, [])

  // a layout is reported inside its own parent, so a bar sits at its block's place plus its own
  const measureBlock = useCallback((id: string, event: LayoutChangeEvent) => {
    const { y } = event.nativeEvent.layout
    setBlockTops((current) => (current[id] === y ? current : { ...current, [id]: y }))
  }, [])

  const measureBars = useCallback((id: string, event: LayoutChangeEvent) => {
    const { y } = event.nativeEvent.layout
    setBarTops((current) => (current[id] === y ? current : { ...current, [id]: y }))
  }, [])

  const start = useCallback(async (workload: Workload) => {
    if (busy.current) return
    busy.current = true
    setRunning(workload.id)
    setShare(0)
    setArmed(false)
    setReadings((current) => ({ ...current, [workload.id]: NOTHING }))
    // the gap this run causes is its own, so the readout starts from zero
    resetWorstGap()
    signal.current = { aborted: false }

    const chunks = Math.ceil(workload.calls / REFERENCE_CHUNK) * workload.referenceRuns
    const steps = workload.runs + chunks
    let done = 0
    const result = await runWorkload(
      workload,
      (progress) => {
        done += 1
        setShare(done / steps)
        setReadings((current) => {
          const reading = current[workload.id] ?? NOTHING
          if (progress.side === 'package') {
            return { ...current, [workload.id]: { ...reading, own: progress.ms } }
          }
          return { ...current, [workload.id]: { ...reading, reference: progress.ms } }
        })
      },
      signal.current,
    )

    setReadings((current) => ({
      ...current,
      [workload.id]: { own: result.ownMs, reference: result.referenceMs },
    }))
    setResults((current) => ({ ...current, [workload.id]: result }))
    setRunning(null)
    busy.current = false
  }, [])

  // the finale blocks the app, so it takes a second tap on its own warning
  const runFinale = useCallback(() => {
    if (busy.current) return
    if (!armed) {
      setArmed(true)
      return
    }
    void start(FINALE)
  }, [armed, start])

  const track = width - SIDE * 2 - METRIC_WIDTH - VALUE_WIDTH - COLUMN_GAP * 2
  const radius = Math.max(width, height) * VIGNETTE_REACH

  // an act off screen draws nothing
  if (!active) return <View style={styles.root} />

  return (
    <View style={styles.root}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color={colours.ground} />
        <Circle cx={width / 2} cy={height / 2} r={radius}>
          <RadialGradient
            c={vec(width / 2, height / 2)}
            r={radius}
            colors={[colours.vignette, colours.ground]}
          />
        </Circle>
        {Object.entries(barTops).map(([id, y]) =>
          blockTops[id] === undefined ? null : (
            <Bars
              key={id}
              top={CONTENT_TOP + blockTops[id] + y + BARS_TOP}
              track={track}
              reading={readings[id] ?? NOTHING}
              documented={documentedOf(id)}
            />
          ),
        )}
      </Canvas>
      <View style={styles.content}>
        <View style={styles.spread}>
          <Text style={styles.detail}>every row scales to its own h3-js bar, the full track</Text>
          <View style={styles.legend}>
            <View style={[styles.swatch, styles.packageSwatch]} />
            <Text style={styles.detail}>this package</Text>
            <View style={[styles.swatch, styles.referenceSwatch]} />
            <Text style={styles.detail}>h3-js</Text>
          </View>
        </View>
        {WORKLOADS.map((workload) => (
          <WorkloadRow
            key={workload.id}
            workload={workload}
            reading={readings[workload.id] ?? NOTHING}
            result={results[workload.id]}
            running={running === workload.id}
            share={share}
            idle={running === null}
            onMeasureBlock={measureBlock}
            onMeasureBars={measureBars}
            onRun={start}
          />
        ))}
        <View style={styles.finale} onLayout={(event) => measureBlock(FINALE.id, event)}>
          <View style={styles.spread}>
            <Text style={styles.label}>{FINALE.label}</Text>
            <Text style={styles.detail}>{FINALE.detail}</Text>
          </View>
          <Text style={styles.warning}>
            the h3-js side is one unchunked call that cannot be interrupted, so the app is
            unresponsive for several seconds once started
          </Text>
          <Pressable
            style={[styles.control, armed ? styles.armed : null]}
            onPress={runFinale}
            disabled={running !== null}
            accessibilityRole="button"
          >
            <Text style={armed ? styles.armedLabel : styles.controlLabel}>
              {finaleLabel(running === FINALE.id, armed)}
            </Text>
          </Pressable>
          <Measure
            id={FINALE.id}
            reading={readings[FINALE.id] ?? NOTHING}
            result={results[FINALE.id]}
            running={running === FINALE.id}
            share={share}
            onMeasure={measureBars}
          />
        </View>
        <View style={styles.print}>
          <FinePrint notes={[EMSCRIPTEN_NOTE]} />
        </View>
      </View>
      <BlockedReadout />
    </View>
  )
}

function finaleLabel(running: boolean, armed: boolean): string {
  if (running) return 'running, the JS thread is on h3-js'
  return armed ? 'tap again to start' : 'run the finale'
}

function documentedOf(id: string): number | undefined {
  return WORKLOADS.find((workload) => workload.id === id)?.documented
}

interface BarsProps {
  top: number
  track: number
  reading: Reading
  documented: number | undefined
}

/**
 * Draws one row's pair of bars, the h3-js median as the whole track and the package's share of it.
 *
 * Until the h3-js side reports, the share is the one the documented factor implies, so the bar
 * starts where the report says it should and moves to what this device measured.
 */
function Bars({ top, track, reading, documented }: BarsProps) {
  const started = reading.own > 0 || reading.reference > 0
  const implied = documented === undefined || documented <= 0 ? 1 : 1 / documented
  const share = reading.reference > 0 ? barFraction(reading.own, reading.reference) : implied
  return (
    <>
      <Rect
        x={BAR_LEFT}
        y={top + BAR_INSET}
        width={track}
        height={BAR_HEIGHT}
        color={colours.hairline}
      />
      <Rect
        x={BAR_LEFT}
        y={top + BAR_LINE + BAR_INSET}
        width={track}
        height={BAR_HEIGHT}
        color={colours.hairline}
      />
      <Rect
        x={BAR_LEFT}
        y={top + BAR_INSET}
        width={started ? Math.max(MIN_BAR_PX, share * track) : 0}
        height={BAR_HEIGHT}
        color={PACKAGE_COLOUR}
      />
      <Rect
        x={BAR_LEFT}
        y={top + BAR_LINE + BAR_INSET}
        width={reading.reference > 0 ? track : 0}
        height={BAR_HEIGHT}
        color={colours.contrast}
      />
    </>
  )
}

interface MeasureProps {
  id: string
  reading: Reading
  result: Result | undefined
  running: boolean
  share: number
  onMeasure(id: string, event: LayoutChangeEvent): void
}

/** Draws what a row measured: the factor, what the two sides took, and where the bars belong. */
function Measure({ id, reading, result, running, share, onMeasure }: MeasureProps) {
  const settled = running ? undefined : result
  return (
    <View style={styles.measure} onLayout={(event) => onMeasure(id, event)}>
      <View style={styles.factorColumn}>
        <Text style={styles.factor} numberOfLines={1}>
          {settled === undefined || settled.aborted ? '' : formatFactor(settled.factor)}
        </Text>
        <Text style={settled?.aborted === true ? styles.warning : styles.detail}>
          {caption(running, share, settled)}
        </Text>
      </View>
      <View style={styles.bars}>
        <View style={styles.barLine}>
          <Text style={styles.own}>{formatReading(reading.own)}</Text>
        </View>
        <View style={styles.barLine}>
          <Text style={styles.reference}>{formatReading(reading.reference)}</Text>
        </View>
      </View>
    </View>
  )
}

function caption(running: boolean, share: number, settled: Result | undefined): string {
  if (running) return `running, ${Math.round(share * 100)} percent`
  if (settled === undefined) return 'tap to run'
  return settled.aborted ? 'aborted' : 'measured now'
}

interface WorkloadRowProps {
  workload: Workload
  reading: Reading
  result: Result | undefined
  running: boolean
  share: number
  idle: boolean
  onMeasureBlock(id: string, event: LayoutChangeEvent): void
  onMeasureBars(id: string, event: LayoutChangeEvent): void
  onRun(workload: Workload): void
}

/** Draws one workload: what it runs, what it measured now and what the report documents. */
function WorkloadRow({
  workload,
  reading,
  result,
  running,
  share,
  idle,
  onMeasureBlock,
  onMeasureBars,
  onRun,
}: WorkloadRowProps) {
  const chunked = workload.calls > REFERENCE_CHUNK
  return (
    <Pressable
      style={styles.row}
      onPress={() => onRun(workload)}
      onLayout={(event) => onMeasureBlock(workload.id, event)}
      disabled={!idle}
      accessibilityRole="button"
    >
      <View style={styles.spread}>
        <Text style={styles.label}>{workload.label}</Text>
        {workload.documented === undefined ? null : (
          <Text style={styles.detail} numberOfLines={1}>
            {`documented, iPhone XS ${formatFactor(workload.documented)}`}
          </Text>
        )}
      </View>
      <View style={styles.spread}>
        <Text style={styles.detail} numberOfLines={1}>
          {workload.detail}
        </Text>
        {chunked && result !== undefined && !result.aborted && !running ? (
          <Text style={styles.detail} numberOfLines={1}>
            {`h3-js wall ${formatMs(result.referenceWallMs)}`}
          </Text>
        ) : null}
      </View>
      <Measure
        id={workload.id}
        reading={reading}
        result={result}
        running={running}
        share={share}
        onMeasure={onMeasureBars}
      />
    </Pressable>
  )
}

const valueColumn = { lineHeight: 16, width: VALUE_WIDTH, textAlign: 'right' } as const

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colours.ground,
  },
  content: {
    position: 'absolute',
    top: CONTENT_TOP,
    left: SIDE,
    right: SIDE,
  },
  spread: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 8, height: 8 },
  packageSwatch: { backgroundColor: PACKAGE_COLOUR },
  referenceSwatch: { backgroundColor: colours.contrast },
  row: { marginTop: 10 },
  label: { ...type.value, lineHeight: 16, color: colours.text },
  detail: { ...type.label, lineHeight: 14, color: colours.muted },
  warning: { ...type.label, lineHeight: 14, color: colours.contrast },
  measure: { flexDirection: 'row', alignItems: 'flex-start', gap: COLUMN_GAP, marginTop: 4 },
  factorColumn: { width: METRIC_WIDTH },
  factor: { ...type.metric, lineHeight: 36, height: 36, color: colours.text },
  bars: { flex: 1, marginTop: BARS_TOP },
  barLine: { height: BAR_LINE, justifyContent: 'center', alignItems: 'flex-end' },
  own: { ...type.value, ...valueColumn, color: colours.text },
  reference: { ...type.value, ...valueColumn, color: colours.contrast },
  finale: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colours.hairline,
  },
  control: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: glass.border,
    borderRadius: glass.radius,
    backgroundColor: glass.fill,
    paddingVertical: 9,
    alignItems: 'center',
  },
  print: { marginTop: 14 },
  armed: { borderColor: colours.contrast },
  controlLabel: { ...type.value, lineHeight: 16, color: colours.text },
  armedLabel: { ...type.value, lineHeight: 16, color: colours.contrast },
})
