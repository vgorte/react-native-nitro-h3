import type { UInt64 } from 'react-native-nitro-modules'
import { rethrowAsH3Error } from './H3Error'
import { native } from './native'
import type { CoordPair } from './types'

/**
 * Finds the cell containing the given coordinate at the given resolution.
 *
 * @param lat Latitude in degrees.
 * @param lng Longitude in degrees.
 * @param res Resolution, `0` to `15`.
 * @throws {@linkcode H3Error} if the coordinate is out of range, or the resolution is
 * fractional or out of range.
 */
export function latLngToCell(lat: number, lng: number, res: number): bigint {
  try {
    return native.latLngToCell(lat, lng, res)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds the centre of a cell, in degrees.
 *
 * @param cell The cell.
 * @returns The centre as a `[latitude, longitude]` pair.
 * @throws {@linkcode H3Error} if the cell is not valid.
 */
export function cellToLatLng(cell: bigint): CoordPair {
  try {
    return native.cellToLatLng(cell as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds the boundary of a cell, in degrees, counter-clockwise.
 *
 * Six points for a hexagon. Pentagons and cells that cross an icosahedron edge return more, up to
 * ten, because H3 inserts the edge crossings.
 *
 * @param cell The cell.
 * @returns The boundary vertices as `[latitude, longitude]` pairs, whose first point is not
 * repeated at the end.
 * @throws {@linkcode H3Error} if the cell is not valid.
 */
export function cellToBoundary(cell: bigint): CoordPair[] {
  try {
    return native.cellToBoundary(cell as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}
