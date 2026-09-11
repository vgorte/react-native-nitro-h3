/** Names the two bundled Inter Tight weights, as `expo-font` registers them. */
export const fontFamily = {
  light: 'InterTight-200',
  regular: 'InterTight-400',
} as const

/** Maps every family name onto its bundled file, ready for `useFonts`. */
export const fontAssets = {
  [fontFamily.light]: require('../../assets/fonts/InterTight-ExtraLight.ttf'),
  [fontFamily.regular]: require('../../assets/fonts/InterTight-Regular.ttf'),
}
