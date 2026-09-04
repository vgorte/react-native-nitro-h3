import { describe, expect, test } from 'bun:test'
import { sliderValueAt } from '../render/hud/track'

describe('sliderValueAt', () => {
  test('maps the track onto the range and rounds to whole steps', () => {
    expect(sliderValueAt(0, 200, 1, 50)).toBe(1)
    expect(sliderValueAt(200, 200, 1, 50)).toBe(50)
    expect(sliderValueAt(100, 200, 1, 50)).toBe(26)
  })

  test('clamps a drag past either end', () => {
    expect(sliderValueAt(-40, 200, 1, 50)).toBe(1)
    expect(sliderValueAt(400, 200, 1, 50)).toBe(50)
  })
})
