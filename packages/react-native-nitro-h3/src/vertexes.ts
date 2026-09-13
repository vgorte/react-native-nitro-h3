import type { UInt64 } from 'react-native-nitro-modules'
import { rethrowAsH3Error } from './H3Error'
import { native } from './native'
import type { CoordPair } from './types'

/**
 * Finds one vertex of a cell, by number.
 *
 * Vertex numbers run `0` to `5` counter-clockwise. A pentagon has five, so `5` is out of range
 * there.
 *
 * @param cell The cell.
 * @param vertexNum The vertex number, an integer from `0` to `5`.
 * @returns The vertex index.
 * @throws {@linkcode H3Error} if the cell is not valid, or the vertex number is fractional or out
 * of range.
 */
export function cellToVertex(cell: bigint, vertexNum: number): bigint {
  try {
    return native.cellToVertex(cell as UInt64, vertexNum)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds every vertex of a cell.
 *
 * Six for a hexagon and five for a pentagon: the missing vertex is removed natively rather than
 * arriving as a hole.
 *
 * @param cell The cell.
 * @returns The vertexes, as a view onto the native buffer.
 * @throws {@linkcode H3Error} if the index is not a valid cell.
 */
export function cellToVertexes(cell: bigint): BigUint64Array {
  try {
    return new BigUint64Array(native.cellToVertexes(cell as UInt64))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Reads the coordinate of a vertex, in degrees.
 *
 * Diverges from `h3-js`, which measures any index it is handed, a cell included.
 *
 * @param vertex The vertex.
 * @returns The point the vertex sits on, as a `[latitude, longitude]` pair.
 * @throws {@linkcode H3Error} if the index is not a valid vertex.
 */
export function vertexToLatLng(vertex: bigint): CoordPair {
  try {
    return native.vertexToLatLng(vertex as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}
