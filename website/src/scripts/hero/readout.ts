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
  /** The copy block, in canvas units. A leader that would cross it loses the side. */
  copy: Rect | null
}

export type Anchor = { x: number; y: number; side: 1 | -1 }

/** Liang-Barsky segment against an axis aligned box, so the leader can keep off the copy block. */
export function segBox(x1: number, y1: number, x2: number, y2: number, b: Rect | null): boolean {
  if (!b) return false
  if (Math.max(x1, x2) < b.left || Math.min(x1, x2) > b.right) return false
  if (Math.max(y1, y2) < b.top || Math.min(y1, y2) > b.bottom) return false
  if (x1 > b.left && x1 < b.right && y1 > b.top && y1 < b.bottom) return true
  if (x2 > b.left && x2 < b.right && y2 > b.top && y2 < b.bottom) return true
  const dx = x2 - x1
  const dy = y2 - y1
  const ps = [-dx, dx, -dy, dy]
  const qs = [x1 - b.left, b.right - x1, y1 - b.top, b.bottom - y1]
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 4; i++) {
    const p = ps[i] ?? 0
    const q = qs[i] ?? 0
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }
  return t0 <= t1
}

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
    // The leader runs from this vertex to the card corner facing it, so the crossing test belongs
    // here, where the side can still be swapped.
    const ax = side > 0 ? x : x + w
    const cross = segBox(v[0], v[1], ax, y + h, input.copy) ? 1 : 0
    // Bounded into its band: on a very wide stage a clamp can push the card far enough that a raw
    // distance would outweigh `blocked` and land the card on the copy block.
    return { x, y, side, blocked, cross, off: Math.min(9999, Math.abs(ax - v[0])) }
  }
  const score = (p: { blocked: number; cross: number; off: number }): number =>
    p.cross * 1e6 + p.blocked * 1e4 + p.off
  const first: 1 | -1 = input.cellCenterX > input.W / 2 ? -1 : 1
  let pos = resolve(first)
  if (pos.blocked || pos.cross) {
    const alt = resolve(first === 1 ? -1 : 1)
    if (score(alt) < score(pos)) pos = alt
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
