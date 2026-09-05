import { describe, expect, test } from 'bun:test'
import { BUCKETS, bucketOfCount, colours, ramp, rampColours } from '../theme/tokens'

describe('tokens', () => {
  test('carries the Observatory ground and ramp', () => {
    expect(colours.ground).toBe('#060911')
    expect(colours.contrast).toBe('#FFB454')
    expect(ramp).toEqual(['#0F2F5A', '#1E6FD6', '#3FB0FF', '#C9EBFF', '#FFFFFF'])
  })

  test('quantises the ramp into the bucket count, endpoints included', () => {
    const quantised = rampColours(BUCKETS)

    expect(quantised).toHaveLength(16)
    expect(quantised[0]).toBe('#0f2f5a')
    expect(quantised[15]).toBe('#ffffff')
    expect(new Set(quantised).size).toBe(16)
  })

  test('maps a count onto a bucket on a logarithmic scale', () => {
    expect(bucketOfCount(1, 1, 1000, 16)).toBe(0)
    expect(bucketOfCount(1000, 1, 1000, 16)).toBe(15)
    expect(bucketOfCount(32, 1, 1000, 16)).toBeGreaterThan(bucketOfCount(4, 1, 1000, 16))
  })

  test('anchors the darkest step at the quietest count and the brightest at the busiest', () => {
    expect(bucketOfCount(400, 400, 10_000, 16)).toBe(0)
    expect(bucketOfCount(10_000, 400, 10_000, 16)).toBe(15)
    expect(bucketOfCount(2_000, 400, 10_000, 16)).toBe(8)
  })

  test('takes a count of nothing to the empty step, whatever the range is', () => {
    expect(bucketOfCount(0, 400, 10_000, 16)).toBe(0)
    expect(bucketOfCount(0, 1, 1, 16)).toBe(0)
  })

  test('takes every counted cell to the top step where the range is one count wide', () => {
    expect(bucketOfCount(550, 550, 550, 16)).toBe(15)
    expect(bucketOfCount(1, 1, 1, 16)).toBe(15)
  })
})
