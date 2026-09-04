import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { latLngToCell } from 'react-native-nitro-h3'
import { boundariesOf, diskAround } from '../engine/cells'
import { buildMesh, buildOutlinePath } from '../engine/mesh'
import { projectCells } from '../engine/projection'
import { formatCount, formatMs } from '../engine/stats'
import {
  classesForZoom,
  createTileSource,
  type StyleClass,
  TILE_MIN_ZOOM,
  type TileId,
  visibleTiles,
} from '../engine/tiles'
import { resetWorstGap } from '../render/BlockedReadout'
import { CellPictures, type CellScene, recordCellScene } from '../render/CellPictures'
import { EngineCanvas } from '../render/EngineCanvas'
import { type GlowImage, GlowLayer, renderGlow } from '../render/GlowLayer'
import { Attribution } from '../render/hud/Attribution'
import { Metric } from '../render/hud/Metric'
import { Panel } from '../render/hud/Panel'
import { Row } from '../render/hud/Row'
import { Slider } from '../render/hud/Slider'
import { TileLayer } from '../render/TileLayer'
import { type Camera, type CameraAnchor, sceneViewport, useCamera } from '../render/useCamera'
import { BUCKETS, colours } from '../theme/tokens'
import type { ActProps } from './types'

const BERLIN: CameraAnchor = { lat: 52.52, lng: 13.405 }
const RESOLUTION = 9
const MIN_K = 1
const MAX_K = 81
const CHUNK_SIZE = 10_000
const INSET = 0.08
const OUTLINE_EDGES = 3
const OUTLINE_LIMIT = 20_000
const SLIDER_WIDTH = 180

interface PlanetScene {
  cells: CellScene
  cellCount: number
  boundariesMs: number
}

function buildScene(anchor: CameraAnchor, k: number): PlanetScene {
  const disk = diskAround(latLngToCell(anchor.lat, anchor.lng, RESOLUTION), k)
  const boundaries = boundariesOf(disk.value)
  const projected = projectCells(boundaries.value, anchor)
  // the inset stands in for the outline above the ceiling
  const outlined = projected.cellCount <= OUTLINE_LIMIT
  const mesh = buildMesh(projected, {
    chunkSize: CHUNK_SIZE,
    buckets: BUCKETS,
    inset: outlined ? 0 : INSET,
  })
  const outline = outlined ? buildOutlinePath(projected, OUTLINE_EDGES) : null
  return {
    cells: recordCellScene(mesh, projected.bounds, outline),
    cellCount: projected.cellCount,
    boundariesMs: boundaries.ms,
  }
}

/** Draws the city-mode disk over the basemap, with the disk radius under one slider. */
export function Planet({ active }: ActProps) {
  const { width, height } = useWindowDimensions()
  const [glow, setGlow] = useState<GlowImage | null>(null)
  const [tiles, setTiles] = useState<TileId[]>([])
  const [classes, setClasses] = useState<StyleClass[]>([])
  const [radius, setRadius] = useState(MAX_K)
  const [builtRadius, setBuiltRadius] = useState(MAX_K)
  const cameraRef = useRef<Camera | null>(null)
  const sceneRef = useRef<CellScene | null>(null)
  // a fresh array draws the tiles that arrived since the last render
  const source = useMemo(() => createTileSource(() => setTiles((current) => [...current])), [])

  const refreshTiles = useCallback(() => {
    const camera = cameraRef.current
    if (camera === null || !active) return
    const centre = camera.centreOf(width, height)
    const zoom = camera.zoomAt(centre.lat)
    if (zoom < TILE_MIN_ZOOM) {
      setTiles([])
      return
    }
    const visible = visibleTiles(centre, zoom, width, height)
    setTiles(visible)
    setClasses(classesForZoom(zoom))
    for (const tile of visible) source.request(tile)
  }, [active, width, height, source])

  const paintGlow = useCallback(
    (scene: CellScene) => {
      const camera = cameraRef.current
      if (camera === null) return
      const values = {
        translateX: camera.translateX.value,
        translateY: camera.translateY.value,
        scale: camera.scale.value,
      }
      setGlow(renderGlow(scene, sceneViewport(width, height, values), values.scale))
    },
    [width, height],
  )

  const onSettle = useCallback(() => {
    const scene = sceneRef.current
    if (scene === null || !active) return
    paintGlow(scene)
    refreshTiles()
    // resetting last keeps the glow out of the run
    resetWorstGap()
  }, [active, paintGlow, refreshTiles])

  const camera = useCamera({ anchor: BERLIN, onSettle })
  const scene = useMemo(() => buildScene(camera.anchor, builtRadius), [camera.anchor, builtRadius])
  const fitted = useRef(false)

  useEffect(() => {
    cameraRef.current = camera
    sceneRef.current = scene.cells
  })

  useEffect(() => {
    if (!active) return
    // the fit follows the data, never a re-anchor's reprojection
    if (!fitted.current) {
      fitted.current = true
      // the camera reads back late, so the fit's settle picks the tiles
      camera.fit(scene.cells.bounds, width, height)
    } else {
      refreshTiles()
    }
    // the mount cost lands before the first frame, and is no run
    paintGlow(scene.cells)
    resetWorstGap()
  }, [active, camera.fit, scene, width, height, paintGlow, refreshTiles])

  // an act off screen keeps its mesh and runs no loop
  if (!active) return <View style={styles.root} />

  return (
    <View style={styles.root}>
      <EngineCanvas camera={camera}>
        <TileLayer source={source} tiles={tiles} classes={classes} anchor={camera.anchor} />
        <GlowLayer glow={glow} />
        <CellPictures scene={scene.cells} />
      </EngineCanvas>
      <View style={styles.panel}>
        <Panel>
          <Metric value={formatCount(scene.cellCount)} caption="cells drawn" />
          <Row label="resolution" value={`${RESOLUTION}`} />
          <Row label="boundaries" value={formatMs(scene.boundariesMs)} call="cellsToBoundaries" />
          <Row label="disk radius" value={`${radius}`} tone="muted" />
          <Slider
            min={MIN_K}
            max={MAX_K}
            value={radius}
            width={SLIDER_WIDTH}
            onChange={setRadius}
            onSettle={setBuiltRadius}
          />
        </Panel>
      </View>
      <Attribution text={source.attribution} />
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
    top: 104,
    right: 16,
  },
})
