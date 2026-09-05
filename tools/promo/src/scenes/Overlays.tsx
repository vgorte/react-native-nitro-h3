import type { CSSProperties } from 'react'
import { interpolate } from 'remotion'
import { colours } from '../theme'
import type { Drag, Tap } from './scenes'

/** The screen the takes were recorded on, in points; every overlay size is given against it. */
const PHONE_POINTS = 874

/** Points the ripple grows across before it is gone. */
const RIPPLE_POINTS = 44

/** Seconds a ripple takes to grow and fade. */
const RIPPLE_SECONDS = 0.4

/** Points the drag cursor is across. */
const CURSOR_POINTS = 14

const CURSOR_ALPHA = 0.55

/** Seconds the cursor takes to fade once the finger has lifted. */
const LIFT_SECONDS = 0.2

interface RipplesProps {
  taps: readonly Tap[]
  /** Seconds into the scene the frame stands at. */
  seconds: number
  /** Points of the phone drawn per point of its own screen. */
  scale: number
}

/**
 * Draws a ring where each tap landed, since a simulator recording carries no touch of its own.
 *
 * The ring is the phone's own text colour at a hairline, so nothing is added to the frame that the
 * act does not already draw in.
 */
export function Ripples({ taps, seconds, scale }: RipplesProps) {
  return (
    <>
      {taps.map((tap) => {
        const age = seconds - tap.at
        if (age < 0 || age > RIPPLE_SECONDS) return null
        const progress = age / RIPPLE_SECONDS
        const size = interpolate(progress, [0, 1], [0, RIPPLE_POINTS * scale])
        return (
          <div
            key={`${tap.at}`}
            style={{
              ...styles.ripple,
              left: `${tap.x * 100}%`,
              top: `${tap.y * 100}%`,
              width: size,
              height: size,
              opacity: 1 - progress,
            }}
          />
        )
      })}
    </>
  )
}

interface CursorProps {
  drag: Drag
  seconds: number
  scale: number
}

/** Draws the finger that rides a control, at the position the take's own readings put it. */
export function Cursor({ drag, seconds, scale }: CursorProps) {
  const first = drag.steps[0]
  const last = drag.steps[drag.steps.length - 1]
  if (first === undefined || last === undefined) return null
  if (seconds < first.at || seconds > drag.until + LIFT_SECONDS) return null

  const times = drag.steps.map((step) => step.at)
  const positions = drag.steps.map((step) => step.x)
  const x = interpolate(Math.min(seconds, last.at), times, positions)
  // the finger goes with the drag rather than blinking out
  const lift = interpolate(seconds, [drag.until, drag.until + LIFT_SECONDS], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const size = CURSOR_POINTS * scale

  return (
    <div
      style={{
        ...styles.cursor,
        left: `${x * 100}%`,
        top: `${drag.y * 100}%`,
        width: size,
        height: size,
        opacity: CURSOR_ALPHA * lift,
      }}
    />
  )
}

/** Answers the scale one point of the recorded screen is drawn at. */
export function phoneScale(height: number): number {
  return height / PHONE_POINTS
}

const styles: Record<string, CSSProperties> = {
  ripple: {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    borderRadius: '50%',
    border: `1px solid ${colours.text}`,
    boxSizing: 'border-box',
  },
  cursor: {
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    borderRadius: '50%',
    backgroundColor: colours.text,
  },
}
