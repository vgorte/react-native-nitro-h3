import { describe, expect, test } from 'bun:test'
import { formatAreaKm2, formatCount, formatMs, formatUs, median, percentile } from '../engine/stats'

describe('stats', () => {
  test('takes the upper of the two middle samples', () => {
    expect(median([4, 1, 3, 2])).toBe(3)
    expect(median([5, 1, 3])).toBe(3)
  })

  test('takes the nearest rank for a percentile', () => {
    const samples = Array.from({ length: 20 }, (_, index) => index + 1)

    expect(percentile(samples, 0.95)).toBe(19)
  })

  test('formats a duration the way the benchmark table does', () => {
    expect(formatMs(425.63)).toBe('425.6 ms')
    expect(formatMs(0.085)).toBe('0.085 ms')
    expect(formatUs(0.0426)).toBe('42.6 us')
  })

  test('drops a cell area to an exponent below a square metre', () => {
    expect(formatAreaKm2(4.357)).toBe('4.357 km²')
    expect(formatAreaKm2(0.0000009)).toBe('9.00e-7 km²')
  })

  test('groups thousands in a count', () => {
    expect(formatCount(129169)).toBe('129,169')
  })
})
