import type { FontVariant } from 'react-native'
import { fontFamily } from './fonts'

/** Names the Observatory colours outside the intensity ramp. */
export const colours = {
  ground: '#060911',
  vignette: '#0D1424',
  hairline: '#26324A',
  text: '#E8EEF8',
  muted: '#7C8AA6',
  contrast: '#FFB454',
} as const

/** Names the ramp of the Observatory theme, low intensity to high. */
export const ramp: readonly string[] = ['#0F2F5A', '#1E6FD6', '#3FB0FF', '#C9EBFF', '#FFFFFF']

/** Describes the glass of the HUD surfaces. */
export const glass = {
  fill: 'rgba(255,255,255,0.04)',
  blur: 18,
  border: 'rgba(255,255,255,0.08)',
  radius: 14,
} as const

// a `readonly` tuple is not assignable to the `fontVariant` of a `TextStyle`
const tabular: FontVariant[] = ['tabular-nums']

/** Carries the type scale: weight 200 for numbers, weight 400 for labels. */
export const type = {
  metric: { fontFamily: fontFamily.light, fontSize: 32, fontVariant: tabular },
  headline: { fontFamily: fontFamily.light, fontSize: 44, fontVariant: tabular },
  value: { fontFamily: fontFamily.regular, fontSize: 13, fontVariant: tabular },
  label: { fontFamily: fontFamily.regular, fontSize: 11 },
} as const

/** Counts the colour buckets a mesh is drawn in; a bucket is one draw call per chunk. */
export const BUCKETS = 16

/**
 * Answers the ramp bucket of a count on a logarithmic scale.
 *
 * Counts are heavy at the low end, so a linear ramp leaves every cell at the darkest stop.
 */
export function bucketOfCount(count: number, max: number, buckets: number): number {
  if (count <= 1 || max <= 1) return 0
  const position = Math.log(count) / Math.log(max)
  return Math.min(buckets - 1, Math.max(0, Math.round(position * (buckets - 1))))
}

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16)
}

/** Quantises the theme ramp into `count` colours, evenly spaced between its stops. */
export function rampColours(count: number): string[] {
  const quantised: string[] = []
  for (let step = 0; step < count; step++) {
    const position = count === 1 ? 0 : (step / (count - 1)) * (ramp.length - 1)
    const lower = Math.min(Math.floor(position), ramp.length - 2)
    const weight = position - lower
    const from = ramp[lower]
    const to = ramp[lower + 1]
    let colour = '#'
    for (let offset = 1; offset < 7; offset += 2) {
      const value = Math.round(
        channel(from, offset) + (channel(to, offset) - channel(from, offset)) * weight,
      )
      colour += value.toString(16).padStart(2, '0')
    }
    quantised.push(colour)
  }
  return quantised
}
