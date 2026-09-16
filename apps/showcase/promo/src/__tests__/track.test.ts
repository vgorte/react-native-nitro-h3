import { describe, expect, test } from 'bun:test'
import { SCENES } from '../scenes/scenes'
import { cursorOn, ringsOf, type Track } from '../scenes/track'

const TRACK: Track = { from: 0.4, to: 0.9, y: 0.8, low: 1, high: 50 }

describe('ringsOf', () => {
  test('inverts the cell count of a disk at every ring the slider offers', () => {
    for (let k = 1; k <= 50; k += 1) expect(ringsOf(3 * k * k + 3 * k + 1)).toBe(k)
  })
})

describe('cursorOn', () => {
  test('puts the ends of the drag on the ends of the track', () => {
    const drag = cursorOn(TRACK, 1, [
      { at: 0, cells: 7 },
      { at: 1, cells: 7651 },
    ])
    expect(drag.steps[0].x).toBeCloseTo(TRACK.from, 9)
    expect(drag.steps[1].x).toBeCloseTo(TRACK.to, 9)
    expect(drag.y).toBe(TRACK.y)
  })

  test('spaces the steps by the rings they carry', () => {
    const drag = cursorOn(TRACK, 1, [
      { at: 0, cells: 7 },
      { at: 1, cells: 1951 },
    ])
    // k 25 of 1 to 50 is half the track
    expect(drag.steps[1].x).toBeCloseTo(TRACK.from + (24 / 49) * 0.5, 9)
  })

  test("the grid's cursor never leaves its track", () => {
    const grid = SCENES.find((scene) => scene.id === 'grid')
    const drag = grid?.drag
    expect(drag).toBeDefined()
    let before = -1
    for (const step of drag?.steps ?? []) {
      expect(step.x).toBeGreaterThanOrEqual(0.4123 - 1e-9)
      expect(step.x).toBeLessThanOrEqual(0.9103 + 1e-9)
      expect(step.x).toBeGreaterThanOrEqual(before)
      before = step.x
    }
  })

  test("the grid's cursor stands on the reading the caption shows", () => {
    const grid = SCENES.find((scene) => scene.id === 'grid')
    const steps = grid?.drag?.steps ?? []
    // the opening reading has no key of its own, so the keys line up one behind the steps
    expect(steps.length).toBe((grid?.keys.length ?? 0) + 1)
    for (const [index, key] of (grid?.keys ?? []).entries()) {
      expect(steps[index + 1].at).toBeCloseTo(key.at, 9)
    }
  })
})
