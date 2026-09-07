/** Answers the value under a track position, clamped and rounded to whole steps. */
export function sliderValueAt(x: number, width: number, min: number, max: number): number {
  'worklet'
  const position = Math.min(1, Math.max(0, x / width))
  return Math.round(min + position * (max - min))
}
