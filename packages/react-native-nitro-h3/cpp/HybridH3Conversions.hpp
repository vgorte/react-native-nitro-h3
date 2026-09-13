//
//  HybridH3Conversions.hpp
//  react-native-nitro-h3
//
//  Created by Viktor Gorte on 26.08.26.
//

#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <tuple>
#include <vector>

#include "HybridH3Spec.hpp"
#include "core/CellBuffer.hpp"
#include "core/Geometry.hpp"
#include "core/H3ErrorMapping.hpp"

namespace margelo::nitro::h3::detail {

/** Hands a filled `CellBuffer` to JS as an owning `ArrayBuffer` of exactly `count() * 8` bytes. */
inline std::shared_ptr<ArrayBuffer> toArrayBuffer(h3core::CellBuffer&& buffer) {
  const int64_t count = buffer.count();
  // holds the block until `wrap` has taken it, so a throw in between does not leak
  std::unique_ptr<uint64_t[]> owned(buffer.release());
  if (owned == nullptr) {
    // unreachable for a non-empty result; `wrap` rejects `nullptr`, `new uint64_t[0]` does not
    owned.reset(new uint64_t[0]);
  }

  uint64_t* cells = owned.get();
  // the deleter frees the `uint64_t*` allocated above, never the `uint8_t*` wrapped below
  auto wrapped = ArrayBuffer::wrap(reinterpret_cast<uint8_t*>(cells), static_cast<size_t>(count) * sizeof(uint64_t),
                                   [cells]() { delete[] cells; });
  owned.release();
  return wrapped;
}

/** Borrows a read-only view of a cell set that arrived from JS. */
struct CellSpan {
  const uint64_t* data;
  int64_t count;
};

/**
 * Validates an inbound `ArrayBuffer` and views it as cells.
 *
 * The span is valid only for the duration of the synchronous call, because a buffer from JS is
 * borrowing and Nitro enforces that by throwing from `data()` and `size()` off the JS thread.
 */
inline CellSpan toCellSpan(const std::shared_ptr<ArrayBuffer>& buffer) {
  if (buffer == nullptr) {
    h3core::throwInvalidArgument("Expected a cell set");
  }
  const size_t bytes = buffer->size();
  if (bytes == 0) {
    return CellSpan{nullptr, 0};
  }
  uint8_t* data = buffer->data();
  if (data == nullptr) {
    h3core::throwInvalidArgument("The cell set has already been released");
  }
  if (bytes % sizeof(uint64_t) != 0) {
    h3core::throwInvalidArgument("A cell set's byte length must be a multiple of 8");
  }
  if (reinterpret_cast<uintptr_t>(data) % alignof(uint64_t) != 0) {
    h3core::throwInvalidArgument("A cell set must be aligned to 8 bytes");
  }
  return CellSpan{reinterpret_cast<const uint64_t*>(data), static_cast<int64_t>(bytes / sizeof(uint64_t))};
}

/**
 * Hands a vector to JS as an owning `ArrayBuffer` over its elements.
 *
 * `T` is the type the JS side views: `double` for interleaved coordinates and boundary vertices,
 * `uint8_t` for the per-cell vertex counts of a boundary batch.
 */
template <typename T> std::shared_ptr<ArrayBuffer> toArrayBuffer(std::vector<T>&& values) {
  if (values.empty()) {
    // `wrap` rejects `nullptr`, which an empty vector's `data()` may be
    return ArrayBuffer::allocate(0);
  }
  auto owned = std::make_unique<std::vector<T>>(std::move(values));
  uint8_t* data = reinterpret_cast<uint8_t*>(owned->data());
  const size_t bytes = owned->size() * sizeof(T);
  // the deleter frees the vector that owns the block, never the `uint8_t*` wrapped below
  auto wrapped = ArrayBuffer::wrap(data, bytes, [buffer = owned.get()]() { delete buffer; });
  owned.release();
  return wrapped;
}

/** Borrows a read-only view of interleaved coordinates that arrived from JS. */
struct DoubleSpan {
  const double* data;
  int64_t count;
};

/**
 * Validates an inbound `ArrayBuffer` and views it as doubles.
 *
 * The span is valid only for the duration of the synchronous call, as `toCellSpan`'s is, and the
 * checks are the same four in the same order, worded for coordinates.
 */
inline DoubleSpan toDoubleSpan(const std::shared_ptr<ArrayBuffer>& buffer) {
  if (buffer == nullptr) {
    h3core::throwInvalidArgument("Expected a coordinate set");
  }
  const size_t bytes = buffer->size();
  if (bytes == 0) {
    return DoubleSpan{nullptr, 0};
  }
  uint8_t* data = buffer->data();
  if (data == nullptr) {
    h3core::throwInvalidArgument("The coordinate set has already been released");
  }
  if (bytes % sizeof(double) != 0) {
    h3core::throwInvalidArgument("A coordinate set's byte length must be a multiple of 8");
  }
  if (reinterpret_cast<uintptr_t>(data) % alignof(double) != 0) {
    h3core::throwInvalidArgument("A coordinate set must be aligned to 8 bytes");
  }
  return DoubleSpan{reinterpret_cast<const double*>(data), static_cast<int64_t>(bytes / sizeof(double))};
}

/** Copies a ring of degrees into the tuple pairs nitrogen maps a `CoordPair` to. */
inline std::vector<std::tuple<double, double>> toCoordPairs(const h3core::Ring& ring) {
  std::vector<std::tuple<double, double>> points;
  points.reserve(ring.size());
  for (const h3core::Point& point : ring) {
    points.emplace_back(point.lat, point.lng);
  }
  return points;
}

/** Builds the three-level nesting nitrogen returns for `cellsToMultiPolygon` from an `h3core::MultiPolygon`. */
inline std::vector<std::vector<std::vector<std::tuple<double, double>>>>
toCoordPairGrid(const h3core::MultiPolygon& polygons) {
  std::vector<std::vector<std::vector<std::tuple<double, double>>>> result;
  result.reserve(polygons.size());
  for (const h3core::Polygon& polygon : polygons) {
    std::vector<std::vector<std::tuple<double, double>>> loops;
    loops.reserve(polygon.size());
    for (const h3core::Ring& ring : polygon) {
      loops.push_back(toCoordPairs(ring));
    }
    result.push_back(std::move(loops));
  }
  return result;
}

/**
 * Copies an inbound cell set so a worker thread may read it.
 *
 * A buffer that arrived from JavaScript is borrowing, and Nitro enforces that rather than merely
 * documenting it: `JSArrayBuffer::data()` and `size()` throw when called off the converting thread.
 * So this runs in the synchronous prologue, before dispatch, and it copies unconditionally.
 */
inline std::shared_ptr<ArrayBuffer> copyInbound(const std::shared_ptr<ArrayBuffer>& buffer) {
  if (buffer == nullptr) {
    h3core::throwInvalidArgument("Expected a cell set");
  }
  const size_t byteLength = buffer->size();
  // the same checks `toCellSpan` makes, in the same order and words; alignment is not checked
  // because `ArrayBuffer::copy` allocates aligned
  if (byteLength == 0) {
    // `ArrayBuffer::copy` memcpys from a pointer it requires to be non-null
    return ArrayBuffer::allocate(0);
  }
  if (buffer->data() == nullptr) {
    // `JSArrayBuffer::data()` answers `nullptr` once the JS object or its runtime has gone
    h3core::throwInvalidArgument("The cell set has already been released");
  }
  if (byteLength % sizeof(uint64_t) != 0) {
    h3core::throwInvalidArgument("A cell set's byte length must be a multiple of 8");
  }
  return ArrayBuffer::copy(buffer);
}

/** Views an owned buffer as cells. Never call this on a borrowed buffer off the JavaScript thread. */
inline const uint64_t* cellsOf(const std::shared_ptr<ArrayBuffer>& buffer) {
  // `ArrayBuffer::copy` and `ArrayBuffer::allocate` both allocate with `new uint8_t[n]`, aligned to
  // `__STDCPP_DEFAULT_NEW_ALIGNMENT__` and so to at least 8 everywhere this builds
  return reinterpret_cast<const uint64_t*>(buffer->data());
}

/** Returns the number of cells in an owned buffer. */
inline int64_t countOf(const std::shared_ptr<ArrayBuffer>& buffer) {
  return static_cast<int64_t>(buffer->size() / sizeof(uint64_t));
}

} // namespace margelo::nitro::h3::detail
