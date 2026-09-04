import * as Location from 'expo-location'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import {
  areNeighborCells,
  cellToLatLng,
  getHexagonEdgeLengthAvgM,
  latLngToCell,
} from 'react-native-nitro-h3'
import { runOnJS, useAnimatedReaction, withTiming } from 'react-native-reanimated'
import { pathBetween, timed } from '../engine/cells'
import { mercatorX, mercatorY } from '../engine/projection'
import { formatCount, formatMs, formatUs } from '../engine/stats'
import {
  AGE_SPAN,
  capTrail,
  extendTrail,
  filledCells,
  MAX_TRAIL_RES,
  MIN_TRAIL_RES,
  pathOrJump,
  scaleForTrail,
  TRAIL_RES,
  type TrailFix,
  type TrailStep,
} from '../engine/trail'
import { resetWorstGap } from '../render/BlockedReadout'
import { CellPictures } from '../render/CellPictures'
import { EngineCanvas } from '../render/EngineCanvas'
import { Choice, type ChoiceOption } from '../render/hud/Choice'
import { FinePrint } from '../render/hud/FinePrint'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { Row } from '../render/hud/Row'
import { buildTrailScene, type TrailScene } from '../render/trailScene'
import { type CameraAnchor, useCamera } from '../render/useCamera'
import { colours, glass, type } from '../theme/tokens'
import { REPLAY_ROUTE } from './replayRoute'
import type { ActProps } from './types'

// the act's published contract names these; the rules that use them live in engine/trail.ts
export {
  AGE_SPAN,
  extendTrail,
  MAX_TRAIL_RES,
  MIN_TRAIL_RES,
  TRAIL_RES,
  type TrailStep,
} from '../engine/trail'

/** Set on a build that logs every fix it takes, which is how `replayRoute.ts` was recorded. */
const RECORDING = process.env.EXPO_PUBLIC_TRAIL_RECORD === '1'

// where the act stands until the first fix says where the visitor is
const BERLIN: CameraAnchor = { lat: 52.52, lng: 13.405 }

/** Milliseconds the camera takes to glide onto a new head cell. */
const FOLLOW_MS = 400

const RES_OPTIONS: readonly ChoiceOption<number>[] = [
  { value: MIN_TRAIL_RES, label: `${MIN_TRAIL_RES}` },
  { value: TRAIL_RES, label: `${TRAIL_RES}` },
  { value: MAX_TRAIL_RES, label: `${MAX_TRAIL_RES}` },
]

const PANEL_TOP = 104
const PRINT_WIDTH = 268
// clears the blocked readout, which stands on the same line at the other edge
const CONTROL_BOTTOM = 118
// The head stands where the three glass surfaces leave the scene open on both test targets: under
// the expanded panel, left of the controls and above the blocked readout.
const HEAD_X = 0.32
const HEAD_Y = 0.76

const NOTES = [
  'a fix that is not a neighbour of the head is joined with gridPathCells',
  'a fix a second at resolution 11 lands in the same cell or a neighbour, so the grid path only ' +
    'answers a gap in the feed',
  'those filled cells draw on the lower half of the ramp, the measured ones on the whole of it',
  `the trail keeps its last ${formatCount(AGE_SPAN)} cells, and fades over what it holds`,
  'with the location refused, a recorded route plays at the pace it was walked',
]

/** Names where the fixes come from: the device itself, or the route recorded on a simulated run. */
type Source = 'live' | 'replay'

/** Holds what one gap cost: the cells `gridPathCells` filled in, and what the call took. */
interface Gap {
  cells: number
  ms: number
}

/** Holds what the last fix measured, which is what the call rows report. */
interface Reading {
  fixes: number
  /** What `latLngToCell` took on the last fix. */
  locateMs: number
  /** The last gap the grid path closed, `null` while every fix has been a neighbour. */
  gap: Gap | null
}

const NOTHING: Reading = { fixes: 0, locateMs: 0, gap: null }

/** Holds a trail walked one fix further, together with what the two calls behind it took. */
interface Walk {
  trail: TrailStep[]
  locateMs: number
  gap: Gap | null
}

/** Walks one fix onto the trail, timing the two calls the HUD names. */
function walkFix(trail: TrailStep[], fix: TrailFix, res: number): Walk {
  const located = timed('latLngToCell', () => latLngToCell(fix.lat, fix.lng, res))
  const closed: { gap: Gap | null } = { gap: null }
  const walked = extendTrail(trail, located.value, areNeighborCells, (from, to) =>
    pathOrJump(from, to, (a, b) => {
      const between = pathBetween(a, b)
      // the two ends of the path are the head and the fix, so the gap is what stands between them
      closed.gap = { cells: between.value.length - 2, ms: between.ms }
      return between.value
    }),
  )
  return { trail: capTrail(walked, AGE_SPAN), locateMs: located.ms, gap: closed.gap }
}

