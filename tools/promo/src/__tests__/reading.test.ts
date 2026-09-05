import { describe, expect, test } from 'bun:test'
import { readingAt } from '../scenes/reading'
import { EASE_SECONDS, SCENES, type Scene } from '../scenes/scenes'

/** The frame rate the wide cut is walked at; the hero's 30 fps samples a subset of these moments. */
const FPS = 60

function sceneOf(id: string): Scene {
  const scene = SCENES.find((candidate) => candidate.id === id)
  if (scene === undefined) throw new Error(`no scene ${id}`)
  return scene
}

/** Answers the largest step between two consecutive frames of a scene, and where it happened. */
function largestStep(scene: Scene): { step: number; at: number } {
  let worst = { step: 0, at: 0 }
  let before: number | null = null
  for (let frame = 0; frame <= Math.round(scene.seconds * FPS); frame += 1) {
    const seconds = frame / FPS
    const { value } = readingAt(scene, seconds)
    if (value === null) continue
    if (before !== null) {
      const step = Math.abs(value - before)
      if (step > worst.step) worst = { step, at: seconds }
    }
    before = value
  }
  return worst
}

/** Answers the largest distance between two readings the caption steps between. */
function largestDelta(scene: Scene): number {
  let widest = 0
  let held = scene.value
  for (const key of scene.keys) {
    if (key.value !== null) widest = Math.max(widest, Math.abs(key.value - (held ?? 0)))
    held = key.value
  }
  return widest
}

describe('readingAt', () => {
  // the two acts whose keys sit closer together than one ease, which is where a naive walk jumps
  for (const id of ['grid', 'trail']) {
    const scene = sceneOf(id)

    test(`${id} crosses no key in a single frame`, () => {
      expect(largestStep(scene).step).toBeLessThan(largestDelta(scene))
    })

    test(`${id} moves no faster than one ease can carry it`, () => {
      // an interrupted ease starts at most one key behind, so it never closes more than two at once
      const bound = (2 * largestDelta(scene)) / (EASE_SECONDS * FPS)
      expect(largestStep(scene).step).toBeLessThanOrEqual(bound)
    })

    test(`${id} never falls back or overshoots`, () => {
      const top = Math.max(scene.value ?? 0, ...scene.keys.map((key) => key.value ?? 0))
      let before = scene.value ?? 0
      for (let frame = 0; frame <= Math.round(scene.seconds * FPS); frame += 1) {
        const { value } = readingAt(scene, frame / FPS)
        expect(value).not.toBeNull()
        expect(value as number).toBeGreaterThanOrEqual(before - 1e-9)
        expect(value as number).toBeLessThanOrEqual(top + 1e-9)
        before = value as number
      }
    })

    test(`${id} opens and closes on the readings its take carried`, () => {
      expect(readingAt(scene, 0).value).toBe(scene.value)
      const last = scene.keys[scene.keys.length - 1]
      expect(readingAt(scene, last.at + EASE_SECONDS).value).toBeCloseTo(last.value as number, 6)
    })
  }

  test('an act that has measured nothing shows nothing until its key', () => {
    const engine = sceneOf('engine')
    const key = engine.keys[0]
    expect(readingAt(engine, key.at - 0.01).value).toBeNull()
    expect(readingAt(engine, key.at).value).toBe(0)
    expect(readingAt(engine, key.at + EASE_SECONDS).value).toBeCloseTo(key.value as number, 6)
  })

  test('a key that renames what is counted keeps the name afterwards', () => {
    const heatmap = sceneOf('heatmap')
    const key = heatmap.keys[0]
    expect(readingAt(heatmap, 0).label).toBe('points placed')
    expect(readingAt(heatmap, key.at + 1).label).toBe('cells from a million points')
  })
})
