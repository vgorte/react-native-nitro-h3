import { describe, expect, test } from 'bun:test'
import type { CellBoundaries } from 'react-native-nitro-h3'
import {
  cullCells,
  DEG_TO_RAD,
  type GlobeView,
  latLngToXyz,
  mercatorToLatLng,
  mercatorX,
  mercatorY,
  metresPerPixel,
  type ProjectedCells,
  project,
  projectCells,
  projectCellsGlobeLocal,
  radiusForResolution,
  resolutionForZoom,
  rotateToView,
  unproject,
  zoomForMetresPerPixel,
} from '../engine/projection'

const STRIDE = 20

// the H3 average edge lengths of the resolutions the Planet act uses, in metres
const EDGE_M = [
  1281256, 483056, 182513, 68979, 26072, 9854, 3725, 1406, 531, 201, 75.9, 28.7, 10.8, 4.1, 1.5,
  0.6,
]
const edgeLengthM = (res: number): number => EDGE_M[res]

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

describe('projectCells', () => {
  test('puts the centre at the origin and grows y downward', () => {
    const projected = projectCells(boundaries([[0, 0, 1, 0, -1, 0]]), CENTRE)

    expect(projected.points[0]).toBeCloseTo(0, 2)
    expect(projected.points[1]).toBeCloseTo(0, 2)
    expect(projected.points[2]).toBe(0)
    expect(projected.points[3]).toBeLessThan(0)
    expect(projected.points[5]).toBeGreaterThan(0)
  })

  test('projects a degree of longitude to the Web Mercator metre', () => {
    const projected = projectCells(boundaries([[0, 1, 0, 0, 0, -1]]), CENTRE)

    expect(projected.points[0]).toBeCloseTo((6378137 * Math.PI) / 180, 2)
    expect(projected.bounds.maxX).toBeCloseTo((6378137 * Math.PI) / 180, 2)
    expect(projected.bounds.minX).toBeCloseTo((-6378137 * Math.PI) / 180, 2)
  })

  test('leaves the padding slots of a cell untouched', () => {
    const projected = projectCells(boundaries([polygon(6, 0, 0)]), CENTRE)

    expect(projected.vertexCounts[0]).toBe(6)
    expect(projected.points.slice(12, 20)).toEqual(new Float32Array(8))
  })
})

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

describe('mercator', () => {
  test('round trips a coordinate within 1e-9 degrees', () => {
    const point = { lat: 52.52, lng: 13.405 }
    const back = mercatorToLatLng(mercatorX(point.lng), mercatorY(point.lat))

    expect(Math.abs(back.lat - point.lat)).toBeLessThan(1e-9)
    expect(Math.abs(back.lng - point.lng)).toBeLessThan(1e-9)
  })
})

describe('resolutionForZoom', () => {
  test('answers a resolution whose cell is nearest 30 px across', () => {
    const res = resolutionForZoom(14, 52.52, edgeLengthM)
    const across = (2 * EDGE_M[res]) / metresPerPixel(14, 52.52)

    expect(across).toBeGreaterThan(15)
    expect(across).toBeLessThan(60)
  })

  test('grows monotonically with zoom', () => {
    let previous = -1
    for (let zoom = 1; zoom <= 18; zoom++) {
      const res = resolutionForZoom(zoom, 0, edgeLengthM)
      expect(res).toBeGreaterThanOrEqual(previous)
      previous = res
    }
  })
})

