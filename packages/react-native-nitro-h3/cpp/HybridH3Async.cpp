//
//  HybridH3Async.cpp
//  react-native-nitro-h3
//
//  Created by Viktor Gorte on 28.08.26.
//

#include <cstdint>
#include <exception>
#include <memory>
#include <tuple>
#include <utility>
#include <vector>

#include <NitroModules/ArrayBuffer.hpp>
#include <NitroModules/Promise.hpp>

#include "HybridH3.hpp"
#include "HybridH3Conversions.hpp"
#include "ops/Hierarchy.hpp"
#include "ops/Regions.hpp"

namespace margelo::nitro::h3 {

std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>>
HybridH3::polygonToCellsAsync(const std::vector<std::vector<std::vector<double>>>& rings, double res) {
  // no inbound `ArrayBuffer`: nitrogen converted the nested arrays eagerly, so the vector is owned here
  std::vector<std::vector<std::vector<double>>> owned = rings;
  return Promise<std::shared_ptr<ArrayBuffer>>::async(
      [owned = std::move(owned), res]() -> std::shared_ptr<ArrayBuffer> {
        return detail::toArrayBuffer(h3ops::polygonToCells(owned, res));
      });
}

std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>>
HybridH3::polygonToCellsExperimentalAsync(const std::vector<std::vector<std::vector<double>>>& rings, double res,
                                          double flags) {
  std::vector<std::vector<std::vector<double>>> owned = rings;
  return Promise<std::shared_ptr<ArrayBuffer>>::async(
      [owned = std::move(owned), res, flags]() -> std::shared_ptr<ArrayBuffer> {
        return detail::toArrayBuffer(h3ops::polygonToCellsExperimental(owned, res, flags));
      });
}

std::shared_ptr<Promise<std::vector<std::vector<std::vector<std::tuple<double, double>>>>>>
HybridH3::cellsToMultiPolygonAsync(const std::shared_ptr<ArrayBuffer>& cells) {
  std::shared_ptr<ArrayBuffer> owned;
  // a malformed cell set rejects the promise rather than throwing out of a promise-returning method
  try {
    owned = detail::copyInbound(cells);
  } catch (...) {
    return Promise<std::vector<std::vector<std::vector<std::tuple<double, double>>>>>::rejected(
        std::current_exception());
  }
  return Promise<std::vector<std::vector<std::vector<std::tuple<double, double>>>>>::async(
      [owned = std::move(owned)]() -> std::vector<std::vector<std::vector<std::tuple<double, double>>>> {
        return detail::toCoordPairGrid(h3ops::cellsToMultiPolygon(detail::cellsOf(owned), detail::countOf(owned)));
      });
}

std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>>
HybridH3::uncompactCellsAsync(const std::shared_ptr<ArrayBuffer>& cells, double res) {
  std::shared_ptr<ArrayBuffer> owned;
  // a malformed cell set rejects the promise rather than throwing out of a promise-returning method
  try {
    owned = detail::copyInbound(cells);
  } catch (...) {
    return Promise<std::shared_ptr<ArrayBuffer>>::rejected(std::current_exception());
  }
  return Promise<std::shared_ptr<ArrayBuffer>>::async(
      [owned = std::move(owned), res]() -> std::shared_ptr<ArrayBuffer> {
        return detail::toArrayBuffer(h3ops::uncompactCells(detail::cellsOf(owned), detail::countOf(owned), res));
      });
}

} // namespace margelo::nitro::h3
