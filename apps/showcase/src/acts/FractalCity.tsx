import { Group, Path, Skia, type SkPath, type SkPoint } from '@shopify/react-native-skia'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import {
  cellAreaKm2,
  cellToChildrenSize,
  cellToLatLng,
  cellToParent,
  getHexagonEdgeLengthAvgM,
  getResolution,
  type LatLng,
  latLngToCell,
} from 'react-native-nitro-h3'
import {
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { boundariesOf, childrenOf, diskAround } from '../engine/cells'
import { buildMesh } from '../engine/mesh'
import {
  DEG_TO_RAD,
  mercatorX,
  mercatorY,
  type ProjectedCells,
  projectCells,
} from '../engine/projection'
import { formatCount, formatMs } from '../engine/stats'
import { resetWorstGap } from '../render/BlockedReadout'
import { CellPictures, type CellScene, recordCellScene } from '../render/CellPictures'
import { EngineCanvas } from '../render/EngineCanvas'
import { growthTransform } from '../render/growth'
import { FinePrint } from '../render/hud/FinePrint'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { Row } from '../render/hud/Row'
import { type CameraAnchor, sceneToLatLng, screenToScene, useCamera } from '../render/useCamera'
import { BUCKETS, colours, type } from '../theme/tokens'
import { lastPlanetPosition } from './planetPosition'
import type { ActProps } from './types'

/** Milliseconds the children take to grow out of the parent centre. */
export const GROWTH_MS = 300

/** Milliseconds the parent outline stays as a ghost before it is gone. */
export const GHOST_FADE_MS = 1_000

/** Points across which a tapped cell is zoomed to, wide enough to read its children inside it. */
export const TARGET_CELL_PX = 120

/** The coarsest resolution a long press can fold up to. */
export const MIN_RES = 0

/** The finest resolution a tap can split down to. */
export const MAX_RES = 15

/** Caps the leaf cells the act draws, the interactive ceiling every act shares. */
export const FRACTAL_CELL_CAP = 20_000

const BERLIN: CameraAnchor = { lat: 52.52, lng: 13.405 }
const START_RES = 6
// H3 has an aperture of 7, so a hexagon splits into seven children and a pentagon into six
const APERTURE = 7
// the act opens at the size a child settles at, so the first tap changes the depth and not the scale
const OPEN_CELL_PX = TARGET_CELL_PX / Math.sqrt(APERTURE)
// resolutions between the opening set and the floor, over which the ramp is spread
const DEPTH_STEPS = MAX_RES - START_RES
const CHUNK_SIZE = 10_000
const CELL_SPACING = Math.sqrt(3)
// a disk of k rings is a hexagon of cells, and only its apothem is covered in every direction
const DISK_APOTHEM = Math.sqrt(3) / 2
// the largest k whose disk of 3k(k + 1) + 1 cells still fits under the cap, k = 81
const MAX_K = Math.floor((Math.sqrt((4 * FRACTAL_CELL_CAP - 1) / 3) - 1) / 2)
// long enough that a fold is deliberate, short enough that a held finger answers
const LONG_PRESS_MS = 400
const PANEL_TOP = 104
const PRINT_WIDTH = 268

const FLOOR_NOTE = `resolution ${MAX_RES} is the floor, so this cell does not split`
const TOP_NOTE = `resolution ${MIN_RES} is the ceiling, so there is nothing to fold up to`
const CEILING_NOTE = `the ceiling of ${formatCount(FRACTAL_CELL_CAP)} leaf cells stops the next split`

const NOTES = [
  'a tap splits the cell under it, a long press folds a cell and its siblings back into the parent',
  'the children do not tile the parent exactly, because the aperture is 7 and the grid is rotated',
]

/** Holds the leaf cells the act draws, which stand at every resolution the visitor has opened. */
interface Leaves {
  cells: BigUint64Array
  /** The ramp bucket of every cell, how far its resolution stands below the opening one. */
  buckets: Uint8Array
  member: Set<bigint>
  deepest: number
  shallowest: number
}

/** Holds a built scene: the recorded fills, the grid over them and what the build cost. */
interface Scene {
  cells: CellScene
  outline: SkPath
  leafCount: number
  boundariesMs: number
  /** Everything the rebuild took: the boundaries, the projection, the mesh and the recording. */
  buildMs: number
}

/** Holds the children of one split while they grow, in the scene's own metre frame. */
interface Growth {
  cells: CellScene
  outline: SkPath
  centre: { x: number; y: number }
}

/** Holds what the HUD says about the cell in focus: the tapped one, or the centre before a tap. */
interface Focus {
  res: number
  areaKm2: number
  /** Cells the next level down holds, `0` at the floor where there is no next level. */
  childrenSize: number
  /** What `cellToChildren` took on the last split, `null` where no split produced this focus. */
  childrenMs: number | null
}

/** Holds how far a leaf set can still be taken, and the one line that says where it stops. */
interface Reach {
  split: boolean
  fold: boolean
  note: string | null
}

const NO_CENTRE = { x: 0, y: 0 }
const NO_REACH: Reach = { split: false, fold: false, note: null }

/**
 * Answers the ramp bucket of a leaf, the ramp spread over the resolutions below the opening one.
 *
 * The opening set takes the darkest step and the floor the brightest, so the depth a visitor has
 * opened is what the colour carries; a cell folded above the opening resolution keeps the darkest.
 */
function bucketOfResolution(res: number): number {
  const depth = Math.max(0, Math.min(DEPTH_STEPS, res - START_RES))
  return Math.round((depth / DEPTH_STEPS) * (BUCKETS - 1))
}

/** Reads the resolutions of a cell set once, into the colours and the range the gestures ask for. */
function leavesOf(cells: BigUint64Array): Leaves {
  const buckets = new Uint8Array(cells.length)
  const member = new Set<bigint>()
  let deepest = MIN_RES
  let shallowest = MAX_RES
  for (let cell = 0; cell < cells.length; cell++) {
    const res = getResolution(cells[cell])
    buckets[cell] = bucketOfResolution(res)
    member.add(cells[cell])
    if (res > deepest) deepest = res
    if (res < shallowest) shallowest = res
  }
  return { cells, buckets, member, deepest, shallowest }
}

/** Answers the scene position of a coordinate, the inverse of `sceneToLatLng`. */
function sceneOf(at: LatLng, anchor: CameraAnchor): { x: number; y: number } {
  return {
    x: mercatorX(at.lng) - mercatorX(anchor.lng),
    y: mercatorY(anchor.lat) - mercatorY(at.lat),
  }
}

/**
 * Builds the closed outline of every projected cell, which is what makes the nesting read.
 *
 * A mixed-resolution tiling has no direction every cell shares, so no run of edges covers it the way
 * three consecutive ones cover a grid of one resolution, and every cell carries its own ring.
 */
function outlinePath(projected: ProjectedCells): SkPath {
  const { stride, points, vertexCounts, cellCount } = projected
  const builder = Skia.PathBuilder.Make()
  for (let cell = 0; cell < cellCount; cell++) {
    const count = vertexCounts[cell]
    if (count < 3) continue
    const base = cell * stride
    const ring = new Array<SkPoint>(count)
    for (let vertex = 0; vertex < count; vertex++) {
      ring[vertex] = { x: points[base + vertex * 2], y: points[base + vertex * 2 + 1] }
    }
    builder.addPoly(ring, true)
  }
  return builder.detach()
}

/** Holds one recorded cell set: what is drawn, and what the H3 call behind it took. */
interface Recorded {
  scene: CellScene
  outline: SkPath
  boundariesMs: number
}

/** Projects a cell set into the scene's metre frame and records it as pictures and an outline. */
function record(cells: BigUint64Array, buckets: Uint8Array, anchor: CameraAnchor): Recorded {
  const boundaries = boundariesOf(cells)
  const projected = projectCells(boundaries.value, anchor)
  const mesh = buildMesh(projected, {
    chunkSize: CHUNK_SIZE,
    buckets: BUCKETS,
    inset: 0,
    bucketOf: buckets,
  })
  return {
    scene: recordCellScene(mesh, projected.bounds, null),
    outline: outlinePath(projected),
    boundariesMs: boundaries.ms,
  }
}

/** Projects one cell on its own, for the outline it leaves and the span the camera zooms to. */
function shapeOf(cell: bigint, anchor: CameraAnchor): ProjectedCells {
  return projectCells(boundariesOf(new BigUint64Array([cell])).value, anchor)
}

/** Builds the scene of one leaf set. */
function buildScene(leaves: Leaves, anchor: CameraAnchor): Scene {
  const started = performance.now()
  const built = record(leaves.cells, leaves.buckets, anchor)
  return {
    cells: built.scene,
    outline: built.outline,
    leafCount: leaves.cells.length,
    boundariesMs: built.boundariesMs,
    buildMs: performance.now() - started,
  }
}

/** Answers everything the HUD says about one cell, and the split duration that produced it. */
function focusOf(cell: bigint, childrenMs: number | null): Focus {
  const res = getResolution(cell)
  return {
    res,
    areaKm2: cellAreaKm2(cell),
    childrenSize: res === MAX_RES ? 0 : cellToChildrenSize(cell, res + 1),
    childrenMs,
  }
}

/** Answers the pixel scale at which a cell of the opening resolution reads at its settled size. */
function openingScale(lat: number): number {
  return (OPEN_CELL_PX * Math.cos(lat * DEG_TO_RAD)) / (2 * getHexagonEdgeLengthAvgM(START_RES))
}

/** Answers the ring count whose disk reaches every corner of the viewport, under the cap. */
function coverage(width: number, height: number, scale: number, lat: number): number {
  const reach = ((Math.hypot(width, height) / 2) * Math.cos(lat * DEG_TO_RAD)) / scale
  const spacing = CELL_SPACING * getHexagonEdgeLengthAvgM(START_RES)
  return Math.max(1, Math.min(MAX_K, Math.ceil(reach / (spacing * DISK_APOTHEM)) + 1))
}

/**
 * Answers what the gestures may still do with a leaf set, and the line that says why one may not.
 *
 * A tap that no leaf set can answer leaves its gesture disabled rather than letting a call reach
 * the resolution ladder's end and come back as an `H3Error`.
 */
function reachOf(leaves: Leaves): Reach {
  // every split but a pentagon's adds six leaves, so this is the last set a tap could act on
  const room = leaves.cells.length + APERTURE - 1 <= FRACTAL_CELL_CAP
  const split = room && leaves.shallowest < MAX_RES
  const fold = leaves.deepest > MIN_RES
  if (!room) return { split, fold, note: CEILING_NOTE }
  if (!split) return { split, fold, note: FLOOR_NOTE }
  if (!fold) return { split, fold, note: TOP_NOTE }
  return { split, fold, note: null }
}

/** Formats a cell area, which spans nine orders of magnitude between the two ends of the ladder. */
function formatAreaKm2(km2: number): string {
  return `${km2 < 0.001 ? km2.toExponential(2) : km2.toPrecision(4)} km²`
}

/**
 * Splits the grid under the finger, one cell at a time, from a city block down to a doorstep.
 *
 * A tap replaces the cell it lands on with its children, which grow out of the parent centre while
 * the parent outline fades behind them and the camera zooms until that cell reads at
 * {@linkcode TARGET_CELL_PX}. A long press does the reverse. What is drawn is therefore a tree of
 * leaves at many resolutions at once, coloured by how far down each one stands.
 */
export function FractalCity({ active }: ActProps) {
  const { width, height } = useWindowDimensions()
  // the pixel scale the act opened at, which doubles as the flag that it has opened
  const [openScale, setOpenScale] = useState<number | null>(null)
  const [leaves, setLeaves] = useState<Leaves | null>(null)
  const [growth, setGrowth] = useState<Growth | null>(null)
  const [ghost, setGhost] = useState<SkPath | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const merged = useRef<Leaves | null>(null)
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

  // the geometry is the leaf set alone, so a settle has nothing to rebuild and only re-anchors
  const settle = useCallback(() => {}, [])
  const camera = useCamera({ anchor: BERLIN, onSettle: settle })
  const { anchor, setAnchor, translateX, translateY, scale } = camera

  const scene = useMemo(
    () => (leaves === null ? null : buildScene(leaves, anchor)),
    [leaves, anchor],
  )

  // the act reaches for the position store only once it is on screen, where Atlas has written it
  useEffect(() => {
    if (!active || openScale !== null) return
    const last = lastPlanetPosition()
    const centre = last === null ? BERLIN : { lat: last.centre.lat, lng: last.centre.lng }
    const pixels = openingScale(centre.lat)
    const middle = latLngToCell(centre.lat, centre.lng, START_RES)
    setAnchor(centre)
    setOpenScale(pixels)
    setLeaves(leavesOf(diskAround(middle, coverage(width, height, pixels, centre.lat)).value))
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

  /** Answers the leaf under a screen point, by climbing from the deepest resolution drawn. */
  const leafAt = useCallback(
    (x: number, y: number): bigint | null => {
      if (leaves === null) return null
      const point = screenToScene(x, y, {
        translateX: translateX.value,
        translateY: translateY.value,
        scale: scale.value,
      })
      const at = sceneToLatLng(point.x, point.y, anchor)
      let cell = latLngToCell(at.lat, at.lng, leaves.deepest)
      for (let res = leaves.deepest; res >= leaves.shallowest; res--) {
        if (leaves.member.has(cell)) return cell
        if (res > leaves.shallowest) cell = cellToParent(cell, res - 1)
      }
      return null
    },
    [leaves, anchor, translateX, translateY, scale],
  )

  const merge = useCallback((): void => {
    if (merged.current === null) return
    setLeaves(merged.current)
    merged.current = null
    setGrowth(null)
  }, [])

  const split = useCallback(
    (x: number, y: number): void => {
      // a split still growing owns the scene, and a second one would grow out of a stale centre
      if (leaves === null || growth !== null) return
      const cell = leafAt(x, y)
      if (cell === null) return

      const next = focusOf(cell, null)
      if (next.childrenSize === 0) {
        setRefusal(FLOOR_NOTE)
        return
      }
      if (leaves.cells.length - 1 + next.childrenSize > FRACTAL_CELL_CAP) {
        setRefusal(CEILING_NOTE)
        return
      }
      setRefusal(null)

      const children = childrenOf(cell, next.res + 1)
      const kept = new BigUint64Array(leaves.cells.length - 1)
      let cursor = 0
      for (const leaf of leaves.cells) if (leaf !== cell) kept[cursor++] = leaf
      const whole = new BigUint64Array(kept.length + children.value.length)
      whole.set(kept)
      whole.set(children.value, kept.length)

      const grown = record(
        children.value,
        new Uint8Array(children.value.length).fill(bucketOfResolution(next.res + 1)),
        anchor,
      )
      const parent = shapeOf(cell, anchor)
      const centre = sceneOf(cellToLatLng(cell), anchor)

      merged.current = leavesOf(whole)
      setLeaves(leavesOf(kept))
      setGrowth({ cells: grown.scene, outline: grown.outline, centre })
      setFocus({ ...next, childrenMs: children.ms })

      progress.value = 0
      progress.value = withTiming(1, { duration: GROWTH_MS }, (finished) => {
        'worklet'
        if (finished) runOnJS(merge)()
      })

      setGhost(outlinePath(parent))
      ghostAlpha.value = 1
      ghostAlpha.value = withTiming(0, { duration: GHOST_FADE_MS })
      if (fading.current !== null) clearTimeout(fading.current)
      fading.current = setTimeout(() => setGhost(null), GHOST_FADE_MS)

      const span = parent.bounds.maxX - parent.bounds.minX
      zoomAbout(centre, TARGET_CELL_PX / span)
    },
    [leaves, growth, anchor, leafAt, merge, zoomAbout, progress, ghostAlpha],
  )

  const fold = useCallback(
    (x: number, y: number): void => {
      if (leaves === null || growth !== null) return
      const cell = leafAt(x, y)
      if (cell === null) return
      const res = getResolution(cell)
      if (res <= MIN_RES) {
        setRefusal(TOP_NOTE)
        return
      }
      setRefusal(null)

      const parent = cellToParent(cell, res - 1)
      const kept: bigint[] = []
      for (const leaf of leaves.cells) {
        if (getResolution(leaf) >= res - 1 && cellToParent(leaf, res - 1) === parent) continue
        kept.push(leaf)
      }
      kept.push(parent)

      setLeaves(leavesOf(BigUint64Array.from(kept)))
      setFocus(focusOf(parent, null))

      const shape = shapeOf(parent, anchor)
      const span = shape.bounds.maxX - shape.bounds.minX
      zoomAbout(sceneOf(cellToLatLng(parent), anchor), TARGET_CELL_PX / span)
    },
    [leaves, growth, anchor, leafAt, zoomAbout],
  )

  const reach = leaves === null ? NO_REACH : reachOf(leaves)
  // a refused tap outranks the standing line, because it answers the gesture the visitor just made
  const note = refusal ?? reach.note

  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .enabled(reach.split)
      .onEnd((event) => {
        'worklet'
        runOnJS(split)(event.x, event.y)
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
          </>
        )}
      </EngineCanvas>
      {/* box-none leaves the scene every touch the panel head does not take */}
      <View style={styles.panel} pointerEvents="box-none">
        <Panel collapsible collapsed={collapsed} onToggle={() => setCollapsed((held) => !held)}>
          <Metric value={formatCount(scene?.leafCount ?? 0)} caption="leaf cells" />
          <Row label="resolution" value={focus === null ? '-' : `${focus.res}`} />
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
  note: {
    width: PRINT_WIDTH,
  },
  blocked: { ...type.label, color: colours.muted },
  print: {
    width: PRINT_WIDTH,
    marginTop: 4,
  },
})
