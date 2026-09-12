import h3 from 'h3-js'
import type { CellBoundaries, LatLng, Ring } from 'react-native-nitro-h3'
import {
  cellsToBoundaries,
  cellsToLatLngs,
  cellsToMultiPolygon,
  cellToBoundary,
  cellToChildren,
  cellToChildrenSize,
  cellToLatLng,
  compactCells,
  getResolution,
  gridDisk,
  gridPathCells,
  latLngsToCells,
  latLngToCell,
  polygonToCells,
  polygonToCellsAsync,
  uncompactCells,
  uncompactCellsAsync,
} from 'react-native-nitro-h3'
import { WORKLOAD_IDS, type WorkloadId } from './benchmarkPlan'

const SAN_FRANCISCO = { lat: 37.7749, lng: -122.4194 }
const BERLIN = { lat: 52.52, lng: 13.405 }
const HAMBURG = { lat: 53.5511, lng: 9.9937 }

// the polygon of the measurement that justified the package: San Francisco, res 12, 412,377 cells
const SAN_FRANCISCO_POLYGON: Ring[] = [
  [
    [37.81331899998324, -122.40898669999721],
    [37.71980619999785, -122.35447369999936],
    [37.70761319999757, -122.5123436999984],
    [37.78358719999717, -122.5247187000022],
    [37.815157199999845, -122.4798767000009],
  ],
]

const RUNS = 20
// one pass of these workloads costs `h3-js` seconds, so they get far fewer runs
const RUNS_SLOW = 3
const CALLS = 100_000
const CALLS_PER_RUN = 1_000
const DISK_K = 20
const EPSILON = 1e-9

// one sample is one call, the tap a user waits for
const SINGLE_CALLS = 1_000
const SINGLE_CALL_STEP = 0.001
const SINGLE_CALL_COLUMNS = 40
// the same grid at the size a batch is written for
const BATCH_STEP = 0.001
const BATCH_COLUMNS = 320
// a macrotask between two single calls would cost more than the calls themselves
const SINGLE_CALL_YIELD = 100

// the factor against the work one call does; `k=20` stays `W2`
const DISK_SERIES: { id: WorkloadId; k: number; runs: number }[] = [
  { id: 'W2a', k: 1, runs: RUNS },
  { id: 'W2b', k: 5, runs: RUNS },
  { id: 'W2c', k: 10, runs: RUNS },
  // 7,651 cells per call, so a thousand `h3-js` calls run into seconds
  { id: 'W2d', k: 50, runs: RUNS_SLOW },
]

const UNCOMPACT_RES = 12
const CHILDREN_PARENT_RES = 5
const CHILDREN_RES = 10
const PATH_RES = 9
// the benchmark's own budget, 32 MB packed, so `W8` cannot exhaust the phone's heap
const UNCOMPACT_BUDGET = 4_000_000

const OWN = 'react-native-nitro-h3'
const REFERENCE = 'h3-js'
const BASELINE = 'empty-body baseline'

// every label is written once: the plan the screen lists up front and the row pushed afterwards
const LABELS = {
  w0: 'W0 latLngToCell, one call per sample',
  w1: 'W1 latLngToCell x 100,000',
  w2: `W2 gridDisk(k=${DISK_K}) x 1,000`,
  w3: 'W3 polygonToCells, SF, res 12',
  w3Async: 'W3 polygonToCellsAsync, SF, res 12',
  w4: `W4 compactCells of a k=${DISK_K} disk`,
  w5: `W5 cellsToMultiPolygon of a k=${DISK_K} disk`,
  w6: 'W6 cellToLatLng x 100,000',
  w7: 'W7 cellToBoundary x 100,000',
  w9: `W9 cellToChildren, res ${CHILDREN_PARENT_RES} to res ${CHILDREN_RES}`,
  w10: `W10 gridPathCells, Berlin to Hamburg, res ${PATH_RES} x 1,000`,
  w11: 'W11 latLngsToCells x 100,000 pairs',
  w12: 'W12 cellsToLatLngs x 100,000 cells',
  w13: 'W13 cellsToBoundaries x 100,000 cells',
}

function diskSeriesLabel(series: { id: string; k: number }): string {
  return `${series.id} gridDisk(k=${series.k}) x 1,000`
}

function uncompactLabel(res: number, asynchronous: boolean): string {
  return `W8 uncompactCells${asynchronous ? 'Async' : ''}, SF res 9 compacted, to res ${res}`
}

/** One card of the plan: the workload's id and the label the row carries. */
export interface PlanEntry {
  id: WorkloadId
  label: string
}

