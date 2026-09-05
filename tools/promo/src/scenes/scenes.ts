/** One act of the showcase, as the video plays it. */
export interface Scene {
  /** The clip under public/clips, without its extension. */
  id: string
  /** The act name, as the app's own indicator spells it. */
  act: string
  /** Frames the scene stands for, at 60 fps; never longer than the clip. */
  duration: number
  /** The number the act's panel carried in the take. */
  value: number
  /** Decimal places the number is written with. */
  decimals: number
  /** What follows the number, where the panel wrote a unit onto it. */
  suffix: string
  /** What the number counts. */
  label: string
  /** One line on what the act is doing. */
  note: string
  /** Frames of the clip the hero loop skips, so its three seconds end where the number lands. */
  heroSkip: number
}

/**
 * Names the six acts in the order the video plays them, with the reading each take ended on.
 *
 * Every number here was read off the panel in the take it belongs to, so what the caption says is
 * what the phone in the same frame shows.
 */
export const SCENES: readonly Scene[] = [
  {
    id: 'atlas',
    act: 'Atlas',
    duration: 240,
    value: 1801,
    decimals: 0,
    suffix: '',
    label: 'cells on the map',
    note: 'a hexagon grid over Berlin, through the classic GeoJSON path',
    heroSkip: 0,
  },
  {
    id: 'engine',
    act: 'Engine',
    duration: 240,
    value: 878.3,
    decimals: 1,
    suffix: '×',
    label: 'faster than h3-js',
    note: 'compacting 99,919 cells, both sides on the JS thread',
    heroSkip: 0,
  },
  {
    id: 'fractal',
    act: 'Fractal city',
    duration: 264,
    value: 835,
    decimals: 0,
    suffix: '',
    label: 'leaf cells',
    note: 'a tap splits one cell into its seven children',
    heroSkip: 42,
  },
  {
    id: 'grid',
    act: 'Magnetic grid',
    duration: 270,
    value: 7651,
    decimals: 0,
    suffix: '',
    label: 'cells drawn',
    note: 'fifty rings from the centre, rebuilt as the slider moves',
    heroSkip: 0,
  },
  {
    id: 'heatmap',
    act: 'Heatmap',
    duration: 270,
    value: 137972,
    decimals: 0,
    suffix: '',
    label: 'cells from a million points',
    note: 'a million points located at resolution 10, then counted',
    heroSkip: 0,
  },
  {
    id: 'trail',
    act: 'Trail',
    duration: 240,
    value: 11,
    decimals: 0,
    suffix: '',
    label: 'cells on the trail',
    note: 'a gap in the feed, closed with gridPathCells',
    heroSkip: 0,
  },
]

/** The three acts the hero loop plays, strongest first. */
export const HERO_SCENES: readonly Scene[] = ['heatmap', 'fractal', 'atlas'].map((id) => {
  const scene = SCENES.find((candidate) => candidate.id === id)
  if (scene === undefined) throw new Error(`no scene ${id}`)
  return scene
})
