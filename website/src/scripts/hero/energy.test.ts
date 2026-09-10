import { describe, expect, test } from 'bun:test'
import {
  createEnergy,
  decayEnergy,
  ENERGY_FLOOR,
  ENERGY_KEY_ORIGIN,
  ENERGY_TAU,
  type EnergyState,
  energyKey,
  markPatch,
} from './energy'

const targetAt = (state: EnergyState, q: number, r: number): number | undefined =>
  state.cells.get(energyKey(q, r))?.target

describe('energyKey', () => {
  test('is collision free well past the range the grid reaches', () => {
    const seen = new Set<number>()
    for (let q = -400; q <= 400; q += 7) {
      for (let r = -400; r <= 400; r += 7) {
        const key = energyKey(q, r)
        expect(Number.isSafeInteger(key)).toBe(true)
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
  })

  test('never runs a coordinate off the negative end of its offset', () => {
    expect(energyKey(-ENERGY_KEY_ORIGIN, -ENERGY_KEY_ORIGIN)).toBe(0)
  })
})

describe('markPatch', () => {
  test('sets the centre to 1 and each ring to its cubed falloff', () => {
    const state = createEnergy()
    markPatch(state, 0, 0, 3)
    const cubed = (d: number): number => (1 - d / 4) ** 3
    expect(targetAt(state, 0, 0)).toBe(1)
    expect(targetAt(state, -1, 1)).toBeCloseTo(cubed(1), 12)
    expect(targetAt(state, -2, 2)).toBeCloseTo(cubed(2), 12)
    expect(targetAt(state, -3, 3)).toBeCloseTo(cubed(3), 12)
  })

  test('touches the centre and three full rings', () => {
    const state = createEnergy()
    markPatch(state, 3, -2, 3)
    expect(state.cells.size).toBe(1 + 6 + 12 + 18)
  })
})

describe('decayEnergy', () => {
  test('halves the gap to the target after one half-life', () => {
    const state = createEnergy()
    markPatch(state, 0, 0, 0)
    decayEnergy(state, ENERGY_TAU * Math.LN2, 600, false)
    expect(state.cells.get(energyKey(0, 0))?.e).toBeCloseTo(0.5, 12)
  })

  test('drops a cell whose target is 0 once it falls below the floor', () => {
    const state = createEnergy()
    state.cells.set(energyKey(0, 0), { q: 0, r: 0, e: ENERGY_FLOOR * 1.2, target: 0, stamp: -1 })
    decayEnergy(state, 1, 600, false)
    expect(state.cells.has(energyKey(0, 0))).toBe(false)
  })

  test('cuts the lowest-energy cells down to the cap', () => {
    const state = createEnergy()
    for (let i = 1; i <= 10; i++) {
      state.cells.set(energyKey(i, 0), {
        q: i,
        r: 0,
        e: i / 10,
        target: i / 10,
        stamp: state.stamp,
      })
    }
    decayEnergy(state, 0.016, 4, false)
    expect(state.cells.size).toBe(4)
    expect([...state.cells.values()].map((cell) => cell.q).sort()).toEqual([10, 7, 8, 9].sort())
  })

  test('keeps the cells this frame touched and drops the ones it left behind', () => {
    const state = createEnergy()
    for (let i = 1; i <= 10; i++) {
      state.cells.set(energyKey(i, 0), { q: i, r: 0, e: 0.9, target: 0, stamp: state.stamp })
    }
    state.stamp += 1
    // A touched cell starts dark, so by energy alone these three would be the first to go.
    for (let i = 1; i <= 3; i++) {
      state.cells.set(energyKey(0, i), { q: 0, r: i, e: 0, target: 1, stamp: state.stamp })
    }
    decayEnergy(state, 0.016, 3, false)
    expect([...state.cells.values()].map((cell) => cell.r).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })
})
