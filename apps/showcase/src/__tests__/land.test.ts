import { describe, expect, test } from 'bun:test'
import { landPathFor, loadLand } from '../engine/land'
import type { GlobeView } from '../engine/projection'

const VIEW: GlobeView = { lambda0: 0, phi0: 0, cx: 200, cy: 400, radius: 150 }

describe('loadLand', () => {
  test('decodes rings of unit-sphere points', () => {
    const land = loadLand()

    expect(land.offsets.length).toBeGreaterThan(2)
    expect(land.offsets[0]).toBe(0)
    expect(land.offsets[land.offsets.length - 1]).toBe(land.xyz.length / 3)
    for (let vertex = 0; vertex < land.xyz.length; vertex += 3) {
      const radius = Math.hypot(land.xyz[vertex], land.xyz[vertex + 1], land.xyz[vertex + 2])
      expect(Math.abs(radius - 1)).toBeLessThan(1e-5)
    }
  })
})

describe('landPathFor', () => {
  const land = loadLand()

  test('breaks the rings into polylines that stay inside the disk', () => {
    const path = landPathFor(land, VIEW)
    const moves = path.match(/M/g) ?? []

    expect(moves.length).toBeGreaterThan(1)
    for (const [, x, y] of path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
      expect(Math.hypot(Number(x) - VIEW.cx, Number(y) - VIEW.cy)).toBeLessThan(VIEW.radius + 0.1)
    }
  })

  test('turns the globe, so the far side is a different coastline', () => {
    expect(landPathFor(land, VIEW)).not.toBe(landPathFor(land, { ...VIEW, lambda0: Math.PI }))
  })
})
