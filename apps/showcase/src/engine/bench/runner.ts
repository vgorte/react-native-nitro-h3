import { median } from '../stats'
import type { Workload } from './workloads'

// both constants sit here, because `workloads.ts` needs the native module to load

/** Sizes the chunks of the h3-js side, so its bar grows while it runs and the act stays usable. */
export const REFERENCE_CHUNK = 2_000

/** Caps one run: `runWorkload` gives up once a workload has been going for longer. */
export const RUN_CEILING_MS = 30_000

/** Reports the package pass or h3-js chunk that just finished, so a bar can grow as it runs. */
export interface Progress {
  workload: string
  side: 'package' | 'h3-js'
  done: number
  total: number
  ms: number
}

/** Carries both medians of one workload, the factor between them and the documented factor. */
export interface Result {
  id: string
  ownMs: number
  referenceMs: number
  referenceWallMs: number
  factor: number
  documented: number | undefined
  aborted: boolean
}

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const now = performance.now.bind(performance)

/** Runs one workload on both sides and answers their medians and the factor between them. */
export async function runWorkload(
  workload: Workload,
  onProgress: (progress: Progress) => void,
  signal: { aborted: boolean },
  ceilingMs = RUN_CEILING_MS,
): Promise<Result> {
  const started = now()
  const stopped = (): boolean => signal.aborted || now() - started > ceilingMs

  const aborted = (): Result => ({
    id: workload.id,
    ownMs: 0,
    referenceMs: 0,
    referenceWallMs: 0,
    factor: 0,
    documented: workload.documented,
    aborted: true,
  })

  workload.own()
  await yieldToLoop()
  if (stopped()) return aborted()

  const ownSamples: number[] = []
  for (let pass = 0; pass < workload.runs; pass++) {
    const start = now()
    workload.own()
    ownSamples.push(now() - start)
    onProgress({
      workload: workload.id,
      side: 'package',
      done: pass + 1,
      total: workload.runs,
      ms: median(ownSamples),
    })
    await yieldToLoop()
    if (stopped()) return aborted()
  }

  // a single unchunked call cannot be bounded, so warming it would repeat the whole run
  if (workload.calls > 1) {
    workload.reference(0, Math.min(REFERENCE_CHUNK, workload.calls))
    await yieldToLoop()
    if (stopped()) return aborted()
  }

  const referenceSamples: number[] = []
  let wall = 0
  for (let pass = 0; pass < workload.referenceRuns; pass++) {
    const wallStart = now()
    let sum = 0
    for (let from = 0; from < workload.calls; from += REFERENCE_CHUNK) {
      const to = Math.min(from + REFERENCE_CHUNK, workload.calls)
      const start = now()
      workload.reference(from, to)
      sum += now() - start
      onProgress({ workload: workload.id, side: 'h3-js', done: to, total: workload.calls, ms: sum })
      await yieldToLoop()
      if (stopped()) return aborted()
    }
    referenceSamples.push(sum)
    wall += now() - wallStart
  }

  const ownMs = median(ownSamples)
  const referenceMs = median(referenceSamples)
  return {
    id: workload.id,
    ownMs,
    referenceMs,
    referenceWallMs: wall / workload.referenceRuns,
    factor: ownMs > 0 ? referenceMs / ownMs : 0,
    documented: workload.documented,
    aborted: false,
  }
}
