/** One reading the caption takes on, keyed to the moment the take showed it. */
export interface Key {
  /**
   * Seconds into the scene the caption starts easing onto the reading.
   *
   * An act whose number answers one action keys 150 ms after that action, so the caption reads as
   * a summary of what just happened; an act whose number runs on keys at the second it was read,
   * so the ease itself carries the same lag rather than adding to it.
   */
  at: number
  /** The number the panel carried, `null` where the act had not measured one yet. */
  value: number | null
  /** What the number counts, where the reading changed what is being counted. */
  label?: string
}

/** One tap the take took, drawn back over the phone as a ripple. */
export interface Tap {
  /** Seconds into the scene the finger went down. */
  at: number
  /** Where it landed, as a fraction of the phone's own width and height. */
  x: number
  y: number
}

/** One position of a finger riding a control, as a fraction of the phone's width. */
export interface DragStep {
  at: number
  x: number
}

/** The finger that drags a control, drawn back over the phone as a disc. */
export interface Drag {
  /** Where the control stands, as a fraction of the phone's own height. */
  y: number
  /** Seconds into the scene the finger lifts. */
  until: number
  steps: readonly DragStep[]
}

/** One act of the showcase, as the video plays it. */
export interface Scene {
  /** The clip under public/clips, without its extension. */
  id: string
  /** The act name, as the app's own indicator spells it. */
  act: string
  /** Seconds the scene stands for; never longer than the clip. */
  seconds: number
  /** The reading the caption opens on, `null` where the act has measured nothing yet. */
  value: number | null
  /** Decimal places the number is written with. */
  decimals: number
  /** What follows the number, where the panel wrote a unit onto it. */
  suffix: string
  /** What the number counts, until a key replaces it. */
  label: string
  /** The H3 call the act is making, named the way the act's own rows name it. */
  call: string
  /** What the panel read, and when; the caption steps through these. */
  keys: readonly Key[]
  /** A third line in the theme's amber, which stands from the first reading on. */
  note?: string
  taps?: readonly Tap[]
  drag?: Drag
  /** Whether the phone is pushed in slowly over the scene. */
  pushIn?: boolean
  /** Seconds of the clip the hero loop skips, so its three seconds hold the interaction. */
  heroSkip: number
}

/** Seconds the caption takes to ease from one reading onto the next. */
export const EASE_SECONDS = 0.3

/**
 * Names the six acts in the order the video plays them, with the readings each take stepped through.
 *
 * Every number here was read off the panel in the take it belongs to, at the second it is keyed to,
 * so what the caption says is what the phone in the same frame shows.
 */
export const SCENES: readonly Scene[] = [
  {
    id: 'atlas',
    act: 'Atlas',
    seconds: 4.2,
    value: 1261,
    decimals: 0,
    suffix: '',
    label: 'cells on the map',
    call: 'gridDisk',
    keys: [{ at: 1.65, value: 3997 }],
    heroSkip: 0,
  },
  {
    id: 'engine',
    act: 'Engine',
    seconds: 4.5,
    value: null,
    decimals: 1,
    suffix: '×',
    label: 'faster than h3-js',
    call: 'compactCells, 99,919 cells',
    keys: [{ at: 2.6, value: 1021 }],
    note: 'h3-js held the JS thread 1.8 s',
    heroSkip: 0,
  },
  {
    id: 'fractal',
    act: 'Fractal city',
    seconds: 4.3,
    value: 817,
    decimals: 0,
    suffix: '',
    label: 'leaf cells',
    call: 'cellToChildren',
    keys: [
      { at: 0.5, value: 823 },
      { at: 2.15, value: 829 },
      { at: 3.78, value: 835 },
    ],
    taps: [
      { at: 0.35, x: 0.4975, y: 0.5492 },
      { at: 2.0, x: 0.4975, y: 0.5492 },
      { at: 3.63, x: 0.4975, y: 0.5492 },
    ],
    pushIn: true,
    heroSkip: 0,
  },
  {
    id: 'grid',
    act: 'Magnetic grid',
    seconds: 4.7,
    value: 7,
    decimals: 0,
    suffix: '',
    label: 'cells drawn',
    call: 'gridRing',
    keys: [
      { at: 0.5, value: 37 },
      { at: 0.75, value: 217 },
      { at: 1.25, value: 631 },
      { at: 1.5, value: 919 },
      { at: 1.75, value: 1141 },
      { at: 2.0, value: 1951 },
      { at: 2.25, value: 2437 },
      { at: 2.5, value: 2611 },
      { at: 2.75, value: 3781 },
      { at: 3.0, value: 4447 },
      { at: 3.25, value: 4681 },
      { at: 3.5, value: 5941 },
      { at: 3.75, value: 6769 },
      { at: 4.25, value: 7651 },
    ],
    drag: {
      y: 0.8158,
      until: 4.25,
      steps: [
        { at: 0.0, x: 0.4129 },
        { at: 0.25, x: 0.4129 },
        { at: 0.5, x: 0.4332 },
        { at: 0.75, x: 0.484 },
        { at: 1.0, x: 0.484 },
        { at: 1.25, x: 0.5449 },
        { at: 1.5, x: 0.5754 },
        { at: 1.75, x: 0.5957 },
        { at: 2.0, x: 0.6566 },
        { at: 2.25, x: 0.6871 },
        { at: 2.5, x: 0.6972 },
        { at: 2.75, x: 0.7582 },
        { at: 3.0, x: 0.7886 },
        { at: 3.25, x: 0.7988 },
        { at: 3.5, x: 0.8495 },
        { at: 3.75, x: 0.88 },
        { at: 4.0, x: 0.88 },
        { at: 4.25, x: 0.9104 },
      ],
    },
    heroSkip: 0,
  },
  {
    id: 'heatmap',
    act: 'Heatmap',
    seconds: 4.3,
    value: 1000000,
    decimals: 0,
    suffix: '',
    label: 'points placed',
    call: 'latLngsToCells, 1,000,000 points',
    keys: [{ at: 0.9, value: 137972, label: 'cells from a million points' }],
    taps: [{ at: 0.7, x: 0.7786, y: 0.7048 }],
    heroSkip: 0,
  },
  {
    id: 'trail',
    act: 'Trail',
    seconds: 4.7,
    value: 196,
    decimals: 0,
    suffix: '',
    label: 'cells on the trail',
    call: 'latLngToCell, one call per fix',
    keys: [
      { at: 0.25, value: 203 },
      { at: 0.5, value: 206 },
      { at: 0.75, value: 216 },
      { at: 1.0, value: 224 },
      { at: 1.25, value: 226 },
      { at: 1.5, value: 234 },
      { at: 1.75, value: 237 },
      { at: 2.0, value: 246 },
      { at: 2.25, value: 256 },
      { at: 2.5, value: 258 },
      { at: 2.75, value: 264 },
      { at: 3.0, value: 272 },
      { at: 3.25, value: 284 },
      { at: 3.5, value: 286 },
      { at: 3.75, value: 295 },
      { at: 4.0, value: 297 },
      { at: 4.15, value: 303 },
      { at: 4.4, value: 310 },
    ],
    heroSkip: 0,
  },
]

/** The three acts the hero loop plays, the switch first. */
export const HERO_SCENES: readonly Scene[] = ['heatmap', 'grid', 'fractal'].map((id) => {
  const scene = SCENES.find((candidate) => candidate.id === id)
  if (scene === undefined) throw new Error(`no scene ${id}`)
  return scene
})
