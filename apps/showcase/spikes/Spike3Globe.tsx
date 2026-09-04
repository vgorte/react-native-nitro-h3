import {
  BlendMode,
  Canvas,
  Circle,
  Fill,
  Group,
  Picture,
  Skia,
  type SkPaint,
  type SkPicture,
  type SkPoint,
  VertexMode,
} from '@shopify/react-native-skia'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import {
  cellsToBoundaries,
  cellsToLatLngs,
  getBaseCellNumber,
  getRes0Cells,
  uncompactCells,
} from 'react-native-nitro-h3'
import {
  runOnJS,
  type SharedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated'

import {
  buildGlobeFrame,
  createGlobeFrame,
  type GlobeCells,
  type GlobeFrame,
  type GlobeView,
  toGlobeCells,
} from './globe'
import { rampColours } from './mesh'

const RESOLUTION = 2
const BASE_CELLS = 122
const BUCKETS = 16
const DISK_MARGIN = 0.88
const RAD_PER_PX = 0.005
const SPIN_RATE = 0.6
const MEASURE_MS = 5000
const SLOW_FRAME_MS = 20
const MAX_SAMPLES = 2048
const START_LAMBDA = 0.2
const START_PHI = 0.4

const GROUND = '#060911'
const SPHERE = '#0A1424'
const RIM = '#26324A'
const TEXT = '#E8EEF8'
const MUTED = '#7C8AA6'

const VARIANTS = ['js', 'worklet'] as const
type Variant = (typeof VARIANTS)[number]

const STAGES = ['res0', 'uncompact', 'boundaries', 'centres', 'buckets', 'sphere'] as const
type Stage = (typeof STAGES)[number]

const BUCKET_PAINTS: SkPaint[] = rampColours(BUCKETS).map((colour) => {
  const paint = Skia.Paint()
  paint.setColor(Skia.Color(colour))
  paint.setAntiAlias(true)
  return paint
})

const EMPTY_PICTURE = (() => {
  const recorder = Skia.PictureRecorder()
  recorder.beginRecording(Skia.XYWHRect(0, 0, 1, 1))
  return recorder.finishRecordingAsPicture()
})()

interface Globe {
  cells: GlobeCells
  frame: GlobeFrame
  timings: Record<Stage, number>
  cellCount: number
  vertexCount: number
}

interface Stats {
  variant: Variant
  median: number
  p95: number
  fps: number
  slow: number
  frames: number
  visible: number
}

function clampPhi(phi: number): number {
  'worklet'
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, phi))
}

function load(): Globe {
  const timings = {} as Record<Stage, number>

  let mark = performance.now()
  const res0 = getRes0Cells()
  timings.res0 = performance.now() - mark

  mark = performance.now()
  const cells = uncompactCells(res0, RESOLUTION)
  timings.uncompact = performance.now() - mark

  mark = performance.now()
  const boundaries = cellsToBoundaries(cells)
  timings.boundaries = performance.now() - mark

  mark = performance.now()
  const centres = cellsToLatLngs(cells)
  timings.centres = performance.now() - mark

  mark = performance.now()
  const buckets = new Uint8Array(cells.length)
  for (let cell = 0; cell < cells.length; cell++) {
    buckets[cell] = Math.floor((getBaseCellNumber(cells[cell]) * BUCKETS) / BASE_CELLS)
  }
  timings.buckets = performance.now() - mark

  mark = performance.now()
  const sphere = toGlobeCells(boundaries, centres, buckets)
  const frame = createGlobeFrame(sphere, BUCKETS)
  timings.sphere = performance.now() - mark

  let vertexCount = 0
  for (let cell = 0; cell < sphere.cellCount; cell++) vertexCount += sphere.vertexCounts[cell]

  return { cells: sphere, frame, timings, cellCount: cells.length, vertexCount }
}

/**
 * Projects the globe for one view and records the drawable picture, one batch per colour bucket.
 *
 * Runs unchanged on the JS thread and on the UI thread, which is the only difference the two
 * variants measure.
 */
function drawGlobe(globe: Globe, view: GlobeView, picture: SharedValue<SkPicture>): number {
  'worklet'
  const { cells, frame } = globe
  const visible = buildGlobeFrame(cells, frame, view)

  const recorder = Skia.PictureRecorder()
  const canvas = recorder.beginRecording(
    Skia.XYWHRect(view.cx - view.radius, view.cy - view.radius, view.radius * 2, view.radius * 2),
  )

  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    const used = frame.pointCounts[bucket]
    if (used === 0) continue

    const positions = frame.positions[bucket]
    const points = new Array<SkPoint>(used)
    for (let point = 0; point < used; point++) {
      points[point] = { x: positions[point * 2], y: positions[point * 2 + 1] }
    }

    const source = frame.indices[bucket]
    const indexCount = frame.indexCounts[bucket]
    const indices = new Array<number>(indexCount)
    for (let index = 0; index < indexCount; index++) indices[index] = source[index]

    const vertices = Skia.MakeVertices(
      VertexMode.Triangles,
      points,
      undefined,
      undefined,
      indices,
      true,
    )
    canvas.drawVertices(vertices, BlendMode.SrcOver, BUCKET_PAINTS[bucket])
  }

  picture.value = recorder.finishRecordingAsPicture()
  return visible
}

