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

  test('anchors the first step at the low count and the top step at the high one', () => {
    expect(bucketOfCount(400, 400, 10_000, 16)).toBe(0)
    expect(bucketOfCount(10_000, 400, 10_000, 16)).toBe(15)
    expect(bucketOfCount(2_000, 400, 10_000, 16)).toBe(8)
  })

  test('clamps the counts outside the anchors onto the two end steps', () => {
    expect(bucketOfCount(50, 400, 10_000, 16)).toBe(0)
    expect(bucketOfCount(40_000, 400, 10_000, 16)).toBe(15)
  })

  test('takes a count of nothing to the empty step, whatever the anchors are', () => {
    expect(bucketOfCount(0, 400, 10_000, 16)).toBe(0)
    expect(bucketOfCount(0, 1, 1, 16)).toBe(0)
  })

  test('takes every counted cell to the top step where the anchors meet', () => {
    expect(bucketOfCount(550, 550, 550, 16)).toBe(15)
    expect(bucketOfCount(1, 1, 1, 16)).toBe(15)
  })

  test('places a run measured at resolution 7 between its own quantiles', () => {
    // a million points at resolution 7 on the simulator: 547 cells, p25 410, p99 10,457
    expect(bucketOfCount(410, 410, 10_457, 16)).toBe(0)
    expect(bucketOfCount(1_074, 410, 10_457, 16)).toBe(4)
    expect(bucketOfCount(11_887, 410, 10_457, 16)).toBe(15)
  })
})
