import type { UInt64 } from 'react-native-nitro-modules'
import { H3Error, rethrowAsH3Error } from './H3Error'
import { native } from './native'
import type { CoordPair } from './types'

/**
 * Measures the exact area of a cell in square kilometres.
 *
 * h3-js spells this `cellArea(cell, 'km2')`. Here the unit is part of the name, so nothing about the
 * unit crosses the bridge at call time.
 *
 * @param cell The cell.
 * @returns The area in square kilometres.
 * @throws {@linkcode H3Error} if the cell is not valid.
 */
export function cellAreaKm2(cell: bigint): number {
  try {
    return native.cellAreaKm2(cell as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Measures the exact area of a cell in square metres.
 *
 * @param cell The cell.
 * @returns The area in square metres.
 * @throws {@linkcode H3Error} if the cell is not valid.
 */
export function cellAreaM2(cell: bigint): number {
  try {
    return native.cellAreaM2(cell as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Measures the exact area of a cell in square radians.
 *
 * @param cell The cell.
 * @returns The area in square radians, on the unit sphere.
 * @throws {@linkcode H3Error} if the cell is not valid.
 */
export function cellAreaRads2(cell: bigint): number {
  try {
    return native.cellAreaRads2(cell as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Refuses a coordinate that is not a pair of finite numbers.
 *
 * The three distance functions unpack their arguments into the four doubles the native method
 * takes, so a malformed argument would otherwise reach H3 as `NaN` rather than as a refusal. The
 * polygon check in `cpp/core/GeoPolygonBuilder.cpp` words its own refusal the same way.
 */
function checkPair(coordinate: CoordPair): void {
  if (
    !Array.isArray(coordinate) ||
    coordinate.length !== 2 ||
    !Number.isFinite(coordinate[0]) ||
    !Number.isFinite(coordinate[1])
  ) {
    throw new H3Error('Each coordinate must be a [latitude, longitude] pair')
  }
}

/**
 * Measures the great-circle distance between two coordinates in kilometres.
 *
 * h3-js spells this `greatCircleDistance(a, b, 'km')`. Here the unit is part of the name, so
 * nothing about the unit crosses the bridge at call time.
 *
 * @param a The first point, `[latitude, longitude]` in degrees.
 * @param b The second point, `[latitude, longitude]` in degrees.
 * @returns The distance in kilometres.
 * @throws {@linkcode H3Error} if either argument is not a pair of finite numbers.
 */
export function greatCircleDistanceKm(a: CoordPair, b: CoordPair): number {
  checkPair(a)
  checkPair(b)
  try {
    return native.greatCircleDistanceKm(a[0], a[1], b[0], b[1])
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Measures the great-circle distance between two coordinates in metres.
 *
 * @param a The first point, `[latitude, longitude]` in degrees.
 * @param b The second point, `[latitude, longitude]` in degrees.
 * @returns The distance in metres.
 * @throws {@linkcode H3Error} if either argument is not a pair of finite numbers.
 */
export function greatCircleDistanceM(a: CoordPair, b: CoordPair): number {
  checkPair(a)
  checkPair(b)
  try {
    return native.greatCircleDistanceM(a[0], a[1], b[0], b[1])
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Measures the great-circle distance between two coordinates in radians.
 *
 * @param a The first point, `[latitude, longitude]` in degrees.
 * @param b The second point, `[latitude, longitude]` in degrees.
 * @returns The distance in radians, on the unit sphere.
 * @throws {@linkcode H3Error} if either argument is not a pair of finite numbers.
 */
export function greatCircleDistanceRads(a: CoordPair, b: CoordPair): number {
  checkPair(a)
  checkPair(b)
  try {
    return native.greatCircleDistanceRads(a[0], a[1], b[0], b[1])
  } catch (error) {
    rethrowAsH3Error(error)
  }
}
