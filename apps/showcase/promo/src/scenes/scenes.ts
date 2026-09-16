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
  unit?: string
}

/** One tap the take took, drawn back over the phone as a ripple. */
export interface Tap {
  /** Seconds into the scene the finger went down. */
  at: number
  /** Where it landed, as a fraction of the phone's own width and height. */
  x: number
  y: number
}

/** The window a cut plays of a clip: what it skips, and how long it stands. */
export interface Window {
  skip: number
  seconds: number
}

/** One act of the showcase, as the video plays it. */
export interface Scene {
  /** The clip under public/clips, without its extension. */
  id: string
  /** What the act is for, which the caption leads with and a portrait card carries alone. */
  headline: string
  /** Seconds the landscape scene stands for; never longer than the clip. */
  seconds: number
  /** The reading the number line opens on, `null` where that line is words alone. */
  value: number | null
  /** Decimal places the number is written with. */
  decimals: number
  /** What follows the number, where the panel wrote a unit onto it. */
  suffix: string
  /** Words before the number, where the line reads as a claim rather than a count. */
  lead?: string
  /**
   * The words the number line ends on, or the whole line where there is no number.
   *
   * `{k}` stands for the ring count the reading was walked at, which only a disk carries.
   */
  unit: string
  /** The H3 call the act is making, named the way the act's own rows name it. */
  call: string
  /** What the panel read, and when; the caption steps through these. */
  keys: readonly Key[]
  taps?: readonly Tap[]
  drag?: Drag
  /** Whether the phone is pushed in slowly over the scene. */
  pushIn?: boolean
  /** The window the hero loop plays, chosen so the act's one interaction reads inside it. */
  hero: Window
  /** The core the portrait cut plays, trimmed to the interaction and nothing around it. */
  portrait: Window
}

/** Seconds the caption takes to ease from one reading onto the next. */
export const EASE_SECONDS = 0.3

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
    headline: 'Live H3 grid adapting to zoom',
    seconds: 5.0,
    value: 817,
    decimals: 0,
    suffix: '',
    unit: 'cells rendered',
    call: 'gridDisk',
    keys: [
      { at: 0.65, value: 2791 },
      { at: 4.55, value: 3997 },
    ],
    hero: { skip: 2.0, seconds: 3.0 },
    portrait: { skip: 1.4, seconds: 3.6 },
  },
  {
    // the leaf count stays on the phone's own panel, so the line can say what the act is doing
    id: 'fractal',
    headline: 'Every tap splits a cell into seven',
    seconds: 4.2,
    value: null,
    decimals: 0,
    suffix: '',
    unit: 'Recursive splitting',
    call: 'cellToChildren',
    keys: [],
    taps: [
      { at: 0.36, x: 0.4975, y: 0.5492 },
      { at: 1.98, x: 0.4975, y: 0.5492 },
      { at: 3.61, x: 0.4975, y: 0.5492 },
    ],
    pushIn: true,
    hero: { skip: 0.1, seconds: 3.7 },
    portrait: { skip: 0, seconds: 3.9 },
  },
  {
    id: 'grid',
    headline: 'Zero-latency expansion',
    seconds: 4.6,
    value: 7,
    decimals: 0,
    suffix: '',
    unit: 'cells at k={k}',
    call: 'gridRing',
    keys: RING_READINGS.slice(1).map(({ at, cells }) => ({ at, value: cells })),
    drag: cursorOn(RING_TRACK, 4.1, RING_READINGS),
    hero: { skip: 0.4, seconds: 3.0 },
    portrait: { skip: 0.3, seconds: 3.6 },
  },
  {
    id: 'heatmap',
    headline: 'From noise to spatial density',
    seconds: 4.2,
    value: 1000000,
    decimals: 0,
    suffix: '',
    unit: 'points placed',
    call: 'latLngsToCells',
    keys: [{ at: 0.85, value: 547, unit: 'cells from 1M points' }],
    taps: [{ at: 0.68, x: 0.7811, y: 0.706 }],
    hero: { skip: 0.0, seconds: 3.0 },
    portrait: { skip: 0.2, seconds: 3.4 },
  },
  {
    id: 'trail',
    headline: 'Live tracking at 60x',
    seconds: 4.5,
    value: 193,
    decimals: 0,
    suffix: '',
    unit: 'cells updated instantly',
    call: 'latLngToCell',
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
    hero: { skip: 0.5, seconds: 2.8 },
    portrait: { skip: 0.4, seconds: 3.5 },
  },
]

/** The acts the hero loops play, the switch first and the rest in the order the video runs them. */
export const HERO_SCENES: readonly Scene[] = ['heatmap', 'atlas', 'fractal', 'grid', 'trail'].map(
  (id) => {
    const scene = SCENES.find((candidate) => candidate.id === id)
    if (scene === undefined) throw new Error(`no scene ${id}`)
    return scene
  },
)
