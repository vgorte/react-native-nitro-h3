import { type SkPoint, Vertices } from '@shopify/react-native-skia'
import { useFonts } from 'expo-font'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { cellsToBoundaries, gridDisk, latLngToCell } from 'react-native-nitro-h3'
import { buildMesh } from './engine/mesh'
import { type Bounds, projectCells } from './engine/projection'
import { resetWorstGap } from './render/BlockedReadout'
import { EngineCanvas } from './render/EngineCanvas'
import { type CameraAnchor, useCamera } from './render/useCamera'
import { fontAssets } from './theme/fonts'
import { BUCKETS, colours, rampColours } from './theme/tokens'

const BERLIN: CameraAnchor = { lat: 52.52, lng: 13.405 }
const RESOLUTION = 9
const DISK_K = 82
const CHUNK_SIZE = 10_000
const INSET = 0.08

/** Holds one drawable batch of the scene, ready for a Skia vertex draw. */
interface Batch {
  key: string
  points: SkPoint[]
  indices: number[]
  colour: string
}

interface Scene {
  batches: Batch[]
  bounds: Bounds
}

function buildScene(anchor: CameraAnchor): Scene {
  const cells = gridDisk(latLngToCell(anchor.lat, anchor.lng, RESOLUTION), DISK_K)
  const projected = projectCells(cellsToBoundaries(cells), anchor)
  const mesh = buildMesh(projected, { chunkSize: CHUNK_SIZE, buckets: BUCKETS, inset: INSET })
  const palette = rampColours(BUCKETS)

  const batches = mesh.groups.map((group) => {
    const points = new Array<SkPoint>(group.positions.length / 2)
    for (let point = 0; point < points.length; point++) {
      points[point] = { x: group.positions[point * 2], y: group.positions[point * 2 + 1] }
    }
    return {
      key: `${group.chunk}-${group.bucket}`,
      points,
      indices: Array.from(group.indices),
      colour: palette[group.bucket],
    }
  })

  return { batches, bounds: projected.bounds }
}

export default function App() {
  const [fontsLoaded] = useFonts(fontAssets)
  const { width, height } = useWindowDimensions()
  // the disk is fixed, so a settle only starts the gap count over
  const onSettle = useCallback(() => resetWorstGap(), [])
  const camera = useCamera({ anchor: BERLIN, onSettle })
  const scene = useMemo(() => buildScene(camera.anchor), [camera.anchor])
  const fitted = useRef(false)

  useEffect(() => {
    // the fit follows the data, never a re-anchor's reprojection
    if (!fitted.current) {
      fitted.current = true
      camera.fit(scene.bounds, width, height)
    }
    // the build blocks the thread before the first frame, and is no run
    resetWorstGap()
  }, [camera.fit, scene, width, height])

  // the ground colour already fills the window, so an unstyled first frame is worse than none
  if (!fontsLoaded) return <View style={styles.root} />

  return (
    <GestureHandlerRootView style={styles.root}>
      <EngineCanvas camera={camera}>
        {scene.batches.map((batch) => (
          <Vertices
            key={batch.key}
            mode="triangles"
            vertices={batch.points}
            indices={batch.indices}
            color={batch.colour}
          />
        ))}
      </EngineCanvas>
      <StatusBar style="light" />
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colours.ground,
  },
})
