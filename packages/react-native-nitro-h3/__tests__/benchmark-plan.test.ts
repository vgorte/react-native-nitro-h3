import { describe, expect, test } from 'bun:test'
import {
  formatProgress,
  parseProgress,
  parseWorkloadIds,
  WORKLOAD_IDS,
} from '../../../apps/example/src/benchmarkPlan'

describe('workload id parsing', () => {
  test('empty text selects every workload in plan order', () => {
    expect(parseWorkloadIds('').ids).toEqual([...WORKLOAD_IDS])
    expect(parseWorkloadIds('  \n').ids).toEqual([...WORKLOAD_IDS])
  })

  test('ids come back in plan order, case-insensitively and without duplicates', () => {
    expect(parseWorkloadIds('w13, W7 w13').ids).toEqual(['W7', 'W13'])
    expect(parseWorkloadIds('w3async;W3').ids).toEqual(['W3', 'W3Async'])
  })

  test('an unknown id is an error naming it', () => {
    const parsed = parseWorkloadIds('W7, W99, foo')
    expect(parsed.ids).toBeUndefined()
    expect(parsed.error).toContain('W99, foo')
  })
})

describe('progress lines', () => {
  test('a start line round-trips through a logcat prefix', () => {
    const line = formatProgress({ kind: 'start', selected: ['W7', 'W13'], planned: 20 })
    expect(line).toBe('BENCHMARK_PROGRESS start 2/20 W7,W13')
    expect(parseProgress(`09-12 10:00:00.000  1234  1234 I ReactNativeJS: ${line}`)).toEqual({
      kind: 'start',
      selected: ['W7', 'W13'],
      planned: 20,
    })
  })

  test('a done line round-trips with and without a reference median', () => {
    const withReference = {
      kind: 'done' as const,
      id: 'W7' as const,
      position: 1,
      selected: 2,
      millis: 12.345,
      referenceMillis: 456.7,
      elapsedSeconds: 8.2,
    }
    expect(parseProgress(formatProgress(withReference))).toEqual(withReference)
    const withoutReference = { ...withReference, id: 'W3Async' as const, referenceMillis: null }
    expect(parseProgress(formatProgress(withoutReference))).toEqual(withoutReference)
  })

  test('payload chunks and unrelated lines are not progress', () => {
    expect(parseProgress('BENCHMARK_JSON 1/3 |{"rows":[]}|')).toBeUndefined()
    expect(
      parseProgress('BENCHMARK_PROGRESS done W99 1/1 millis=1 reference=none elapsed=1'),
    ).toBeUndefined()
    expect(parseProgress('benchmark run failed')).toBeUndefined()
  })
})
