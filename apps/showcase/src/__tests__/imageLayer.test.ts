import { describe, expect, test } from 'bun:test'
import type { CellBoundaries } from 'react-native-nitro-h3'
import { ATLAS_CELL_CAP, coverage, MAX_K } from '../engine/atlas'
import {
  cornersOf,
  FRAME_PADDING,
  frameExtent,
  frameMatrix,
  type ImageFrame,
  imageFrameOf,
  projectPoints,
  sampleStride,
} from '../engine/imageLayer'
import { mercatorToLatLng, mercatorX, mercatorY, projectCells } from '../engine/projection'

const BERLIN_BOUNDS = {
  ne: [13.7612, 52.6755] as [number, number],
  sw: [13.0884, 52.3383] as [number, number],
}

const VIEWPORT = { width: 402, height: 874 }

// `getHexagonEdgeLengthAvgM` at the resolutions the act offers, so no package call is made here
const EDGE_M: Record<number, number> = { 7: 1220.6, 8: 461.4, 9: 174.4 }

describe('imageFrameOf', () => {
  test('keeps the viewport aspect and caps the pixel count', () => {
    const frame = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 3, 2_000_000, 0)

    expect(frame.width / frame.height).toBeCloseTo(402 / 874, 3)
    expect(frame.width * frame.height).toBeLessThanOrEqual(2_000_000)
    expect(frame.west).toBe(13.0884)
    expect(frame.north).toBeCloseTo(52.6755, 9)
  })

  test('draws at the full pixel ratio where the cap leaves room for it', () => {
    const frame = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 2, 4_000_000, 0)

    expect(frame.width).toBe(804)
    expect(frame.height).toBe(1748)
  })

  test('never answers a frame of no pixels, however low the cap', () => {
    const frame = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 3, 1)

    expect(frame.width).toBeGreaterThanOrEqual(1)
    expect(frame.height).toBeGreaterThanOrEqual(1)
  })

  test('reaches the padding past the viewport on every side, in ground and in pixels', () => {
    const plain = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 2, 40_000_000, 0)
    const padded = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 2, 40_000_000, 0.5)
    const span = BERLIN_BOUNDS.ne[0] - BERLIN_BOUNDS.sw[0]

    expect(padded.west).toBeCloseTo(BERLIN_BOUNDS.sw[0] - span / 2, 9)
    expect(padded.east).toBeCloseTo(BERLIN_BOUNDS.ne[0] + span / 2, 9)
    expect(padded.north).toBeGreaterThan(plain.north)
    expect(padded.south).toBeLessThan(plain.south)
    expect(padded.width).toBe(plain.width * 2)
    expect(padded.height).toBe(plain.height * 2)
  })

  test('grows the ground and the pixels together, so the image is drawn at the same scale', () => {
    const plain = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 2, 40_000_000, 0)
    const padded = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 2, 40_000_000, FRAME_PADDING)
    const across = (of: ImageFrame): number => of.width / (mercatorX(of.east) - mercatorX(of.west))
    const down = (of: ImageFrame): number => of.height / (mercatorY(of.north) - mercatorY(of.south))

    expect(across(padded)).toBeCloseTo(across(plain), 6)
    expect(down(padded)).toBeCloseTo(down(plain), 6)
  })

  test('holds the padded frame under the cap by shrinking it whole', () => {
    const padded = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 3, 4_000_000, FRAME_PADDING)

    expect(padded.width * padded.height).toBeLessThanOrEqual(4_000_000)
    expect(padded.width / padded.height).toBeCloseTo(402 / 874, 2)
  })
})

describe('frameExtent', () => {
  test('answers the corners of the frame and the coordinate in the middle of them', () => {
    const frame = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 2, 4_000_000, FRAME_PADDING)
    const extent = frameExtent(frame)

    expect(extent.bounds).toEqual([frame.west, frame.south, frame.east, frame.north])
    expect(extent.center[0]).toBeCloseTo((frame.west + frame.east) / 2, 9)
    expect(mercatorY(extent.center[1])).toBeCloseTo(
      (mercatorY(frame.north) + mercatorY(frame.south)) / 2,
      3,
    )
  })

  test('sizes a disk that stays under the cell cap at every resolution the act offers', () => {
    const frame = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 2, 4_000_000, FRAME_PADDING)

    for (const res of [7, 8, 9]) {
      const rings = coverage(frameExtent(frame), res, (of) => EDGE_M[of])
      expect(rings).toBeLessThanOrEqual(MAX_K)
      expect(3 * rings * (rings + 1) + 1).toBeLessThanOrEqual(ATLAS_CELL_CAP)
    }
  })
})