/** Answers the trail a whole run of fixes builds at one resolution, which a new one rebuilds. */
function walkRoute(fixes: readonly TrailFix[], res: number): Walk {
  let walk: Walk = { trail: [], locateMs: 0, gap: null }
  for (const fix of fixes) {
    const walked = walkFix(walk.trail, fix, res)
    walk = { trail: walked.trail, locateMs: walked.locateMs, gap: walked.gap ?? walk.gap }
  }
  return walk
}

/**
 * Draws the route the visitor walks as the cells it passes through, gap by gap.
 *
 * Every fix becomes one cell through `latLngToCell`. A fix that is not a neighbour of the head is
 * joined to it with `gridPathCells`, and those cells draw on the lower half of the ramp, which is
 * the act's whole point: what was measured and what was inferred are told apart on screen. The
 * trail keeps its last {@linkcode AGE_SPAN} cells and fades over whatever it holds, and the camera
 * follows the head until the visitor takes it over, after which the recentre control gives it back.
 * Refusing the location plays {@linkcode REPLAY_ROUTE} instead, at the pace it was recorded.
 */
export function Trail({ active }: ActProps) {
  const { width, height } = useWindowDimensions()
  const [source, setSource] = useState<Source | null>(null)
  const [res, setRes] = useState(TRAIL_RES)
  const [trail, setTrail] = useState<TrailStep[]>([])
  const [reading, setReading] = useState<Reading>(NOTHING)
  const [scene, setScene] = useState<TrailScene | null>(null)
  const [following, setFollowing] = useState(true)
  const [collapsed, setCollapsed] = useState(false)

  // the fixes the act has taken, which a change of resolution walks again
  const fixes = useRef<TrailFix[]>([])
  // the standing trail, so a fix extends what is drawn without waiting for a render
  const held = useRef<TrailStep[]>([])
  const anchored = useRef<CameraAnchor>(BERLIN)
  const framed = useRef(false)
  const started = useRef<number | null>(null)
  const played = useRef(0)
  // set when a fix arrived during a gesture, where the rebuild waits for the camera to settle
  const pending = useRef(false)

  const rebuild = useCallback(() => {
    if (!pending.current) return
    pending.current = false
    if (held.current.length > 0) setScene(buildTrailScene(held.current, anchored.current))
  }, [])

  const camera = useCamera({ anchor: BERLIN, onSettle: rebuild })
  const { anchor, setAnchor, translateX, translateY, scale, interacting } = camera

  useEffect(() => {
    anchored.current = anchor
  }, [anchor])

  /** Puts a cell in the band the two panels leave open, which is where the head belongs. */
  const centreOn = useCallback(
    (cell: bigint, animated: boolean) => {
      const centre = cellToLatLng(cell)
      const frame = anchored.current
      const x = mercatorX(centre.lng) - mercatorX(frame.lng)
      const y = mercatorY(frame.lat) - mercatorY(centre.lat)
      const toX = width * HEAD_X - x * scale.value
      const toY = height * HEAD_Y - y * scale.value
      if (!animated) {
        translateX.value = toX
        translateY.value = toY
        return
      }
      translateX.value = withTiming(toX, { duration: FOLLOW_MS })
      translateY.value = withTiming(toY, { duration: FOLLOW_MS })
    },
    [width, height, translateX, translateY, scale],
  )

  const take = useCallback(
    (fix: TrailFix) => {
      fixes.current.push(fix)
      if (RECORDING) console.log('trail fix', JSON.stringify(fix))
      // the first fix says where the act stands, and the metre frame is measured from there
      if (fixes.current.length === 1) {
        anchored.current = { lat: fix.lat, lng: fix.lng }
        setAnchor(anchored.current)
      }
      const walked = walkFix(held.current, fix, res)
      held.current = walked.trail
      setTrail(walked.trail)
      setReading((before) => ({
        fixes: fixes.current.length,
        locateMs: walked.locateMs,
        gap: walked.gap ?? before.gap,
      }))
    },
    [res, setAnchor],
  )

  // the two sources reach for the standing rule rather than depend on it, so a change of
  // resolution neither resubscribes the watcher nor knocks the replay off its pace
  const taking = useRef(take)
  useEffect(() => {
    taking.current = take
  }, [take])

  // a resolution is a tiling of its own, so the whole route is walked again at the new one
  useEffect(() => {
    const walked = walkRoute(fixes.current, res)
    held.current = walked.trail
    setTrail(walked.trail)
    setReading((before) => ({ ...before, locateMs: walked.locateMs, gap: walked.gap }))
  }, [res])

  // the act asks for the location once it is on screen, and a refusal is what starts the replay
  useEffect(() => {
    if (!active || source !== null) return
    let cancelled = false
    void Location.requestForegroundPermissionsAsync().then(({ granted }) => {
      if (cancelled) return
      // the system holds the app while its dialog stands, and that gap is not the act's to report
      resetWorstGap()
      setSource(granted ? 'live' : 'replay')
    })
    return () => {
      cancelled = true
    }
  }, [active, source])

  // the watcher belongs to the act on screen, and is torn down on every other transition
  useEffect(() => {
    if (!active || source !== 'live') return
    let watcher: Location.LocationSubscription | null = null
    let cancelled = false
    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0 },
      (position) => {
        started.current ??= position.timestamp
        taking.current({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          t: position.timestamp - started.current,
        })
      },
    ).then((opened) => {
      if (cancelled) opened.remove()
      else watcher = opened
    })
    return () => {
      cancelled = true
      watcher?.remove()
    }
  }, [active, source])

  // the replay keeps the pace it was recorded at, and holds where it stands while the act is away
  useEffect(() => {
    if (!active || source !== 'replay') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const play = () => {
      const index = played.current
      const fix = REPLAY_ROUTE[index]
      if (fix === undefined) return
      played.current = index + 1
      taking.current(fix)
      const next = REPLAY_ROUTE[index + 1]
      if (next !== undefined) timer = setTimeout(play, Math.max(0, next.t - fix.t))
    }
    timer = setTimeout(play, 0)
    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [active, source])

  useEffect(() => {
    if (!active) return
    // the gaps of the builds that follow belong to this act, and to no act before it
    resetWorstGap()
  }, [active])

  // a camera the visitor has taken hold of is theirs until the recentre control hands it back
  useAnimatedReaction(
    () => interacting.value,
    (now) => {
      if (now) runOnJS(setFollowing)(false)
    },
  )

  // the first fix frames the trail; every one after it glides the head back into the middle
  useEffect(() => {
    const head = trail[trail.length - 1]
    if (head === undefined) return
    if (!framed.current) {
      framed.current = true
      scale.value = scaleForTrail(
        width,
        height,
        anchored.current.lat,
        getHexagonEdgeLengthAvgM,
        res,
      )
      centreOn(head.cell, false)
      return
    }
    if (following) centreOn(head.cell, true)
  }, [trail, following, res, width, height, centreOn, scale])

  // a rebuild during a pan would drop a frame under the finger, so it waits for the settle instead
  useEffect(() => {
    if (trail.length === 0) {
      setScene(null)
      return
    }
    if (interacting.value) {
      pending.current = true
      return
    }
    pending.current = false
    setScene(buildTrailScene(trail, anchor))
  }, [trail, anchor, interacting])

  const edgeM = useMemo(() => getHexagonEdgeLengthAvgM(res), [res])
  const filled = useMemo(() => filledCells(trail), [trail])

  // an act off screen keeps its trail, holds its source and draws nothing
  if (!active) return <View style={styles.root} />

  return (
    <View style={styles.root}>
      <EngineCanvas camera={camera}>
        <CellPictures scene={scene?.scene ?? null} />
      </EngineCanvas>
      {/* box-none leaves the scene every touch the panel head does not take */}
      <View style={styles.panel} pointerEvents="box-none">
        <Panel collapsible collapsed={collapsed} onToggle={() => setCollapsed((was) => !was)}>
          <Metric value={formatCount(trail.length)} caption="cells on the trail" />
          <Row label="fixes" value={formatCount(reading.fixes)} />
          <Row label="source" value={source ?? 'asking'} />
          <Row label="resolution" value={`${res}`} />
          <Row
            label="average edge"
            value={`${edgeM.toFixed(1)} m`}
            call="getHexagonEdgeLengthAvgM"
          />
          <Row
            label="locate"
            value={reading.fixes === 0 ? '-' : formatUs(reading.locateMs)}
            call="latLngToCell"
          />
          <Row
            label="grid path, last gap"
            value={
              reading.gap === null
                ? '-'
                : `${formatCount(reading.gap.cells)} / ${formatUs(reading.gap.ms)}`
            }
            call="gridPathCells"
          />
          <Row label="grid path cells" value={formatCount(filled)} tone="muted" />
          <Row
            label="boundaries"
            value={scene === null ? '-' : formatMs(scene.boundariesMs)}
            call="cellsToBoundaries"
          />
          <Row label="mesh" value={scene === null ? '-' : formatMs(scene.meshMs)} />
          <Row label="camera" value={following ? 'on the head' : 'yours'} tone="muted" />
          <View style={styles.print}>
            <FinePrint notes={NOTES} />
          </View>
        </Panel>
      </View>
      <View style={styles.control}>
        <Panel align="right">
          <Choice label="resolution" options={RES_OPTIONS} value={res} onChange={setRes} />
          <Pressable
            style={[styles.button, following ? null : styles.away]}
            onPress={() => setFollowing(true)}
            accessibilityRole="button"
          >
            <Text style={following ? styles.buttonLabel : styles.awayLabel}>recentre</Text>
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
  buttonLabel: { ...type.value, lineHeight: 16, color: colours.muted },
  away: { borderColor: colours.contrast },
  awayLabel: { ...type.value, lineHeight: 16, color: colours.contrast },
})
