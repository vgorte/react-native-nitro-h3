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
  // the ground at 55 percent, so muted labels survive a panel over the brightest cells
  scrim: 'rgba(6,9,17,0.55)',
} as const

// a `readonly` tuple is not assignable to the `fontVariant` of a `TextStyle`
const tabular: FontVariant[] = ['tabular-nums']

/** Carries the type scale: weight 200 for numbers, weight 400 for labels. */
export const type = {
  metric: { fontFamily: fontFamily.light, fontSize: 32, fontVariant: tabular },
  value: { fontFamily: fontFamily.regular, fontSize: 13, fontVariant: tabular },
  label: { fontFamily: fontFamily.regular, fontSize: 11 },
} as const

/** Counts the colour buckets a mesh is drawn in; a bucket is one draw call per chunk. */
export const BUCKETS = 16

/** Alpha of a cell fill drawn over a basemap, where the hairline outline carries the grid. */
export const CELL_FILL_OPACITY = 0.12

/**
 * Answers the ramp bucket of a count on a logarithmic scale over the range `low` to `max`.
 *
 * Counts are heavy at the low end, so a linear ramp leaves every cell at the darkest stop; a set
 * with a floor under it fills the bright end instead, which is why the scale is anchored at `low`.
 *
 * @param count Points in the cell, `0` where none landed in it.
 * @param low The quietest counted cell, which the ramp's darkest step stands for.
 * @param max The busiest counted cell, which the ramp's brightest step stands for.
 * @param buckets Steps the ramp is cut into, which the caller takes from the theme.
 */
export function bucketOfCount(count: number, low: number, max: number, buckets: number): number {
  if (count <= 0) return 0
  const anchor = Math.max(1, low)
  // a set whose counted cells all hold the same number has no range to spread, so it is all hot
  if (max <= anchor) return buckets - 1
  const position = Math.log(count / anchor) / Math.log(max / anchor)
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
