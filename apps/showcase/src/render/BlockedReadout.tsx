import {
  BackdropBlur,
  Rect,
  RoundedRect,
  rect,
  rrect,
  Text,
  useFont,
} from '@shopify/react-native-skia'
import { useEffect } from 'react'
import { useWindowDimensions } from 'react-native'
import {
  makeMutable,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated'
import { fontAssets, fontFamily } from '../theme/fonts'
import { colours, glass, type } from '../theme/tokens'

/** The gap at which the JS thread has missed a frame and the readout says so. */
export const BLOCKED_THRESHOLD_MS = 16

/** Milliseconds between two beats of the JS-side interval. */
const BEAT_MS = 16

const PANEL_WIDTH = 208
const PANEL_HEIGHT = 58
const PANEL_MARGIN = 16
const PANEL_BOTTOM = 48
const TEXT_INSET = 14
const SWEEP_WIDTH = 32
const SWEEP_HEIGHT = 2
const SWEEP_MS = 1600

// the readout outlives every act, so the worst gap is held outside it
const worst = makeMutable(0)

/** Clears the worst gap, so the panel reports the run that follows and not the one before. */
export function resetWorstGap(): void {
  worst.value = 0
}

/**
 * Reports how far the JS thread is behind the wall clock, drawn entirely on the UI thread.
 *
 * A JS-side interval writes the clock into a shared value; the UI thread compares it with its own
 * clock every frame, so both the sweep and the numbers keep moving while the JS thread is blocked.
 */
export function BlockedReadout() {
  const { height } = useWindowDimensions()
  const labelFont = useFont(fontAssets[fontFamily.regular], type.value.fontSize)
  const peakFont = useFont(fontAssets[fontFamily.regular], type.label.fontSize)

  const beat = useSharedValue(Date.now())
  const gap = useSharedValue(0)
  const sweep = useSharedValue(0)

  useEffect(() => {
    const timer = setInterval(() => {
      beat.value = Date.now()
    }, BEAT_MS)
    return () => clearInterval(timer)
  }, [beat])

  useFrameCallback(() => {
    'worklet'
    const now = Date.now()
    gap.value = now - beat.value
    if (gap.value > worst.value) worst.value = gap.value
    sweep.value = (now % SWEEP_MS) / SWEEP_MS
  })

  const top = height - PANEL_BOTTOM - PANEL_HEIGHT
  const panel = rrect(
    rect(PANEL_MARGIN, top, PANEL_WIDTH, PANEL_HEIGHT),
    glass.radius,
    glass.radius,
  )

  const label = useDerivedValue(() =>
    // the beat is one period old at rest, so a beat of slack keeps jitter quiet
    gap.value - BEAT_MS > BLOCKED_THRESHOLD_MS
      ? `JS thread blocked ${gap.value.toFixed(0)} ms`
      : 'JS thread free',
  )
  const peak = useDerivedValue(() => `worst ${worst.value.toFixed(0)} ms`)
  const sweepX = useDerivedValue(() => PANEL_MARGIN + sweep.value * (PANEL_WIDTH - SWEEP_WIDTH))

  return (
    <>
      <BackdropBlur blur={glass.blur} clip={panel}>
        <RoundedRect rect={panel} color={glass.fill} />
      </BackdropBlur>
      <RoundedRect rect={panel} color={glass.border} style="stroke" strokeWidth={1} />
      <Text
        x={PANEL_MARGIN + TEXT_INSET}
        y={top + 24}
        text={label}
        font={labelFont}
        color={colours.muted}
      />
      <Text
        x={PANEL_MARGIN + TEXT_INSET}
        y={top + 42}
        text={peak}
        font={peakFont}
        color={colours.muted}
      />
      <Rect
        x={sweepX}
        y={top + PANEL_HEIGHT - SWEEP_HEIGHT * 2}
        width={SWEEP_WIDTH}
        height={SWEEP_HEIGHT}
        color={colours.muted}
      />
    </>
  )
}
