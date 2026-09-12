/**
 * The workload ids in plan order, one per row of a full run.
 *
 * `W3Async` and `W8Async` share a leading token with their synchronous rows, so a label's first
 * word is not an id; this list is.
 */
export const WORKLOAD_IDS = [
  'W0',
  'W1',
  'W2',
  'W2a',
  'W2b',
  'W2c',
  'W2d',
  'W3',
  'W3Async',
  'W4',
  'W5',
  'W6',
  'W7',
  'W8',
  'W8Async',
  'W9',
  'W10',
  'W11',
  'W12',
  'W13',
] as const

export type WorkloadId = (typeof WORKLOAD_IDS)[number]

const BY_LOWER_CASE = new Map<string, WorkloadId>(WORKLOAD_IDS.map((id) => [id.toLowerCase(), id]))

export function isWorkloadId(value: string): value is WorkloadId {
  return BY_LOWER_CASE.get(value.toLowerCase()) === value
}

/**
 * Parses a comma or whitespace separated list of workload ids into plan order.
 *
 * Case does not matter and duplicates collapse. Empty text selects every workload.
 *
 * @returns The selected ids, or an error naming every entry that is not a workload id.
 */
export function parseWorkloadIds(
  text: string,
): { ids: WorkloadId[]; error?: undefined } | { ids?: undefined; error: string } {
  const entries = text
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (entries.length === 0) {
    return { ids: [...WORKLOAD_IDS] }
  }
  const unknown = entries.filter((entry) => !BY_LOWER_CASE.has(entry.toLowerCase()))
  if (unknown.length > 0) {
    return {
      error: `Unknown workload ${unknown.length === 1 ? 'id' : 'ids'}: ${unknown.join(', ')}. Known: ${WORKLOAD_IDS.join(', ')}.`,
    }
  }
  const wanted = new Set(entries.map((entry) => BY_LOWER_CASE.get(entry.toLowerCase())))
  return { ids: WORKLOAD_IDS.filter((id) => wanted.has(id)) }
}

/** The token every progress line starts with; distinct from the payload's `BENCHMARK_JSON`. */
export const PROGRESS_PREFIX = 'BENCHMARK_PROGRESS'

export interface RunStarted {
  kind: 'start'
  selected: WorkloadId[]
  planned: number
}

export interface WorkloadDone {
  kind: 'done'
  id: WorkloadId
  /** One-based position within the selected workloads. */
  position: number
  selected: number
  millis: number
  referenceMillis: number | null
  elapsedSeconds: number
}

export type Progress = RunStarted | WorkloadDone

/**
 * Formats a progress event as the single log line the host script reads back.
 *
 * `start` carries the selection and the plan length, `done` one finished row's medians.
 */
export function formatProgress(progress: Progress): string {
  if (progress.kind === 'start') {
    return `${PROGRESS_PREFIX} start ${progress.selected.length}/${progress.planned} ${progress.selected.join(',')}`
  }
  const reference = progress.referenceMillis === null ? 'none' : String(progress.referenceMillis)
  return (
    `${PROGRESS_PREFIX} done ${progress.id} ${progress.position}/${progress.selected} ` +
    `millis=${progress.millis} reference=${reference} elapsed=${progress.elapsedSeconds}`
  )
}

const START_LINE = /BENCHMARK_PROGRESS start (\d+)\/(\d+) (\S+)/
const DONE_LINE =
  /BENCHMARK_PROGRESS done (\S+) (\d+)\/(\d+) millis=(\S+) reference=(\S+) elapsed=(\S+)/

/**
 * Parses one log line back into a progress event.
 *
 * The line may carry a logcat or console prefix. Returns `undefined` for any other line.
 */
export function parseProgress(line: string): Progress | undefined {
  const start = START_LINE.exec(line)
  if (start !== null) {
    const parsed = parseWorkloadIds(start[3] ?? '')
    if (parsed.ids === undefined || parsed.ids.length !== Number(start[1])) {
      return undefined
    }
    return { kind: 'start', selected: parsed.ids, planned: Number(start[2]) }
  }
  const done = DONE_LINE.exec(line)
  if (done === null) {
    return undefined
  }
  const id = done[1] ?? ''
  const millis = Number(done[4])
  const elapsedSeconds = Number(done[6])
  const referenceMillis = done[5] === 'none' ? null : Number(done[5])
  if (
    !isWorkloadId(id) ||
    !Number.isFinite(millis) ||
    !Number.isFinite(elapsedSeconds) ||
    (referenceMillis !== null && !Number.isFinite(referenceMillis))
  ) {
    return undefined
  }
  return {
    kind: 'done',
    id,
    position: Number(done[2]),
    selected: Number(done[3]),
    millis,
    referenceMillis,
    elapsedSeconds,
  }
}
