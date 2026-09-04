import { Canvas, Fill, Group, Path, Skia, type SkPath } from '@shopify/react-native-skia'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { runOnJS, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated'

import {
  buildTilePaths,
  decodeTile,
  lngLatToTile,
  type StyleClass,
  type TileId,
  tileGrid,
  tileUrl,
} from './tiles'

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'
const CENTRE = { lng: 13.4, lat: 52.52 }
const ZOOM = 14
const COLUMNS = 3
const ROWS = 2
const TILE_UNITS = 256
const FIT_MARGIN = 0.94
const REPEATS = 5
const PAN_MS = 5000
const PAN_RADIUS_PX = 160
const ZOOM_AMPLITUDE = 0.12
const SLOW_FRAME_MS = 20

const GROUND = '#060911'
const WATER = '#0B2038'
const ACCENT = '#3FB0FF'
const TEXT = '#E8EEF8'
const MUTED = '#7C8AA6'

/** Draws the classes back to front, water lowest and the widest road on top. */
const DRAW_ORDER = [
  'water',
  'building',
  'service',
  'minor',
  'tertiary',
  'secondary',
  'primary',
  'trunk',
  'motorway',
] as const satisfies readonly StyleClass[]

const OPACITY: Record<StyleClass, number> = {
  water: 1,
  building: 0.18,
  service: 0.22,
  minor: 0.32,
  tertiary: 0.45,
  secondary: 0.58,
  primary: 0.72,
  trunk: 0.86,
  motorway: 1,
}

const STAGES = ['decode', 'build', 'parse'] as const
type Stage = (typeof STAGES)[number]

interface TilePiece {
  style: StyleClass
  path: SkPath
}

interface TileScene {
  key: string
  offsetX: number
  offsetY: number
  scale: number
  pieces: TilePiece[]
}

interface TileMeasurement {
  scene: TileScene
  fetchMs: number
  medians: Record<Stage, number>
  bytes: number
  features: number
  chars: number
  sampleName: string | null
}

interface Summary {
  buildings: boolean
  tiles: number
  medians: Record<Stage, number>
  perTile: number
  worst: number
  fetchMs: number
  bytes: number
  features: number
  chars: number
  sampleName: string | null
}

interface FrameRate {
  frames: number
  slow: number
  ms: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

async function measureTile(
  template: string,
  tile: TileId,
  origin: TileId,
  buildings: boolean,
): Promise<TileMeasurement> {
  let mark = performance.now()
  const response = await fetch(tileUrl(template, tile))
  const buffer = await response.arrayBuffer()
  const fetchMs = performance.now() - mark
  const bytes = new Uint8Array(buffer)

  const timings: Record<Stage, number[]> = { decode: [], build: [], parse: [] }
  let pieces: TilePiece[] = []
  let extent = 0
  let features = 0
  let chars = 0
  let sampleName: string | null = null

  for (let repeat = 0; repeat < REPEATS; repeat++) {
    mark = performance.now()
    const decoded = decodeTile(bytes)
    timings.decode.push(performance.now() - mark)

    mark = performance.now()
    const built = buildTilePaths(decoded.tile, { buildings })
    timings.build.push(performance.now() - mark)

    mark = performance.now()
    const parsed: TilePiece[] = []
    for (const style of DRAW_ORDER) {
      const source = built.paths[style]
      if (source === '') continue
      const path = Skia.Path.MakeFromSVGString(source)
      if (path !== null) parsed.push({ style, path })
    }
    timings.parse.push(performance.now() - mark)

    pieces = parsed
    extent = built.extent
    features = built.features
    chars = Object.values(built.paths).reduce((total, path) => total + path.length, 0)
    sampleName = decoded.sampleName
  }

  return {
    scene: {
      key: `${tile.z}/${tile.x}/${tile.y}`,
      offsetX: (tile.x - origin.x) * TILE_UNITS,
      offsetY: (tile.y - origin.y) * TILE_UNITS,
      scale: TILE_UNITS / extent,
      pieces,
    },
    fetchMs,
    medians: {
      decode: median(timings.decode),
      build: median(timings.build),
      parse: median(timings.parse),
    },
    bytes: bytes.length,
    features,
    chars,
    sampleName,
  }
}

function summarise(measurements: TileMeasurement[], buildings: boolean): Summary {
  const medians = {} as Record<Stage, number>
  for (const stage of STAGES) {
    medians[stage] = mean(measurements.map((measurement) => measurement.medians[stage]))
  }
  const totals = measurements.map((measurement) =>
    STAGES.reduce((sum, stage) => sum + measurement.medians[stage], 0),
  )
  return {
    buildings,
    tiles: measurements.length,
    medians,
    perTile: mean(totals),
    worst: Math.max(...totals),
    fetchMs: mean(measurements.map((measurement) => measurement.fetchMs)),
    bytes: measurements.reduce((total, measurement) => total + measurement.bytes, 0),
    features: measurements.reduce((total, measurement) => total + measurement.features, 0),
    chars: measurements.reduce((total, measurement) => total + measurement.chars, 0),
    sampleName:
      measurements.find((measurement) => measurement.sampleName !== null)?.sampleName ?? null,
  }
}

export default function Spike2Tiles() {
  const { width, height } = useWindowDimensions()
  const [buildings, setBuildings] = useState(true)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [scenes, setScenes] = useState<TileScene[]>([])
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

  const fitCamera = useCallback(() => {
    const fit = Math.min(width / (COLUMNS * TILE_UNITS), height / (ROWS * TILE_UNITS)) * FIT_MARGIN
    scale.value = fit
    translateX.value = (width - COLUMNS * TILE_UNITS * fit) / 2
    translateY.value = (height - ROWS * TILE_UNITS * fit) / 2
  }, [width, height, scale, translateX, translateY])

  // the camera is fitted before the first tile mounts, so no draw ever starts from the identity
  useEffect(fitCamera, [fitCamera])

  const measure = useCallback(() => {
    setSummary(null)
    setFrameRate(null)
    setScenes([])
    setError(null)

    const run = async () => {
      setProgress('reading the TileJSON')
      const tilejson = await fetch(TILEJSON_URL)
      const template = ((await tilejson.json()) as { tiles: string[] }).tiles[0]

      const origin = lngLatToTile(CENTRE.lng, CENTRE.lat, ZOOM)
      const tiles = tileGrid(origin, COLUMNS, ROWS)
      const measurements: TileMeasurement[] = []
      for (const tile of tiles) {
        setProgress(`tile ${measurements.length + 1} of ${tiles.length}, ${REPEATS} decodes`)
        await new Promise((resolve) => setTimeout(resolve, 48))
        measurements.push(await measureTile(template, tile, origin, buildings))
      }

      setScenes(measurements.map((measurement) => measurement.scene))
      setSummary(summarise(measurements, buildings))
      setProgress(null)
      fitCamera()
    }

    run().catch((cause: unknown) => {
      setProgress(null)
      setError(cause instanceof Error ? cause.message : `${cause}`)
    })
  }, [buildings, fitCamera])

  const startPan = useCallback(() => {
    if (scenes.length === 0) return
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
    scenes,
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
            {scenes.map((tile) => (
              <Group
                key={tile.key}
                transform={[
                  { translateX: tile.offsetX },
                  { translateY: tile.offsetY },
                  { scale: tile.scale },
                ]}
              >
                {tile.pieces.map((piece) => (
                  <Path
                    key={piece.style}
                    path={piece.path}
                    color={piece.style === 'water' ? WATER : ACCENT}
                    opacity={OPACITY[piece.style]}
                    style={piece.style === 'water' ? 'fill' : 'stroke'}
                    strokeWidth={0}
                  />
                ))}
              </Group>
            ))}
          </Group>
        </Canvas>
      </GestureDetector>

      <View style={styles.hud} pointerEvents="box-none">
        <View style={styles.panel} pointerEvents="none">
          <Text style={styles.title}>
            {COLUMNS * ROWS} tiles at z{ZOOM}, {buildings ? 'with buildings' : 'no buildings'}
          </Text>
          {progress !== null ? <Text style={styles.muted}>{progress}</Text> : null}
          {error !== null ? <Text style={styles.error}>{error}</Text> : null}
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
            label={buildings ? 'buildings' : 'no buildings'}
            onPress={() => setBuildings((current) => !current)}
          />
          <Button label={`decode x${REPEATS}`} onPress={measure} />
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
      <Row label="per tile" value={summary.perTile.toFixed(1)} emphasis />
      <Row label="worst tile" value={summary.worst.toFixed(1)} />
      <Row label="fetch, excluded" value={summary.fetchMs.toFixed(0)} />
      <Row label="tiles" value={`${summary.tiles}, ${Math.round(summary.bytes / 1024)} KiB`} />
      <Row label="features" value={summary.features.toLocaleString()} />
      <Row label="path chars" value={summary.chars.toLocaleString()} />
      <Row label="road name" value={summary.sampleName ?? 'none'} />
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
  error: {
    color: '#FF8A8A',
    fontSize: 12,
  },
  value: {
    color: TEXT,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  strong: {
    color: ACCENT,
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