function median(values: number[]): number {
  'worklet'
  const sorted = [...values].sort((left, right) => left - right)
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]
}

function percentile95(values: number[]): number {
  'worklet'
  const sorted = [...values].sort((left, right) => left - right)
  return sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
}

export default function Spike3Globe() {
  const { width, height } = useWindowDimensions()
  const [globe, setGlobe] = useState<Globe | null>(null)
  const [variant, setVariant] = useState<Variant>('js')
  const [stats, setStats] = useState<Stats | null>(null)
  const [running, setRunning] = useState(false)

  const picture = useSharedValue<SkPicture>(EMPTY_PICTURE)
  const lambda0 = useSharedValue(START_LAMBDA)
  const phi0 = useSharedValue(START_PHI)
  const spinFrom = useSharedValue(START_LAMBDA)
  const measuring = useSharedValue(0)
  const runStarted = useSharedValue(0)
  const frames = useSharedValue(0)
  const slowFrames = useSharedValue(0)
  const sampleCount = useSharedValue(0)
  const lastLambda = useSharedValue(Number.NaN)
  const lastPhi = useSharedValue(Number.NaN)
  const visibleCells = useSharedValue(0)

  const samples = useMemo(() => new Float64Array(MAX_SAMPLES), [])
  const jsRotation = useRef({ lambda0: START_LAMBDA, phi0: START_PHI, dirty: true })
  const jsRun = useRef<{
    startedAt: number
    base: number
    last: number
    frames: number
    slow: number
  } | null>(null)
  const jsSamples = useRef<number[]>([])

  const radius = (Math.min(width, height) / 2) * DISK_MARGIN
  const cx = width / 2
  const cy = height / 2
  const disk = useMemo(() => {
    const path = Skia.Path.Make()
    path.addCircle(cx, cy, radius)
    return path
  }, [cx, cy, radius])

  const finish = useCallback((measured: Stats) => {
    setStats(measured)
    setRunning(false)
  }, [])

  useEffect(() => {
    const handle = setTimeout(() => setGlobe(load()), 48)
    return () => clearTimeout(handle)
  }, [])

  // the loop that redraws the globe is the loop that counts the frames
  useEffect(() => {
    if (globe === null || variant !== 'js') return
    let handle = 0

    const tick = () => {
      handle = requestAnimationFrame(tick)
      const rotation = jsRotation.current
      const run = jsRun.current
      const now = performance.now()

      if (run !== null) {
        if (run.last === 0) {
          run.startedAt = now
          run.last = now
          return
        }
        run.frames += 1
        if (now - run.last > SLOW_FRAME_MS) run.slow += 1
        run.last = now
        rotation.lambda0 = run.base + (SPIN_RATE * (now - run.startedAt)) / 1000
        rotation.dirty = true
      }

      if (!rotation.dirty) return
      rotation.dirty = false

      const started = performance.now()
      const visible = drawGlobe(
        globe,
        { lambda0: rotation.lambda0, phi0: rotation.phi0, cx, cy, radius },
        picture,
      )
      const cost = performance.now() - started

      if (run === null) return
      jsSamples.current.push(cost)
      const elapsed = now - run.startedAt
      if (elapsed < MEASURE_MS) return

      jsRun.current = null
      finish({
        variant: 'js',
        median: median(jsSamples.current),
        p95: percentile95(jsSamples.current),
        fps: (run.frames / elapsed) * 1000,
        slow: run.slow,
        frames: run.frames,
        visible,
      })
    }

    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [globe, variant, cx, cy, radius, picture, finish])

  // the same loop on the UI thread, timed by the frame callback
  const frameCallback = useFrameCallback((info) => {
    'worklet'
    if (globe === null) return

    if (measuring.value === 1) {
      measuring.value = 2
      runStarted.value = info.timeSinceFirstFrame
      return
    }

    let elapsed = 0
    if (measuring.value === 2) {
      elapsed = info.timeSinceFirstFrame - runStarted.value
      lambda0.value = spinFrom.value + (SPIN_RATE * elapsed) / 1000
      frames.value += 1
      if ((info.timeSincePreviousFrame ?? 0) > SLOW_FRAME_MS) slowFrames.value += 1
    }

    if (lambda0.value !== lastLambda.value || phi0.value !== lastPhi.value) {
      lastLambda.value = lambda0.value
      lastPhi.value = phi0.value
      const started = performance.now()
      visibleCells.value = drawGlobe(
        globe,
        { lambda0: lambda0.value, phi0: phi0.value, cx, cy, radius },
        picture,
      )
      const cost = performance.now() - started
      if (measuring.value === 2 && sampleCount.value < MAX_SAMPLES) {
        samples[sampleCount.value] = cost
        sampleCount.value += 1
      }
    }

    if (measuring.value !== 2 || elapsed < MEASURE_MS) return

    const collected: number[] = []
    for (let sample = 0; sample < sampleCount.value; sample++) collected.push(samples[sample])
    measuring.value = 0
    runOnJS(finish)({
      variant: 'worklet',
      median: median(collected),
      p95: percentile95(collected),
      fps: (frames.value / elapsed) * 1000,
      slow: slowFrames.value,
      frames: frames.value,
      visible: visibleCells.value,
    })
  }, false)

  useEffect(() => {
    frameCallback.setActive(globe !== null && variant === 'worklet')
  }, [globe, variant, frameCallback])

  const measure = useCallback(() => {
    if (globe === null) return
    setStats(null)
    setRunning(true)
    if (variant === 'js') {
      jsSamples.current = []
      jsRun.current = {
        startedAt: 0,
        base: jsRotation.current.lambda0,
        last: 0,
        frames: 0,
        slow: 0,
      }
      return
    }
    spinFrom.value = lambda0.value
    frames.value = 0
    slowFrames.value = 0
    sampleCount.value = 0
    measuring.value = 1
  }, [globe, variant, lambda0, spinFrom, frames, slowFrames, sampleCount, measuring])

  // each variant keeps its own rotation, so the switch hands the view over
  const switchVariant = useCallback(() => {
    setStats(null)
    setVariant((current) => {
      if (current === 'js') {
        lambda0.value = jsRotation.current.lambda0
        phi0.value = jsRotation.current.phi0
        lastLambda.value = Number.NaN
        return 'worklet'
      }
      jsRotation.current = { lambda0: lambda0.value, phi0: phi0.value, dirty: true }
      return 'js'
    })
  }, [lambda0, phi0, lastLambda])

  const gesture = useMemo(() => {
    if (variant === 'js') {
      return Gesture.Pan()
        .runOnJS(true)
        .onChange((event) => {
          const rotation = jsRotation.current
          rotation.lambda0 -= event.changeX * RAD_PER_PX
          rotation.phi0 = clampPhi(rotation.phi0 + event.changeY * RAD_PER_PX)
          rotation.dirty = true
        })
    }
    return Gesture.Pan().onChange((event) => {
      'worklet'
      lambda0.value -= event.changeX * RAD_PER_PX
      phi0.value = clampPhi(phi0.value + event.changeY * RAD_PER_PX)
    })
  }, [variant, lambda0, phi0])

  return (
    <GestureHandlerRootView style={styles.root}>
      <GestureDetector gesture={gesture}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color={GROUND} />
          <Circle cx={cx} cy={cy} r={radius} color={SPHERE} />
          <Group clip={disk}>
            <Picture picture={picture} />
          </Group>
          <Circle cx={cx} cy={cy} r={radius} color={RIM} style="stroke" strokeWidth={1.5} />
        </Canvas>
      </GestureDetector>

      <View style={styles.hud} pointerEvents="box-none">
        <View style={styles.panel} pointerEvents="none">
          <Text style={styles.title}>
            globe at resolution {RESOLUTION}, {variant} thread
          </Text>
          {globe === null ? <Text style={styles.muted}>building the sphere</Text> : null}
          {globe !== null ? <Load globe={globe} /> : null}
          {running ? <Text style={styles.muted}>rotating for 5 s</Text> : null}
          {stats !== null ? <Readout stats={stats} /> : null}
        </View>

        <View style={styles.controls}>
          <Button label={variant} onPress={switchVariant} />
          <Button label={running ? 'rotating' : 'rotate 5 s'} onPress={measure} />
        </View>
      </View>
      <StatusBar style="light" />
    </GestureHandlerRootView>
  )
}

function Load({ globe }: { globe: Globe }) {
  return (
    <>
      {STAGES.map((stage) => (
        <Row key={stage} label={stage} value={globe.timings[stage].toFixed(1)} />
      ))}
      <Row label="cells" value={globe.cellCount.toLocaleString()} />
      <Row label="vertices" value={globe.vertexCount.toLocaleString()} />
    </>
  )
}

function Readout({ stats }: { stats: Stats }) {
  return (
    <>
      <Row label="build ms median" value={stats.median.toFixed(2)} emphasis />
      <Row label="build ms p95" value={stats.p95.toFixed(2)} />
      <Row label="fps" value={stats.fps.toFixed(1)} emphasis />
      <Row label={`frames over ${SLOW_FRAME_MS} ms`} value={`${stats.slow}`} />
      <Row label="frames" value={`${stats.frames}`} />
      <Row label="visible cells" value={stats.visible.toLocaleString()} />
    </>
  )
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={emphasis ? styles.strong : styles.value}>{value}</Text>
    </View>
  )
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: GROUND,
  },
  hud: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 64,
    paddingBottom: 48,
    paddingHorizontal: 16,
  },
  panel: {
    alignSelf: 'flex-start',
    minWidth: 260,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(6,9,17,0.82)',
    gap: 2,
  },
  title: {
    color: TEXT,
    fontSize: 15,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  muted: {
    color: MUTED,
    fontSize: 12,
  },
  value: {
    color: TEXT,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  strong: {
    color: '#3FB0FF',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  buttonLabel: {
    color: TEXT,
    fontSize: 13,
  },
})
