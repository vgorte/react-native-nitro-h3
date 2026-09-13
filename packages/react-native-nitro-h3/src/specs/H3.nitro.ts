import type { HybridObject, UInt64 } from 'react-native-nitro-modules'

// a latitude and longitude in degrees. Nitrogen maps a tuple to `std::tuple<double, double>`, which
// crosses as a JavaScript array of two numbers rather than as a generated struct.
export type CoordPair = [lat: number, lng: number]

// local IJ hexagon coordinates. Nitrogen generates a C++ struct of the same name in
// `margelo::nitro::h3`, which is not H3's own `::CoordIJ`.
export interface CoordIJ {
  i: number
  j: number
}

// the stride and the two buffers of one boundary batch. Nitrogen generates a C++ struct of the same name whose
// two `ArrayBuffer` members convert like a direct `ArrayBuffer` return, so neither is copied.
export interface CellBoundaryBuffers {
  stride: number
  vertices: ArrayBuffer
  vertexCounts: ArrayBuffer
}

// internal binding surface; the public API in `src/` wraps these methods.
export interface H3 extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  // `bigint` without signedness is a nitrogen error, so cells are `UInt64`.
  latLngToCell(lat: number, lng: number, res: number): UInt64
  cellToLatLng(cell: UInt64): CoordPair
  cellToBoundary(cell: UInt64): CoordPair[]
  // three levels of nesting: polygons of loops of points, which nitrogen expands recursively.
  cellsToMultiPolygon(cells: ArrayBuffer): CoordPair[][][]
  // `number[][][]` rather than a named point struct, so the public `Ring[]` passes straight through;
  // nitrogen maps it to `const std::vector<std::vector<std::vector<double>>>&`.
  polygonToCells(rings: number[][][], res: number): ArrayBuffer
  // the containment mode crosses as a `number`, which C++ narrows to the `uint32_t` flags word.
  polygonToCellsExperimental(rings: number[][][], res: number, flags: number): ArrayBuffer

  // typed arrays are not spec types; the wrapper views this `ArrayBuffer` as a `BigUint64Array` without copying.
  gridDisk(origin: UInt64, k: number): ArrayBuffer
  gridRing(origin: UInt64, k: number): ArrayBuffer
  gridRingUnsafe(origin: UInt64, k: number): ArrayBuffer
  // one buffer per ring, so nitrogen wraps the `ArrayBuffer` type in a `std::vector`.
  gridDiskDistances(origin: UInt64, k: number): ArrayBuffer[]
  gridPathCells(start: UInt64, end: UInt64): ArrayBuffer
  // C answers `int64_t`; a grid distance is far inside `2^53 - 1`, so the spec type is `number`.
  gridDistance(origin: UInt64, destination: UInt64): number
  cellToLocalIj(origin: UInt64, cell: UInt64): CoordIJ
  localIjToCell(origin: UInt64, i: number, j: number): UInt64

  areNeighborCells(origin: UInt64, destination: UInt64): boolean
  cellsToDirectedEdge(origin: UInt64, destination: UInt64): UInt64
  getDirectedEdgeOrigin(edge: UInt64): UInt64
  getDirectedEdgeDestination(edge: UInt64): UInt64
  reverseDirectedEdge(edge: UInt64): UInt64
  // both of these have a fixed length, so the `ArrayBuffer` is two or six cells rather than a query.
  directedEdgeToCells(edge: UInt64): ArrayBuffer
  originToDirectedEdges(origin: UInt64): ArrayBuffer
  directedEdgeToBoundary(edge: UInt64): CoordPair[]
  edgeLengthKm(edge: UInt64): number
  edgeLengthM(edge: UInt64): number
  edgeLengthRads(edge: UInt64): number

  cellToVertex(cell: UInt64, vertexNum: number): UInt64
  cellToVertexes(cell: UInt64): ArrayBuffer
  vertexToLatLng(vertex: UInt64): CoordPair

  degsToRads(degrees: number): number
  radsToDegs(radians: number): number

  isValidCell(cell: UInt64): boolean
  isValidIndex(index: UInt64): boolean
  isValidDirectedEdge(edge: UInt64): boolean
  isValidVertex(vertex: UInt64): boolean
  isPentagon(cell: UInt64): boolean
  isResClassIII(cell: UInt64): boolean
  getResolution(index: UInt64): number
  getBaseCellNumber(cell: UInt64): number
  getIndexDigit(cell: UInt64, digit: number): number
  // digits arrive as `number[]`, which nitrogen maps to `const std::vector<double>&`.
  constructCell(baseCellNumber: number, digits: number[], res: number): UInt64
  cellToString(cell: UInt64): string
  cellFromString(text: string): UInt64

  // the unit is part of the name, so no unit string crosses the bridge at call time.
  cellAreaKm2(cell: UInt64): number
  cellAreaM2(cell: UInt64): number
  cellAreaRads2(cell: UInt64): number
  // coordinates in degrees; the C functions take two `::LatLng` pointers in radians.
  greatCircleDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number
  greatCircleDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number
  greatCircleDistanceRads(lat1: number, lng1: number, lat2: number, lng2: number): number

  cellToParent(cell: UInt64, res: number): UInt64
  cellToCenterChild(cell: UInt64, res: number): UInt64
  cellToChildrenSize(cell: UInt64, res: number): number
  cellToChildPos(cell: UInt64, parentRes: number): number
  // the one H3 argument that is a plain `int64_t` rather than an index, so it crosses as a `number`.
  childPosToCell(childPos: number, parent: UInt64, childRes: number): UInt64
  cellToChildren(cell: UInt64, res: number): ArrayBuffer
  // a cell set in and a cell set out; both cross as `ArrayBuffer` and neither is copied.
  compactCells(cells: ArrayBuffer): ArrayBuffer
  uncompactCells(cells: ArrayBuffer, res: number): ArrayBuffer

  // additive batch surface beyond h3-js. Coordinates are interleaved `[lat, lng]` doubles; the
  // wrapper views the returned `ArrayBuffer` as a typed array without copying.
  latLngsToCells(coords: ArrayBuffer, res: number): ArrayBuffer
  cellsToLatLngs(cells: ArrayBuffer): ArrayBuffer
  // one boundary batch answers three values, so a struct rides back rather than three calls. The
  // stride is `MAX_CELL_BNDRY_VERTS * 2`, which C++ fills in so the number has a single source.
  cellsToBoundaries(cells: ArrayBuffer): CellBoundaryBuffers

  getHexagonAreaAvgKm2(res: number): number
  getHexagonAreaAvgM2(res: number): number
  getHexagonEdgeLengthAvgKm(res: number): number
  getHexagonEdgeLengthAvgM(res: number): number
  // C answers `int64_t`; every value fits a JavaScript number exactly, so the spec type is `number`.
  getNumCells(res: number): number
  getRes0Cells(): ArrayBuffer
  getPentagons(res: number): ArrayBuffer
  // the one cell set whose elements are face numbers rather than indexes, so it crosses as
  // `std::vector<double>` rather than as a buffer.
  getIcosahedronFaces(cell: UInt64): number[]

  // async twins of the four operations that can exceed Nitro's 50 ms rule of thumb; each dispatches
  // the same `h3ops::` call its synchronous sibling makes, on a worker thread.
  polygonToCellsAsync(rings: number[][][], res: number): Promise<ArrayBuffer>
  polygonToCellsExperimentalAsync(
    rings: number[][][],
    res: number,
    flags: number,
  ): Promise<ArrayBuffer>
  // a rejection carries `what()` alone, without the `H3.<method>(...): ` prefix a synchronous throw
  // gets; the wrapper's regex in `src/H3Error.ts` tolerates both shapes.
  cellsToMultiPolygonAsync(cells: ArrayBuffer): Promise<CoordPair[][][]>
  uncompactCellsAsync(cells: ArrayBuffer, res: number): Promise<ArrayBuffer>

  // the cell ceiling crosses as a `number` because `Infinity` has to survive the trip; C++ maps it
  // to the no-limit sentinel it starts with, and owns the validation.
  setMaxCellCount(maxCellCount: number): void
}