function planOf(uncompactRes: number): PlanEntry[] {
  return [
    { id: 'W0', label: LABELS.w0 },
    { id: 'W1', label: LABELS.w1 },
    { id: 'W2', label: LABELS.w2 },
    ...DISK_SERIES.map((series) => ({ id: series.id, label: diskSeriesLabel(series) })),
    { id: 'W3', label: LABELS.w3 },
    { id: 'W3Async', label: LABELS.w3Async },
    { id: 'W4', label: LABELS.w4 },
    { id: 'W5', label: LABELS.w5 },
    { id: 'W6', label: LABELS.w6 },
    { id: 'W7', label: LABELS.w7 },
    { id: 'W8', label: uncompactLabel(uncompactRes, false) },
    { id: 'W8Async', label: uncompactLabel(uncompactRes, true) },
    { id: 'W9', label: LABELS.w9 },
    { id: 'W10', label: LABELS.w10 },
    { id: 'W11', label: LABELS.w11 },
    { id: 'W12', label: LABELS.w12 },
    { id: 'W13', label: LABELS.w13 },
  ]
}

/**
 * Returns the plan the screen lists before a run.
 *
 * The budget can drop `W8`'s resolution, so a run reports its own plan; only the labels differ.
 */
export function initialPlan(): PlanEntry[] {
  return planOf(UNCOMPACT_RES)
}

export interface Stats {
  median: number
  p95: number
  min: number
  max: number
}

export interface Row {
  id: WorkloadId
  workload: string
  runs: number
  millis: number
  referenceMillis: number | undefined
  stats: Stats
  referenceStats: Stats | undefined
  equivalent: boolean
  detail: string
  // one sample is one call, so p95 belongs beside the median
  singleCall: boolean
}

/**
 * Reports what the run is doing between two samples, so the screen can show one line per workload.
 *
 * `index` is the plan position of the workload being measured; a subset run skips the positions it
 * did not select. `passes` of `0` means the workload has not started timing yet.
 */
export interface RunState {
  plan: PlanEntry[]
  rows: Row[]
  index: number
  engine: string
  pass: number
  passes: number
}

const performanceApi = (globalThis as { performance?: { now(): number } }).performance
// resolved at load, so no lookup happens inside the timed window
const now: () => number =
  performanceApi != null ? performanceApi.now.bind(performanceApi) : Date.now

function statsOf(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b)
  const last = sorted.length - 1
  // the median takes the upper of the two middle samples on an even count
  const median = sorted[Math.min(last, Math.floor(0.5 * sorted.length))] as number
  // nearest rank, so `p95` is the nineteenth of 20 samples, not the maximum
  const rank = Math.min(last, Math.max(0, Math.ceil(0.95 * sorted.length) - 1))
  return {
    median,
    p95: sorted[rank] as number,
    min: sorted[0] as number,
    max: sorted[last] as number,
  }
}

// loop and clock cost the same in both engines; subtract it
function withoutBaseline(samples: number[], baseline: number): Stats {
  return statsOf(samples.map((sample) => Math.max(0, sample - baseline)))
}

interface Timed<T> {
  value: T
  samples: number[]
  stats: Stats
}

// reports the pass just finished, `0` for the warm-up; it runs outside every `now()` window
type OnPass = (pass: number) => void

// warm-up untimed; its value feeds the equivalence check
// a pause outside every `now()` window caps the longest freeze at one run
async function timeRuns<T>(
  signal: RunSignal,
  runs: number,
  body: () => T,
  onPass: OnPass,
): Promise<Timed<T> | undefined> {
  const value = body()
  onPass(0)
  if (await pause(signal)) {
    return undefined
  }
  const samples: number[] = []
  for (let index = 0; index < runs; index++) {
    const start = now()
    body()
    samples.push(now() - start)
    onPass(index + 1)
    if (await pause(signal)) {
      return undefined
    }
  }
  return { value, samples, stats: statsOf(samples) }
}

async function timeRunsAsync<T>(
  signal: RunSignal,
  runs: number,
  body: () => Promise<T>,
  onPass: OnPass,
): Promise<Timed<T> | undefined> {
  const value = await body()
  onPass(0)
  if (await pause(signal)) {
    return undefined
  }
  const samples: number[] = []
  for (let index = 0; index < runs; index++) {
    const start = now()
    await body()
    samples.push(now() - start)
    onPass(index + 1)
    if (await pause(signal)) {
      return undefined
    }
  }
  return { value, samples, stats: statsOf(samples) }
}

