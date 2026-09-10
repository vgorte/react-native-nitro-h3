import { describe, expect, test } from 'bun:test'
import type { Hexagon, Rect } from './geometry'
import { type AnchorInput, anchorCard, segBox } from './readout'

const box: Rect = { left: 100, top: 100, right: 200, bottom: 200 }

/** `hexPts` walks from angle 0, so `fp[5]` is the upper right vertex and `fp[4]` the upper left. */
const hexAt = (cx: number, cy: number): Hexagon => [
  [cx + 40, cy],
  [cx + 20, cy + 35],
  [cx - 20, cy + 35],
  [cx - 40, cy],
  [cx - 20, cy - 35],
  [cx + 20, cy - 35],
]

const anchorInput = (over: Partial<AnchorInput>): AnchorInput => ({
  fp: hexAt(300, 300),
  cellCenterX: 300,
  W: 1000,
  H: 600,
  cardWidth: 200,
  cardHeight: 100,
  keepOuts: [],
  copy: null,
  ...over,
})

describe('segBox', () => {
  test('a segment straight through the box crosses it', () => {
    expect(segBox(50, 150, 250, 150, box)).toBe(true)
  })

  test('a segment past the top left corner misses the box', () => {
    // The bounding boxes overlap, so only the clip itself can reject this one.
    expect(segBox(0, 150, 150, 0, box)).toBe(false)
  })

  test('a segment starting inside the box crosses it', () => {
    expect(segBox(150, 150, 400, 400, box)).toBe(true)
  })
})

describe('anchorCard', () => {
  test('the card hangs off the vertex facing it and swaps sides across the centre', () => {
    // `fp[5]` is (320, 265), so the card sits 28 px to its right and 36 px plus its height above it.
    expect(anchorCard(anchorInput({}))).toEqual({ x: 348, y: 129, side: 1 })
    // Past the centre the other upper vertex, (680, 265), carries the card on its left.
    expect(anchorCard(anchorInput({ fp: hexAt(700, 300), cellCenterX: 700 }))).toEqual({
      x: 452,
      y: 129,
      side: -1,
    })
  })

  test('the card stays 24 px inside the canvas box', () => {
    // The vertex sits near the top right corner of a 300 x 300 stage, so both clamps bite.
    expect(
      anchorCard(anchorInput({ fp: hexAt(100, 90), cellCenterX: 100, W: 300, H: 300 })),
    ).toEqual({ x: 76, y: 24, side: 1 })
  })

  test('a side whose leader would cross the copy block loses to the other side', () => {
    const fp = hexAt(400, 300)
    // The card corner at (448, 229) lands inside this box, so the leader to it crosses.
    const copy: Rect = { left: 430, top: 200, right: 700, bottom: 260 }
    expect(anchorCard(anchorInput({ fp, cellCenterX: 400 }))).toEqual({ x: 448, y: 129, side: 1 })
    expect(anchorCard(anchorInput({ fp, cellCenterX: 400, copy }))).toEqual({
      x: 152,
      y: 129,
      side: -1,
    })
  })

  test('a side blocked by a keep-out loses to a clear side', () => {
    const fp = hexAt(400, 300)
    const keepOuts = [{ box: { left: 500, top: 100, right: 700, bottom: 300 }, push: 1 as const }]
    expect(anchorCard(anchorInput({ fp, cellCenterX: 400 }))).toEqual({ x: 448, y: 129, side: 1 })
    // Pushed clear to 708, the right side scores a block; the left side is untouched at 152.
    expect(anchorCard(anchorInput({ fp, cellCenterX: 400, keepOuts }))).toEqual({
      x: 152,
      y: 129,
      side: -1,
    })
  })
})
