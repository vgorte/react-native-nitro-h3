import { describe, expect, test } from 'bun:test'
import {
  cloudTransform,
  createLayerState,
  IDLE_X,
  IDLE_Y,
  idleOffset,
  PARA_REF_W,
  PRESETS,
  stepParallax,
  terrainTransform,
  toCanvas,
  toStagePoint,
} from './parallax'

const rect = { left: 40, top: 90, width: 1440, height: 810 }

/** A state with a non-zero translation and the maximum tilt, its inverse refreshed. */
const tilted = (): ReturnType<typeof createLayerState> => {
  const state = createLayerState()
  state.terX = 8
  state.terY = -5
  state.tiltX = 1.5
  state.tiltY = -1.5
  // `dt` 0 makes the ease factor 0, so the step only refreshes the inverse.
  stepParallax(state, {
    preset: PRESETS.tilt,
    dt: 0,
    t: 0,
    stageWidth: rect.width,
    pointNX: 0,
    pointNY: 0,
    live: false,
    idle: false,
    half: false,
    reduced: false,
  })
  return state
}

describe('the layer matrix', () => {
  test('the stored inverse undoes the forward matrix', () => {
    const state = tilted()
    for (const x of [-400, -50, 0, 120, 700]) {
      for (const y of [-300, -20, 0, 90, 400]) {
        const forward = toStagePoint(state, x + rect.width / 2, y + rect.height / 2, rect)
        const back = toCanvas(state.inverse, forward[0] + rect.left, forward[1] + rect.top, rect)
        expect(Math.abs(back[0] - (x + rect.width / 2))).toBeLessThan(1e-9)
        expect(Math.abs(back[1] - (y + rect.height / 2))).toBeLessThan(1e-9)
      }
    }
  })

  test('the identity state maps a client point straight onto the canvas point', () => {
    const state = createLayerState()
    const point = toCanvas(state.inverse, rect.left + 300, rect.top + 200, rect)
    expect(Math.abs(point[0] - 300)).toBeLessThan(1e-9)
    expect(Math.abs(point[1] - 200)).toBeLessThan(1e-9)
  })
})

describe('idleOffset', () => {
  test('stays inside the two amplitudes', () => {
    for (let t = 0; t < 60000; t += 137) {
      const [x, y] = idleOffset(t, 1)
      expect(Math.abs(x)).toBeLessThanOrEqual(IDLE_X + 1e-12)
      expect(Math.abs(y)).toBeLessThanOrEqual(IDLE_Y + 1e-12)
    }
  })

  test('repeats after the common period of fourteen and twenty three seconds', () => {
    for (const t of [0, 1234, 55555]) {
      const a = idleOffset(t, 1)
      const b = idleOffset(t + 322000, 1)
      expect(Math.abs(a[0] - b[0])).toBeLessThan(1e-9)
      expect(Math.abs(a[1] - b[1])).toBeLessThan(1e-9)
    }
  })

  test('halves with a halved amplitude factor', () => {
    const full = idleOffset(9100, 1)
    const half = idleOffset(9100, 0.5)
    expect(half[0]).toBeCloseTo(full[0] / 2, 12)
    expect(half[1]).toBeCloseTo(full[1] / 2, 12)
  })
})

describe('stepParallax', () => {
  test('drives every offset to zero when nothing is live', () => {
    const state = tilted()
    state.cloX = 20
    state.cloY = 12
    for (let i = 0; i < 400; i++) {
      stepParallax(state, {
        preset: PRESETS.tilt,
        dt: 0.016,
        t: i * 16,
        stageWidth: rect.width,
        pointNX: 0.8,
        pointNY: -0.4,
        live: false,
        idle: false,
        half: false,
        reduced: false,
      })
    }
    for (const value of [
      state.terX,
      state.terY,
      state.cloX,
      state.cloY,
      state.tiltX,
      state.tiltY,
    ]) {
      expect(Math.abs(value)).toBeLessThan(1e-6)
    }
    expect(state.idleX).toBe(0)
    expect(state.idleY).toBe(0)
  })

  test('reaches the target in one call under reduced motion', () => {
    const state = createLayerState()
    stepParallax(state, {
      preset: PRESETS.tilt,
      dt: 0.016,
      t: 0,
      stageWidth: PARA_REF_W,
      pointNX: 1,
      pointNY: 1,
      live: true,
      idle: false,
      half: false,
      reduced: true,
    })
    expect(state.terX).toBeCloseTo(-8, 12)
    expect(state.terY).toBeCloseTo(-8, 12)
    expect(state.cloX).toBeCloseTo(-20, 12)
    expect(state.tiltX).toBeCloseTo(-1.5, 12)
    expect(state.tiltY).toBeCloseTo(1.5, 12)
  })

  test('clamps the amplitude factor at both ends', () => {
    for (const [width, want] of [
      [200, -4],
      [9000, -12],
    ] as const) {
      const state = createLayerState()
      stepParallax(state, {
        preset: PRESETS.tilt,
        dt: 0.016,
        t: 0,
        stageWidth: width,
        pointNX: 1,
        pointNY: 0,
        live: true,
        idle: false,
        half: false,
        reduced: true,
      })
      expect(state.terX).toBeCloseTo(want, 12)
    }
  })
})

describe('the two shipped presets', () => {
  test('carry the values of the spec', () => {
    expect(PRESETS.tilt).toEqual({
      terrain: 8,
      tSign: -1,
      clouds: 20,
      cSign: -1,
      tau: 0.25,
      tilt: 1.5,
    })
    expect(PRESETS.follow).toEqual({
      terrain: 8,
      tSign: 1,
      clouds: 20,
      cSign: 1,
      tau: 0.25,
      tilt: 0,
    })
  })

  test('the two transform strings carry the prototype rounding', () => {
    const state = createLayerState()
    state.terX = 1.2345
    state.terY = -2.3456
    state.tiltX = 0.98765
    state.tiltY = -1.23456
    state.cloX = 3.6
    state.idleX = 1
    state.cloY = 0
    state.idleY = -0.5
    expect(terrainTransform(state, false)).toBe('translate3d(1.23px,-2.35px,0)')
    expect(terrainTransform(state, true)).toBe(
      'perspective(1200px) translate3d(1.23px,-2.35px,0) rotateX(0.988deg) rotateY(-1.235deg)',
    )
    expect(cloudTransform(state)).toBe('translate3d(4.60px,-0.50px,0)')
  })
})