// one call per sample, so the stats describe a single call and not a batch
async function timeCalls<T>(
  signal: RunSignal,
  calls: number,
  body: (index: number) => T,
  onPass: OnPass,
): Promise<Timed<T> | undefined> {
  let value = body(0)
  for (let index = 1; index < calls; index++) {
    value = body(index)
  }
  onPass(0)
  if (await pause(signal)) {
    return undefined
  }
  const samples: number[] = []
  for (let index = 0; index < calls; index++) {
    const start = now()
    value = body(index)
    samples.push(now() - start)
    if (index % SINGLE_CALL_YIELD === SINGLE_CALL_YIELD - 1) {
      onPass(index + 1)
      if (await pause(signal)) {
        return undefined
      }
    }
  }
  return { value, samples, stats: statsOf(samples) }
}

function sortedHex(cells: BigUint64Array): string[] {
  const hex = new Array<string>(cells.length)
  for (let index = 0; index < cells.length; index++) {
    hex[index] = (cells[index] as bigint).toString(16)
  }
  return hex.sort()
}

function sameStrings(subject: string[], reference: string[]): boolean {
  return subject.length === reference.length && subject.every((cell, i) => cell === reference[i])
}

function sameCells(subject: BigUint64Array, reference: string[]): boolean {
  if (subject.length !== reference.length) {
    return false
  }
  return sameStrings(sortedHex(subject), reference.map((cell) => cell.toLowerCase()).sort())
}

// a path is ordered, so its equivalence check must not sort
function sameCellsInOrder(subject: BigUint64Array, reference: string[]): boolean {
  if (subject.length !== reference.length) {
    return false
  }
  return reference.every(
    (cell, index) => (subject[index] as bigint).toString(16) === cell.toLowerCase(),
  )
}

function sameLatLng(subject: LatLng, reference: number[]): boolean {
  return (
    Math.abs(subject.lat - (reference[0] as number)) < EPSILON &&
    Math.abs(subject.lng - (reference[1] as number)) < EPSILON
  )
}

// a batch returns its centres interleaved, so the check walks two entries per cell
function sameLatLngPairs(subject: Float64Array, reference: number[][]): boolean {
  if (subject.length !== reference.length * 2) {
    return false
  }
  return reference.every((point, index) =>
    sameLatLng({ lat: subject[2 * index] as number, lng: subject[2 * index + 1] as number }, point),
  )
}

// a boundary batch pads each cell to `stride` doubles, so the check walks only the counted pairs
function sameBoundaryBuffers(subject: CellBoundaries, reference: number[][][]): boolean {
  if (subject.vertexCounts.length !== reference.length) {
    return false
  }
  return reference.every((boundary, index) => {
    if ((subject.vertexCounts[index] as number) !== boundary.length) {
      return false
    }
    const base = index * subject.stride
    return boundary.every((point, vertex) =>
      sameLatLng(
        {
          lat: subject.vertices[base + 2 * vertex] as number,
          lng: subject.vertices[base + 2 * vertex + 1] as number,
        },
        point,
      ),
    )
  })
}

function sameBoundary(subject: LatLng[], reference: number[][]): boolean {
  return (
    subject.length === reference.length &&
    subject.every((point, index) => sameLatLng(point, reference[index] as number[]))
  )
}

function samePolygons(subject: LatLng[][][], reference: number[][][][]): boolean {
  return (
    subject.length === reference.length &&
    subject.every((polygon, p) => {
      const other = reference[p] as number[][][]
      return (
        polygon.length === other.length &&
        polygon.every((loop, l) => sameBoundary(loop, other[l] as number[][]))
      )
    })
  )
}

// carries the request to abandon a run to the sample and workload boundaries
export interface RunSignal {
  cancelled: boolean
}

// a macrotask between samples lets queued presses through and reports whether the run is unwanted
async function pause(signal: RunSignal): Promise<boolean> {
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, 0)
  })
  return signal.cancelled
}

function toRow(
  id: WorkloadId,
  workload: string,
  runs: number,
  stats: Stats,
  referenceStats: Stats | undefined,
  equivalent: boolean,
  detail: string,
  singleCall = false,
): Row {
  return {
    id,
    workload,
    runs,
    millis: stats.median,
    referenceMillis: referenceStats?.median,
    stats,
    referenceStats,
    equivalent,
    detail,
    singleCall,
  }
}

