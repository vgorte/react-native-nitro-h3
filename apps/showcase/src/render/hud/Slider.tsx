import { Canvas, Circle, Rect } from '@shopify/react-native-skia'
import { useEffect, useMemo } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated'
import { colours, ramp } from '../../theme/tokens'
import { sliderValueAt } from './track'

export { sliderValueAt } from './track'

/** Configures {@linkcode Slider}. */
export interface SliderProps {
  min: number
  max: number
  value: number
  /** Length of the track in points; the knob is drawn inside its own margin on either side. */
  width: number
  /** Called on every whole step the drag crosses. */
  onChange(next: number): void
  /** Called once the drag ends, which is when a rebuild is allowed. */
  onSettle(next: number): void
}

const KNOB_RADIUS = 5
const TRACK_HEIGHT = 1
const FILL_HEIGHT = 2
const ROW_HEIGHT = 28

/**
 * Draws the hairline slider every act sets its one control with.
 *
 * The knob follows the finger on the UI thread; `onChange` reaches the act only when the drag
 * crosses a whole step, and `onSettle` once it ends, so no rebuild happens inside a gesture.
 */
export function Slider({ min, max, value, width, onChange, onSettle }: SliderProps) {
  const position = useSharedValue(value)
  const canvasWidth = width + KNOB_RADIUS * 2

  useEffect(() => {
    position.value = value
  }, [value, position])

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((event) => {
          'worklet'
          position.value = sliderValueAt(event.x - KNOB_RADIUS, width, min, max)
          runOnJS(onChange)(position.value)
        })
        .onChange((event) => {
          'worklet'
          const next = sliderValueAt(event.x - KNOB_RADIUS, width, min, max)
          if (next === position.value) return
          position.value = next
          runOnJS(onChange)(next)
        })
        .onFinalize(() => {
          'worklet'
          runOnJS(onSettle)(position.value)
        }),
    [min, max, width, position, onChange, onSettle],
  )

  const fraction = useDerivedValue(() => (position.value - min) / (max - min))
  const fillWidth = useDerivedValue(() => fraction.value * width)
  const knobX = useDerivedValue(() => KNOB_RADIUS + fraction.value * width)
  const size = useMemo(() => ({ width: canvasWidth, height: ROW_HEIGHT }), [canvasWidth])

  return (
    <GestureDetector gesture={gesture}>
      <View style={size}>
        <Canvas style={size}>
          <Rect
            x={KNOB_RADIUS}
            y={ROW_HEIGHT / 2 - TRACK_HEIGHT / 2}
            width={width}
            height={TRACK_HEIGHT}
            color={colours.hairline}
          />
          <Rect
            x={KNOB_RADIUS}
            y={ROW_HEIGHT / 2 - FILL_HEIGHT / 2}
            width={fillWidth}
            height={FILL_HEIGHT}
            color={ramp[2]}
          />
          <Circle cx={knobX} cy={ROW_HEIGHT / 2} r={KNOB_RADIUS} color={ramp[2]} />
        </Canvas>
      </View>
    </GestureDetector>
  )
}
