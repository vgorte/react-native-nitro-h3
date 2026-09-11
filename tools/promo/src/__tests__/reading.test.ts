import { describe, expect, test } from 'bun:test'
import { CARD_SECONDS } from '../Showcase'
import { type Reading, readingAt } from '../scenes/reading'
import { EASE_SECONDS, HERO_SCENES, SCENES, type Scene } from '../scenes/scenes'

/** The frame rate the wide cut is walked at; the hero's 30 fps samples a subset of these moments. */
const FPS = 60

function sceneOf(id: string): Scene {
  const scene = SCENES.find((candidate) => candidate.id === id)
  if (scene === undefined) throw new Error(`no scene ${id}`)
  return scene
}

/** Answers every reading a scene shows, one a frame, from its opening to its cut. */
function walk(scene: Scene): Reading[] {
  const readings: Reading[] = []
  for (let frame = 0; frame <= Math.round(scene.seconds * FPS); frame += 1) {
    readings.push(readingAt(scene, frame / FPS))
  }
  return readings
}

/**
 * Answers the largest step between two consecutive frames of a scene.
 *
 * A frame that renames what is counted is left out: its key snaps rather than eases, so the step
 * across it is a change of subject rather than a jump in one.
 */
function largestStep(scene: Scene): number {
  let worst = 0
  let before: Reading | null = null
  for (const reading of walk(scene)) {
    const { value, unit } = reading
    if (value !== null && before?.value != null && unit === before.unit) {
      worst = Math.max(worst, Math.abs(value - before.value))
    }
    before = reading
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
  for (const scene of SCENES.filter((scene) => scene.keys.length > 0)) {
    test(`${scene.id} crosses no key in a single frame`, () => {
      expect(largestStep(scene)).toBeLessThan(largestDelta(scene))
    })

    test(`${scene.id} moves no faster than one ease can carry it`, () => {
      // an ease can start a key behind, closing two at most
      const bound = (2 * largestDelta(scene)) / (EASE_SECONDS * FPS)
      expect(largestStep(scene)).toBeLessThanOrEqual(bound)
    })

    test(`${scene.id} never falls back or overshoots`, () => {
      const top = Math.max(scene.value ?? 0, ...scene.keys.map((key) => key.value ?? 0))
      let before: number | null = null
      let counting = scene.unit
      let renaming = -1
      for (const [frame, { value, unit }] of walk(scene).entries()) {
        const seconds = frame / FPS
        if (value === null) continue
        expect(value).toBeLessThanOrEqual(top + 1e-9)
        // an ease onto another unit may fall, counting something else
        if (unit !== counting) {
          counting = unit
          renaming = seconds + EASE_SECONDS
        }
        if (seconds > renaming && before !== null) {
          expect(value).toBeGreaterThanOrEqual(before - 1e-9)
        }
        before = value
      }
      expect(before).not.toBeNull()
    })

    test(`${scene.id} opens and closes on the readings its take carried`, () => {
      expect(readingAt(scene, 0).value).toBe(scene.value)
      const last = scene.keys[scene.keys.length - 1]
      expect(readingAt(scene, last.at + EASE_SECONDS).value).toBeCloseTo(last.value as number, 6)
    })
  }

  test('the hero loops play every act once, around fifteen seconds in all', () => {
    expect([...HERO_SCENES].map((scene) => scene.id).sort()).toEqual(
      [...SCENES].map((scene) => scene.id).sort(),
    )
    expect(HERO_SCENES[0].id).toBe('heatmap')
    const total = HERO_SCENES.reduce((sum, scene) => sum + scene.hero.seconds, 0)
    expect(total).toBeGreaterThan(14)
    expect(total).toBeLessThan(17)
  })

  test('a card stands long enough to read the line it carries', () => {
    // about three words a second is a comfortable read, and the longest headline is six
    const longest = Math.max(...SCENES.map((scene) => scene.headline.split(' ').length))
    expect(CARD_SECONDS).toBeGreaterThanOrEqual(longest / 3)
  })

  test('every hero window stands inside the clip its act was cut from', () => {
    for (const scene of SCENES) {
      expect(scene.hero.skip).toBeGreaterThanOrEqual(0)
      expect(scene.hero.skip + scene.hero.seconds).toBeLessThanOrEqual(scene.seconds + 1e-9)
    }
  })

  test('an act that has measured nothing shows nothing until its key', () => {
    const rising: Scene = { ...sceneOf('atlas'), value: null, keys: [{ at: 1, value: 900 }] }
    expect(readingAt(rising, 0.99).value).toBeNull()
    expect(readingAt(rising, 1).value).toBe(0)
    expect(readingAt(rising, 1 + EASE_SECONDS).value).toBeCloseTo(900, 6)
  })

  test('an act with no keys holds the line it opens on', () => {
    for (const scene of SCENES.filter((candidate) => candidate.keys.length === 0)) {
      const opening = readingAt(scene, 0)
      expect(readingAt(scene, scene.seconds).value).toBe(opening.value)
      expect(readingAt(scene, scene.seconds).unit).toBe(opening.unit)
    }
  })

  test('a key that renames what is counted lands on its value at once', () => {
    const heatmap = sceneOf('heatmap')
    const key = heatmap.keys[0]
    const snap = Math.round(key.at * FPS)
    const before = readingAt(heatmap, (snap - 1) / FPS)
    expect(before.value).toBe(heatmap.value)
    expect(before.unit).toBe('points placed')
    for (let frame = snap; frame <= Math.round(heatmap.seconds * FPS); frame += 1) {
      const reading = readingAt(heatmap, frame / FPS)
      expect(reading.value).toBe(547)
      expect(reading.unit).toBe('cells from 1M points')
    }
  })

  test('a key that renames what is counted keeps the name afterwards', () => {
    const heatmap = sceneOf('heatmap')
    const key = heatmap.keys[0]
    expect(readingAt(heatmap, 0).unit).toBe('points placed')
    expect(readingAt(heatmap, key.at + 1).unit).toBe('cells from 1M points')
  })

  test('the last of two keys on the same second is the one that is shown', () => {
    const shared: Scene = {
      ...sceneOf('atlas'),
      value: 100,
      keys: [
        { at: 1, value: 500 },
        { at: 1, value: 200 },
      ],
    }
    expect(readingAt(shared, 0.99).value).toBe(100)
    expect(readingAt(shared, 1).value).toBe(100)
    expect(readingAt(shared, 1 + EASE_SECONDS / 2).value).toBeCloseTo(150, 6)
    expect(readingAt(shared, 1 + EASE_SECONDS).value).toBeCloseTo(200, 6)
    // the dropped key's value is never reached, let alone passed
    for (const { value } of walk(shared)) expect(value ?? 0).toBeLessThanOrEqual(200 + 1e-9)
  })
})
