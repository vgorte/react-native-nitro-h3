//
//  HybridH3.hpp
//  react-native-nitro-h3
//
//  Created by Viktor Gorte on 26.08.26.
//

#pragma once

#include "HybridH3Spec.hpp"

namespace margelo::nitro::h3 {

/**
 * Implements the `H3` HybridObject as an adapter: it converts Nitro's types to the plain ones
 * `cpp/ops` takes and back again. Validation and memory discipline live in `cpp/ops` and
 * `cpp/core`, which know nothing about Nitro.
 */
class HybridH3 final : public HybridH3Spec {
public:
  HybridH3() : HybridObject(TAG) {}

  // Indexing
  uint64_t latLngToCell(double lat, double lng, double res) override;
  std::tuple<double, double> cellToLatLng(uint64_t cell) override;
  std::vector<std::tuple<double, double>> cellToBoundary(uint64_t cell) override;

  // Traversal
  std::shared_ptr<ArrayBuffer> gridDisk(uint64_t origin, double k) override;
  std::shared_ptr<ArrayBuffer> gridRing(uint64_t origin, double k) override;
  std::shared_ptr<ArrayBuffer> gridRingUnsafe(uint64_t origin, double k) override;
  std::vector<std::shared_ptr<ArrayBuffer>> gridDiskDistances(uint64_t origin, double k) override;
  std::shared_ptr<ArrayBuffer> gridPathCells(uint64_t start, uint64_t end) override;
  double gridDistance(uint64_t origin, uint64_t destination) override;
  CoordIJ cellToLocalIj(uint64_t origin, uint64_t cell) override;
  uint64_t localIjToCell(uint64_t origin, double i, double j) override;

  // Edges
  bool areNeighborCells(uint64_t origin, uint64_t destination) override;
  uint64_t cellsToDirectedEdge(uint64_t origin, uint64_t destination) override;
  uint64_t getDirectedEdgeOrigin(uint64_t edge) override;
  uint64_t getDirectedEdgeDestination(uint64_t edge) override;
  uint64_t reverseDirectedEdge(uint64_t edge) override;
  std::shared_ptr<ArrayBuffer> directedEdgeToCells(uint64_t edge) override;
  std::shared_ptr<ArrayBuffer> originToDirectedEdges(uint64_t origin) override;
  std::vector<std::tuple<double, double>> directedEdgeToBoundary(uint64_t edge) override;
  double edgeLengthKm(uint64_t edge) override;
  double edgeLengthM(uint64_t edge) override;
  double edgeLengthRads(uint64_t edge) override;

  // Vertexes
  uint64_t cellToVertex(uint64_t cell, double vertexNum) override;
  std::shared_ptr<ArrayBuffer> cellToVertexes(uint64_t cell) override;
  std::tuple<double, double> vertexToLatLng(uint64_t vertex) override;

  // Regions
  std::vector<std::vector<std::vector<std::tuple<double, double>>>>
  cellsToMultiPolygon(const std::shared_ptr<ArrayBuffer>& cells) override;
  std::shared_ptr<ArrayBuffer> polygonToCells(const std::vector<std::vector<std::vector<double>>>& rings,
                                              double res) override;
  std::shared_ptr<ArrayBuffer> polygonToCellsExperimental(const std::vector<std::vector<std::vector<double>>>& rings,
                                                          double res, double flags) override;

  // Units
  double degsToRads(double degrees) override;
  double radsToDegs(double radians) override;

  // Inspection
  bool isValidCell(uint64_t cell) override;
  bool isValidIndex(uint64_t index) override;
  bool isValidDirectedEdge(uint64_t edge) override;
  bool isValidVertex(uint64_t vertex) override;
  bool isPentagon(uint64_t cell) override;
  bool isResClassIII(uint64_t cell) override;
  double getResolution(uint64_t index) override;
  double getBaseCellNumber(uint64_t cell) override;
  double getIndexDigit(uint64_t cell, double digit) override;
  uint64_t constructCell(double baseCellNumber, const std::vector<double>& digits, double res) override;
  std::string cellToString(uint64_t cell) override;
  uint64_t cellFromString(const std::string& text) override;

  // Measurement
  double cellAreaKm2(uint64_t cell) override;
  double cellAreaM2(uint64_t cell) override;
  double cellAreaRads2(uint64_t cell) override;
  double greatCircleDistanceKm(double lat1, double lng1, double lat2, double lng2) override;
  double greatCircleDistanceM(double lat1, double lng1, double lat2, double lng2) override;
  double greatCircleDistanceRads(double lat1, double lng1, double lat2, double lng2) override;

  // Hierarchy
  uint64_t cellToParent(uint64_t cell, double res) override;
  uint64_t cellToCenterChild(uint64_t cell, double res) override;
  double cellToChildrenSize(uint64_t cell, double res) override;
  double cellToChildPos(uint64_t cell, double parentRes) override;
  uint64_t childPosToCell(double childPos, uint64_t parent, double childRes) override;
  std::shared_ptr<ArrayBuffer> cellToChildren(uint64_t cell, double res) override;
  std::shared_ptr<ArrayBuffer> compactCells(const std::shared_ptr<ArrayBuffer>& cells) override;
  std::shared_ptr<ArrayBuffer> uncompactCells(const std::shared_ptr<ArrayBuffer>& cells, double res) override;
  std::shared_ptr<ArrayBuffer> latLngsToCells(const std::shared_ptr<ArrayBuffer>& coords, double res) override;
  std::shared_ptr<ArrayBuffer> cellsToLatLngs(const std::shared_ptr<ArrayBuffer>& cells) override;
  CellBoundaryBuffers cellsToBoundaries(const std::shared_ptr<ArrayBuffer>& cells) override;

  // Misc
  double getHexagonAreaAvgKm2(double res) override;
  double getHexagonAreaAvgM2(double res) override;
  double getHexagonEdgeLengthAvgKm(double res) override;
  double getHexagonEdgeLengthAvgM(double res) override;
  double getNumCells(double res) override;
  std::shared_ptr<ArrayBuffer> getRes0Cells() override;
  std::shared_ptr<ArrayBuffer> getPentagons(double res) override;
  std::vector<double> getIcosahedronFaces(uint64_t cell) override;

  // Async
  // each is a synchronous prologue plus a `Promise<T>::async` dispatch; a borrowed resource is
  // touched only in the prologue, never in the dispatched lambda
  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>>
  polygonToCellsAsync(const std::vector<std::vector<std::vector<double>>>& rings, double res) override;
  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>>
  polygonToCellsExperimentalAsync(const std::vector<std::vector<std::vector<double>>>& rings, double res,
                                  double flags) override;
  std::shared_ptr<Promise<std::vector<std::vector<std::vector<std::tuple<double, double>>>>>>
  cellsToMultiPolygonAsync(const std::shared_ptr<ArrayBuffer>& cells) override;
  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> uncompactCellsAsync(const std::shared_ptr<ArrayBuffer>& cells,
                                                                             double res) override;

  // Configuration
  void setMaxCellCount(double maxCellCount) override;
};

} // namespace margelo::nitro::h3
