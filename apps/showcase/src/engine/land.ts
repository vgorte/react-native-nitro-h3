import { LAND_BASE64 } from './landData'
import type { GlobeView } from './projection'

/** Holds the coastline rings as unit-sphere geometry, built once and rotated every frame. */
export interface LandRings {
  /** Unit-sphere `[x, y, z]` per vertex, packed across every ring. */
  xyz: Float32Array
  /** Vertex at which each ring starts, `ringCount + 1` entries. */
  offsets: Uint32Array
}

/** Holds the coastline projected to the screen as polylines, refilled every frame. */
export interface LandRuns {
  /** Screen `[x, y]` per point, packed, `starts[runCount[0]]` slots in use. */
  points: Float32Array
  /** Slot in `points` at which each run starts, one entry past the last run. */
  starts: Uint32Array
  /** One slot, holding the number of runs written. */
  runCount: Int32Array
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const SEXTETS = (() => {
  const lookup = new Uint8Array(128)
  for (let index = 0; index < ALPHABET.length; index++) lookup[ALPHABET.charCodeAt(index)] = index
  return lookup
})()

// `atob` is not part of the Hermes runtime
function decodeBase64(text: string): Uint8Array {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((text.length / 4) * 3 - padding)
  let cursor = 0
  for (let index = 0; index < text.length; index += 4) {
    const word =
      (SEXTETS[text.charCodeAt(index)] << 18) |
      (SEXTETS[text.charCodeAt(index + 1)] << 12) |
      (SEXTETS[text.charCodeAt(index + 2)] << 6) |
      SEXTETS[text.charCodeAt(index + 3)]
    bytes[cursor] = word >> 16
    if (cursor + 1 < bytes.length) bytes[cursor + 1] = (word >> 8) & 0xff
    if (cursor + 2 < bytes.length) bytes[cursor + 2] = word & 0xff
    cursor += 3
  }
  return bytes
}

/** Decodes the generated coastline payload into views over one buffer. */
export function loadLand(): LandRings {
  const bytes = decodeBase64(LAND_BASE64)
  const header = new Uint32Array(bytes.buffer, 0, 2)
  const offsets = new Uint32Array(bytes.buffer, 8, header[0] + 1)
  const xyz = new Float32Array(bytes.buffer, 8 + offsets.byteLength, header[1] * 3)
  return { xyz, offsets }
}

/** Allocates the run buffers at the size every ring of `land` would need. */
export function createLandRuns(land: LandRings): LandRuns {
  const vertexCount = land.xyz.length / 3
  return {
    points: new Float32Array(vertexCount * 2),
    starts: new Uint32Array(vertexCount + 1),
    runCount: new Int32Array(1),
  }
}

/**
 * Fills the run buffers with the coastline facing the viewer, projected to the screen.
 *
 * A ring breaks into a new run wherever a vertex falls on the far side, so a polyline never
 * crosses the disk, and a run of a single point is dropped.
 */
export function projectLand(land: LandRings, view: GlobeView, runs: LandRuns): void {
  'worklet'
  const { xyz, offsets } = land
  const { points, starts, runCount } = runs
  const { cx, cy, radius } = view

  const sinLambda = Math.sin(view.lambda0)
  const cosLambda = Math.cos(view.lambda0)
  const sinPhi = Math.sin(view.phi0)
  const cosPhi = Math.cos(view.phi0)

  let cursor = 0
  let written = 0
  let start = 0
  let length = 0

  for (let ring = 0; ring + 1 < offsets.length; ring++) {
    for (let vertex = offsets[ring]; vertex < offsets[ring + 1]; vertex++) {
      const slot = vertex * 3
      const x = xyz[slot]
      const y = xyz[slot + 1]
      const turnedX = x * cosLambda + y * sinLambda
      if (sinPhi * xyz[slot + 2] + cosPhi * turnedX <= 0) {
        if (length > 1) {
          starts[written] = start
          written += 1
        } else {
          cursor = start
        }
        start = cursor
        length = 0
        continue
      }
      points[cursor] = cx + radius * (y * cosLambda - x * sinLambda)
      points[cursor + 1] = cy - radius * (cosPhi * xyz[slot + 2] - sinPhi * turnedX)
      cursor += 2
      length += 1
    }
    if (length > 1) {
      starts[written] = start
      written += 1
    } else {
      cursor = start
    }
    start = cursor
    length = 0
  }

  starts[written] = cursor
  runCount[0] = written
}

/** Projects the coastline under a view and answers it as one SVG path of polylines. */
export function landPathFor(land: LandRings, view: GlobeView): string {
  const runs = createLandRuns(land)
  projectLand(land, view, runs)
  const { points, starts } = runs
  const parts: string[] = []

  for (let run = 0; run < runs.runCount[0]; run++) {
    let part = `M${points[starts[run]].toFixed(1)} ${points[starts[run] + 1].toFixed(1)}`
    for (let slot = starts[run] + 2; slot < starts[run + 1]; slot += 2) {
      part += `L${points[slot].toFixed(1)} ${points[slot + 1].toFixed(1)}`
    }
    parts.push(part)
  }

  return parts.join('')
}
