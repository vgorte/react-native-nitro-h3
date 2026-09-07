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

const PUSHED: Settings = { ...OPEN_SETTINGS, points: PUSH_POINTS, res: PUSH_RES }

describe('nextSettings', () => {
  test('bumps the seed and leaves the run it describes alone', () => {
    expect(nextSettings(PUSHED, { control: 'seed' })).toEqual({ ...PUSHED, seed: 2 })
  })

  test('sets both values of the push-it step', () => {
    expect(nextSettings(OPEN_SETTINGS, { control: 'push' })).toEqual({
      ...OPEN_SETTINGS,
      points: PUSH_POINTS,
      res: PUSH_RES,
    })
  })

  test('takes the resolution back to the opening one when the point count leaves the step', () => {
    const left = nextSettings(PUSHED, { control: 'points', value: 100_000 })

    expect(left).toEqual({ ...PUSHED, points: 100_000, res: OPEN_SETTINGS.res })
    expect(isPushed(left)).toBe(false)
  })

  test('keeps the step when its own point count is picked again', () => {
    expect(nextSettings(PUSHED, { control: 'points', value: PUSH_POINTS })).toEqual(PUSHED)
  })

  test('leaves the step by a resolution and keeps the count, which the row still lights', () => {
    const left = nextSettings(PUSHED, { control: 'res', value: 8 })

    expect(left).toEqual({ ...PUSHED, res: 8 })
    expect(isPushed(left)).toBe(false)
  })

  test('changes the point count of a plain run without touching its resolution', () => {
    const plain: Settings = { ...OPEN_SETTINGS, res: 7 }

    expect(nextSettings(plain, { control: 'points', value: PUSH_POINTS })).toEqual({
      ...plain,
      points: PUSH_POINTS,
    })
  })

  test('takes the push-it resolution to stand for the whole step, wherever it is asked for', () => {
    const entered = nextSettings(OPEN_SETTINGS, { control: 'res', value: PUSH_RES })

    expect(entered).toEqual({ ...OPEN_SETTINGS, points: PUSH_POINTS, res: PUSH_RES })
    expect(isPushed(entered)).toBe(true)
  })

  test('opens on the points alone, which is the cloud the heatmap is switched on over', () => {
    expect(OPEN_SETTINGS.view).toBe('points')
    expect(OPEN_SETTINGS.path).toBe('image')
  })

  test('switches the view without touching the run the settings describe', () => {
    for (const value of ['points', 'heatmap', 'both'] as const) {
      expect(nextSettings(PUSHED, { control: 'view', value })).toEqual({ ...PUSHED, view: value })
    }
  })

  test('brings the points back with a path picked while the hexagons stand alone', () => {
    const heat: Settings = { ...OPEN_SETTINGS, view: 'heatmap' }

    expect(nextSettings(heat, { control: 'path', value: 'native' })).toEqual({
      ...heat,
      view: 'both',
      path: 'native',
    })
  })

  test('leaves the view alone where the points already draw', () => {
    expect(nextSettings(OPEN_SETTINGS, { control: 'path', value: 'native' })).toEqual({
      ...OPEN_SETTINGS,
      path: 'native',
    })
    const both: Settings = { ...OPEN_SETTINGS, view: 'both', path: 'native' }
    expect(nextSettings(both, { control: 'path', value: 'image' })).toEqual({
      ...both,
      path: 'image',
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
      { control: 'res', value: PUSH_RES },
      { control: 'view', value: 'points' },
      { control: 'view', value: 'heatmap' },
      { control: 'view', value: 'both' },
      { control: 'path', value: 'image' },
      { control: 'path', value: 'native' },
    ] as const

    let states: Settings[] = [OPEN_SETTINGS]
    for (let step = 0; step < 3; step++) {
      const reached: Settings[] = []
      for (const state of states) {
        for (const change of changes) {
          const answer = nextSettings(state, change)
          expect(isPushed(answer) || RES_CHOICES.includes(answer.res)).toBe(true)
          // a path only ever stands where the points it draws stand with it
          expect(answer.view !== 'heatmap' || answer.path === state.path).toBe(true)
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
