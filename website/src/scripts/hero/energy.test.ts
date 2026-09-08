import { describe, expect, test } from 'bun:test'
import {
  createEnergy,
  decayEnergy,
  ENERGY_FLOOR,
  ENERGY_TAU,
  type EnergyState,
  markPatch,
} from './energy'

const targetAt = (state: EnergyState, q: number, r: number): number | undefined =>
  state.cells.get(`${q},${r}`)?.target

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
    expect(state.cells.get('0,0')?.e).toBeCloseTo(0.5, 12)
  })

  test('drops a cell whose target is 0 once it falls below the floor', () => {
    const state = createEnergy()
    state.cells.set('0,0', { q: 0, r: 0, e: ENERGY_FLOOR * 1.2, target: 0, stamp: -1 })
    decayEnergy(state, 1, 600, false)
    expect(state.cells.has('0,0')).toBe(false)
  })

  test('cuts the lowest-energy cells down to the cap', () => {
    const state = createEnergy()
    for (let i = 1; i <= 10; i++) {
      state.cells.set(`${i},0`, { q: i, r: 0, e: i / 10, target: i / 10, stamp: state.stamp })
    }
    decayEnergy(state, 0.016, 4, false)
    expect(state.cells.size).toBe(4)
    expect([...state.cells.keys()].sort()).toEqual(['10,0', '7,0', '8,0', '9,0'])
  })
})