// a grid of distinct coordinates over San Francisco, so no call repeats an input
function singleCallInputs(): LatLng[] {
  const inputs = new Array<LatLng>(SINGLE_CALLS)
  for (let index = 0; index < SINGLE_CALLS; index++) {
    inputs[index] = {
      lat: SAN_FRANCISCO.lat + (index % SINGLE_CALL_COLUMNS) * SINGLE_CALL_STEP,
      lng: SAN_FRANCISCO.lng + Math.floor(index / SINGLE_CALL_COLUMNS) * SINGLE_CALL_STEP,
    }
  }
  return inputs
}

// the single-call grid at batch size, interleaved as the batch takes it
function batchInputs(): Float64Array {
  const coords = new Float64Array(CALLS * 2)
  for (let index = 0; index < CALLS; index++) {
    coords[2 * index] = SAN_FRANCISCO.lat + (index % BATCH_COLUMNS) * BATCH_STEP
    coords[2 * index + 1] = SAN_FRANCISCO.lng + Math.floor(index / BATCH_COLUMNS) * BATCH_STEP
  }
  return coords
}

// the cells `W11` answers with, which `W12` and `W13` take as their input
interface BatchCells {
  cells: BigUint64Array
  reference: string[]
  same: boolean
}

// one untimed pass of `W11`, for a run that selected a consumer but not the producer
function batchCellsOf(): BatchCells {
  const coordinates = batchInputs()
  const produced = latLngsToCells(coordinates, 9)
  const reference = new Array<string>(CALLS)
  for (let i = 0; i < CALLS; i++) {
    reference[i] = h3.latLngToCell(
      coordinates[2 * i] as number,
      coordinates[2 * i + 1] as number,
      9,
    )
  }
  return { cells: produced, reference, same: sameCellsInOrder(produced, reference) }
}

// both engines allocate whatever is asked for, so the row drops a resolution to stay in budget
function fittingResolution(cells: BigUint64Array, target: number): number {
  // nothing below the input's finest cell is left to uncompact
  let floor = 0
  for (let index = 0; index < cells.length; index++) {
    floor = Math.max(floor, getResolution(cells[index] as bigint))
  }
  for (let res = target; res > floor; res--) {
    let size = 0
    for (let index = 0; index < cells.length; index++) {
      size += cellToChildrenSize(cells[index] as bigint, res)
    }
    if (size <= UNCOMPACT_BUDGET) {
      return res
    }
  }
  return floor
}

/**
 * Times the selected workloads against `h3-js` and reports the run between samples.
 *
 * The reported plan stays the full plan, so a subset run leaves every other card untouched. A
 * workload a selected one reads from is produced untimed when it was not selected itself.
 */
