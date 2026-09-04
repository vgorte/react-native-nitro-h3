import { describe, expect, test } from 'bun:test'
import {
  isPushed,
  nextSettings,
  OPEN_SETTINGS,
  PUSH_POINTS,
  PUSH_RES,
  RES_CHOICES,
  type Settings,
} from '../engine/settings'

const PUSHED: Settings = { seed: 1, points: PUSH_POINTS, res: PUSH_RES }

describe('nextSettings', () => {
  test('bumps the seed and leaves the run it describes alone', () => {
    expect(nextSettings(PUSHED, { control: 'seed' })).toEqual({ ...PUSHED, seed: 2 })
  })

  test('sets both values of the push-it step', () => {
    expect(nextSettings(OPEN_SETTINGS, { control: 'push' })).toEqual({
      seed: OPEN_SETTINGS.seed,
      points: PUSH_POINTS,
      res: PUSH_RES,
    })
  })

  test('takes the resolution back to the opening one when the point count leaves the step', () => {
    const left = nextSettings(PUSHED, { control: 'points', value: 100_000 })

    expect(left).toEqual({ seed: 1, points: 100_000, res: OPEN_SETTINGS.res })
    expect(isPushed(left)).toBe(false)
  })

  test('keeps the step when its own point count is picked again', () => {
    expect(nextSettings(PUSHED, { control: 'points', value: PUSH_POINTS })).toEqual(PUSHED)
  })

  test('leaves the step by a resolution and keeps the count, which the row still lights', () => {
    const left = nextSettings(PUSHED, { control: 'res', value: 8 })

    expect(left).toEqual({ seed: 1, points: PUSH_POINTS, res: 8 })
    expect(isPushed(left)).toBe(false)
  })

  test('changes the point count of a plain run without touching its resolution', () => {
    const plain: Settings = { seed: 1, points: 100_000, res: 7 }

    expect(nextSettings(plain, { control: 'points', value: PUSH_POINTS })).toEqual({
      seed: 1,
      points: PUSH_POINTS,
      res: 7,
    })
  })

  test('never leaves a state the resolution row cannot light', () => {
    const changes = [
      { control: 'seed' },
      { control: 'push' },
      { control: 'points', value: 100_000 },
      { control: 'points', value: PUSH_POINTS },
      { control: 'res', value: 7 },
      { control: 'res', value: 8 },
      { control: 'res', value: 9 },
    ] as const

    let states: Settings[] = [OPEN_SETTINGS]
    for (let step = 0; step < 3; step++) {
      const reached: Settings[] = []
      for (const state of states) {
        for (const change of changes) {
          const answer = nextSettings(state, change)
          expect(isPushed(answer) || RES_CHOICES.includes(answer.res)).toBe(true)
          reached.push(answer)
        }
      }
      states = reached
    }
  })
})

describe('isPushed', () => {
  test('holds only where both values of the step stand', () => {
    expect(isPushed(PUSHED)).toBe(true)
    expect(isPushed({ ...PUSHED, points: 100_000 })).toBe(false)
    expect(isPushed({ ...PUSHED, res: 9 })).toBe(false)
  })
})
