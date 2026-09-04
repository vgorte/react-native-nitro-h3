import { describe, expect, test } from 'bun:test'
import { runWorkload } from '../engine/bench/runner'
import type { Workload } from '../engine/bench/workloads'

function spin(microseconds: number): void {
  const until = performance.now() + microseconds / 1000
  while (performance.now() < until) {
    // busy wait, so the sample is a real duration rather than a stubbed number
  }
}

const workload: Workload = {
  id: 'T1',
  label: 'test workload',
  detail: 'two loops',
  documented: undefined,
  runs: 3,
  referenceRuns: 1,
  calls: 4_000,
  own: () => spin(200),
  reference: (from, to) => spin((to - from) / 10),
}

describe('runWorkload', () => {
  test('reports both sides, the chunked reference and a factor', async () => {
    const progress: string[] = []

    const result = await runWorkload(workload, (step) => progress.push(step.side), {
      aborted: false,
    })

    expect(result.id).toBe('T1')
    expect(result.ownMs).toBeGreaterThan(0)
    expect(result.referenceMs).toBeGreaterThan(0)
    expect(result.referenceWallMs).toBeGreaterThanOrEqual(result.referenceMs)
    expect(result.factor).toBeCloseTo(result.referenceMs / result.ownMs, 6)
    expect(progress.filter((side) => side === 'h3-js').length).toBe(2)
    expect(result.aborted).toBe(false)
  })

  test('stops when the signal aborts', async () => {
    const signal = { aborted: false }
    const promise = runWorkload(
      workload,
      () => {
        signal.aborted = true
      },
      signal,
    )

    const result = await promise

    expect(result.aborted).toBe(true)
  })
})