export async function runBenchmark(
  signal: RunSignal,
  onState: (state: RunState) => void,
  selected: readonly WorkloadId[] = WORKLOAD_IDS,
): Promise<{ rows: Row[]; seconds: number } | undefined> {
  const started = now()
  // plan starts at the target; the budget sets resolution after setup
  let plan = planOf(UNCOMPACT_RES)
  const rows: Row[] = []
  const wanted = new Set(selected)
  // the plan positions to measure, in plan order, so the spinner skips what is not selected
  const queue = plan.flatMap((entry, at) => (wanted.has(entry.id) ? [at] : []))
  let position = 0
  let index = queue[0] ?? plan.length
  function wants(id: WorkloadId): boolean {
    return wanted.has(id)
  }
  function report(engine: string, pass: number, passes: number): void {
    onState({ plan, rows: [...rows], index, engine, pass, passes })
  }
  function track(engine: string, passes: number): OnPass {
    return (pass) => {
      report(engine, pass, passes)
    }
  }
  function finish(row: Row): void {
    rows.push(row)
    position += 1
    index = queue[position] ?? plan.length
    report(OWN, 0, 0)
  }
  report(OWN, 0, 0)
  // setup blocks the thread for seconds, so the list paints first
  if (await pause(signal)) {
    return undefined
  }

  const origin = latLngToCell(SAN_FRANCISCO.lat, SAN_FRANCISCO.lng, 9)
  const disk = gridDisk(origin, DISK_K)
  // `h3-js` stays in its own hexadecimal-string world; converting either side would time the conversion
  const referenceOrigin = h3.latLngToCell(SAN_FRANCISCO.lat, SAN_FRANCISCO.lng, 9)
  const referenceDisk = h3.gridDisk(referenceOrigin, DISK_K)
  const cells = Array.from(disk)
  // compacting the res 9 polygon is the input of `W8`, not the measurement, so it stays untimed
  const compacted = compactCells(polygonToCells(SAN_FRANCISCO_POLYGON, 9))
  const referenceCompacted = h3.compactCells(h3.polygonToCells(SAN_FRANCISCO_POLYGON, 9))
  // `W8` compares two engines if both start from the same cells
  const sameUncompactInput = sameCells(compacted, referenceCompacted)
  const uncompactRes = fittingResolution(compacted, UNCOMPACT_RES)
  plan = planOf(uncompactRes)
  report(OWN, 0, 0)

  if (wants('W0')) {
    const singleInputs = singleCallInputs()
    // an empty body over the loop measures its own cost
    const w0Baseline = await timeCalls(
      signal,
      SINGLE_CALLS,
      () => undefined,
      track(BASELINE, SINGLE_CALLS),
    )
    if (w0Baseline == null) {
      return undefined
    }
    const w0 = await timeCalls(
      signal,
      SINGLE_CALLS,
      (call) => {
        const input = singleInputs[call] as LatLng
        return latLngToCell(input.lat, input.lng, 9)
      },
      track(OWN, SINGLE_CALLS),
    )
    if (w0 == null) {
      return undefined
    }
    const w0Reference = await timeCalls(
      signal,
      SINGLE_CALLS,
      (call) => {
        const input = singleInputs[call] as LatLng
        return h3.latLngToCell(input.lat, input.lng, 9)
      },
      track(REFERENCE, SINGLE_CALLS),
    )
    if (w0Reference == null) {
      return undefined
    }
    const baselineMillis = w0Baseline.stats.median
    finish(
      toRow(
        'W0',
        LABELS.w0,
        SINGLE_CALLS,
        withoutBaseline(w0.samples, baselineMillis),
        withoutBaseline(w0Reference.samples, baselineMillis),
        singleInputs.every(
          (input) =>
            latLngToCell(input.lat, input.lng, 9).toString(16) ===
            h3.latLngToCell(input.lat, input.lng, 9).toLowerCase(),
        ),
        `${SINGLE_CALLS} distinct inputs, median and p95 per call, ` +
          `${baselineMillis.toFixed(4)} ms baseline subtracted`,
        true,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  if (wants('W1')) {
    const w1 = await timeRuns(
      signal,
      RUNS,
      () => {
        let last = 0n
        for (let i = 0; i < CALLS; i++) {
          last = latLngToCell(SAN_FRANCISCO.lat, SAN_FRANCISCO.lng, 9)
        }
        return last
      },
      track(OWN, RUNS),
    )
    if (w1 == null) {
      return undefined
    }
    const w1Reference = await timeRuns(
      signal,
      RUNS,
      () => {
        let last = ''
        for (let i = 0; i < CALLS; i++) {
          last = h3.latLngToCell(SAN_FRANCISCO.lat, SAN_FRANCISCO.lng, 9)
        }
        return last
      },
      track(REFERENCE, RUNS),
    )
    if (w1Reference == null) {
      return undefined
    }
    finish(
      toRow(
        'W1',
        LABELS.w1,
        RUNS,
        w1.stats,
        w1Reference.stats,
        w1.value.toString(16) === w1Reference.value.toLowerCase(),
        w1.value.toString(16),
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  if (wants('W2')) {
    const w2 = await timeRuns(
      signal,
      RUNS,
      () => {
        let last = disk
        for (let i = 0; i < CALLS_PER_RUN; i++) {
          last = gridDisk(origin, DISK_K)
        }
        return last
      },
      track(OWN, RUNS),
    )
    if (w2 == null) {
      return undefined
    }
    const w2Reference = await timeRuns(
      signal,
      RUNS,
      () => {
        let last = referenceDisk
        for (let i = 0; i < CALLS_PER_RUN; i++) {
          last = h3.gridDisk(referenceOrigin, DISK_K)
        }
        return last
      },
      track(REFERENCE, RUNS),
    )
    if (w2Reference == null) {
      return undefined
    }
    finish(
      toRow(
        'W2',
        LABELS.w2,
        RUNS,
        w2.stats,
        w2Reference.stats,
        sameCells(w2.value, w2Reference.value),
        `${w2.value.length} cells per call`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  for (const series of DISK_SERIES) {
    if (wants(series.id)) {
      const own = await timeRuns(
        signal,
        series.runs,
        () => {
          let last = disk
          for (let i = 0; i < CALLS_PER_RUN; i++) {
            last = gridDisk(origin, series.k)
          }
          return last
        },
        track(OWN, series.runs),
      )
      if (own == null) {
        return undefined
      }
      const reference = await timeRuns(
        signal,
        series.runs,
        () => {
          let last = referenceDisk
          for (let i = 0; i < CALLS_PER_RUN; i++) {
            last = h3.gridDisk(referenceOrigin, series.k)
          }
          return last
        },
        track(REFERENCE, series.runs),
      )
      if (reference == null) {
        return undefined
      }
      finish(
        toRow(
          series.id,
          diskSeriesLabel(series),
          series.runs,
          own.stats,
          reference.stats,
          sameCells(own.value, reference.value),
          `${own.value.length} cells per call`,
        ),
      )
    }

    if (await pause(signal)) {
      return undefined
    }
  }

  // `W3Async` checks against these cells, so they outlive the block that measured them
  let w3Hex: string[] | undefined
  if (wants('W3')) {
    const w3 = await timeRuns(
      signal,
      RUNS_SLOW,
      () => polygonToCells(SAN_FRANCISCO_POLYGON, 12),
      track(OWN, RUNS_SLOW),
    )
    if (w3 == null) {
      return undefined
    }
    const w3Reference = await timeRuns(
      signal,
      RUNS_SLOW,
      () => h3.polygonToCells(SAN_FRANCISCO_POLYGON, 12),
      track(REFERENCE, RUNS_SLOW),
    )
    if (w3Reference == null) {
      return undefined
    }
    w3Hex = sortedHex(w3.value)
    finish(
      toRow(
        'W3',
        LABELS.w3,
        RUNS_SLOW,
        w3.stats,
        w3Reference.stats,
        sameCells(w3.value, w3Reference.value),
        `${w3.value.length} cells`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  if (wants('W3Async')) {
    const w3Async = await timeRunsAsync(
      signal,
      RUNS_SLOW,
      () => polygonToCellsAsync(SAN_FRANCISCO_POLYGON, 12),
      track(OWN, RUNS_SLOW),
    )
    if (w3Async == null) {
      return undefined
    }
    // untimed and unreported, for a run that left `W3` out
    w3Hex ??= sortedHex(polygonToCells(SAN_FRANCISCO_POLYGON, 12))
    finish(
      toRow(
        'W3Async',
        LABELS.w3Async,
        RUNS_SLOW,
        w3Async.stats,
        undefined,
        sameStrings(sortedHex(w3Async.value), w3Hex),
        `${w3Async.value.length} cells`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  if (wants('W4')) {
    const w4 = await timeRuns(signal, RUNS, () => compactCells(disk), track(OWN, RUNS))
    if (w4 == null) {
      return undefined
    }
    const w4Reference = await timeRuns(
      signal,
      RUNS,
      () => h3.compactCells(referenceDisk),
      track(REFERENCE, RUNS),
    )
    if (w4Reference == null) {
      return undefined
    }
    finish(
      toRow(
        'W4',
        LABELS.w4,
        RUNS,
        w4.stats,
        w4Reference.stats,
        sameCells(w4.value, w4Reference.value),
        `${w4.value.length} cells`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  if (wants('W5')) {
    const w5 = await timeRuns(signal, RUNS, () => cellsToMultiPolygon(disk), track(OWN, RUNS))
    if (w5 == null) {
      return undefined
    }
    const w5Reference = await timeRuns(
      signal,
      RUNS,
      () => h3.cellsToMultiPolygon(referenceDisk),
      track(REFERENCE, RUNS),
    )
    if (w5Reference == null) {
      return undefined
    }
    finish(
      toRow(
        'W5',
        LABELS.w5,
        RUNS,
        w5.stats,
        w5Reference.stats,
        samePolygons(w5.value, w5Reference.value),
        `${w5.value.length} polygons`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  if (wants('W6')) {
    const w6 = await timeRuns(
      signal,
      RUNS,
      () => {
        let last: LatLng = { lat: 0, lng: 0 }
        for (let i = 0; i < CALLS; i++) {
          last = cellToLatLng(cells[i % cells.length] as bigint)
        }
        return last
      },
      track(OWN, RUNS),
    )
    if (w6 == null) {
      return undefined
    }
    const w6Reference = await timeRuns(
      signal,
      RUNS,
      () => {
        let last: number[] = []
        for (let i = 0; i < CALLS; i++) {
          last = h3.cellToLatLng(referenceDisk[i % referenceDisk.length] as string)
        }
        return last
      },
      track(REFERENCE, RUNS),
    )
    if (w6Reference == null) {
      return undefined
    }
    finish(
      toRow(
        'W6',
        LABELS.w6,
        RUNS,
        w6.stats,
        w6Reference.stats,
        cells.length === referenceDisk.length &&
          cells.every((cell, at) =>
            sameLatLng(cellToLatLng(cell), h3.cellToLatLng(referenceDisk[at] as string)),
          ),
        `${CALLS} calls over ${cells.length} distinct cells`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  if (wants('W7')) {
    const w7 = await timeRuns(
      signal,
      RUNS,
      () => {
        let last: LatLng[] = []
        for (let i = 0; i < CALLS; i++) {
          last = cellToBoundary(cells[i % cells.length] as bigint)
        }
        return last
      },
      track(OWN, RUNS),
    )
    if (w7 == null) {
      return undefined
    }
    const w7Reference = await timeRuns(
      signal,
      RUNS,
      () => {
        let last: number[][] = []
        for (let i = 0; i < CALLS; i++) {
          last = h3.cellToBoundary(referenceDisk[i % referenceDisk.length] as string)
        }
        return last
      },
      track(REFERENCE, RUNS),
    )
    if (w7Reference == null) {
      return undefined
    }
    finish(
      toRow(
        'W7',
        LABELS.w7,
        RUNS,
        w7.stats,
        w7Reference.stats,
        cells.length === referenceDisk.length &&
          cells.every((cell, at) =>
            sameBoundary(cellToBoundary(cell), h3.cellToBoundary(referenceDisk[at] as string)),
          ),
        `${CALLS} calls over ${cells.length} distinct cells`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  // `W8Async` checks against these cells, so they outlive the block that measured them
  let w8Hex: string[] | undefined
  if (wants('W8')) {
    const w8 = await timeRuns(
      signal,
      RUNS,
      () => uncompactCells(compacted, uncompactRes),
      track(OWN, RUNS),
    )
    if (w8 == null) {
      return undefined
    }
    const w8Reference = await timeRuns(
      signal,
      RUNS,
      () => h3.uncompactCells(referenceCompacted, uncompactRes),
      track(REFERENCE, RUNS),
    )
    if (w8Reference == null) {
      return undefined
    }
    w8Hex = sortedHex(w8.value)
    finish(
      toRow(
        'W8',
        uncompactLabel(uncompactRes, false),
        RUNS,
        w8.stats,
        w8Reference.stats,
        sameUncompactInput && sameCells(w8.value, w8Reference.value),
        `${compacted.length} cells in, ${w8.value.length} cells out`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  if (wants('W8Async')) {
    const w8Async = await timeRunsAsync(
      signal,
      RUNS,
      () => uncompactCellsAsync(compacted, uncompactRes),
      track(OWN, RUNS),
    )
    if (w8Async == null) {
      return undefined
    }
    // untimed and unreported, for a run that left `W8` out
    w8Hex ??= sortedHex(uncompactCells(compacted, uncompactRes))
    finish(
      toRow(
        'W8Async',
        uncompactLabel(uncompactRes, true),
        RUNS,
        w8Async.stats,
        undefined,
        sameStrings(sortedHex(w8Async.value), w8Hex),
        `${compacted.length} cells in, ${w8Async.value.length} cells out`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  if (wants('W9')) {
    const parent = latLngToCell(SAN_FRANCISCO.lat, SAN_FRANCISCO.lng, CHILDREN_PARENT_RES)
    const referenceParent = h3.latLngToCell(
      SAN_FRANCISCO.lat,
      SAN_FRANCISCO.lng,
      CHILDREN_PARENT_RES,
    )
    const w9 = await timeRuns(
      signal,
      RUNS,
      () => cellToChildren(parent, CHILDREN_RES),
      track(OWN, RUNS),
    )
    if (w9 == null) {
      return undefined
    }
    const w9Reference = await timeRuns(
      signal,
      RUNS,
      () => h3.cellToChildren(referenceParent, CHILDREN_RES),
      track(REFERENCE, RUNS),
    )
    if (w9Reference == null) {
      return undefined
    }
    finish(
      toRow(
        'W9',
        LABELS.w9,
        RUNS,
        w9.stats,
        w9Reference.stats,
        sameCells(w9.value, w9Reference.value),
        `${w9.value.length} children of ${parent.toString(16)}`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  if (wants('W10')) {
    const berlin = latLngToCell(BERLIN.lat, BERLIN.lng, PATH_RES)
    const hamburg = latLngToCell(HAMBURG.lat, HAMBURG.lng, PATH_RES)
    const referenceBerlin = h3.latLngToCell(BERLIN.lat, BERLIN.lng, PATH_RES)
    const referenceHamburg = h3.latLngToCell(HAMBURG.lat, HAMBURG.lng, PATH_RES)
    const w10 = await timeRuns(
      signal,
      RUNS,
      () => {
        let last: BigUint64Array = new BigUint64Array(0)
        for (let i = 0; i < CALLS_PER_RUN; i++) {
          last = gridPathCells(berlin, hamburg)
        }
        return last
      },
      track(OWN, RUNS),
    )
    if (w10 == null) {
      return undefined
    }
    const w10Reference = await timeRuns(
      signal,
      RUNS,
      () => {
        let last: string[] = []
        for (let i = 0; i < CALLS_PER_RUN; i++) {
          last = h3.gridPathCells(referenceBerlin, referenceHamburg)
        }
        return last
      },
      track(REFERENCE, RUNS),
    )
    if (w10Reference == null) {
      return undefined
    }
    finish(
      toRow(
        'W10',
        LABELS.w10,
        RUNS,
        w10.stats,
        w10Reference.stats,
        sameCellsInOrder(w10.value, w10Reference.value),
        `${w10.value.length} cells per path`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  // `W12` and `W13` read `W11`'s answer, produced untimed for a run that left `W11` out
  let batch: BatchCells | undefined
  function batchOf(): BatchCells {
    if (batch === undefined) {
      batch = batchCellsOf()
    }
    return batch
  }

  if (wants('W11')) {
    const coordinates = batchInputs()
    const w11 = await timeRuns(signal, RUNS, () => latLngsToCells(coordinates, 9), track(OWN, RUNS))
    if (w11 == null) {
      return undefined
    }
    // the batch answers for the whole set, so the loop it replaces collects too
    const w11Reference = await timeRuns(
      signal,
      RUNS,
      () => {
        const cells = new Array<string>(CALLS)
        for (let i = 0; i < CALLS; i++) {
          cells[i] = h3.latLngToCell(
            coordinates[2 * i] as number,
            coordinates[2 * i + 1] as number,
            9,
          )
        }
        return cells
      },
      track(REFERENCE, RUNS),
    )
    if (w11Reference == null) {
      return undefined
    }
    // `W12` compares two engines if both start from the same cells, which is what `W11` answered
    const sameBatchCells = sameCellsInOrder(w11.value, w11Reference.value)
    batch = { cells: w11.value, reference: w11Reference.value, same: sameBatchCells }
    finish(
      toRow(
        'W11',
        LABELS.w11,
        RUNS,
        w11.stats,
        w11Reference.stats,
        sameBatchCells,
        `${CALLS} pairs in one call, ${CALLS} h3-js calls`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  if (wants('W12')) {
    const { cells: batchCells, reference: batchReference, same: sameBatchCells } = batchOf()
    const w12 = await timeRuns(signal, RUNS, () => cellsToLatLngs(batchCells), track(OWN, RUNS))
    if (w12 == null) {
      return undefined
    }
    const w12Reference = await timeRuns(
      signal,
      RUNS,
      () => {
        const centres = new Array<number[]>(CALLS)
        for (let i = 0; i < CALLS; i++) {
          centres[i] = h3.cellToLatLng(batchReference[i] as string)
        }
        return centres
      },
      track(REFERENCE, RUNS),
    )
    if (w12Reference == null) {
      return undefined
    }
    finish(
      toRow(
        'W12',
        LABELS.w12,
        RUNS,
        w12.stats,
        w12Reference.stats,
        sameBatchCells && sameLatLngPairs(w12.value, w12Reference.value),
        `${CALLS} cells in one call, ${CALLS} h3-js calls`,
      ),
    )
  }

  if (await pause(signal)) {
    return undefined
  }

  if (wants('W13')) {
    const { cells: batchCells, reference: batchReference, same: sameBatchCells } = batchOf()
    const w13 = await timeRuns(signal, RUNS, () => cellsToBoundaries(batchCells), track(OWN, RUNS))
    if (w13 == null) {
      return undefined
    }
    const w13Reference = await timeRuns(
      signal,
      RUNS,
      () => {
        const boundaries = new Array<number[][]>(CALLS)
        for (let i = 0; i < CALLS; i++) {
          boundaries[i] = h3.cellToBoundary(batchReference[i] as string)
        }
        return boundaries
      },
      track(REFERENCE, RUNS),
    )
    if (w13Reference == null) {
      return undefined
    }
    finish(
      toRow(
        'W13',
        LABELS.w13,
        RUNS,
        w13.stats,
        w13Reference.stats,
        sameBatchCells && sameBoundaryBuffers(w13.value, w13Reference.value),
        `${CALLS} cells in one call, ${CALLS} h3-js calls`,
      ),
    )
  }

  return { rows, seconds: (now() - started) / 1000 }
}
