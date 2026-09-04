import { describe, expect, test } from 'bun:test'
import type { MeshBuild, MeshGroup } from '../engine/mesh'
import { bucketBatches } from '../render/pictures'

function group(bucket: number, chunk: number, points: number): MeshGroup {
  return {
    bucket,
    chunk,
    cellCount: points / 6,
    positions: new Float32Array(points * 2),
    indices: new Uint16Array((points / 6) * 12),
  }
}

describe('bucketBatches', () => {
  test('answers the batches of one bucket across every chunk', () => {
    const mesh: MeshBuild = {
      groups: [group(0, 0, 6), group(1, 0, 6), group(0, 1, 12)],
      chunkCount: 2,
      pointCount: 24,
      indexCount: 48,
    }

    const batches = bucketBatches(mesh, 0)

    expect(batches).toHaveLength(2)
    expect(batches.map((batch) => batch.chunk)).toEqual([0, 1])
  })

  test('keeps every batch inside the 16-bit index range', () => {
    const mesh: MeshBuild = {
      groups: [group(0, 0, 60_000)],
      chunkCount: 1,
      pointCount: 60_000,
      indexCount: 0,
    }

    for (const batch of bucketBatches(mesh, 0)) {
      expect(batch.positions.length / 2).toBeLessThanOrEqual(65_535)
    }
  })

  test('answers an empty list for a bucket no group carries', () => {
    const mesh: MeshBuild = {
      groups: [group(0, 0, 6), group(2, 0, 6)],
      chunkCount: 1,
      pointCount: 12,
      indexCount: 24,
    }

    expect(bucketBatches(mesh, 1)).toEqual([])
  })
})
