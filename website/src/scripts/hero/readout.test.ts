import { describe, expect, test } from 'bun:test'
import type { Rect } from './geometry'
import { segBox } from './readout'

const box: Rect = { left: 100, top: 100, right: 200, bottom: 200 }

describe('segBox', () => {
  test('a segment straight through the box crosses it', () => {
    expect(segBox(50, 150, 250, 150, box)).toBe(true)
  })

  test('a segment past the top left corner misses the box', () => {
    // The bounding boxes overlap, so only the clip itself can reject this one.
    expect(segBox(0, 150, 150, 0, box)).toBe(false)
  })

  test('a segment starting inside the box crosses it', () => {
    expect(segBox(150, 150, 400, 400, box)).toBe(true)
  })
})
