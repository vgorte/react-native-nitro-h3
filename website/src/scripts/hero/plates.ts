import { PARA_REF_W } from './parallax'

/**
 * Describes the cloud plate's recipe. The plate is baked by `website/scripts/gen-cloud-plate.ts`
 * and ships as an image, so nothing here reaches the browser; the constants stay next to the scene
 * they describe.
 */
export type Plate = { levels: string; gain: number }

/**
 * The mask preset: the plate keeps the photograph's own colour and luma becomes the alpha, so the
 * grey clouds read as grey haze rather than as white.
 */
export const CLOUD_PLATE: Plate = { levels: 'none', gain: 1 }

/** Rendered blur at the reference stage width. */
export const DOF_BLUR_PX = 6

/** The cloud layer's share of the stage width, which is what image pixels are scaled against. */
export const CLOUD_SPAN = 1.12

/** The band between the two zeroes stays sharp; the blurred copy is let through above and below. */
export const DOF_STOPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.07, 1],
  [0.25, 0],
  [0.73, 0],
  [1, 1],
]

/** Returns the blur radius the plate is baked at, in pixels of an image this wide. */
export function cloudBlurPx(imageWidth: number): number {
  return (DOF_BLUR_PX * imageWidth) / (CLOUD_SPAN * PARA_REF_W)
}

/**
 * Returns the depth-of-field band's alpha at a fraction of the image height, interpolated linearly
 * over `DOF_STOPS`. It is the vertical gradient the blurred copy is cut with.
 */
export function bandAlphaAt(t: number): number {
  const first = DOF_STOPS[0]
  const last = DOF_STOPS[DOF_STOPS.length - 1]
  if (!first || !last) return 0
  if (t <= first[0]) return first[1]
  for (let i = 1; i < DOF_STOPS.length; i += 1) {
    const stop = DOF_STOPS[i]
    const previous = DOF_STOPS[i - 1]
    if (!stop || !previous || t > stop[0]) continue
    const span = stop[0] - previous[0]
    const k = span === 0 ? 1 : (t - previous[0]) / span
    return previous[1] + (stop[1] - previous[1]) * k
  }
  return last[1]
}

/** Writes luma into the alpha channel in place. Pure, so it is the part under test. */
export function alphaFromLuma(data: Uint8ClampedArray, gain: number): void {
  for (let p = 0; p < data.length; p += 4) {
    const r = data[p] ?? 0
    const g = data[p + 1] ?? 0
    const b = data[p + 2] ?? 0
    const l = (r * 0.299 + g * 0.587 + b * 0.114) / 255
    data[p + 3] = Math.round(Math.min(1, l * gain) * 255)
  }
}
