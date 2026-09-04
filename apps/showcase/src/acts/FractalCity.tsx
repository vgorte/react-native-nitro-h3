import { Group, Path, type SkPath } from '@shopify/react-native-skia'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import {
  cellAreaKm2,
  cellToChildrenSize,
  cellToLatLng,
  cellToParent,
  getHexagonEdgeLengthAvgM,
  getResolution,
  latLngToCell,
} from 'react-native-nitro-h3'
import {
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { childrenOf, diskAround } from '../engine/cells'
import {
  CEILING_NOTE,
  coverage,
  FLOOR_NOTE,
  FRACTAL_CELL_CAP,
  leafFrom,
  leavesOf,
  MAX_RES,
  MIN_RES,
  OPEN_CELL_PX,
  openingScale,
  type Reach,
  reachOf,
  replaceLeaf,
  START_RES,
  TARGET_CELL_PX,
  TOP_NOTE,
  type Tree,
  withoutBranch,
} from '../engine/fractal'
import { formatAreaKm2, formatCount, formatMs } from '../engine/stats'
import { resetWorstGap } from '../render/BlockedReadout'
import { CellPictures, type CellScene } from '../render/CellPictures'
import { EngineCanvas } from '../render/EngineCanvas'
import {
  bucketsOf,
  buildScene,
  inDepthOrder,
  outlinePath,
  record,
  sceneOf,
  shapeOf,
} from '../render/fractalScene'
import { growthTransform } from '../render/growth'
import { FinePrint } from '../render/hud/FinePrint'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { Row } from '../render/hud/Row'
import { InspectHighlight } from '../render/InspectHighlight'
import { type CameraAnchor, sceneToLatLng, screenToScene, useCamera } from '../render/useCamera'
import { BUCKETS, colours, glass, type } from '../theme/tokens'
import { lastPlanetPosition } from './planetPosition'
import type { ActProps } from './types'

// the act's published contract names these; the rules that use them live in engine/fractal.ts
export { MAX_RES, MIN_RES, TARGET_CELL_PX } from '../engine/fractal'

/** Milliseconds the children take to grow out of the parent centre. */
export const GROWTH_MS = 300

/** Milliseconds the parent outline stays as a ghost before it is gone. */
export const GHOST_FADE_MS = 1_000

const BERLIN: CameraAnchor = { lat: 52.52, lng: 13.405 }
// long enough that a fold is deliberate, short enough that a held finger answers
const LONG_PRESS_MS = 400
const PANEL_TOP = 104
const PRINT_WIDTH = 268
// clears the blocked readout, which stands on the same line at the other edge
const CONTROL_BOTTOM = 118
// the control is there but has nothing to open on, until the first cell is in focus
const DISABLED_OPACITY = 0.4

const NOTES = [
  'a tap splits the cell under it, a long press folds a cell and its siblings back into the parent',
  'the children do not tile the parent exactly, because the aperture is 7 and the grid is rotated',
]

/** Holds the children of one split while they grow, in the scene's own metre frame. */
interface Growth {
  cells: CellScene
  outline: SkPath
  centre: { x: number; y: number }
}

/** Holds what the HUD says about the cell in focus: the one last touched, or the opening centre. */
interface Focus {
  /** The cell itself, which the inspect control opens the sheet on. */
  cell: bigint
  res: number
  areaKm2: number
  /** Cells the next level down holds, `0` at the floor where there is no next level. */
  childrenSize: number
  /** What `cellToChildren` took on the last split, `null` where no split produced this focus. */
  childrenMs: number | null
}

const NO_CENTRE = { x: 0, y: 0 }
const NO_REACH: Reach = { split: false, fold: false, note: null }

/** Answers everything the HUD says about one cell, and the split duration that produced it. */
function focusOf(cell: bigint, childrenMs: number | null): Focus {
  const res = getResolution(cell)
  return {
    cell,
    res,
    areaKm2: cellAreaKm2(cell),
    childrenSize: res === MAX_RES ? 0 : cellToChildrenSize(cell, res + 1),
    childrenMs,
  }
}

/**
 * Splits the grid under the finger, one cell at a time, from a city block down to a doorstep.
 *
 * A tap replaces the cell it lands on with its children, which grow out of the parent centre while
 * the parent outline fades behind them and the camera zooms until that cell reads at
 * {@linkcode TARGET_CELL_PX}. A long press does the reverse, framing the cell it produces at the
 * size that cell had before it was split, so a descent and its climb land on the same view. What is
 * drawn is a tree: leaves at many resolutions at once over the fills of every cell already split,
 * both coloured by how far down they stand.
 */
export function FractalCity({ active, inspected, onInspect }: ActProps) {
  const { width, height } = useWindowDimensions()
  // the pixel scale the act opened at, which doubles as the flag that it has opened
  const [openScale, setOpenScale] = useState<number | null>(null)
  const [tree, setTree] = useState<Tree | null>(null)
  const [growth, setGrowth] = useState<Growth | null>(null)
  const [ghost, setGhost] = useState<SkPath | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const merged = useRef<Tree | null>(null)
  const fading = useRef<ReturnType<typeof setTimeout> | null>(null)

  const progress = useSharedValue(0)
  const ghostAlpha = useSharedValue(0)
  const zoom = useSharedValue(0)
  const fromScale = useSharedValue(1)
  const toScale = useSharedValue(1)
  const pivotX = useSharedValue(0)
  const pivotY = useSharedValue(0)
  const heldX = useSharedValue(0)
  const heldY = useSharedValue(0)

  // the geometry is the tree alone, so a settle has nothing to rebuild and only re-anchors
  const settle = useCallback(() => {}, [])
  const camera = useCamera({ anchor: BERLIN, onSettle: settle })
  const { anchor, setAnchor, translateX, translateY, scale } = camera

  const scene = useMemo(() => (tree === null ? null : buildScene(tree, anchor)), [tree, anchor])

  // the act reaches for the position store only once it is on screen, where Atlas has written it
  useEffect(() => {
    if (!active || openScale !== null) return
    const last = lastPlanetPosition()
    const centre = last === null ? BERLIN : { lat: last.centre.lat, lng: last.centre.lng }
    const pixels = openingScale(centre.lat, getHexagonEdgeLengthAvgM)
    const middle = latLngToCell(centre.lat, centre.lng, START_RES)
    const k = coverage(width, height, pixels, centre.lat, getHexagonEdgeLengthAvgM)
    setAnchor(centre)
    setOpenScale(pixels)
    setTree({
      leaves: leavesOf(diskAround(middle, k).value, BUCKETS, getResolution),
      ancestors: new BigUint64Array(0),
    })
    setFocus(focusOf(middle, null))
  }, [active, openScale, width, height, setAnchor])

  // the opening scene stands in the anchor's own frame, so the camera starts from its origin
  useEffect(() => {
    if (openScale === null) return
    translateX.value = width / 2
    translateY.value = height / 2
    scale.value = openScale
  }, [openScale, width, height, translateX, translateY, scale])

  useEffect(() => {
    if (!active) return
    // the gap of the build that follows belongs to this act, and to no act before it
    resetWorstGap()
  }, [active])

  // a ghost that outlives its act would fade onto the next scene
  useEffect(() => {
    return () => {
      if (fading.current !== null) clearTimeout(fading.current)
    }
  }, [])

  // The zoom drives the scale and holds the pivot where it was, which is a pinch about that point.
  // The mapper runs once when it is registered, where every value below still carries the camera's
  // own identity, so that first run writes back exactly what the camera already holds.
  useAnimatedReaction(
    () => zoom.value,
    (moved) => {
      const next = fromScale.value + (toScale.value - fromScale.value) * moved
      scale.value = next
      translateX.value = heldX.value - pivotX.value * next
      translateY.value = heldY.value - pivotY.value * next
    },
  )

  const zoomAbout = useCallback(
    (pivot: { x: number; y: number }, target: number): void => {
      fromScale.value = scale.value
      toScale.value = target
      pivotX.value = pivot.x
      pivotY.value = pivot.y
      heldX.value = translateX.value + pivot.x * scale.value
      heldY.value = translateY.value + pivot.y * scale.value
      zoom.value = 0
      zoom.value = withTiming(1, { duration: GROWTH_MS })
    },
    [fromScale, toScale, pivotX, pivotY, heldX, heldY, zoom, scale, translateX, translateY],
  )

  /** Answers the leaf under a screen point, from the cell the deepest resolution drawn holds. */
  const leafAt = useCallback(
    (x: number, y: number): bigint | null => {
      if (tree === null) return null
      const point = screenToScene(x, y, {
        translateX: translateX.value,
        translateY: translateY.value,
        scale: scale.value,
      })
      const at = sceneToLatLng(point.x, point.y, anchor)
      const deepest = latLngToCell(at.lat, at.lng, tree.leaves.deepest)
      return leafFrom(deepest, tree.leaves, cellToParent)
    },
    [tree, anchor, translateX, translateY, scale],
  )

  const merge = useCallback((): void => {
    if (merged.current === null) return
    setTree(merged.current)
    merged.current = null
    setGrowth(null)
  }, [])

  const split = useCallback(
    (x: number, y: number): void => {
      // a split still growing owns the scene, and a second one would grow out of a stale centre
      if (tree === null || growth !== null) return
      const cell = leafAt(x, y)
      if (cell === null) return

      // the HUD describes the cell last touched, so a refused tap moves the focus onto it too
      const next = focusOf(cell, null)
      setFocus(next)
      if (next.childrenSize === 0) {
        setRefusal(FLOOR_NOTE)
        return
      }
      if (tree.leaves.cells.length - 1 + next.childrenSize > FRACTAL_CELL_CAP) {
        setRefusal(CEILING_NOTE)
        return
      }
      setRefusal(null)

      const children = childrenOf(cell, next.res + 1)
      const grown = record(children.value, bucketsOf(children.value), anchor)
      const parent = shapeOf(cell, anchor)
      const centre = sceneOf(cellToLatLng(cell), anchor)

      // the cell stays a leaf while its children grow over it, and becomes an underlay at the merge
      merged.current = {
        leaves: leavesOf(
          replaceLeaf(tree.leaves.cells, cell, children.value),
          BUCKETS,
          getResolution,
        ),
        ancestors: inDepthOrder([...tree.ancestors, cell]),
      }
      setGrowth({ cells: grown.scene, outline: outlinePath(grown.projected), centre })
      setFocus({ ...next, childrenMs: children.ms })

      progress.value = 0
      progress.value = withTiming(1, { duration: GROWTH_MS }, () => {
        'worklet'
        // an interrupted growth merges too, so no scene is left half open
        runOnJS(merge)()
      })

      setGhost(outlinePath(parent))
      ghostAlpha.value = 1
      ghostAlpha.value = withTiming(0, { duration: GHOST_FADE_MS })
      if (fading.current !== null) clearTimeout(fading.current)
      fading.current = setTimeout(() => setGhost(null), GHOST_FADE_MS)

      const span = parent.bounds.maxX - parent.bounds.minX
      zoomAbout(centre, TARGET_CELL_PX / span)
    },
    [tree, growth, anchor, leafAt, merge, zoomAbout, progress, ghostAlpha],
  )

  const fold = useCallback(
    (x: number, y: number): void => {
      if (tree === null || growth !== null) return
      const cell = leafAt(x, y)
      if (cell === null) return
      const res = getResolution(cell)
      if (res <= MIN_RES) {
        setFocus(focusOf(cell, null))
        setRefusal(TOP_NOTE)
        return
      }
      setRefusal(null)

      const parent = cellToParent(cell, res - 1)
      const kept = withoutBranch(tree.leaves.cells, parent, res - 1, getResolution, cellToParent)
      kept.push(parent)
      const ancestors = withoutBranch(tree.ancestors, parent, res - 1, getResolution, cellToParent)

      setTree({
        leaves: leavesOf(BigUint64Array.from(kept), BUCKETS, getResolution),
        ancestors: BigUint64Array.from(ancestors),
      })
      setFocus(focusOf(parent, null))

      // the parent is framed at the size it had before its split, which undoes that split's zoom
      const shape = shapeOf(parent, anchor)
      const span = shape.bounds.maxX - shape.bounds.minX
      zoomAbout(sceneOf(cellToLatLng(parent), anchor), OPEN_CELL_PX / span)
    },
    [tree, growth, anchor, leafAt, zoomAbout],
  )

  const reach = tree === null ? NO_REACH : reachOf(tree.leaves)
  // a refused tap outranks the standing line, because it answers the gesture the visitor just made
  const note = refusal ?? reach.note

  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .enabled(reach.split)
      .onEnd((event, success) => {
        'worklet'
        if (success) runOnJS(split)(event.x, event.y)
      })
    // the fold has to fail before a pan starts, which it does as soon as the finger moves
    const press = Gesture.LongPress()
      .enabled(reach.fold)
      .minDuration(LONG_PRESS_MS)
      .onStart((event) => {
        'worklet'
        runOnJS(fold)(event.x, event.y)
      })
    return Gesture.Exclusive(press, camera.gesture, tap)
  }, [camera.gesture, reach.split, reach.fold, split, fold])

  const centre = growth === null ? NO_CENTRE : growth.centre
  const growing = useDerivedValue(() => growthTransform(centre, progress.value), [centre])
  // the grid carries the tiling where every leaf stands at the same depth, so it holds one point
  // wide whatever the camera has zoomed to
  const gridWidth = useDerivedValue(() => 1 / scale.value)

  // an act off screen keeps its tree and draws nothing
  if (!active) return <View style={styles.root} />

  return (
    <View style={styles.root}>
      <EngineCanvas camera={camera} gesture={gesture}>
        {scene === null ? null : (
          <>
            {/* the cells already split, so the ground never shows where children miss a corner */}
            <CellPictures scene={scene.under} />
            <CellPictures scene={scene.cells} />
            <Path
              path={scene.outline}
              color={colours.hairline}
              style="stroke"
              strokeWidth={gridWidth}
            />
            {ghost === null ? null : (
              <Path
                path={ghost}
                color={colours.text}
                style="stroke"
                strokeWidth={gridWidth}
                opacity={ghostAlpha}
              />
            )}
            {growth === null ? null : (
              <Group transform={growing}>
                <CellPictures scene={growth.cells} />
                <Path
                  path={growth.outline}
                  color={colours.hairline}
                  style="stroke"
                  strokeWidth={gridWidth}
                />
              </Group>
            )}
            <InspectHighlight cell={inspected ?? null} anchor={anchor} scale={scale} />
          </>
        )}
      </EngineCanvas>
      {/* box-none leaves the scene every touch the panel head does not take */}
      <View style={styles.panel} pointerEvents="box-none">
        <Panel collapsible collapsed={collapsed} onToggle={() => setCollapsed((held) => !held)}>
          <Metric value={formatCount(scene?.leafCount ?? 0)} caption="leaf cells" />
          <Row
            label="resolution"
            value={focus === null ? '-' : `${focus.res}`}
            call="getResolution"
          />
          <Row
            label="cell area"
            value={focus === null ? '-' : formatAreaKm2(focus.areaKm2)}
            call="cellAreaKm2"
          />
          <Row
            label="next level"
            value={focus === null || focus.childrenSize === 0 ? '-' : `${focus.childrenSize}`}
            call="cellToChildrenSize"
          />
          <Row
            label="split"
            value={focus === null || focus.childrenMs === null ? '-' : formatMs(focus.childrenMs)}
            call="cellToChildren"
          />
          <Row
            label="boundaries"
            value={scene === null ? '-' : formatMs(scene.boundariesMs)}
            call="cellsToBoundaries"
          />
          <Row label="rebuild" value={scene === null ? '-' : formatMs(scene.buildMs)} />
          {note === null ? null : (
            <View style={styles.note}>
              <Text style={styles.blocked}>{note}</Text>
            </View>
          )}
          <View style={styles.print}>
            <FinePrint notes={NOTES} />
          </View>
        </Panel>
      </View>
      <View style={styles.control}>
        <Panel align="right">
          <Pressable
            style={[styles.button, focus === null ? styles.disabled : null]}
            onPress={() => {
              if (focus !== null) onInspect?.(focus.cell)
            }}
            disabled={focus === null}
            accessibilityRole="button"
            accessibilityState={{ disabled: focus === null }}
          >
            <Text style={styles.buttonLabel}>inspect</Text>
          </Pressable>
        </Panel>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colours.ground,
  },
  panel: {
    position: 'absolute',
    top: PANEL_TOP,
    right: 16,
  },
  control: {
    position: 'absolute',
    right: 16,
    bottom: CONTROL_BOTTOM,
  },
  note: {
    width: PRINT_WIDTH,
  },
  blocked: { ...type.label, color: colours.muted },
  print: {
    width: PRINT_WIDTH,
    marginTop: 4,
  },
  button: {
    borderWidth: 1,
    borderColor: glass.border,
    borderRadius: glass.radius,
    backgroundColor: glass.fill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  disabled: { opacity: DISABLED_OPACITY },
  buttonLabel: { ...type.value, lineHeight: 16, color: colours.muted },
})
