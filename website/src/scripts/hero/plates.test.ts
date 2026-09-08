import { describe, expect, test } from 'bun:test'
import { alphaFromLuma, CLOUD_PLATE, DOF_BLUR_PX, DOF_STOPS } from './plates'

const pixels = (...rgb: number[][]): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(rgb.length * 4)
  for (const [i, colour] of rgb.entries()) {
    data[i * 4] = colour[0] ?? 0
    data[i * 4 + 1] = colour[1] ?? 0
    data[i * 4 + 2] = colour[2] ?? 0
    data[i * 4 + 3] = 255
  }
  return data
}

describe('alphaFromLuma', () => {
  test('writes luma into alpha and leaves the colour channels alone', () => {
    const data = pixels([0, 0, 0], [255, 255, 255], [128, 128, 128])
    alphaFromLuma(data, 1, false)
    expect(data[3]).toBe(0)
    expect(data[7]).toBe(255)
    expect(data[11]).toBe(128)
    expect([...data.slice(0, 3)]).toEqual([0, 0, 0])
    expect([...data.slice(4, 7)]).toEqual([255, 255, 255])
    expect([...data.slice(8, 11)]).toEqual([128, 128, 128])
  })

  test('uses the luma weights and not a plain channel average', () => {
    const data = pixels([0, 0, 255])
    alphaFromLuma(data, 1, false)
    expect(data[3]).toBe(Math.round(0.114 * 255))
    expect(data[3]).not.toBe(85)
  })

  test('a gain above one clamps at 255 instead of wrapping', () => {
    const data = pixels([128, 128, 128])
    alphaFromLuma(data, 3, false)
    expect(data[3]).toBe(255)
  })
})

describe('the shipped plate', () => {
  test('carries the mask preset of the spec', () => {
    expect(CLOUD_PLATE).toEqual({ levels: 'none', whiten: false, gain: 1 })
    expect(DOF_BLUR_PX).toBe(6)
    expect(DOF_STOPS).toEqual([
      [0, 1],
      [0.07, 1],
      [0.25, 0],
      [0.73, 0],
      [1, 1],
    ])
  })
})
