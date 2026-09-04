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
    expect(bucketOfCount(1, 1000, 16)).toBe(0)
    expect(bucketOfCount(1000, 1000, 16)).toBe(15)
    expect(bucketOfCount(32, 1000, 16)).toBeGreaterThan(bucketOfCount(4, 1000, 16))
  })
})
