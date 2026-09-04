import { Skia } from '@shopify/react-native-skia'
import { useFonts } from 'expo-font'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { cellsToBoundaries, gridDisk, latLngToCell } from 'react-native-nitro-h3'
import { buildMesh, buildOutlinePath } from './engine/mesh'
import { projectCells } from './engine/projection'
import { resetWorstGap } from './render/BlockedReadout'
import { CellPictures, type CellScene, recordCellScene } from './render/CellPictures'
import { EngineCanvas } from './render/EngineCanvas'
import { type GlowImage, GlowLayer, renderGlow } from './render/GlowLayer'
import { type Camera, type CameraAnchor, screenToScene, useCamera } from './render/useCamera'
import { fontAssets } from './theme/fonts'
import { BUCKETS, colours } from './theme/tokens'

const BERLIN: CameraAnchor = { lat: 52.52, lng: 13.405 }
const RESOLUTION = 9
const DISK_K = 81
const CHUNK_SIZE = 10_000
const INSET = 0.08
const OUTLINE_EDGES = 3
const OUTLINE_LIMIT = 20_000

function buildScene(anchor: CameraAnchor): CellScene {
  const cells = gridDisk(latLngToCell(anchor.lat, anchor.lng, RESOLUTION), DISK_K)
  const projected = projectCells(cellsToBoundaries(cells), anchor)
  // the inset stands in for the outline above the ceiling
  const outlined = projected.cellCount <= OUTLINE_LIMIT
  const mesh = buildMesh(projected, {
    chunkSize: CHUNK_SIZE,
    buckets: BUCKETS,
    inset: outlined ? 0 : INSET,
  })
  const outline = outlined ? buildOutlinePath(projected, OUTLINE_EDGES) : null
  return recordCellScene(mesh, projected.bounds, outline)
}

/** Answers the scene rectangle the viewport covers at the camera's current values. */
function sceneViewport(camera: Camera, width: number, height: number) {
  const scale = camera.scale.value
  const origin = screenToScene(0, 0, {
    translateX: camera.translateX.value,
    translateY: camera.translateY.value,
    scale,
  })
  return Skia.XYWHRect(origin.x, origin.y, width / scale, height / scale)
}

export default function App() {
  const [fontsLoaded] = useFonts(fontAssets)
  const { width, height } = useWindowDimensions()
  const [glow, setGlow] = useState<GlowImage | null>(null)
  const cameraRef = useRef<Camera | null>(null)
  const sceneRef = useRef<CellScene | null>(null)

  const paintGlow = useCallback(
    (scene: CellScene) => {
      const camera = cameraRef.current
      if (camera === null) return
      setGlow(renderGlow(scene, sceneViewport(camera, width, height), camera.scale.value))
    },
    [width, height],
  )

  const onSettle = useCallback(() => {
    resetWorstGap()
    const scene = sceneRef.current
    if (scene !== null) paintGlow(scene)
  }, [paintGlow])

  const camera = useCamera({ anchor: BERLIN, onSettle })
  const scene = useMemo(() => buildScene(camera.anchor), [camera.anchor])
  const fitted = useRef(false)

  useEffect(() => {
    cameraRef.current = camera
    sceneRef.current = scene
  })

  useEffect(() => {
    // the fit follows the data, never a re-anchor's reprojection
    if (!fitted.current) {
      fitted.current = true
      camera.fit(scene.bounds, width, height)
    }
    // the build blocks the thread before the first frame, and is no run
    resetWorstGap()
    paintGlow(scene)
  }, [camera.fit, scene, width, height, paintGlow])

  // the ground colour already fills the window, so an unstyled first frame is worse than none
  if (!fontsLoaded) return <View style={styles.root} />

  return (
    <GestureHandlerRootView style={styles.root}>
      <EngineCanvas camera={camera}>
        <GlowLayer glow={glow} />
        <CellPictures scene={scene} />
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
