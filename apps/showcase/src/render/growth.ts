import type { Transforms3d } from '@shopify/react-native-skia'

// the children start as a speck rather than at zero, so the first frame already has an area
const GROWTH_START = 0.05

/** Answers the transform that scales the children about the parent centre. */
export function growthTransform(centre: { x: number; y: number }, progress: number): Transforms3d {
  'worklet'
  return [
    { translateX: centre.x },
    { translateY: centre.y },
    { scale: GROWTH_START + (1 - GROWTH_START) * progress },
    { translateX: -centre.x },
    { translateY: -centre.y },
  ]
}
