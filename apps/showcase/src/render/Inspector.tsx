import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import {
  cellAreaKm2,
  cellToChildrenSize,
  cellToParent,
  cellToString,
  getBaseCellNumber,
  getHexagonEdgeLengthAvgM,
  getResolution,
  gridDisk,
  isPentagon,
} from 'react-native-nitro-h3'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { type InspectorRow, inspectRows, SHEET_MS } from '../engine/inspect'
import { formatUs } from '../engine/stats'
import { colours, glass, type } from '../theme/tokens'
import { Panel } from './hud/Panel'

/** The calls the sheet reads and times, handed to the rules so those import no package. */
const H3 = {
  cellToString,
  getResolution,
  getBaseCellNumber,
  isPentagon,
  cellAreaKm2,
  getHexagonEdgeLengthAvgM,
  cellToParent,
  cellToChildrenSize,
  gridDisk,
}

const SHEET_MARGIN = 12
const SHEET_BOTTOM = 16

/** Share of the viewport the sheet may take before its rows scroll inside it. */
const SHEET_MAX = 0.7

/** Opacity of the ground behind the sheet, high enough that no reading under it stays legible. */
const SHEET_BACKING = 0.92

// the head, the gap under it and the panel's own padding, until a layout has measured them
const SHEET_CHROME = 48

/** Configures {@linkcode Inspector}. */
export interface InspectorProps {
  /** The cell to inspect, `null` while the sheet is closed. */
  cell: bigint | null
  onClose(): void
}

/** Draws one reading: what it answers, the call behind it, its value and what that call took. */
function Reading({ row }: { row: InspectorRow }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{row.label}</Text>
      <View style={styles.trailing}>
        {row.call === undefined ? null : <Text style={styles.call}>{row.call}</Text>}
        <Text style={styles.value}>{row.value}</Text>
        {row.ms === undefined ? null : <Text style={styles.median}>{formatUs(row.ms)}</Text>}
      </View>
    </View>
  )
}

/**
 * Draws the sheet a tapped cell opens: every call the library answers about it, one row each.
 *
 * The sheet rises from the bottom edge over {@linkcode SHEET_MS} and falls back over the same, and
 * every median it shows is the middle of the repeats `inspectRows` runs, because a single call sits
 * at the resolution of the clock. The dim behind it takes the act and its HUD back, so no reading
 * of the act prints through the rows and no control under the sheet reads as live.
 */
export function Inspector({ cell, onClose }: InspectorProps) {
  const { height } = useWindowDimensions()
  const rise = useSharedValue(0)
  // the cell the sheet draws, which it holds on to while it falls back out of the screen
  const [shown, setShown] = useState<bigint | null>(cell)
  // the sheet and its rows as they were laid out, whose difference is everything but the rows
  const [sheetPx, setSheetPx] = useState(0)
  const [rowsPx, setRowsPx] = useState(0)
  const rows = useMemo(() => (shown === null ? null : inspectRows(shown, H3)), [shown])
  const chrome = sheetPx > 0 && rowsPx > 0 ? sheetPx - rowsPx : SHEET_CHROME

  useEffect(() => {
    if (cell !== null) {
      setShown(cell)
      // this assignment cancels a fall, and rising from where it left the sheet leaves no jump
      rise.value = withTiming(1, { duration: SHEET_MS })
      return
    }
    rise.value = withTiming(0, { duration: SHEET_MS }, (finished) => {
      'worklet'
      // a sheet reopened mid-close cancels this timing, and its cell is not this one's to drop
      if (finished === true) runOnJS(setShown)(null)
    })
  }, [cell, rise])

  const rising = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - rise.value) * height }],
  }))
  const dimming = useAnimatedStyle(() => ({ opacity: rise.value }))

  if (rows === null) return null

  return (
    // a closing sheet takes no touch, so the act answers again as soon as the visitor closes it
    <View style={StyleSheet.absoluteFill} pointerEvents={cell === null ? 'none' : 'auto'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, dimming]} pointerEvents="none" />
      {/* the backdrop takes every touch the sheet does not, so no tap reaches the act below */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="close the inspector"
      />
      <Animated.View
        style={[styles.sheet, rising]}
        onLayout={(event) => setSheetPx(event.nativeEvent.layout.height)}
      >
        {/* the ground behind the glass: this sheet lies over the HUD, not over the scene */}
        <View style={styles.backing} pointerEvents="none" />
        <Panel>
          <View style={styles.head}>
            <Text style={styles.title}>inspected cell</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
              <Text style={styles.close}>close</Text>
            </Pressable>
          </View>
          <ScrollView
            style={[styles.rows, { maxHeight: height * SHEET_MAX - chrome }]}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            onLayout={(event) => setRowsPx(event.nativeEvent.layout.height)}
          >
            {rows.map((row) => (
              <Reading key={row.label} row={row} />
            ))}
          </ScrollView>
        </Panel>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  dim: { backgroundColor: glass.scrim },
  backing: {
    position: 'absolute',
    inset: 0,
    borderRadius: glass.radius,
    backgroundColor: colours.ground,
    opacity: SHEET_BACKING,
  },
  sheet: {
    position: 'absolute',
    left: SHEET_MARGIN,
    right: SHEET_MARGIN,
    bottom: SHEET_BOTTOM,
  },
  head: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
  },
  rows: { alignSelf: 'stretch' },
  list: { gap: 8 },
  row: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
  },
  trailing: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title: { ...type.label, color: colours.text },
  close: { ...type.label, color: colours.contrast },
  label: { ...type.label, color: colours.muted },
  call: { ...type.label, color: colours.muted },
  value: { ...type.value, color: colours.text },
  median: { ...type.value, color: colours.muted },
})
