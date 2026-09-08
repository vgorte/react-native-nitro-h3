import { NBR } from './geometry'

/** Time constant of the exponential approach, in seconds. */
export const ENERGY_TAU = 0.2
/** Below this an untouched cell is dropped rather than kept for an invisible amount of light. */
export const ENERGY_FLOOR = 0.02

export type EnergyCell = { q: number; r: number; e: number; target: number; stamp: number }

export type EnergyState = { cells: Map<number, EnergyCell>; stamp: number }

/**
 * A cell's map key, in place of the `${q},${r}` string a touch used to allocate. The grid reaches
 * about 75 rings from the origin in either direction, so the 4096 offset and the 8192 stride cannot
 * collide and stay well inside the safe integer range.
 */
export const ENERGY_KEY_ORIGIN = 4096
const ENERGY_KEY_STRIDE = 8192

export function energyKey(q: number, r: number): number {
  return (q + ENERGY_KEY_ORIGIN) * ENERGY_KEY_STRIDE + (r + ENERGY_KEY_ORIGIN)
}

export function createEnergy(): EnergyState {
  return { cells: new Map(), stamp: 0 }
}

function touch(state: EnergyState, q: number, r: number, target: number): void {
  const key = energyKey(q, r)
  const cell = state.cells.get(key)
  if (cell) {
    cell.target = target
    cell.stamp = state.stamp
    return
  }
  state.cells.set(key, { q, r, e: 0, target, stamp: state.stamp })
}

/** Marks the focus cell and `ringRadius` rings around it, once per frame. */
export function markPatch(state: EnergyState, q: number, r: number, ringRadius: number): void {
  state.stamp += 1
  touch(state, q, r, 1)
  for (let d = 1; d <= ringRadius; d++) {
    // Cubic falloff, so the patch reaches zero at its own edge instead of ending on a plateau.
    const falloff = 1 - d / (ringRadius + 1)
    const target = falloff * falloff * falloff
    let cq = q + NBR[4][0] * d
    let cr = r + NBR[4][1] * d
    for (const step of NBR) {
      for (let j = 0; j < d; j++) {
        touch(state, cq, cr, target)
        cq += step[0]
        cr += step[1]
      }
    }
  }
}

/**
 * Exponential approach, so the trail length does not depend on the frame rate. Reduced motion
 * snaps to the target, which leaves the current patch and no trail at all.
 */
export function decayEnergy(state: EnergyState, dt: number, cap: number, reduced: boolean): void {
  const k = reduced ? 1 : 1 - Math.exp(-dt / ENERGY_TAU)
  for (const [key, cell] of state.cells) {
    const target = cell.stamp === state.stamp ? cell.target : 0
    cell.e += (target - cell.e) * k
    if (target === 0 && cell.e < ENERGY_FLOOR) state.cells.delete(key)
  }
  if (state.cells.size <= cap) return
  const sorted = [...state.cells.entries()].sort((a, b) => a[1].e - b[1].e)
  const excess = state.cells.size - cap
  for (let i = 0; i < excess; i++) {
    const entry = sorted[i]
    if (entry) state.cells.delete(entry[0])
  }
}
