//
//  HybridH3.cpp
//  react-native-nitro-h3
//
//  Created by Viktor Gorte on 26.08.26.
//

#include "HybridH3.hpp"

#include <cmath>
#include <cstdint>
#include <memory>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

#include "HybridH3Conversions.hpp"
#include "core/CellBuffer.hpp"
#include "core/H3ErrorMapping.hpp"
#include "core/Validation.hpp"
#include "ops/Batches.hpp"
#include "ops/Edges.hpp"
#include "ops/Hierarchy.hpp"
#include "ops/Indexing.hpp"
#include "ops/Inspection.hpp"
#include "ops/Measurement.hpp"
#include "ops/Misc.hpp"
#include "ops/Regions.hpp"
#include "ops/Traversal.hpp"
#include "ops/Units.hpp"
#include "ops/Vertexes.hpp"
#include "shapes/CellSetCall.hpp"

using namespace margelo::nitro::h3::detail;

namespace margelo::nitro::h3 {

uint64_t HybridH3::latLngToCell(double lat, double lng, double res) {
  return h3ops::latLngToCell(lat, lng, res);
}

std::tuple<double, double> HybridH3::cellToLatLng(uint64_t cell) {
  const h3core::Point centre = h3ops::cellToLatLng(cell);
  return {centre.lat, centre.lng};
}

std::vector<std::tuple<double, double>> HybridH3::cellToBoundary(uint64_t cell) {
  return toCoordPairs(h3ops::cellToBoundary(cell));
}

std::shared_ptr<ArrayBuffer> HybridH3::gridDisk(uint64_t origin, double k) {
  return toArrayBuffer(h3ops::gridDisk(origin, k));
}

std::shared_ptr<ArrayBuffer> HybridH3::gridRing(uint64_t origin, double k) {
  return toArrayBuffer(h3ops::gridRing(origin, k));
}

std::shared_ptr<ArrayBuffer> HybridH3::gridRingUnsafe(uint64_t origin, double k) {
  return toArrayBuffer(h3ops::gridRingUnsafe(origin, k));
}

std::vector<std::shared_ptr<ArrayBuffer>> HybridH3::gridDiskDistances(uint64_t origin, double k) {
  std::vector<h3core::CellBuffer> rings = h3ops::gridDiskDistances(origin, k);
  std::vector<std::shared_ptr<ArrayBuffer>> buffers;
  buffers.reserve(rings.size());
  for (h3core::CellBuffer& ring : rings) {
    buffers.push_back(toArrayBuffer(std::move(ring)));
  }
  return buffers;
}

std::shared_ptr<ArrayBuffer> HybridH3::gridPathCells(uint64_t start, uint64_t end) {
  return toArrayBuffer(h3ops::gridPathCells(start, end));
}

double HybridH3::gridDistance(uint64_t origin, uint64_t destination) {
  // a grid distance is bounded by the number of cells at resolution 15, so the widening is exact
  return static_cast<double>(h3ops::gridDistance(origin, destination));
}

CoordIJ HybridH3::cellToLocalIj(uint64_t origin, uint64_t cell) {
  const h3core::IJ ij = h3ops::cellToLocalIj(origin, cell);
  return CoordIJ(static_cast<double>(ij.i), static_cast<double>(ij.j));
}

uint64_t HybridH3::localIjToCell(uint64_t origin, double i, double j) {
  return h3ops::localIjToCell(origin, i, j);
}

bool HybridH3::areNeighborCells(uint64_t origin, uint64_t destination) {
  return h3ops::areNeighborCells(origin, destination);
}

uint64_t HybridH3::cellsToDirectedEdge(uint64_t origin, uint64_t destination) {
  return h3ops::cellsToDirectedEdge(origin, destination);
}

uint64_t HybridH3::getDirectedEdgeOrigin(uint64_t edge) {
  return h3ops::getDirectedEdgeOrigin(edge);
}

uint64_t HybridH3::getDirectedEdgeDestination(uint64_t edge) {
  return h3ops::getDirectedEdgeDestination(edge);
}

uint64_t HybridH3::reverseDirectedEdge(uint64_t edge) {
  return h3ops::reverseDirectedEdge(edge);
}

std::shared_ptr<ArrayBuffer> HybridH3::directedEdgeToCells(uint64_t edge) {
  return toArrayBuffer(h3ops::directedEdgeToCells(edge));
}

std::shared_ptr<ArrayBuffer> HybridH3::originToDirectedEdges(uint64_t origin) {
  return toArrayBuffer(h3ops::originToDirectedEdges(origin));
}

std::vector<std::tuple<double, double>> HybridH3::directedEdgeToBoundary(uint64_t edge) {
  return toCoordPairs(h3ops::directedEdgeToBoundary(edge));
}

double HybridH3::edgeLengthKm(uint64_t edge) {
  return h3ops::edgeLengthKm(edge);
}

double HybridH3::edgeLengthM(uint64_t edge) {
  return h3ops::edgeLengthM(edge);
}

double HybridH3::edgeLengthRads(uint64_t edge) {
  return h3ops::edgeLengthRads(edge);
}

uint64_t HybridH3::cellToVertex(uint64_t cell, double vertexNum) {
  return h3ops::cellToVertex(cell, vertexNum);
}

std::shared_ptr<ArrayBuffer> HybridH3::cellToVertexes(uint64_t cell) {
  return toArrayBuffer(h3ops::cellToVertexes(cell));
}

std::tuple<double, double> HybridH3::vertexToLatLng(uint64_t vertex) {
  const h3core::Point point = h3ops::vertexToLatLng(vertex);
  return {point.lat, point.lng};
}

std::vector<std::vector<std::vector<std::tuple<double, double>>>>
HybridH3::cellsToMultiPolygon(const std::shared_ptr<ArrayBuffer>& cells) {
  const CellSpan span = toCellSpan(cells);
  return toCoordPairGrid(h3ops::cellsToMultiPolygon(span.data, span.count));
}

std::shared_ptr<ArrayBuffer> HybridH3::polygonToCells(const std::vector<std::vector<std::vector<double>>>& rings,
                                                      double res) {
  return toArrayBuffer(h3ops::polygonToCells(rings, res));
}

std::shared_ptr<ArrayBuffer>
HybridH3::polygonToCellsExperimental(const std::vector<std::vector<std::vector<double>>>& rings, double res,
                                     double flags) {
  return toArrayBuffer(h3ops::polygonToCellsExperimental(rings, res, flags));
}

double HybridH3::degsToRads(double degrees) {
  return h3ops::degsToRads(degrees);
}

double HybridH3::radsToDegs(double radians) {
  return h3ops::radsToDegs(radians);
}

bool HybridH3::isValidCell(uint64_t cell) {
  return h3ops::isValidCell(cell);
}

bool HybridH3::isValidIndex(uint64_t index) {
  return h3ops::isValidIndex(index);
}

bool HybridH3::isValidDirectedEdge(uint64_t edge) {
  return h3ops::isValidDirectedEdge(edge);
}

bool HybridH3::isValidVertex(uint64_t vertex) {
  return h3ops::isValidVertex(vertex);
}

bool HybridH3::isPentagon(uint64_t cell) {
  return h3ops::isPentagon(cell);
}

bool HybridH3::isResClassIII(uint64_t cell) {
  return h3ops::isResClassIII(cell);
}

double HybridH3::getResolution(uint64_t index) {
  return static_cast<double>(h3ops::getResolution(index));
}

double HybridH3::getBaseCellNumber(uint64_t cell) {
  return static_cast<double>(h3ops::getBaseCellNumber(cell));
}

double HybridH3::getIndexDigit(uint64_t cell, double digit) {
  return static_cast<double>(h3ops::getIndexDigit(cell, digit));
}

uint64_t HybridH3::constructCell(double baseCellNumber, const std::vector<double>& digits, double res) {
  return h3ops::constructCell(baseCellNumber, digits, res);
}

std::string HybridH3::cellToString(uint64_t cell) {
  return h3ops::cellToString(cell);
}

uint64_t HybridH3::cellFromString(const std::string& text) {
  return h3ops::cellFromString(text);
}

double HybridH3::cellAreaKm2(uint64_t cell) {
  return h3ops::cellAreaKm2(cell);
}

double HybridH3::cellAreaM2(uint64_t cell) {
  return h3ops::cellAreaM2(cell);
}

double HybridH3::cellAreaRads2(uint64_t cell) {
  return h3ops::cellAreaRads2(cell);
}

double HybridH3::greatCircleDistanceKm(double lat1, double lng1, double lat2, double lng2) {
  return h3ops::greatCircleDistanceKm(lat1, lng1, lat2, lng2);
}

double HybridH3::greatCircleDistanceM(double lat1, double lng1, double lat2, double lng2) {
  return h3ops::greatCircleDistanceM(lat1, lng1, lat2, lng2);
}

double HybridH3::greatCircleDistanceRads(double lat1, double lng1, double lat2, double lng2) {
  return h3ops::greatCircleDistanceRads(lat1, lng1, lat2, lng2);
}

uint64_t HybridH3::cellToParent(uint64_t cell, double res) {
  return h3ops::cellToParent(cell, res);
}

uint64_t HybridH3::cellToCenterChild(uint64_t cell, double res) {
  return h3ops::cellToCenterChild(cell, res);
}

double HybridH3::cellToChildrenSize(uint64_t cell, double res) {
  // at most `getNumCells(15)`, well inside `2^53 - 1`, so the widening is exact
  return static_cast<double>(h3ops::cellToChildrenSize(cell, res));
}

double HybridH3::cellToChildPos(uint64_t cell, double parentRes) {
  return static_cast<double>(h3ops::cellToChildPos(cell, parentRes));
}

uint64_t HybridH3::childPosToCell(double childPos, uint64_t parent, double childRes) {
  return h3ops::childPosToCell(childPos, parent, childRes);
}

std::shared_ptr<ArrayBuffer> HybridH3::cellToChildren(uint64_t cell, double res) {
  return toArrayBuffer(h3ops::cellToChildren(cell, res));
}

std::shared_ptr<ArrayBuffer> HybridH3::compactCells(const std::shared_ptr<ArrayBuffer>& cells) {
  const CellSpan span = toCellSpan(cells);
  return toArrayBuffer(h3ops::compactCells(span.data, span.count));
}

std::shared_ptr<ArrayBuffer> HybridH3::uncompactCells(const std::shared_ptr<ArrayBuffer>& cells, double res) {
  const CellSpan span = toCellSpan(cells);
  return toArrayBuffer(h3ops::uncompactCells(span.data, span.count, res));
}

std::shared_ptr<ArrayBuffer> HybridH3::latLngsToCells(const std::shared_ptr<ArrayBuffer>& coords, double res) {
  const DoubleSpan span = toDoubleSpan(coords);
  return toArrayBuffer(h3ops::latLngsToCells(span.data, span.count, res));
}

std::shared_ptr<ArrayBuffer> HybridH3::cellsToLatLngs(const std::shared_ptr<ArrayBuffer>& cells) {
  const CellSpan span = toCellSpan(cells);
  return toArrayBuffer(h3ops::cellsToLatLngs(span.data, span.count));
}

CellBoundaryBuffers HybridH3::cellsToBoundaries(const std::shared_ptr<ArrayBuffer>& cells) {
  const CellSpan span = toCellSpan(cells);
  h3ops::BoundaryBuffers result = h3ops::cellsToBoundaries(span.data, span.count);
  return CellBoundaryBuffers(static_cast<double>(h3ops::kBoundaryStride), toArrayBuffer(std::move(result.vertices)),
                             toArrayBuffer(std::move(result.vertexCounts)));
}

double HybridH3::getHexagonAreaAvgKm2(double res) {
  return h3ops::getHexagonAreaAvgKm2(res);
}

double HybridH3::getHexagonAreaAvgM2(double res) {
  return h3ops::getHexagonAreaAvgM2(res);
}

double HybridH3::getHexagonEdgeLengthAvgKm(double res) {
  return h3ops::getHexagonEdgeLengthAvgKm(res);
}

double HybridH3::getHexagonEdgeLengthAvgM(double res) {
  return h3ops::getHexagonEdgeLengthAvgM(res);
}

double HybridH3::getNumCells(double res) {
  // `569707381193162` at resolution `15` is well inside `2^53 - 1`, so the widening is exact
  return static_cast<double>(h3ops::getNumCells(res));
}

std::shared_ptr<ArrayBuffer> HybridH3::getRes0Cells() {
  return toArrayBuffer(h3ops::getRes0Cells());
}

std::shared_ptr<ArrayBuffer> HybridH3::getPentagons(double res) {
  return toArrayBuffer(h3ops::getPentagons(res));
}

std::vector<double> HybridH3::getIcosahedronFaces(uint64_t cell) {
  const std::vector<int> faces = h3ops::getIcosahedronFaces(cell);
  std::vector<double> widened;
  widened.reserve(faces.size());
  for (const int face : faces) {
    widened.push_back(static_cast<double>(face));
  }
  return widened;
}

void HybridH3::setMaxCellCount(double maxCellCount) {
  static constexpr const char* kMessage = "maxCellCount must be a positive integer or Infinity";
  // `Infinity` is how a caller restores the default, and `h3core::toInt64` rejects it, so it is
  // mapped before the narrowing rather than after.
  if (std::isinf(maxCellCount) && maxCellCount > 0.0) {
    h3shapes::setMaxCellCount(h3shapes::kNoCellLimit);
    return;
  }
  const int64_t limit = h3core::toInt64(maxCellCount, kMessage);
  if (limit < 1) {
    h3core::throwInvalidArgument(kMessage);
  }
  h3shapes::setMaxCellCount(limit);
}

} // namespace margelo::nitro::h3
