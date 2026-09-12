import React from 'react'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { WorkloadId } from './benchmarkPlan'
import { formatProgress, parseWorkloadIds } from './benchmarkPlan'
import type { PlanEntry, Row, RunSignal, RunState, Stats } from './benchmarkWorkloads'
import { initialPlan, runBenchmark } from './benchmarkWorkloads'

// the unified log on iOS truncates a message at about a kilobyte
const CHUNK = 700

// the cards are listed before the first run; a run reports its own plan, with `W8`'s fitted label
const PLAN = initialPlan()

interface Payload {
  rows: {
    workload: string
    runs: number
    millis: number
    referenceMillis: number | null
    equivalent: boolean
    stats: { millis: Stats; referenceMillis: Stats | null }
    detail: string
  }[]
  measuredOn: {
    platform: string
    // Android only: iOS exposes no model, and the key is then absent from the JSON
    device?: string
    osVersion: string
    build: string
    reactNative: string
    hermes: string
    h3js: string
    date: string
    warmupRuns: number
    durationSeconds: number
  }
}

// Metro defines `__DEV__` as a global; reading it off `globalThis` needs no ambient declaration,
// which this app's empty `types` list (`tsconfig.json`) would not provide.
function isDebugBuild(): boolean {
  return (globalThis as { __DEV__?: boolean }).__DEV__ === true
}

function deviceModel(): string | undefined {
  if (Platform.OS !== 'android') {
    return undefined
  }
  const { Manufacturer, Model } = Platform.constants
  return `${Manufacturer} ${Model}`
}

function reactNativeVersion(): string {
  const { major, minor, patch } = Platform.constants.reactNativeVersion
  return `${major}.${minor}.${patch}`
}

function hermesVersion(): string {
  const hermes = (
    globalThis as { HermesInternal?: { getRuntimeProperties?(): Record<string, string> } }
  ).HermesInternal
  return hermes?.getRuntimeProperties?.()['OSS Release Version'] ?? 'unknown'
}

function formatMillis(millis: number): string {
  return millis < 1 ? millis.toFixed(3) : millis.toFixed(1)
}

// a per-call row carries p95 beside median, the tail users feel
function formatStats(stats: Stats, singleCall: boolean): string {
  const median = formatMillis(stats.median)
  return singleCall ? `${median} / ${formatMillis(stats.p95)} ms` : `${median} ms`
}

function formatReference(row: Row): string {
  return row.referenceStats == null ? 'n/a' : formatStats(row.referenceStats, row.singleCall)
}

// a missing reference and an unmeasurable own time both mean no factor, as in the SVG script
function factorOf(row: Row): number | undefined {
  if (row.referenceMillis == null || row.millis <= 0) {
    return undefined
  }
  return row.referenceMillis / row.millis
}

function formatFactor(factor: number): string {
  return factor >= 10 ? factor.toFixed(0) : factor.toFixed(1)
}

// the run count is read back off the rows, naming whichever workloads differ from the common one
function runSummary(rows: Row[]): string {
  const tally = new Map<number, number>()
  for (const row of rows) {
    tally.set(row.runs, (tally.get(row.runs) ?? 0) + 1)
  }
  const [common] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] as [number, number]
  const named = new Set<string>()
  const exceptions: string[] = []
  for (const row of rows) {
    // variants of one workload share an id and are named once
    const id = row.workload.split(' ')[0] as string
    if (row.runs === common || named.has(id)) {
      continue
    }
    named.add(id)
    exceptions.push(`${row.runs} for ${id}`)
  }
  return exceptions.length === 0 ? `${common} runs` : `${common} runs, ${exceptions.join(', ')}`
}

function caption(rows: Row[], seconds: number): string {
  const build = isDebugBuild() ? 'Debug, not usable' : 'Release'
  const differing = rows.filter((row) => !row.equivalent).map((row) => row.workload)
  const warning =
    differing.length === 0 ? '' : ` RESULTS DIFFER FROM h3-js: ${differing.join(', ')}.`
  return (
    `Measured on ${Platform.OS} ${String(Platform.Version)}, ${build}, ` +
    `react-native ${reactNativeVersion()}, Hermes ${hermesVersion()}, against h3-js 4.5.0; ` +
    `median of ${runSummary(rows)} after one warm-up, ${seconds.toFixed(0)} s total.` +
    warning
  )
}

