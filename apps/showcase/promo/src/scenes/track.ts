/**
 * The track a dragged control runs along, measured off its take in the phone's own frame.
 *
 * The two ends are where the thumb's centre stands at the lowest and highest value it carries, as
 * fractions of the phone's width, so a cursor placed from a reading lands on the thumb rather than
 * beside it.
 */
export interface Track {
  from: number
  to: number
  /** Where the track stands, as a fraction of the phone's own height. */
  y: number
  /** The values the two ends carry. */
  low: number
  high: number
}

/** One reading of a dragged control: the second it was taken, and what the panel counted. */
export interface Reading {
  at: number
  cells: number
}

/** One position of a finger riding a control, as a fraction of the phone's width. */
export interface DragStep {
  at: number
  x: number
}

/** The finger that drags a control, drawn back over the phone as a disc. */
export interface Drag {
  y: number
  /** Seconds into the scene the finger lifts. */
  until: number
  steps: readonly DragStep[]
}

/**
 * Answers the ring count a disk of this many cells was walked at.
 *
 * A disk of `k` rings holds `3k² + 3k + 1` cells, which inverts exactly over the counts a panel
 * carries.
 */
export function ringsOf(cells: number): number {
  return Math.round((Math.sqrt((4 * (cells - 1)) / 3 + 1) - 1) / 2)
}

/**
 * Rides a cursor on a slider's thumb, from the same readings the caption steps through.
 *
 * The thumb sits at a whole step of the track, so a reading places the cursor where the slider drew
 * it; nothing about the position is read off a frame by hand.
 */
export function cursorOn(track: Track, until: number, readings: readonly Reading[]): Drag {
  const span = track.to - track.from
  const reach = track.high - track.low
  return {
    y: track.y,
    until,
    steps: readings.map(({ at, cells }) => ({
      at,
      x: track.from + ((ringsOf(cells) - track.low) / reach) * span,
    })),
  }
}
