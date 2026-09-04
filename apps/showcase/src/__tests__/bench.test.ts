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

  test('warms the reference side on its first chunk only', async () => {
    const chunks: number[][] = []
    const counted: Workload = { ...workload, reference: (from, to) => chunks.push([from, to]) }

    await runWorkload(counted, () => {}, { aborted: false })

    expect(chunks).toEqual([
      [0, 2_000],
      [0, 2_000],
      [2_000, 4_000],
    ])
  })

  test('never warms one unchunked call that is measured once', async () => {
    let calls = 0
    const finale: Workload = {
      ...workload,
      runs: 1,
      referenceRuns: 1,
      calls: 1,
      reference: () => {
        calls += 1
      },
    }

    await runWorkload(finale, () => {}, { aborted: false })

    expect(calls).toBe(1)
  })

  test('warms one unchunked call that is measured repeatedly', async () => {
    let calls = 0
    const repeated: Workload = {
      ...workload,
      runs: 1,
      referenceRuns: 3,
      calls: 1,
      reference: () => {
        calls += 1
      },
    }

    await runWorkload(repeated, () => {}, { aborted: false })

    expect(calls).toBe(4)
  })

  test('gives up once the run passes the ceiling', async () => {
    let calls = 0
    const slow: Workload = {
      ...workload,
      reference: () => {
        calls += 1
        spin(150_000)
      },
    }

    const result = await runWorkload(slow, () => {}, { aborted: false }, 100)

    expect(result.aborted).toBe(true)
    expect(calls).toBe(1)
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
