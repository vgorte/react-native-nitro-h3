import { describe, expect, test } from 'bun:test'
import type { CellBoundaries } from 'react-native-nitro-h3'
import {
  buildGlobeFrame,
  createGlobeFrame,
  type GlobeView,
  latLngToXyz,
  project,
  rotateToView,
  toGlobeCells,
  unproject,
} from '../globe'

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

describe('latLngToXyz', () => {
  test('puts the axes where the projection expects them', () => {
    expect(latLngToXyz(0, 0)).toEqual({ x: 1, y: 0, z: 0 })

    const east = latLngToXyz(0, 90)
    expect(east.x).toBeCloseTo(0, 12)
    expect(east.y).toBeCloseTo(1, 12)

    const pole = latLngToXyz(90, 40)
    expect(pole.z).toBeCloseTo(1, 12)
    expect(pole.x).toBeCloseTo(0, 12)
    expect(pole.y).toBeCloseTo(0, 12)
  })
})

describe('rotateToView', () => {
  test('turns the view centre toward the viewer', () => {
    const rotated = rotateToView(latLngToXyz(37, -122), view(37, -122))

    expect(rotated.x).toBeCloseTo(0, 12)
    expect(rotated.y).toBeCloseTo(0, 12)
    expect(rotated.z).toBeCloseTo(1, 12)
  })
})

describe('project', () => {
  test('draws the view centre in the middle of the disk', () => {
    const centre = project(20, 30, view(20, 30))

    expect(centre.x).toBeCloseTo(200, 9)
    expect(centre.y).toBeCloseTo(400, 9)
    expect(centre.visible).toBe(true)
  })

  test('keeps the pole at the top of the disk for phi0 = 0', () => {
    for (const lng of [-180, -75, 0, 44.5, 180]) {
      const pole = project(90, 17, view(0, lng))

      expect(pole.x).toBeCloseTo(200, 9)
      expect(pole.y).toBeCloseTo(250, 9)
    }
  })

  test('flips visibility at the limb', () => {
    expect(project(0, 89.99, view(0, 0)).visible).toBe(true)
    expect(project(0, 90.01, view(0, 0)).visible).toBe(false)

    expect(project(-69.99, 40, view(20, 40)).visible).toBe(true)
    expect(project(-70.01, 40, view(20, 40)).visible).toBe(false)
  })

  test('lands every point inside the disk', () => {
    const target = view(-12, 155)
    for (const [lat, lng] of [
      [90, 0],
      [-90, 0],
      [0, 180],
      [45, -60],
    ]) {
      const point = project(lat, lng, target)
      const distance = Math.hypot(point.x - target.cx, point.y - target.cy)

      expect(distance).toBeLessThanOrEqual(150 + 1e-9)
    }
  })
})

describe('unproject', () => {
  test('round trips the forward projection within 1e-9 degrees', () => {
    const views = [view(0, 0), view(37, -122), view(-33.9, 151.2), view(64, 179.5)]
    const points = [
      [0, 0],
      [10, 10],
      [-45, 30],
      [37, -122],
      [-33.9, 151.2],
      [64, 179.5],
      [80, -170],
    ]

    for (const target of views) {
      for (const [lat, lng] of points) {
        const forward = project(lat, lng, target)
        if (forward.depth < 0.05) continue
        const back = unproject(forward.x, forward.y, target)

        expect(back).toBeDefined()
        expect(back?.lat).toBeCloseTo(lat, 9)
        expect(back?.lng).toBeCloseTo(lng, 9)
      }
    }
  })

  test('answers undefined outside the disk', () => {
    const target = view(10, 20)

    expect(unproject(target.cx + 151, target.cy, target)).toBeUndefined()
    expect(unproject(target.cx, target.cy - 400, target)).toBeUndefined()
    expect(unproject(target.cx + 149, target.cy, target)).toBeDefined()
  })

  test('keeps the longitude in range at the edge of the disk', () => {
    const target = view(0, 179)
    const point = unproject(target.cx + 149, target.cy, target)

    expect(point?.lng).toBeGreaterThan(-180)
    expect(point?.lng).toBeLessThanOrEqual(180)
  })
})

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
