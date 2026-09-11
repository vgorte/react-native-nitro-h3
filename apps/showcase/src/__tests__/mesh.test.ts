import { describe, expect, test } from 'bun:test'
import type { CellBoundaries } from 'react-native-nitro-h3'
import { bucketForDistance, buildMesh, buildOutlinePath, PATCH_RINGS } from '../engine/mesh'
import { projectCells } from '../engine/projection'

const STRIDE = 20

/** Lays out hand-written cells in the padded layout `cellsToBoundaries` answers. */
function boundaries(cells: number[][]): CellBoundaries {
  const vertices = new Float64Array(cells.length * STRIDE).fill(Number.NaN)
  const vertexCounts = new Uint8Array(cells.length)
  cells.forEach((pairs, cell) => {
    vertexCounts[cell] = pairs.length / 2
    vertices.set(pairs, cell * STRIDE)
  })
  return { stride: STRIDE, vertices, vertexCounts }
}

/** Answers a regular polygon of `count` vertices around a coordinate, one degree across. */
function polygon(count: number, lat: number, lng: number): number[] {
  const pairs: number[] = []
  for (let vertex = 0; vertex < count; vertex++) {
    const angle = (vertex / count) * 2 * Math.PI
    pairs.push(lat + Math.sin(angle), lng + Math.cos(angle))
  }
  return pairs
}

const CENTRE = { lat: 0, lng: 0 }
const FULL = { chunkSize: 10_000, buckets: 16, inset: 0 }

describe('buildMesh', () => {
  test('fans a hexagon into four triangles from its first vertex', () => {
    const mesh = buildMesh(projectCells(boundaries([polygon(6, 0, 0)]), CENTRE), FULL)

    expect(mesh.groups).toHaveLength(1)
    expect(mesh.groups[0].positions).toHaveLength(12)
    expect(Array.from(mesh.groups[0].indices)).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5])
    expect(mesh.pointCount).toBe(6)
    expect(mesh.indexCount).toBe(12)
  })

  test('fans a pentagon into three triangles', () => {
    const mesh = buildMesh(projectCells(boundaries([polygon(5, 0, 0)]), CENTRE), FULL)

    expect(mesh.groups[0].positions).toHaveLength(10)
    expect(Array.from(mesh.groups[0].indices)).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4])
  })

  test('offsets the indices of a second cell in the same bucket', () => {
    const cells = boundaries([polygon(6, 0, 0), polygon(5, 0, 0)])
    const mesh = buildMesh(projectCells(cells, CENTRE), { ...FULL, buckets: 1 })

    expect(mesh.groups).toHaveLength(1)
    expect(Array.from(mesh.groups[0].indices.slice(12))).toEqual([6, 7, 8, 6, 8, 9, 6, 9, 10])
    expect(mesh.pointCount).toBe(11)
  })

  test('splits cells across chunks and buckets', () => {
    const cells = boundaries(Array.from({ length: 12 }, () => polygon(6, 0, 0)))
    const mesh = buildMesh(projectCells(cells, CENTRE), { chunkSize: 4, buckets: 2, inset: 0 })

    expect(mesh.chunkCount).toBe(3)
    expect(mesh.groups).toHaveLength(6)
    expect(mesh.groups.map((group) => group.cellCount)).toEqual([2, 2, 2, 2, 2, 2])
    expect(mesh.groups.map((group) => group.chunk)).toEqual([0, 0, 1, 1, 2, 2])
    expect(mesh.groups.map((group) => group.bucket)).toEqual([0, 1, 0, 1, 0, 1])
  })

  test('keeps every batch addressable by a 16-bit index', () => {
    const cells = boundaries(Array.from({ length: 20_000 }, () => polygon(6, 0, 0)))
    const mesh = buildMesh(projectCells(cells, CENTRE), FULL)

    expect(mesh.groups).toHaveLength(32)
    for (const group of mesh.groups) {
      const points = group.positions.length / 2
      let highest = 0
      for (const index of group.indices) highest = Math.max(highest, index)
      expect(points).toBeLessThanOrEqual(65_535)
      expect(highest).toBeLessThan(points)
    }
  })

  test('shrinks every vertex toward the centre of its cell', () => {
    const cells = projectCells(boundaries([polygon(6, 0, 0)]), CENTRE)
    const full = buildMesh(cells, FULL).groups[0].positions
    const inset = buildMesh(cells, { ...FULL, inset: 0.08 }).groups[0].positions

    let originX = 0
    let originY = 0
    for (let vertex = 0; vertex < 6; vertex++) {
      originX += full[vertex * 2] / 6
      originY += full[vertex * 2 + 1] / 6
    }
    for (let vertex = 0; vertex < 6; vertex++) {
      expect(inset[vertex * 2]).toBeCloseTo(originX + (full[vertex * 2] - originX) * 0.92, 2)
      expect(inset[vertex * 2 + 1]).toBeCloseTo(
        originY + (full[vertex * 2 + 1] - originY) * 0.92,
        2,
      )
    }
  })
})

describe('buildOutlinePath', () => {
  test('draws three edges of every cell as one polyline', () => {
    const cells = projectCells(boundaries([polygon(6, 0, 0), polygon(6, 0, 0)]), CENTRE)
    const path = buildOutlinePath(cells, 3)

    expect(path.match(/M/g)).toHaveLength(2)
    expect(path.match(/L/g)).toHaveLength(6)
  })

  test('stops at the last vertex of a cell with fewer edges', () => {
    const cells = projectCells(boundaries([[0, 0, 1, 0, 1, 1]]), CENTRE)

    expect(buildOutlinePath(cells, 3).match(/L/g)).toHaveLength(2)
  })
})

describe('bucketForDistance', () => {
  test('puts the patch centre at the brightest step and the last ring at the darkest', () => {
    expect(bucketForDistance(0, 16)).toBe(15)
    expect(bucketForDistance(PATCH_RINGS, 16)).toBe(0)
  })

  test('gives every ring of the patch its own step', () => {
    const steps = []
    for (let ring = 0; ring <= PATCH_RINGS; ring++) steps.push(bucketForDistance(ring, 16))

    expect(steps).toEqual([15, 14, 12, 11, 9, 8, 6, 5, 3, 2, 0])
    expect(new Set(steps).size).toBe(PATCH_RINGS + 1)
  })

  test('answers the darkest step outside the patch and for an unknown distance', () => {
    expect(bucketForDistance(PATCH_RINGS + 1, 16)).toBe(0)
    expect(bucketForDistance(-1, 16)).toBe(0)
  })
})