describe('frameMatrix and projectPoints', () => {
  test('puts the north-west corner at the origin and the south-east corner at the far pixel', () => {
    const frame = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 2, 4_000_000, 0)
    const out = new Float32Array(4)
    const drawn = projectPoints(Float64Array.from([52.6755, 13.0884, 52.3383, 13.7612]), frame, out)

    expect(drawn).toBe(2)
    expect(out[0]).toBeCloseTo(0, 3)
    expect(out[1]).toBeCloseTo(0, 3)
    expect(out[2]).toBeCloseTo(frame.width, 3)
    expect(out[3]).toBeCloseTo(frame.height, 3)
  })

  test('leaves a point outside the frame out of the count', () => {
    const frame = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 2, 4_000_000, 0)
    const out = new Float32Array(2)

    expect(projectPoints(Float64Array.from([53.5, 10.0]), frame, out)).toBe(0)
  })

  test('packs the points inside the frame from the front', () => {
    const frame = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 2, 4_000_000, 0)
    const out = new Float32Array(4)
    const drawn = projectPoints(
      Float64Array.from([53.5, 10.0, 52.6755, 13.0884, 52.3383, 13.7612]),
      frame,
      out,
    )

    expect(drawn).toBe(2)
    expect(out[0]).toBeCloseTo(0, 3)
    expect(out[2]).toBeCloseTo(frame.width, 3)
  })

  test('lands a cell drawn under the matrix on the pixel a point at its centre takes', () => {
    const frame = imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 2, 4_000_000, FRAME_PADDING)
    const anchor = { lat: 52.5, lng: 13.4 }
    const centres = [
      { lat: 52.62, lng: 13.2 },
      { lat: 52.42, lng: 13.65 },
    ]
    const projected = projectCells(squareCells(centres, 300), anchor)
    const [scaleX, scaleY, translateX, translateY] = frameMatrix(frame, anchor)

    const out = new Float32Array(4)
    projectPoints(
      Float64Array.from(centres.flatMap((centre) => [centre.lat, centre.lng])),
      frame,
      out,
    )

    for (const cell of centres.keys()) {
      const middle = centreOfCell(projected.points, cell * projected.stride, SQUARE_VERTICES)

      expect(middle.x * scaleX + translateX).toBeCloseTo(out[cell * 2], 2)
      expect(middle.y * scaleY + translateY).toBeCloseTo(out[cell * 2 + 1], 2)
    }
  })
})

describe('cornersOf', () => {
  test('answers top-left, top-right, bottom-right, bottom-left as lng,lat pairs', () => {
    const corners = cornersOf(imageFrameOf(BERLIN_BOUNDS, VIEWPORT, 2, 4_000_000, 0))

    expect(corners.map(([lng]) => lng)).toEqual([13.0884, 13.7612, 13.7612, 13.0884])
    for (const [corner, lat] of [52.6755, 52.6755, 52.3383, 52.3383].entries()) {
      expect(corners[corner][1]).toBeCloseTo(lat, 9)
    }
  })
})

describe('sampleStride', () => {
  test('draws everything under the cap and thins evenly above it', () => {
    expect(sampleStride(100_000, 1_000_000)).toBe(1)
    expect(sampleStride(1_000_000, 250_000)).toBe(4)
  })

  test('answers a stride of one for a set of nothing', () => {
    expect(sampleStride(0, 1_000_000)).toBe(1)
  })
})

const SQUARE_VERTICES = 4

/**
 * Builds boundaries whose cells are squares in Web Mercator, so the mean of a cell's vertices is
 * its centre exactly and the matrix can be pinned against a point at that centre.
 */
function squareCells(
  centres: readonly { lat: number; lng: number }[],
  half: number,
): CellBoundaries {
  const stride = SQUARE_VERTICES * 2
  const vertices = new Float64Array(centres.length * stride)
  const vertexCounts = new Uint8Array(centres.length).fill(SQUARE_VERTICES)
  for (const [cell, centre] of centres.entries()) {
    const x = mercatorX(centre.lng)
    const y = mercatorY(centre.lat)
    const corners = [
      [x - half, y + half],
      [x + half, y + half],
      [x + half, y - half],
      [x - half, y - half],
    ]
    for (const [vertex, [cornerX, cornerY]] of corners.entries()) {
      const at = mercatorToLatLng(cornerX, cornerY)
      vertices[cell * stride + vertex * 2] = at.lat
      vertices[cell * stride + vertex * 2 + 1] = at.lng
    }
  }
  return { stride, vertices, vertexCounts }
}

/** Answers the mean of a cell's projected vertices, which the square puts on its centre. */
function centreOfCell(points: Float32Array, base: number, count: number) {
  let x = 0
  let y = 0
  for (let vertex = 0; vertex < count; vertex++) {
    x += points[base + vertex * 2]
    y += points[base + vertex * 2 + 1]
  }
  return { x: x / count, y: y / count }
}
