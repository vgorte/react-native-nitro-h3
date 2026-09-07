import { describe, expect, test } from 'bun:test'
import { barFraction } from '../render/hud/barScale'

describe('barFraction', () => {
  test('scales this package against the h3-js median of its own row', () => {
    expect(barFraction(1, 1)).toBe(1)
    expect(barFraction(1, 15)).toBeCloseTo(1 / 15, 6)
    expect(barFraction(0.085, 73.3)).toBeCloseTo(0.00116, 5)
  })

  test('fills the track while the h3-js side has no median yet', () => {
    expect(barFraction(91.5, 0)).toBe(1)
    expect(barFraction(0, 0)).toBe(1)
  })

  test('clamps a package side that is slower than h3-js', () => {
    expect(barFraction(200, 100)).toBe(1)
    expect(barFraction(-5, 100)).toBe(0)
  })
})