function toMarkdown(rows: Row[], seconds: number): string {
  const header =
    '| Workload | react-native-nitro-h3 | h3-js | Equivalent | Result |\n|---|---:|---:|:-:|---|'
  const body = rows
    .map((row) => {
      const equivalent = row.equivalent ? 'yes' : 'no'
      const own = formatStats(row.stats, row.singleCall)
      return `| ${row.workload} | ${own} | ${formatReference(row)} | ${equivalent} | ${row.detail} |`
    })
    .join('\n')
  return `${header}\n${body}\n\n${caption(rows, seconds)}`
}

// `null`, not `undefined`: `JSON.stringify` would drop the key entirely
function toPayload(rows: Row[], seconds: number): Payload {
  return {
    rows: rows.map((row) => ({
      workload: row.workload,
      runs: row.runs,
      millis: row.millis,
      referenceMillis: row.referenceMillis ?? null,
      equivalent: row.equivalent,
      stats: { millis: row.stats, referenceMillis: row.referenceStats ?? null },
      detail: row.detail,
    })),
    measuredOn: {
      platform: Platform.OS,
      device: deviceModel(),
      osVersion: String(Platform.Version),
      build: isDebugBuild() ? 'Debug' : 'Release',
      reactNative: reactNativeVersion(),
      hermes: hermesVersion(),
      h3js: '4.5.0',
      date: new Date().toISOString().slice(0, 10),
      warmupRuns: 1,
      durationSeconds: Number(seconds.toFixed(1)),
    },
  }
}

// `os_log` trims a line's outer whitespace and rewrites a backslash, so neither a raw nor a quoted
// chunk survives intact; the bars pin both edges.
function logPayload(payload: Payload): void {
  const text = JSON.stringify(payload)
  const total = Math.ceil(text.length / CHUNK)
  for (let index = 0; index < total; index++) {
    const chunk = text.slice(index * CHUNK, (index + 1) * CHUNK)
    console.log(`BENCHMARK_JSON ${index + 1}/${total} |${chunk}|`)
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// the JavaScript thread is blocked for the length of a sample, so this line only moves between
// samples; the spinner beside it is native and keeps turning throughout
function progressLabel(state: RunState): string {
  if (state.passes === 0) {
    return 'starting'
  }
  return state.pass === 0
    ? `${state.engine}, warm-up`
    : `${state.engine}, pass ${state.pass}/${state.passes}`
}

function Measure({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.measure}>
      <Text style={styles.measureLabel}>{label}</Text>
      <Text style={styles.measureValue}>{value}</Text>
    </View>
  )
}

function Status({ row, running }: { row: Row | undefined; running: boolean }): React.JSX.Element {
  if (row != null) {
    return (
      <Text style={row.equivalent ? styles.equivalent : styles.differs}>
        {row.equivalent ? '✓' : '✗'}
      </Text>
    )
  }
  if (running) {
    return <ActivityIndicator size="small" />
  }
  return <Text style={styles.waiting}>-</Text>
}

function WorkloadCard({
  entry,
  row,
  progress,
  running,
  onRun,
}: {
  entry: PlanEntry
  row: Row | undefined
  progress: string | undefined
  running: boolean
  onRun: (id: WorkloadId) => void
}): React.JSX.Element {
  const factor = row == null ? undefined : factorOf(row)
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={row == null ? styles.workloadWaiting : styles.workload}>
          {row?.workload ?? entry.label}
        </Text>
        <Status row={row} running={progress != null} />
        <Pressable
          accessibilityLabel={`Run ${entry.id}`}
          disabled={running}
          onPress={() => {
            onRun(entry.id)
          }}
        >
          <Text style={running ? styles.runOneDisabled : styles.runOne}>Run</Text>
        </Pressable>
      </View>
      {row == null ? undefined : (
        <View style={styles.measures}>
          <Measure label="react-native-nitro-h3" value={formatStats(row.stats, row.singleCall)} />
          <Measure label="h3-js" value={formatReference(row)} />
          <View style={styles.measure}>
            <Text style={styles.measureLabel}>factor</Text>
            <Text style={styles.factor}>{factor == null ? 'n/a' : `${formatFactor(factor)}×`}</Text>
          </View>
        </View>
      )}
      {row == null ? undefined : <Text style={styles.detail}>{row.detail}</Text>}
      {progress == null ? undefined : <Text style={styles.detail}>{progress}</Text>}
    </View>
  )
}

