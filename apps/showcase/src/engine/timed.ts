/** Holds a call's result together with the milliseconds it took and the name it is shown under. */
export interface Timed<T> {
  label: string
  value: T
  ms: number
}

// resolved once, so no property lookup happens inside a timed window
const now = performance.now.bind(performance)

/** Runs a call inside a `performance.now()` window and labels its duration. */
export function timed<T>(label: string, call: () => T): Timed<T> {
  const start = now()
  const value = call()
  return { label, value, ms: now() - start }
}
