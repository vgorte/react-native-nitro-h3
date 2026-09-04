import { useEffect, useMemo } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
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
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { type InspectorRow, inspectRows, SHEET_MS } from '../engine/inspect'
import { formatUs } from '../engine/stats'
import { colours, type } from '../theme/tokens'
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
 * The sheet rises from the bottom edge over {@linkcode SHEET_MS} and every median it shows is the
 * middle of the repeats `inspectRows` runs, because a single call sits at the resolution of the
 * clock. It covers the act while it stands, so a tap outside closes it rather than reaching the
 * scene.
 */
export function Inspector({ cell, onClose }: InspectorProps) {
  const { height } = useWindowDimensions()
  const rise = useSharedValue(0)
  const rows = useMemo(() => (cell === null ? null : inspectRows(cell, H3)), [cell])

  useEffect(() => {
    rise.value = 0
    if (cell !== null) rise.value = withTiming(1, { duration: SHEET_MS })
  }, [cell, rise])

  const rising = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - rise.value) * height }],
  }))

  if (rows === null) return null

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* the backdrop takes every touch the sheet does not, so no tap reaches the act below */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="close the inspector"
      />
      <Animated.View style={[styles.sheet, rising]}>
        <Panel>
          <View style={styles.head}>
            <Text style={styles.title}>inspected cell</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
              <Text style={styles.close}>close</Text>
            </Pressable>
          </View>
          {rows.map((row) => (
            <Reading key={row.label} row={row} />
          ))}
        </Panel>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
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
