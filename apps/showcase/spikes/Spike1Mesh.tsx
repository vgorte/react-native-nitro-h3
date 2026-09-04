import {
  BlendMode,
  Canvas,
  Fill,
  Group,
  PaintStyle,
  Picture,
  Skia,
  type SkPaint,
  type SkPicture,
  type SkPoint,
  VertexMode,
} from '@shopify/react-native-skia'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { cellsToBoundaries, cellToLatLng, gridDisk } from 'react-native-nitro-h3'
import { runOnJS, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated'

import { type Bounds, buildMesh, buildOutlinePath, projectCells, rampColours } from './mesh'

const ORIGIN = 0x8928308280fffffn
const CHUNK_SIZE = 10_000
const BUCKETS = 16
const INSET = 0.08
const OUTLINE_EDGES = 3
const REPEATS = 5
const PAN_MS = 5000
const PAN_RADIUS_PX = 160
const ZOOM_AMPLITUDE = 0.12
const SLOW_FRAME_MS = 20

const GROUND = '#060911'
const HAIRLINE = '#26324A'
const TEXT = '#E8EEF8'
const MUTED = '#7C8AA6'

const SIZES = [
  { label: '20k', k: 82 },
  { label: '128k', k: 207 },
] as const

const VARIANTS = ['outline', 'inset'] as const
type Variant = (typeof VARIANTS)[number]

const STAGES = [
  'gridDisk',
  'cellsToBoundaries',
  'project',
  'mesh',
  'points',
  'indices',
  'vertices',
  'outline',
  'record',
] as const
type Stage = (typeof STAGES)[number]

const BUCKET_PAINTS: SkPaint[] = rampColours(BUCKETS).map((colour) => {
  const paint = Skia.Paint()
  paint.setColor(Skia.Color(colour))
  paint.setAntiAlias(true)
  return paint
})

const OUTLINE_PAINT = (() => {
  const paint = Skia.Paint()
  paint.setColor(Skia.Color(HAIRLINE))
  paint.setStyle(PaintStyle.Stroke)
  paint.setStrokeWidth(0)
  paint.setAntiAlias(true)
  return paint
})()

interface Scene {
  pictures: SkPicture[]
  bounds: Bounds
}

interface Run {
  timings: Record<Stage, number>
  cells: number
  points: number
  indices: number
  chunks: number
  groups: number
  scene: Scene
}

interface Summary {
  size: string
  variant: Variant
  medians: Record<Stage, number>
  total: number
  cells: number
  points: number
  indices: number
  chunks: number
  groups: number
}

interface FrameRate {
  frames: number
  slow: number
  ms: number
}

function runPipeline(k: number, variant: Variant): Run {
  const timings = {} as Record<Stage, number>

  let mark = performance.now()
  const cells = gridDisk(ORIGIN, k)
  timings.gridDisk = performance.now() - mark

  mark = performance.now()
  const boundaries = cellsToBoundaries(cells)
  timings.cellsToBoundaries = performance.now() - mark

  mark = performance.now()
  const projected = projectCells(boundaries, cellToLatLng(ORIGIN))
  timings.project = performance.now() - mark

  mark = performance.now()
  const mesh = buildMesh(projected, {
    chunkSize: CHUNK_SIZE,
    buckets: BUCKETS,
    inset: variant === 'inset' ? INSET : 0,
  })
  timings.mesh = performance.now() - mark

  mark = performance.now()
  const positions = mesh.groups.map((group) => {
    const points = new Array<SkPoint>(group.positions.length / 2)
    for (let point = 0; point < points.length; point++) {
      points[point] = { x: group.positions[point * 2], y: group.positions[point * 2 + 1] }
    }
    return points
  })
  timings.points = performance.now() - mark

  mark = performance.now()
  const indices = mesh.groups.map((group) => Array.from(group.indices))
  timings.indices = performance.now() - mark

  mark = performance.now()
  const vertices = positions.map((points, index) =>
    Skia.MakeVertices(VertexMode.Triangles, points, undefined, undefined, indices[index], false),
  )
  timings.vertices = performance.now() - mark

  mark = performance.now()
  const outline =
    variant === 'outline'
      ? Skia.Path.MakeFromSVGString(buildOutlinePath(projected, OUTLINE_EDGES))
      : null
  timings.outline = performance.now() - mark

  const { minX, minY, maxX, maxY } = projected.bounds
  const rect = Skia.XYWHRect(minX, minY, maxX - minX, maxY - minY)

  mark = performance.now()
  const pictures: SkPicture[] = []
  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    const recorder = Skia.PictureRecorder()
    const canvas = recorder.beginRecording(rect)
    mesh.groups.forEach((group, index) => {
      if (group.bucket !== bucket) return
      canvas.drawVertices(vertices[index], BlendMode.SrcOver, BUCKET_PAINTS[bucket])
    })
    pictures.push(recorder.finishRecordingAsPicture())
  }
  if (outline !== null) {
    const recorder = Skia.PictureRecorder()
    recorder.beginRecording(rect).drawPath(outline, OUTLINE_PAINT)
    pictures.push(recorder.finishRecordingAsPicture())
  }
  timings.record = performance.now() - mark

  return {
    timings,
    cells: cells.length,
    points: mesh.pointCount,
    indices: mesh.indexCount,
    chunks: mesh.chunkCount,
    groups: mesh.groups.length,
    scene: { pictures, bounds: projected.bounds },
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function summarise(runs: Run[], size: string, variant: Variant): Summary {
  const medians = {} as Record<Stage, number>
  let total = 0
  for (const stage of STAGES) {
    medians[stage] = median(runs.map((run) => run.timings[stage]))
    total += medians[stage]
  }
  const last = runs[runs.length - 1]
  return {
    size,
    variant,
    medians,
    total,
    cells: last.cells,
    points: last.points,
    indices: last.indices,
    chunks: last.chunks,
    groups: last.groups,
  }
}

export default function Spike1Mesh() {
  const { width, height } = useWindowDimensions()
  const [sizeIndex, setSizeIndex] = useState(0)
  const [variant, setVariant] = useState<Variant>('outline')
  const [progress, setProgress] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [scene, setScene] = useState<Scene | null>(null)
  const [frameRate, setFrameRate] = useState<FrameRate | null>(null)
  const [panning, setPanning] = useState(false)

  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const scale = useSharedValue(1)
  const baseX = useSharedValue(0)
  const baseY = useSharedValue(0)
  const baseScale = useSharedValue(1)
  const started = useSharedValue(0)
  const finished = useSharedValue(false)
  const frames = useSharedValue(0)
  const slowFrames = useSharedValue(0)

  const transform = useDerivedValue(() => [
    { translateX: translateX.value },
    { translateY: translateY.value },
    { scale: scale.value },
  ])

  const endPan = useCallback((measured: FrameRate) => {
    setFrameRate(measured)
    setPanning(false)
  }, [])

  const frameCallback = useFrameCallback((info) => {
    'worklet'
    if (finished.value) return
    if (started.value === 0) {
      started.value = info.timeSinceFirstFrame
      return
    }
    const elapsed = info.timeSinceFirstFrame - started.value
    frames.value += 1
    if ((info.timeSincePreviousFrame ?? 0) > SLOW_FRAME_MS) slowFrames.value += 1

    const phase = elapsed / 1000
    translateX.value = baseX.value + PAN_RADIUS_PX * Math.sin(phase * Math.PI)
    translateY.value = baseY.value + PAN_RADIUS_PX * Math.cos(phase * Math.PI)
    scale.value = baseScale.value * (1 + ZOOM_AMPLITUDE * Math.sin((phase * Math.PI * 2) / 3))

    if (elapsed >= PAN_MS) {
      finished.value = true
      runOnJS(endPan)({ frames: frames.value, slow: slowFrames.value, ms: elapsed })
    }
  }, false)

  useEffect(() => {
    frameCallback.setActive(panning)
  }, [panning, frameCallback])

  const fitCamera = useCallback(
    (bounds: Bounds) => {
      const fit =
        Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxY - bounds.minY)) * 0.9
      scale.value = fit
      translateX.value = width / 2 - ((bounds.minX + bounds.maxX) / 2) * fit
      translateY.value = height / 2 - ((bounds.minY + bounds.maxY) / 2) * fit
    },
    [width, height, scale, translateX, translateY],
  )

  const measure = useCallback(() => {
    setSummary(null)
    setFrameRate(null)
    setScene(null)
    const size = SIZES[sizeIndex]
    const runs: Run[] = []
    const step = () => {
      setProgress(`building ${size.label} ${variant}, run ${runs.length + 1} of ${REPEATS}`)
      setTimeout(() => {
        runs.push(runPipeline(size.k, variant))
        if (runs.length < REPEATS) {
          step()
          return
        }
        setScene(runs[runs.length - 1].scene)
        setSummary(summarise(runs, size.label, variant))
        setProgress(null)
        fitCamera(runs[runs.length - 1].scene.bounds)
      }, 48)
    }
    step()
  }, [sizeIndex, variant, fitCamera])

  const startPan = useCallback(() => {
    if (scene === null) return
    setFrameRate(null)
    baseX.value = translateX.value
    baseY.value = translateY.value
    baseScale.value = scale.value
    started.value = 0
    finished.value = false
    frames.value = 0
    slowFrames.value = 0
    setPanning(true)
  }, [
    scene,
    baseX,
    baseY,
    baseScale,
    started,
    finished,
    frames,
    slowFrames,
    translateX,
    translateY,
    scale,
  ])

  const gesture = useMemo(() => {
    const pan = Gesture.Pan().onChange((event) => {
      'worklet'
      translateX.value += event.changeX
      translateY.value += event.changeY
    })
    const pinch = Gesture.Pinch().onChange((event) => {
      'worklet'
      const next = scale.value * event.scaleChange
      const factor = next / scale.value
      translateX.value = event.focalX - (event.focalX - translateX.value) * factor
      translateY.value = event.focalY - (event.focalY - translateY.value) * factor
      scale.value = next
    })
    return Gesture.Simultaneous(pan, pinch)
  }, [translateX, translateY, scale])

  return (
    <GestureHandlerRootView style={styles.root}>
      <GestureDetector gesture={gesture}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill color={GROUND} />
          <Group transform={transform}>
            {scene?.pictures.map((picture, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the pictures are a fixed positional list.
              <Picture key={index} picture={picture} />
            ))}
          </Group>
        </Canvas>
      </GestureDetector>

      <View style={styles.hud} pointerEvents="box-none">
        <View style={styles.panel} pointerEvents="none">
          <Text style={styles.title}>
            {SIZES[sizeIndex].label} cells, {variant}
          </Text>
          {progress !== null ? <Text style={styles.muted}>{progress}</Text> : null}
          {summary !== null ? <Readout summary={summary} /> : null}
          {frameRate !== null ? (
            <>
              <Row
                label="fps"
                value={((frameRate.frames / frameRate.ms) * 1000).toFixed(1)}
                emphasis
              />
              <Row label={`frames over ${SLOW_FRAME_MS} ms`} value={`${frameRate.slow}`} />
              <Row label="frames" value={`${frameRate.frames} in ${Math.round(frameRate.ms)} ms`} />
            </>
          ) : null}
        </View>

        <View style={styles.controls}>
          <Button
            label={SIZES[sizeIndex].label}
            onPress={() => setSizeIndex((index) => (index + 1) % SIZES.length)}
          />
          <Button
            label={variant}
            onPress={() => setVariant((current) => (current === 'outline' ? 'inset' : 'outline'))}
          />
          <Button label={`build x${REPEATS}`} onPress={measure} />
          <Button label={panning ? 'panning' : 'pan 5 s'} onPress={startPan} />
        </View>
      </View>
      <StatusBar style="light" />
    </GestureHandlerRootView>
  )
}

function Readout({ summary }: { summary: Summary }) {
  return (
    <>
      {STAGES.map((stage) => (
        <Row key={stage} label={stage} value={summary.medians[stage].toFixed(1)} />
      ))}
      <Row label="build total" value={summary.total.toFixed(1)} emphasis />
      <Row label="cells" value={summary.cells.toLocaleString()} />
      <Row label="points" value={summary.points.toLocaleString()} />
      <Row label="indices" value={summary.indices.toLocaleString()} />
      <Row label="chunks" value={`${summary.chunks}, ${summary.groups} batches`} />
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