describe('cullCells', () => {
  const rect = { minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5 }

  /** Lays out square cells of side `1` centred on each pair, in the padded layout. */
  function squares(centres: number[][]): ProjectedCells {
    const points = new Float32Array(centres.length * STRIDE)
    const vertexCounts = new Uint8Array(centres.length)
    centres.forEach(([x, y], cell) => {
      vertexCounts[cell] = 4
      points.set(
        [x - 0.5, y - 0.5, x + 0.5, y - 0.5, x + 0.5, y + 0.5, x - 0.5, y + 0.5],
        cell * STRIDE,
      )
    })
    return {
      stride: STRIDE,
      points,
      vertexCounts,
      cellCount: centres.length,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    }
  }

  test('answers the input when every cell touches the rectangle', () => {
    const projected = squares([[0, 0]])

    expect(cullCells(projected, rect)).toBe(projected)
  })

  test('drops the cells outside and packs the rest', () => {
    const culled = cullCells(
      squares([
        [0, 0],
        [8, 0],
        [1, 1],
      ]),
      rect,
    )

    expect(culled.cellCount).toBe(2)
    expect(Array.from(culled.vertexCounts)).toEqual([4, 4])
    expect(culled.points[0]).toBeCloseTo(-0.5, 5)
    expect(culled.points[STRIDE]).toBeCloseTo(0.5, 5)
    expect(culled.bounds).toEqual({ minX: -0.5, minY: -0.5, maxX: 1.5, maxY: 1.5 })
  })

  test('answers where every kept cell came from', () => {
    const sources = new Uint32Array(3)
    const culled = cullCells(
      squares([
        [0, 0],
        [8, 0],
        [1, 1],
      ]),
      rect,
      sources,
    )

    expect(culled.cellCount).toBe(2)
    expect(Array.from(sources.slice(0, 2))).toEqual([0, 2])
  })

  test('answers an empty set when nothing touches the rectangle', () => {
    const culled = cullCells(squares([[8, 8]]), rect)

    expect(culled.cellCount).toBe(0)
    expect(culled.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })
})

describe('radiusForResolution', () => {
  test('answers the radius the ladder first asks for a resolution at', () => {
    const radius = radiusForResolution(3, edgeLengthM)

    expect(resolutionForZoom(zoomForMetresPerPixel(6378137 / radius, 0), 0, edgeLengthM)).toBe(3)
    expect(
      resolutionForZoom(zoomForMetresPerPixel(6378137 / (radius * 0.99), 0), 0, edgeLengthM),
    ).toBe(2)
  })

  test('grows with the resolution it is asked for', () => {
    let previous = 0
    for (let res = 1; res <= 9; res++) {
      const radius = radiusForResolution(res, edgeLengthM)
      expect(radius).toBeGreaterThan(previous)
      previous = radius
    }
  })
})

describe('projectCellsGlobeLocal', () => {
  const anchor = { lat: 52.52, lng: 13.4 }

  function cityView(radius: number): GlobeView {
    return {
      lambda0: anchor.lng * DEG_TO_RAD,
      phi0: anchor.lat * DEG_TO_RAD,
      cx: 200,
      cy: 400,
      radius,
    }
  }

  test('answers the direct projection measured from the anchor', () => {
    const at = cityView(2_000_000)
    const cell = [
      anchor.lat + 0.2,
      anchor.lng,
      anchor.lat,
      anchor.lng + 0.2,
      anchor.lat - 0.2,
      anchor.lng,
    ]
    const origin = project(anchor.lat, anchor.lng, at)
    const projected = projectCellsGlobeLocal(boundaries([cell]), at, anchor)

    for (let vertex = 0; vertex < 3; vertex++) {
      const direct = project(cell[vertex * 2], cell[vertex * 2 + 1], at)
      expect(projected.points[vertex * 2]).toBeCloseTo(direct.x - origin.x, 2)
      expect(projected.points[vertex * 2 + 1]).toBeCloseTo(direct.y - origin.y, 2)
    }
  })

  test('answers NaN for a vertex on the far side and for the padding', () => {
    const projected = projectCellsGlobeLocal(
      boundaries([[anchor.lat, anchor.lng, -anchor.lat, anchor.lng + 180, anchor.lat, anchor.lng]]),
      cityView(2_000_000),
      anchor,
    )

    expect(projected.points[0]).toBeCloseTo(0, 6)
    expect(projected.points[2]).toBeNaN()
    expect(projected.points[3]).toBeNaN()
    expect(projected.points[6]).toBeNaN()
  })

  test('keeps a metre apart at the resolution 15 scale', () => {
    const metreInDegrees = (1 / 6378137) * (180 / Math.PI)
    const projected = projectCellsGlobeLocal(
      boundaries([
        [anchor.lat, anchor.lng, anchor.lat + metreInDegrees, anchor.lng, anchor.lat, anchor.lng],
      ]),
      cityView(5e7),
      anchor,
    )

    expect(Math.abs(projected.points[3] - projected.points[1])).toBeGreaterThanOrEqual(0.5)
  })

  test('bounds the cells it kept', () => {
    const at = cityView(2_000_000)
    const projected = projectCellsGlobeLocal(
      boundaries([polygon(6, anchor.lat, anchor.lng)]),
      at,
      anchor,
    )

    expect(projected.cellCount).toBe(1)
    expect(projected.bounds.minX).toBeLessThan(0)
    expect(projected.bounds.maxX).toBeGreaterThan(0)
    expect(projected.bounds.maxY).toBeGreaterThan(projected.bounds.minY)
  })
})
