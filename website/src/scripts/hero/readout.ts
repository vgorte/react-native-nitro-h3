import { cellToLatLng, latLngToCell } from 'h3-js'
import { centerOf, type Hexagon, type Point, RES, type Rect } from './geometry'

export type ReadoutElements = {
  card: HTMLElement
  call: HTMLElement
  id: HTMLElement
  /** The visually hidden live region, absent when the page does not render one. */
  announce: HTMLElement | null
}

/** San Francisco anchors the plane, so the readout reads as a real place. */
const LAT0 = 37.7749
const LNG0 = -122.4194
const LAT_PER_PV = 0.42
const LNG_PER_PU = 0.58

/**
 * Writes the readout for one cell. The coordinates shown are the cell centre, so calling
 * `latLngToCell` with them returns exactly the id on the second line.
 */
export function updateReadout(
  el: ReadoutElements,
  q: number,
  r: number,
  s: number,
  announce: boolean,
): void {
  const centre = centerOf(q, r, s)
  const id = latLngToCell(LAT0 - centre[1] * LAT_PER_PV, LNG0 + centre[0] * LNG_PER_PU, RES)
  const [lat, lng] = cellToLatLng(id)
  const call = `latLngToCell(${lat.toFixed(4)}, ${lng.toFixed(4)}, ${RES})`
  const hex = `0x${id.toLowerCase()}n`
  el.call.textContent = call
  el.id.textContent = hex
  // pointer motion would flood the live region
  if (announce && el.announce) el.announce.textContent = `${call} ${hex}`
}

export type AnchorInput = {
  fp: Hexagon
  /** Screen `x` of the focus cell's centre, in canvas pixels. */
  cellCenterX: number
  W: number
  H: number
  cardWidth: number
  cardHeight: number
  hint: Rect | null
  keepOuts: readonly { box: Rect; push: 1 | -1 }[]
}

export type Anchor = { x: number; y: number; side: 1 | -1 }

/** Hangs the card off the upper vertex facing it and pushes it clear of the copy and the hint. */
export function anchorCard(input: AnchorInput): Anchor {
  const { fp, cardWidth: w, cardHeight: h } = input
  const clampX = (x: number): number => Math.min(Math.max(x, 24), input.W - w - 24)
  const hitOf = (x: number, y: number): { box: Rect; push: 1 | -1 } | null => {
    for (const entry of input.keepOuts) {
      const b = entry.box
      if (x < b.right && x + w > b.left && y < b.bottom && y + h > b.top) return entry
    }
    return null
  }
  const resolve = (side: 1 | -1) => {
    const v = side > 0 ? fp[5] : fp[4]
    let x = side > 0 ? v[0] + 28 : v[0] - 28 - w
    let y = v[1] - 36 - h
    const hint = input.hint
    // Only lift the card when it would actually run into the hint pill.
    if (hint && x < hint.right && x + w > hint.left) y = Math.min(y, hint.top - h - 12)
    x = clampX(x)
    y = Math.min(Math.max(y, 24), input.H - h - 24)
    const hit = hitOf(x, y)
    let blocked = 0
    if (hit) {
      x = clampX(hit.push > 0 ? hit.box.right + 8 : hit.box.left - 8 - w)
      blocked = hitOf(x, y) ? 2 : 1
    }
    return { x, y, side, blocked, off: Math.abs((side > 0 ? x : x + w) - v[0]) }
  }
  const first: 1 | -1 = input.cellCenterX > input.W / 2 ? -1 : 1
  let pos = resolve(first)
  if (pos.blocked) {
    const alt = resolve(first === 1 ? -1 : 1)
    if (alt.blocked * 10000 + alt.off < pos.blocked * 10000 + pos.off) pos = alt
  }
  return { x: pos.x, y: pos.y, side: pos.side }
}

export function leaderAnchors(
  fp: Hexagon,
  card: Rect,
  side: 1 | -1,
  docked: boolean,
): { hex: Point; card: Point } {
  if (docked) {
    return {
      hex: [(fp[1][0] + fp[2][0]) / 2, (fp[1][1] + fp[2][1]) / 2],
      card: [(card.left + card.right) / 2, card.top],
    }
  }
  return {
    hex: side > 0 ? fp[5] : fp[4],
    card: [side > 0 ? card.left : card.right, card.bottom],
  }
}
