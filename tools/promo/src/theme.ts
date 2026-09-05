// The Observatory theme of the showcase, copied from apps/showcase/src/theme/tokens.ts so the video
// stands on the same ground as the app it shows.

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

/** Names the two weights of Inter Tight the captions are set in. */
export const fontFamily = {
  light: 'InterTightLight',
  regular: 'InterTightRegular',
} as const
