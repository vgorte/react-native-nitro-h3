import { cursorOn, type Drag, type Reading, type Track } from './track'

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
/**
 * The Magnetic grid's slider, measured off the clip the composition plays: the thumb's centre at
 * k 1 and at k 50, and the row it stands on.
 *
 * The cursor is placed from these rather than read off frames by hand, so it rides the thumb at
 * every reading instead of drifting beside it.
 */
const RING_TRACK: Track = { from: 0.4123, to: 0.9103, y: 0.8148, low: 1, high: 50 }

/** What the Magnetic grid's panel counted while the slider was dragged, a reading a quarter second. */
const RING_READINGS: readonly Reading[] = [
  { at: 0.0, cells: 7 },
  { at: 0.25, cells: 37 },
  { at: 0.5, cells: 169 },
  { at: 0.75, cells: 217 },
  { at: 1.0, cells: 331 },
  { at: 1.25, cells: 919 },
  { at: 1.5, cells: 1261 },
  { at: 1.75, cells: 1261 },
  { at: 2.0, cells: 2269 },
  { at: 2.25, cells: 2791 },
  { at: 2.5, cells: 2791 },
  { at: 2.75, cells: 4447 },
  { at: 3.0, cells: 4921 },
  { at: 3.25, cells: 4921 },
  { at: 3.5, cells: 6487 },
  { at: 3.75, cells: 6769 },
  { at: 4.0, cells: 7651 },
]

export const SCENES: readonly Scene[] = [
  {
    id: 'atlas',
    act: 'Atlas',
    seconds: 5.0,
    value: 817,
    decimals: 0,
    suffix: '',
    label: 'cells on the map',
    call: 'gridDisk',
    keys: [
      { at: 0.65, value: 2791 },
      { at: 4.55, value: 3997 },
    ],
    heroSkip: 0,
  },
  {
    id: 'engine',
    act: 'Engine',
    seconds: 4.3,
    value: null,
    decimals: 1,
    suffix: '\u00d7',
    label: 'faster than h3-js',
    call: 'compactCells, 99,919 cells',
    keys: [{ at: 2.15, value: 1104.9 }],
    note: 'h3-js held the JS thread 1.6 s',
    heroSkip: 0,
  },
  {
    id: 'fractal',
    act: 'Fractal city',
    seconds: 4.2,
    value: 817,
    decimals: 0,
    suffix: '',
    label: 'leaf cells',
    call: 'cellToChildren',
    keys: [
      { at: 0.525, value: 823 },
      { at: 2.15, value: 829 },
      { at: 3.775, value: 835 },
    ],
    taps: [
      { at: 0.36, x: 0.4975, y: 0.5492 },
      { at: 1.98, x: 0.4975, y: 0.5492 },
      { at: 3.61, x: 0.4975, y: 0.5492 },
    ],
    pushIn: true,
    heroSkip: 0,
  },
  {
    id: 'grid',
    act: 'Magnetic grid',
    seconds: 4.6,
    value: 7,
    decimals: 0,
    suffix: '',
    label: 'cells drawn',
    call: 'gridRing',
    keys: RING_READINGS.slice(1).map(({ at, cells }) => ({ at, value: cells })),
    drag: cursorOn(RING_TRACK, 4.1, RING_READINGS),
    heroSkip: 0,
  },
  {
    id: 'heatmap',
    act: 'Heatmap',
    seconds: 4.2,
    value: 1000000,
    decimals: 0,
    suffix: '',
    label: 'points placed',
    call: 'latLngsToCells, 1,000,000 points',
    keys: [{ at: 0.85, value: 3454, label: 'cells from a million points' }],
    taps: [{ at: 0.68, x: 0.7811, y: 0.706 }],
    heroSkip: 0,
  },
  {
    id: 'trail',
    act: 'Trail',
    seconds: 4.5,
    value: 193,
    decimals: 0,
    suffix: '',
    label: 'cells on the trail',
    call: 'latLngToCell, one call per fix',
    keys: [
      { at: 0.25, value: 198 },
      { at: 0.5, value: 206 },
      { at: 0.75, value: 209 },
      { at: 1.0, value: 215 },
      { at: 1.25, value: 226 },
      { at: 1.5, value: 229 },
      { at: 1.75, value: 236 },
      { at: 2.0, value: 240 },
      { at: 2.25, value: 249 },
      { at: 2.5, value: 256 },
      { at: 2.75, value: 261 },
      { at: 3.0, value: 267 },
      { at: 3.25, value: 276 },
      { at: 3.5, value: 281 },
      { at: 3.75, value: 292 },
      { at: 4.0, value: 295 },
      { at: 4.25, value: 303 },
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
