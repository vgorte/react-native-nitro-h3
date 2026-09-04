import { Skia, type SkPath, type SkPoint } from '@shopify/react-native-skia'
import { getResolution, type LatLng } from 'react-native-nitro-h3'
import { boundariesOf } from '../engine/cells'
import { bucketOfResolution, type Tree } from '../engine/fractal'
import { buildMesh } from '../engine/mesh'
import { mercatorX, mercatorY, type ProjectedCells, projectCells } from '../engine/projection'
import { BUCKETS } from '../theme/tokens'
import { type CellScene, recordCellScene } from './CellPictures'
import type { CameraAnchor } from './useCamera'

const CHUNK_SIZE = 10_000

/** Holds one recorded cell set: what is drawn, the geometry behind it and what H3 took. */
export interface Recorded {
  scene: CellScene
  /** The projection the pictures were recorded from, which an outline is drawn from too. */
  projected: ProjectedCells
  boundariesMs: number
}

/** Holds a built scene: the fills of both layers, the grid over them and what the build cost. */
export interface Scene {
  cells: CellScene
  /** The split cells under the leaves, absent until the first split has merged. */
  under: CellScene | null
  outline: SkPath
  leafCount: number
  /** What `cellsToBoundaries` took over both layers of the rebuild. */
  boundariesMs: number
  /** Everything the rebuild took: the boundaries, the projection, the mesh and the recording. */
  buildMs: number
}

/** Answers the ramp bucket of every cell of a set. */
export function bucketsOf(cells: BigUint64Array): Uint8Array {
  const buckets = new Uint8Array(cells.length)
  for (let cell = 0; cell < cells.length; cell++) {
    buckets[cell] = bucketOfResolution(getResolution(cells[cell]), BUCKETS)
  }
  return buckets
}

/** Orders split cells shallowest first, so a deeper one paints over the parent it came from. */
export function inDepthOrder(cells: bigint[]): BigUint64Array {
  return BigUint64Array.from(
    [...cells].sort((left, right) => getResolution(left) - getResolution(right)),
  )
}

/** Answers the scene position of a coordinate, the inverse of `sceneToLatLng`. */
export function sceneOf(at: LatLng, anchor: CameraAnchor): { x: number; y: number } {
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
export function outlinePath(projected: ProjectedCells): SkPath {
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

/** Projects a cell set into the scene's metre frame and records its fills as pictures. */
export function record(cells: BigUint64Array, buckets: Uint8Array, anchor: CameraAnchor): Recorded {
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
    projected,
    boundariesMs: boundaries.ms,
  }
}

/** Projects one cell on its own, for the outline it leaves and the span the camera zooms to. */
export function shapeOf(cell: bigint, anchor: CameraAnchor): ProjectedCells {
  return projectCells(boundariesOf(new BigUint64Array([cell])).value, anchor)
}

/**
 * Builds the scene of one tree: the split cells first, then the leaves and their grid.
 *
 * Only the leaves carry an outline. The layer under them fills the corners the children of a split
 * leave open, and a grid over it would draw a second tiling into those corners.
 */
export function buildScene(tree: Tree, anchor: CameraAnchor): Scene {
  const started = performance.now()
  const under =
    tree.ancestors.length === 0 ? null : record(tree.ancestors, bucketsOf(tree.ancestors), anchor)
  const leaves = record(tree.leaves.cells, tree.leaves.buckets, anchor)
  return {
    cells: leaves.scene,
    under: under === null ? null : under.scene,
    outline: outlinePath(leaves.projected),
    leafCount: tree.leaves.cells.length,
    boundariesMs: leaves.boundariesMs + (under?.boundariesMs ?? 0),
    buildMs: performance.now() - started,
  }
}
