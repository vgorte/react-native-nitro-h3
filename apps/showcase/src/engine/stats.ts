/** Answers the median of the samples, the upper of the two middle values on an even count. */
export function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(0.5 * sorted.length))]
}

/** Answers the nearest-rank percentile, so `0.95` of twenty samples is the nineteenth. */
export function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right)
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[rank]
}

/** Formats a duration in milliseconds, three decimals under a millisecond and one above. */
export function formatMs(ms: number): string {
  return `${ms < 1 ? ms.toFixed(3) : ms.toFixed(1)} ms`
}

/** Formats a duration in microseconds, for the single calls of the Inspector. */
export function formatUs(ms: number): string {
  return `${(ms * 1000).toFixed(1)} us`
}

/** Formats a cell area, which spans nine orders of magnitude between the two ends of the ladder. */
export function formatAreaKm2(km2: number): string {
  return `${km2 < 0.001 ? km2.toExponential(2) : km2.toPrecision(4)} km²`
}

/** Formats a count with thousands separators. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}
