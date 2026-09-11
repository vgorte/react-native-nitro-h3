import { describe, expect, test } from 'bun:test'
import { cellToLatLng, latLngToCell } from 'h3-js'
import { LAT_PER_PV, LAT0, LNG_PER_PU, LNG0 } from './anchor'
import { cellAt, Q_COUNT, Q_MIN, R_COUNT, R_MIN } from './cells.generated'
import { centerOf, type Point, RES, SIZES } from './geometry'
import { clampToTable } from './readout'
import { calibrate, SCENES } from './scene'

const Q_MAX = Q_MIN + Q_COUNT - 1
const R_MAX = R_MIN + R_COUNT - 1

/** The reference stage boxes the hero is designed for, widest and narrowest included. */
const BOXES: Point[] = [
  [1440, 810],
  [430, 800],
  [2560, 1080],
  [3440, 1440],
]

/** The scan runs well past the reachable range, and a test asserts it is never the binding edge. */
const SCAN_Q = 60
const SCAN_R = 120

/** Returns the axial cells whose centre lies inside the pointer clamp of the given stage boxes. */
function reachable(boxes: readonly Point[]): { q: number; r: number }[] {
  const s = SIZES[RES]
  const cells = new Map<string, { q: number; r: number }>()
  for (const [W, H] of boxes) {
    for (const scene of Object.values(SCENES)) {
      const cal = calibrate(scene, W, H)
      for (let q = -SCAN_Q; q <= SCAN_Q; q++) {
        for (let r = -SCAN_R; r <= SCAN_R; r++) {
          const centre = centerOf(q, r, s)
          if (centre[0] < cal.clampU[0] || centre[0] > cal.clampU[1]) continue
          if (centre[1] < cal.clampV[0] || centre[1] > cal.clampV[1]) continue
          cells.set(`${q},${r}`, { q, r })
        }
      }
    }
  }
  return [...cells.values()]
}

describe('cells.generated', () => {
  test('every entry matches the index and centre h3-js computes for its plane point', () => {
    const s = SIZES[RES]
    const round = (value: number): number => Math.round(value * 1e4) / 1e4
    const wrong: string[] = []
    for (let q = Q_MIN; q <= Q_MAX; q++) {
      for (let r = R_MIN; r <= R_MAX; r++) {
        const centre = centerOf(q, r, s)
        const lat = LAT0 - centre[1] * LAT_PER_PV
        const lng = LNG0 + centre[0] * LNG_PER_PU
        const id = latLngToCell(lat, lng, RES).toLowerCase()
        const [cellLat, cellLng] = cellToLatLng(id)
        const entry = cellAt(q, r)
        if (!entry) {
          wrong.push(`${q},${r}: no entry`)
          continue
        }
        if (entry.id !== id) wrong.push(`${q},${r}: ${entry.id} is not ${id}`)
        if (entry.lat !== round(cellLat)) wrong.push(`${q},${r}: lat ${entry.lat}`)
        if (entry.lng !== round(cellLng)) wrong.push(`${q},${r}: lng ${entry.lng}`)
      }
    }
    expect(wrong).toEqual([])
  })

  test('the table holds every reachable cell with two cells to spare on each side', () => {
    const cells = reachable(BOXES)
    expect(cells.length).toBeGreaterThan(0)
    for (const { q, r } of cells) {
      expect(Math.abs(q)).toBeLessThan(SCAN_Q)
      expect(Math.abs(r)).toBeLessThan(SCAN_R)
      expect(q).toBeGreaterThanOrEqual(Q_MIN + 2)
      expect(q).toBeLessThanOrEqual(Q_MAX - 2)
      expect(r).toBeGreaterThanOrEqual(R_MIN + 2)
      expect(r).toBeLessThanOrEqual(R_MAX - 2)
    }
  })

  test('a cell outside the table has no entry, and the clamp brings it back inside', () => {
    expect(cellAt(Q_MIN - 1, 0)).toBeUndefined()
    expect(cellAt(Q_MAX + 1, 0)).toBeUndefined()
    expect(cellAt(0, R_MIN - 1)).toBeUndefined()
    expect(cellAt(0, R_MAX + 1)).toBeUndefined()
    expect(clampToTable(-9999, 9999)).toEqual([Q_MIN, R_MAX])
    expect(clampToTable(9999, -9999)).toEqual([Q_MAX, R_MIN])
    expect(clampToTable(3, -4)).toEqual([3, -4])
    expect(cellAt(...clampToTable(-9999, 9999))).toBeDefined()
    expect(cellAt(...clampToTable(9999, -9999))).toBeDefined()
  })
})
