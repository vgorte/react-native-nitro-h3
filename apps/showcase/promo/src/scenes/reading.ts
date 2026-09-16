import { EASE_SECONDS, type Scene } from './scenes'

/** Holds what the number line says at one moment: the reading, and what it counts. */
export interface Reading {
  value: number | null
  unit: string
}

/**
 * Answers the reading the caption stands on, easing from wherever it stood when the key landed.
 *
 * Keys closer together than {@linkcode EASE_SECONDS} interrupt one another, so an ease starts from
 * the value the running one had reached rather than from the last key's target: the caption is
 * continuous over the whole scene, whatever the takes were sampled at. A key whose predecessor
 * measured nothing eases from zero, keys sharing a second collapse onto the last of them, and a key
 * that carries a unit of its own lands on its value at once rather than easing onto it.
 */
export function readingAt(scene: Scene, seconds: number): Reading {
  let unit = scene.unit
  let from = scene.value
  let to = scene.value
  let at = 0
  let keyed = false

  for (const key of scene.keys) {
    if (seconds < key.at) break
    // keys sharing a second are one moment, and the last wins
    if (!keyed || key.at > at) {
      from = keyed ? easedTo(from, to, at, key.at) : to
      at = key.at
    }
    to = key.value
    // a key that renames what is counted snaps, so no frame reads a number under the wrong unit
    if (key.unit !== undefined) from = key.value
    unit = key.unit ?? unit
    keyed = true
  }

  if (!keyed) return { value: scene.value, unit }
  return { value: easedTo(from, to, at, seconds), unit }
}

/** Answers where an ease that started at `at` stands by `time`, holding once it has landed. */
function easedTo(from: number | null, to: number | null, at: number, time: number): number | null {
  if (to === null) return null
  const start = from ?? 0
  const progress = Math.min(1, Math.max(0, (time - at) / EASE_SECONDS))
  return start + (to - start) * progress
}
