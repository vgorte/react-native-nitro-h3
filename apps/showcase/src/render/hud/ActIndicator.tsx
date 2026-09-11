import { useCallback, useEffect, useRef } from 'react'
import {
  type LayoutChangeEvent,
  Platform,
  Pressable,
  type ScrollView as ScrollViewHandle,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native'
// the plain scroll view loses to the act's pan on Android
import { ScrollView } from 'react-native-gesture-handler'
import { colours, glass, type } from '../../theme/tokens'

/** Configures {@linkcode ActIndicator}. */
export interface ActIndicatorProps {
  acts: readonly string[]
  current: number
  onSelect(index: number): void
}

// there is no safe-area provider, so the status-bar inset is per platform
const TOP_INSET = Platform.select({ ios: 62, default: (StatusBar.currentHeight ?? 24) + 12 })

/**
 * Lists the acts along the top and moves to the one that is tapped.
 *
 * The names are wider than a small phone, so the row scrolls and brings the current name into
 * view whenever the page changes.
 */
export function ActIndicator({ acts, current, onSelect }: ActIndicatorProps) {
  const scroller = useRef<ScrollViewHandle>(null)
  const frames = useRef<{ x: number; width: number }[]>([])
  const viewport = useRef(0)

  const measure = useCallback((index: number, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout
    frames.current[index] = { x, width }
  }, [])

  useEffect(() => {
    const frame = frames.current[current]
    if (frame === undefined || viewport.current === 0) return
    const centred = frame.x + frame.width / 2 - viewport.current / 2
    scroller.current?.scrollTo({ x: Math.max(0, centred), animated: true })
  }, [current])

  return (
    <View style={styles.bar}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        onLayout={(event) => {
          viewport.current = event.nativeEvent.layout.width
        }}
      >
        {acts.map((act, index) => (
          <Pressable
            key={act}
            onPress={() => onSelect(index)}
            onLayout={(event) => measure(index, event)}
            hitSlop={8}
            accessibilityRole="tab"
            accessibilityState={{ selected: index === current }}
          >
            <Text style={index === current ? styles.currentLabel : styles.label}>{act}</Text>
            <View style={index === current ? styles.currentRule : styles.rule} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: TOP_INSET,
    left: 16,
    right: 16,
    // the names sit straight on the scene, so they need the ground back over a bright city
    backgroundColor: glass.scrim,
    borderRadius: glass.radius,
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 18,
  },
  label: { ...type.label, color: colours.muted },
  currentLabel: { ...type.label, color: colours.text },
  rule: { height: 1, marginTop: 6, backgroundColor: colours.hairline },
  currentRule: { height: 1, marginTop: 6, backgroundColor: colours.text },
})
