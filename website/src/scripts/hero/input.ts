import { NBR, type Point } from './geometry'

const HINT_KEY = 'nh3-hero-hint-seen'
const HINT_FADE_MS = 400

const KEY_STEPS: Record<string, Point> = {
  ArrowRight: NBR[0],
  ArrowLeft: NBR[3],
  ArrowDown: NBR[5],
  ArrowUp: NBR[2],
}

export type InputPort = {
  setFocusFromPoint: (clientX: number, clientY: number) => void
  stepFocus: (dq: number, dr: number) => void
  updateReadout: (announce: boolean) => void
  pulse: () => void
  setOnStage: (on: boolean) => void
  /** Zeroes the normalised pointer, so the layers ease home when the pointer leaves the stage. */
  clearPointer: () => void
  isDocked: () => boolean
  reduced: boolean
}

/** A browser may refuse session storage, so both accesses are guarded. */
export function createHint(hint: HTMLElement | null): { hideSoon: () => void } {
  try {
    if (hint && sessionStorage.getItem(HINT_KEY) === '1') hint.hidden = true
  } catch {
    // Without storage the pill simply shows again, which is the safe direction.
  }
  let timer: number | null = null
  const gone = (): boolean =>
    hint === null || Boolean(hint.hidden) || hint.classList.contains('gone')
  const hide = (): void => {
    if (gone() || !hint) return
    hint.classList.add('gone')
    try {
      sessionStorage.setItem(HINT_KEY, '1')
    } catch {
      // Same as above: a refused write only means the pill returns next visit.
    }
    window.setTimeout(() => {
      hint.hidden = true
    }, HINT_FADE_MS)
  }
  return {
    hideSoon(): void {
      if (timer !== null || gone()) return
      timer = window.setTimeout(hide, HINT_FADE_MS)
    },
  }
}

export function attachInput(
  stage: HTMLElement,
  port: InputPort,
  hint: { hideSoon: () => void },
): void {
  let down = false
  let moved = false

  const onLink = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest('a,button') !== null

  stage.addEventListener('pointerdown', (event) => {
    // A press on a link or a button is theirs, so it neither moves the cell nor pulses.
    if (onLink(event.target)) return
    down = true
    moved = false
    port.setOnStage(true)
    port.setFocusFromPoint(event.clientX, event.clientY)
    port.updateReadout(true)
    hint.hideSoon()
  })

  stage.addEventListener('pointermove', (event) => {
    if (down) {
      moved = true
      port.setFocusFromPoint(event.clientX, event.clientY)
      port.updateReadout(false)
      return
    }
    // The docked layout is press only, and a touch has no hover to follow.
    if (port.isDocked() || event.pointerType === 'touch') return
    port.setOnStage(true)
    port.setFocusFromPoint(event.clientX, event.clientY)
    port.updateReadout(false)
    hint.hideSoon()
  })

  stage.addEventListener('pointerleave', () => {
    port.clearPointer()
    if (!down) port.setOnStage(false)
  })

  window.addEventListener('pointerup', (event) => {
    if (!down) return
    down = false
    if (!moved && !port.reduced) port.pulse()
    // A touch never sends pointerleave, so the lift is what ends the contact.
    if (event.pointerType === 'touch') port.setOnStage(false)
  })

  // A vertical drag that turns into a page scroll arrives here and ends the press without a pulse.
  window.addEventListener('pointercancel', () => {
    down = false
  })

  stage.addEventListener('keydown', (event) => {
    // a focused link or button keeps its own keys
    if (onLink(event.target)) return
    const step = KEY_STEPS[event.key]
    if (step) {
      event.preventDefault()
      port.stepFocus(step[0], step[1])
      port.updateReadout(true)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!port.reduced) port.pulse()
    }
  })
}
