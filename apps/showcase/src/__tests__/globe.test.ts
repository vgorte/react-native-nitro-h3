import { describe, expect, test } from 'bun:test'
import type { CellBoundaries } from 'react-native-nitro-h3'
import { buildGlobeFrame, createGlobeFrame, toGlobeCells } from '../engine/globe'
import type { GlobeView } from '../engine/projection'

const STRIDE = 20
const DEG_TO_RAD = Math.PI / 180

function view(lat: number, lng: number): GlobeView {
  return {
    lambda0: lng * DEG_TO_RAD,
    phi0: lat * DEG_TO_RAD,
    cx: 200,
    cy: 400,
    radius: 150,
  }
}

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

/** Answers a small regular hexagon around a coordinate, a degree across. */
function hexagon(lat: number, lng: number): number[] {
  const pairs: number[] = []
  for (let vertex = 0; vertex < 6; vertex++) {
    const angle = (vertex / 6) * 2 * Math.PI
    pairs.push(lat + Math.sin(angle) * 0.5, lng + Math.cos(angle) * 0.5)
  }
  return pairs
}

describe('buildGlobeFrame', () => {
  const centres = new Float64Array([0, 0, 0, 180, 0, 60])
  const cells = toGlobeCells(
    boundaries([hexagon(0, 0), hexagon(0, 180), hexagon(0, 60)]),
    centres,
    new Uint8Array([0, 0, 1]),
  )

  test('drops the cells facing away from the viewer', () => {
    const frame = createGlobeFrame(cells, 2)
    const visible = buildGlobeFrame(cells, frame, view(0, 0))

    expect(visible).toBe(2)
    expect(frame.pointCounts[0]).toBe(6)
    expect(frame.pointCounts[1]).toBe(6)
  })

  test('fans every kept cell from its first vertex', () => {
    const frame = createGlobeFrame(cells, 2)
    buildGlobeFrame(cells, frame, view(0, 0))

    expect(frame.indexCounts[0]).toBe(12)
    expect(Array.from(frame.indices[0].slice(0, 12))).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5])
  })

  test('packs the second cell of a bucket after the first', () => {
    const wide = { ...cells, buckets: new Uint8Array([0, 0, 0]) }
    const frame = createGlobeFrame(wide, 1)
    const visible = buildGlobeFrame(wide, frame, view(0, 30))

    expect(visible).toBe(2)
    expect(frame.pointCounts[0]).toBe(12)
    expect(Array.from(frame.indices[0].slice(12, 24))).toEqual([
      6, 7, 8, 6, 8, 9, 6, 9, 10, 6, 10, 11,
    ])
  })

  test('projects the centre cell onto the middle of the disk', () => {
    const frame = createGlobeFrame(cells, 2)
    buildGlobeFrame(cells, frame, view(0, 0))

    for (let vertex = 0; vertex < 6; vertex++) {
      const x = frame.positions[0][vertex * 2]
      const y = frame.positions[0][vertex * 2 + 1]

      expect(Math.hypot(x - 200, y - 400)).toBeLessThan(3)
    }
  })

  test('resets the counts between frames', () => {
    const frame = createGlobeFrame(cells, 2)
    buildGlobeFrame(cells, frame, view(0, 0))
    const visible = buildGlobeFrame(cells, frame, view(0, 180))

    expect(visible).toBe(1)
    expect(frame.pointCounts[0]).toBe(6)
    expect(frame.pointCounts[1]).toBe(0)
    expect(frame.indexCounts[1]).toBe(0)
  })
})
