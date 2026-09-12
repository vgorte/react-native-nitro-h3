import type { UInt64 } from 'react-native-nitro-modules'
import { rethrowAsH3Error } from './H3Error'
import { native } from './native'
import type { CoordIJ } from './types'

/**
 * Finds every cell within grid distance `k` of the origin, including the origin itself.
 *
 * The result is a view onto the buffer C++ produced, not a copy, and contains only real cells:
 * H3 pads its output with holes around pentagons, and those are removed natively before the
 * buffer crosses. Expect fewer than `1 + 3k(k + 1)` entries near a pentagon.
 *
 * Diverges from `h3-js`, which returns cells derived from a nonsense origin instead of throwing.
 *
 * @throws {@linkcode H3Error} if the origin is not a valid cell or `k` is negative.
 */
export function gridDisk(origin: bigint, k: number): BigUint64Array {
  try {
    return new BigUint64Array(native.gridDisk(origin as UInt64, k))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds the hollow ring of cells at exactly grid distance `k` from the origin.
 *
 * Safe near pentagons: where the ring is distorted the affected cells are simply absent, so a ring
 * may hold fewer than `6 * k` entries. Use {@linkcode gridRingUnsafe} to be told instead.
 *
 * @param origin The centre cell.
 * @param k The grid distance, `0` or more. A `k` of `0` returns just the origin.
 * @returns The cells at that distance, as a view onto the native buffer.
 * @throws {@linkcode H3Error} if the origin is not a valid cell or `k` is negative.
 */
export function gridRing(origin: bigint, k: number): BigUint64Array {
  try {
    return new BigUint64Array(native.gridRing(origin as UInt64, k))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds the ring as {@linkcode gridRing} does, but throws when a pentagon distorts it.
 *
 * @param origin The centre cell.
 * @param k The grid distance, `0` or more.
 * @returns The cells at that distance, as a view onto the native buffer.
 * @throws {@linkcode H3Error} with `code` `9` and the message
 * `"Pentagon distortion was encountered (code: 9)"` if the ring touches a pentagon, and for an
 * invalid origin or a negative `k`.
 */
export function gridRingUnsafe(origin: bigint, k: number): BigUint64Array {
  try {
    return new BigUint64Array(native.gridRingUnsafe(origin as UInt64, k))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds the cells within grid distance `k` of the origin, grouped by distance.
 *
 * The result always has `k + 1` entries, so the index is always the grid distance: entry `0` holds
 * only the origin. A ring near a pentagon may be shorter than `6 * i`, or even empty, and is still
 * present.
 *
 * @param origin The centre cell.
 * @param k The grid distance, `0` or more.
 * @returns One view per ring, ordered by distance from the origin.
 * @throws {@linkcode H3Error} if the origin is not a valid cell or `k` is negative.
 */
export function gridDiskDistances(origin: bigint, k: number): BigUint64Array[] {
  try {
    return native.gridDiskDistances(origin as UInt64, k).map((ring) => new BigUint64Array(ring))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds the cells along a line between two cells, inclusive of both ends.
 *
 * Diverges from `h3-js`, which drops the error check on the size query at this one call site.
 *
 * @param start The first cell.
 * @param end The last cell, at the same resolution as `start`.
 * @returns The path, starting at `start` and ending at `end`.
 * @throws {@linkcode H3Error} if either cell is not valid, the resolutions differ, or the line
 * crosses a pentagon in a way H3 cannot express.
 */
export function gridPathCells(start: bigint, end: bigint): BigUint64Array {
  try {
    return new BigUint64Array(native.gridPathCells(start as UInt64, end as UInt64))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Measures the grid distance between two cells: the number of steps from one to the other.
 *
 * Diverges from `h3-js`, which answers `0` for two copies of the same nonsense index.
 *
 * @param origin The first cell.
 * @param destination The second cell, at the same resolution.
 * @returns The number of steps.
 * @throws {@linkcode H3Error} if either cell is not valid, the resolutions differ, or the cells are
 * too far apart for H3 to compute a distance.
 */
export function gridDistance(origin: bigint, destination: bigint): number {
  try {
    return native.gridDistance(origin as UInt64, destination as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds the local IJ coordinates of a cell relative to an origin.
 *
 * This is not a serialization format: H3 does not guarantee these coordinates across its own
 * versions, so do not store them or send them between systems that may run different versions.
 *
 * @param origin The anchoring cell.
 * @param cell The cell to locate, at the same resolution and near enough to `origin`.
 * @returns The coordinates, comparable only against others from the same origin.
 * @throws {@linkcode H3Error} if either cell is not valid, the resolutions differ, or the cells are
 * too far apart.
 */
export function cellToLocalIj(origin: bigint, cell: bigint): CoordIJ {
  try {
    return native.cellToLocalIj(origin as UInt64, cell as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds the cell at local IJ coordinates relative to an origin, inverting
 * {@linkcode cellToLocalIj}.
 *
 * The coordinates come from {@linkcode cellToLocalIj}, whose output H3 does not guarantee across its
 * own versions, so do not read them from storage written by a different H3 version.
 *
 * @param origin The anchoring cell.
 * @param coords The coordinates {@linkcode cellToLocalIj} answered, whose `i` and `j` must both be
 * integers.
 * @returns The cell at those coordinates.
 * @throws {@linkcode H3Error} if the origin is not valid, a coordinate is fractional, or the
 * coordinates do not name a cell.
 */
export function localIjToCell(origin: bigint, coords: CoordIJ): bigint {
  try {
    // the spec takes two doubles; the object is what `h3-js` and `cellToLocalIj` use
    return native.localIjToCell(origin as UInt64, coords.i, coords.j)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}
