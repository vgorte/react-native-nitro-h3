import type { Matrix3, Resolution } from './geometry'

export type Mode = 'desk' | 'mob'

export type Mask = { cx: number; cy: number; r0: number; r1: number; fy0: number; fy1: number }

export type Scene = {
  /** Design space, which is also the size the background image is authored at. */
  W: number
  H: number
  image?: ImageMetadata
  /** Ground plane to design space, and back. */
  Hm: Matrix3
  Hi: Matrix3
  clampU: readonly [number, number]
  clampV: readonly [number, number]
  /** The highest screen row the pointer may unproject from, not the mathematical horizon. */
  horizonY: number
  mask: Mask
  litR: Record<Resolution, number>
  litCap: number
  dock: boolean
}

export const SCENES: Record<Mode, Scene> = {
  desk: {
    W: 1672,
    H: 941,
    Hm: [
      [935.0, -596.8246445498, 650.0],
      [0.0, 55.3436018957, 390.0],
      [0.0, -0.5568720379, 1.0],
    ],
    Hi: [
      [0.001069518717, 0.000921699057, -1.054649797835],
      [0.0, 0.003669405678, -1.431068214425],
      [0.0, 0.002043389418, 0.203078127038],
    ],
    clampU: [-0.36, 0.56],
    clampV: [-0.2, 0.3],
    horizonY: 400,
    mask: { cx: 1055, cy: 655, r0: 140, r1: 790, fy0: 388, fy1: 486 },
    // Rings of ground lit around the pointer, per resolution, so the patch keeps its screen size.
    litR: { 6: 2, 9: 3, 12: 4 },
    litCap: 600,
    dock: false,
  },
  mob: {
    W: 868,
    H: 1882,
    Hm: [
      [1870.0, -425.1658767976, -80.0],
      [0.0, 110.6872037914, 780.0],
      [0.0, -0.5568720379, 1.0],
    ],
    Hi: [
      [0.000534759358, 0.000460849528, -0.316681883419],
      [0.0, 0.001834702839, -1.431068214456],
      [0.0, 0.001021694709, 0.203078127042],
    ],
    clampU: [-0.16, 0.09],
    clampV: [-0.2, 0.3],
    horizonY: 800,
    mask: { cx: 610, cy: 1290, r0: 280, r1: 1580, fy0: 776, fy1: 972 },
    // The portrait crop is narrow, so the patch stays a small cluster around the pressed cell.
    litR: { 6: 1, 9: 1, 12: 2 },
    litCap: 300,
    dock: true,
  },
}

/** The one query that decides the mode. The CSS uses the same string, so they cannot disagree. */
export const MODE_QUERY = '(orientation: portrait), (max-width: 49.9375rem)'

/** `?mode=desk` and `?mode=mob` stay as a test aid and take precedence over the query. */
export function pickMode(params: URLSearchParams): Mode {
  const forced = params.get('mode')
  if (forced === 'mob' || forced === 'mobile') return 'mob'
  if (forced === 'desk' || forced === 'desktop') return 'desk'
  return matchMedia(MODE_QUERY).matches ? 'mob' : 'desk'
}
