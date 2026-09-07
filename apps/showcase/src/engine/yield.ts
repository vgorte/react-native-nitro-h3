/**
 * Hands the loop a turn, so anything queued behind a long run gets to happen.
 *
 * A `setTimeout` of zero is the only yield Hermes offers that lets a timer, a touch and a render
 * through; a microtask would resolve before any of them.
 */
export function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