function buttonLabel(running: boolean, workloads: string): string {
  if (running) {
    return 'Running'
  }
  return workloads.trim() === '' ? 'Run full benchmark' : 'Run selected workloads'
}

// a subset says so, so a short list of rows is not read as a full run
function summaryLine(
  rows: number,
  planned: number,
  selected: number,
  seconds: number | undefined,
): string {
  if (selected === planned) {
    return seconds == null
      ? `${rows} of ${planned} workloads`
      : `${rows} workloads, ${seconds.toFixed(0)} s`
  }
  return seconds == null
    ? `${rows} of ${selected} workloads, subset of ${planned}`
    : `${rows} workloads, subset of ${planned}, ${seconds.toFixed(0)} s`
}

function Results({
  plan,
  state,
  seconds,
  selected,
  running,
  onRun,
}: {
  plan: PlanEntry[]
  state: RunState | undefined
  seconds: number | undefined
  selected: number
  running: boolean
  onRun: (id: WorkloadId) => void
}): React.JSX.Element {
  const rows = state?.rows ?? []
  return (
    <View style={styles.results}>
      {state == null ? undefined : (
        <Text style={styles.summaryMeta}>
          {summaryLine(rows.length, plan.length, selected, seconds)}
        </Text>
      )}
      {plan.map((entry, index) => (
        <WorkloadCard
          key={entry.id}
          entry={entry}
          row={rows.find((row) => row.id === entry.id)}
          progress={
            state != null && seconds == null && index === state.index
              ? progressLabel(state)
              : undefined
          }
          running={running}
          onRun={onRun}
        />
      ))}
      {seconds == null ? undefined : <Text style={styles.caption}>{caption(rows, seconds)}</Text>}
    </View>
  )
}

/**
 * Renders the benchmark behind the README's table, timing each workload against `h3-js` in the same
 * engine and the same run.
 *
 * Only a Release build says anything: a Debug build is several times slower, and the caption records
 * which one produced the numbers.
 */
