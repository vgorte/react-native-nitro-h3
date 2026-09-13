import type { UInt64 } from 'react-native-nitro-modules'
import { rethrowAsH3Error } from './H3Error'
import { native } from './native'
import type { CoordPair } from './types'

/**
 * Reports whether two cells share an edge.
 *
 * Diverges from `h3-js`, which answers `false` for a malformed index instead of throwing.
 *
 * @param origin The first cell.
 * @param destination The second cell, at the same resolution.
 * @returns `true` when the two cells are adjacent.
 * @throws {@linkcode H3Error} if either index is not a valid cell, or the resolutions differ.
 */
export function areNeighborCells(origin: bigint, destination: bigint): boolean {
  try {
    return native.areNeighborCells(origin as UInt64, destination as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Builds the directed edge running from one cell to a neighbouring one.
 *
 * @param origin The cell the edge leaves.
 * @param destination The neighbouring cell the edge enters.
 * @returns The directed edge index.
 * @throws {@linkcode H3Error} if either index is not a valid cell, or they are not neighbours.
 */
export function cellsToDirectedEdge(origin: bigint, destination: bigint): bigint {
  try {
    return native.cellsToDirectedEdge(origin as UInt64, destination as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Reads the cell a directed edge leaves.
 *
 * Diverges from `h3-js`, which answers a cell for any index whose mode bits say directed edge.
 *
 * @param edge The directed edge.
 * @returns The origin cell.
 * @throws {@linkcode H3Error} if the index is not a valid directed edge.
 */
export function getDirectedEdgeOrigin(edge: bigint): bigint {
  try {
    return native.getDirectedEdgeOrigin(edge as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Reads the cell a directed edge enters.
 *
 * @param edge The directed edge.
 * @returns The destination cell.
 * @throws {@linkcode H3Error} if the index is not a valid directed edge.
 */
export function getDirectedEdgeDestination(edge: bigint): bigint {
  try {
    return native.getDirectedEdgeDestination(edge as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Builds the edge running the other way between the same two cells.
 *
 * @param edge The directed edge.
 * @returns The edge from this one's destination back to its origin.
 * @throws {@linkcode H3Error} if the index is not a valid directed edge.
 */
export function reverseDirectedEdge(edge: bigint): bigint {
  try {
    return native.reverseDirectedEdge(edge as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Reads the origin and the destination of a directed edge, in that order.
 *
 * @param edge The directed edge.
 * @returns Always two cells, as a view onto the native buffer.
 * @throws {@linkcode H3Error} if the index is not a valid directed edge.
 */
export function directedEdgeToCells(edge: bigint): BigUint64Array {
  try {
    return new BigUint64Array(native.directedEdgeToCells(edge as UInt64))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds every directed edge leaving a cell.
 *
 * Six for a hexagon and five for a pentagon: the missing edge is removed natively rather than
 * arriving as a hole.
 *
 * @param origin The cell the edges leave.
 * @returns The edges, as a view onto the native buffer.
 * @throws {@linkcode H3Error} if the index is not a valid cell.
 */
export function originToDirectedEdges(origin: bigint): BigUint64Array {
  try {
    return new BigUint64Array(native.originToDirectedEdges(origin as UInt64))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds the geometry of a directed edge, in degrees.
 *
 * Two points for an ordinary edge. An edge that crosses an icosahedron face returns three, because
 * H3 inserts the crossing point.
 *
 * @param edge The directed edge.
 * @returns The points along the edge, as `[latitude, longitude]` pairs.
 * @throws {@linkcode H3Error} if the index is not a valid directed edge.
 */
export function directedEdgeToBoundary(edge: bigint): CoordPair[] {
  try {
    return native.directedEdgeToBoundary(edge as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Measures the exact length of a directed edge in kilometres.
 *
 * `h3-js` spells this `edgeLength(edge, 'km')`.
 *
 * @param edge The directed edge.
 * @returns The length in kilometres.
 * @throws {@linkcode H3Error} if the index is not a valid directed edge.
 */
export function edgeLengthKm(edge: bigint): number {
  try {
    return native.edgeLengthKm(edge as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Measures the exact length of a directed edge in metres.
 *
 * @param edge The directed edge.
 * @returns The length in metres.
 * @throws {@linkcode H3Error} if the index is not a valid directed edge.
 */
export function edgeLengthM(edge: bigint): number {
  try {
    return native.edgeLengthM(edge as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Measures the exact length of a directed edge in radians.
 *
 * @param edge The directed edge.
 * @returns The length in radians on the unit sphere.
 * @throws {@linkcode H3Error} if the index is not a valid directed edge.
 */
export function edgeLengthRads(edge: bigint): number {
  try {
    return native.edgeLengthRads(edge as UInt64)
  } catch (error) {
    rethrowAsH3Error(error)
  }
}
