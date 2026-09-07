import { describe, expect, test } from 'bun:test'
import { growthTransform } from '../render/growth'

describe('growthTransform', () => {
  test('starts collapsed on the parent centre and ends at full size', () => {
    const start = growthTransform({ x: 50, y: 80 }, 0)
    const end = growthTransform({ x: 50, y: 80 }, 1)

    expect(start).toEqual([
      { translateX: 50 },
      { translateY: 80 },
      { scale: 0.05 },
      { translateX: -50 },
      { translateY: -80 },
    ])
    expect(end[2]).toEqual({ scale: 1 })
  })

  test('scales about the centre at every progress, so the pivot never moves', () => {
    const half = growthTransform({ x: -12.5, y: 4 }, 0.5)

    expect(half[0]).toEqual({ translateX: -12.5 })
    expect(half[1]).toEqual({ translateY: 4 })
    expect(half[3]).toEqual({ translateX: 12.5 })
    expect(half[4]).toEqual({ translateY: -4 })
  })

  test('grows the scale in step with the progress', () => {
    const scaleAt = (progress: number) =>
      (growthTransform({ x: 0, y: 0 }, progress)[2] as { scale: number }).scale

    expect(scaleAt(0.5)).toBeCloseTo(0.525, 10)
    expect(scaleAt(0.25) - scaleAt(0)).toBeCloseTo(scaleAt(0.75) - scaleAt(0.5), 10)
  })
})