export function BenchmarkScreen(): React.JSX.Element {
  const [state, setState] = React.useState<RunState | undefined>(undefined)
  const [seconds, setSeconds] = React.useState<number | undefined>(undefined)
  const [running, setRunning] = React.useState(false)
  const [failure, setFailure] = React.useState<string | undefined>(undefined)
  const [workloads, setWorkloads] = React.useState('')
  const [selected, setSelected] = React.useState(PLAN.length)
  const signal = React.useRef<RunSignal | undefined>(undefined)
  // a failing run reports rows reached before the setter commits them
  const latest = React.useRef<RunState | undefined>(undefined)

  // leaving the tab abandons the run, so the thread goes back to the app instead of finishing
  // measurements nothing will read
  React.useEffect(() => {
    return () => {
      if (signal.current != null) {
        signal.current.cancelled = true
      }
    }
  }, [])

  const run = React.useCallback((ids: readonly WorkloadId[]) => {
    const current: RunSignal = { cancelled: false }
    signal.current = current
    latest.current = undefined
    setRunning(true)
    setState(undefined)
    setSeconds(undefined)
    setFailure(undefined)
    setSelected(ids.length)
    const startedAt = Date.now()
    // a frame, so the disabled button paints before the workload starts
    requestAnimationFrame(() => {
      // the host script follows a long run off these lines, one per finished workload
      let logged = 0
      console.log(formatProgress({ kind: 'start', selected: [...ids], planned: PLAN.length }))
      void runBenchmark(
        current,
        (next) => {
          latest.current = next
          while (logged < next.rows.length) {
            const row = next.rows[logged] as Row
            logged += 1
            console.log(
              formatProgress({
                kind: 'done',
                id: row.id,
                position: logged,
                selected: ids.length,
                millis: row.millis,
                referenceMillis: row.referenceMillis ?? null,
                elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
              }),
            )
          }
          if (!current.cancelled) {
            setState(next)
          }
        },
        ids,
      )
        .then((measured) => {
          if (measured == null) {
            return
          }
          setSeconds(measured.seconds)
          console.log(toMarkdown(measured.rows, measured.seconds))
          logPayload(toPayload(measured.rows, measured.seconds))
        })
        .catch((error: unknown) => {
          console.error('benchmark run failed', error)
          const rows = latest.current?.rows ?? []
          setFailure(
            `${describe(error)} after ${rows.length} of ${latest.current?.plan.length ?? 0}`,
          )
          if (rows.length === 0) {
            return
          }
          const elapsed = (Date.now() - startedAt) / 1000
          console.log(toMarkdown(rows, elapsed))
          logPayload(toPayload(rows, elapsed))
        })
        .finally(() => {
          // an abandoned run must not touch the state of a screen that is gone
          if (!current.cancelled) {
            setRunning(false)
          }
        })
    })
  }, [])

  const runTyped = React.useCallback(() => {
    const parsed = parseWorkloadIds(workloads)
    if (parsed.ids === undefined) {
      setFailure(parsed.error)
      return
    }
    run(parsed.ids)
  }, [run, workloads])

  const runOne = React.useCallback(
    (id: WorkloadId) => {
      run([id])
    },
    [run],
  )

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Benchmark</Text>
      <Text style={styles.note}>
        Run this in a Release build. Numbers from a Debug build must not go in the README. The app
        only answers between measurements, and leaving this tab abandons the run.
      </Text>
      <Text style={styles.inputLabel}>Workloads</Text>
      <TextInput
        style={styles.input}
        value={workloads}
        onChangeText={setWorkloads}
        accessibilityLabel="Workload ids"
        placeholder="All, or ids such as W13, W7"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!running}
        returnKeyType="go"
        onSubmitEditing={runTyped}
      />
      <Pressable style={styles.button} onPress={runTyped} disabled={running}>
        <Text style={styles.buttonLabel}>{buttonLabel(running, workloads)}</Text>
      </Pressable>
      <Results
        plan={state?.plan ?? PLAN}
        state={state}
        seconds={seconds}
        selected={selected}
        running={running}
        onRun={runOne}
      />
      {failure == null ? undefined : <Text style={styles.failure}>Run failed: {failure}</Text>}
    </ScrollView>
  )
}

const HIGHLIGHT = '#1a7f37'
const MUTED = '#6b6b6b'

const styles = StyleSheet.create({
  content: { padding: 20 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  note: { fontSize: 13, marginBottom: 16 },
  inputLabel: { fontSize: 11, color: MUTED, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#e4e4e4',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 14,
    marginBottom: 12,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#1f6feb',
  },
  buttonLabel: { color: 'white', fontSize: 16, textAlign: 'center' },
  results: { marginTop: 20, gap: 10 },
  summaryMeta: { fontSize: 13, color: MUTED },
  card: { borderWidth: 1, borderColor: '#e4e4e4', borderRadius: 10, padding: 12, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  workload: { flex: 1, fontSize: 14, fontWeight: '600' },
  workloadWaiting: { flex: 1, fontSize: 14, color: MUTED },
  equivalent: { fontSize: 15, fontWeight: '700', color: HIGHLIGHT },
  differs: { fontSize: 15, fontWeight: '700', color: '#b3261e' },
  waiting: { fontSize: 15, color: MUTED },
  runOne: { fontSize: 13, color: '#1f6feb' },
  runOneDisabled: { fontSize: 13, color: MUTED },
  measures: { flexDirection: 'row', gap: 12 },
  measure: { flex: 1, gap: 2 },
  measureLabel: { fontSize: 11, color: MUTED },
  measureValue: { fontSize: 15, fontVariant: ['tabular-nums'] },
  factor: { fontSize: 15, fontWeight: '700', color: HIGHLIGHT, fontVariant: ['tabular-nums'] },
  detail: { fontSize: 12, color: MUTED },
  failure: { fontSize: 13, color: '#b3261e', marginTop: 12 },
  caption: { fontSize: 11, lineHeight: 16, color: MUTED, marginTop: 6 },
})
