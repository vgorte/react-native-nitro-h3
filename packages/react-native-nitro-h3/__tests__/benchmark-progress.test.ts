import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatProgress } from '../../../apps/example/src/benchmarkPlan'
import { collectProgress, isStalled, parseArgs } from '../../../scripts/benchmark-device'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const LOGCAT = '09-12 10:00:00.000  1234  1234 I ReactNativeJS: '

function started(selected: ('W7' | 'W13')[], planned: number): string {
  return formatProgress({ kind: 'start', selected, planned })
}

function done(id: 'W7' | 'W13', position: number, selected: number): string {
  return formatProgress({
    kind: 'done',
    id,
    position,
    selected,
    millis: 12.5,
    referenceMillis: 456.7,
    elapsedSeconds: 8.2,
  })
}

function args(extra: string[]): string[] {
  return ['--platform', 'android', '--serial', 'emulator-5554', '--out', 'run.json', ...extra]
}

describe('benchmark progress capture', () => {
  test('reads through a logcat line prefix', () => {
    const log = [
      `${LOGCAT}Launching com.h3example`,
      `${LOGCAT}${started(['W7', 'W13'], 20)}`,
      `${LOGCAT}${done('W7', 1, 2)}`,
    ].join('\n')
    const progress = collectProgress(log)
    expect(progress.started).toEqual({ kind: 'start', selected: ['W7', 'W13'], planned: 20 })
    expect(progress.done.map((event) => event.id)).toEqual(['W7'])
  })

  test('takes the last run when a log holds two', () => {
    const log = [
      started(['W7', 'W13'], 20),
      done('W7', 1, 2),
      done('W13', 2, 2),
      started(['W7'], 20),
      done('W7', 1, 1),
    ].join('\n')
    const progress = collectProgress(log)
    expect(progress.started?.selected).toEqual(['W7'])
    expect(progress.starts).toBe(2)
    expect(progress.done).toHaveLength(1)
    expect(progress.done[0]?.selected).toBe(1)
  })

  test('payload chunk lines are not progress', () => {
    const log = [
      started(['W7'], 20),
      'BENCHMARK_JSON 1/2 |{"rows":|',
      done('W7', 1, 1),
      'BENCHMARK_JSON 2/2 |[]}|',
    ].join('\n')
    const progress = collectProgress(log)
    expect(progress.started?.planned).toBe(20)
    expect(progress.done.map((event) => event.position)).toEqual([1])
  })

  test('a log without any progress line reports nothing', () => {
    expect(collectProgress('nothing was logged')).toEqual({
      started: undefined,
      done: [],
      starts: 0,
    })
  })
})

describe('stall detection', () => {
  test('the stall window is reached, not merely approached', () => {
    const now = 10 * 60_000
    expect(isStalled(0, now - 1, 10)).toBe(false)
    expect(isStalled(0, now, 10)).toBe(true)
    expect(isStalled(0, now + 1, 10)).toBe(true)
  })

  test('a fractional window is honoured', () => {
    expect(isStalled(0, 29_000, 0.5)).toBe(false)
    expect(isStalled(0, 30_000, 0.5)).toBe(true)
  })
})

describe('command line', () => {
  test('workload ids come back in plan order', () => {
    expect(parseArgs(args(['--workloads', 'w13,w7'])).workloads).toEqual(['W7', 'W13'])
    expect(parseArgs(args([])).workloads).toBeUndefined()
  })

  test('an unknown workload id is a usage error quoting it', () => {
    expect(() => parseArgs(args(['--workloads', 'W7,W99']))).toThrow('W99')
  })

  test('a subset run cannot be published', () => {
    expect(() => parseArgs(args(['--workloads', 'W7', '--publish']))).toThrow('--publish')
  })

  test('the published payload path needs --publish', () => {
    const published = join(ROOT, 'apps', 'example', 'benchmark.json')
    const base = ['--platform', 'android', '--serial', 'emulator-5554', '--out', published]
    expect(() => parseArgs(base)).toThrow('--publish')
    expect(parseArgs([...base, '--publish']).publish).toBe(true)
  })

  test('the stall window defaults to ten minutes and must be positive', () => {
    expect(parseArgs(args([])).stallMinutes).toBe(10)
    expect(parseArgs(args(['--stall-minutes', '2'])).stallMinutes).toBe(2)
    expect(() => parseArgs(args(['--stall-minutes', '0']))).toThrow('--stall-minutes')
    expect(() => parseArgs(args(['--stall-minutes', 'soon']))).toThrow('--stall-minutes')
  })
})
