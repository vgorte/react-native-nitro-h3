import { PANEL_BORDER, PANEL_GAP, PANEL_PADDING } from './panelMetrics'

/** Points a panel keeps clear of whatever stands below it. */
export const CLEARANCE = 12

/** The glass a panel spends on itself: the border and padding of one edge. */
const EDGE = PANEL_BORDER + PANEL_PADDING

/**
 * Returns the height a panel starting at `top` has before it reaches what stands at the foot.
 *
 * `foot` is how far that thing reaches up from the bottom edge, so a foot that has not been measured
 * yet leaves the panel the rest of the window.
 */
export function panelRoom(windowHeight: number, top: number, foot: number): number {
  return Math.max(0, windowHeight - foot - CLEARANCE - top)
}

/**
 * Returns the height the folding body may take inside a panel held to `maxHeight`.
 *
 * A head that has not been measured yet costs nothing, so the body is never given less room than it
 * ends up with.
 */
export function bodyRoom(maxHeight: number, headHeight: number): number {
  const spent = 2 * EDGE + (headHeight === 0 ? 0 : headHeight + PANEL_GAP)
  return Math.max(0, maxHeight - spent)
}
