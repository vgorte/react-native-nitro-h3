# 🔄 Migrating from h3-js

## Cell indexes are `bigint`

The main change is that H3 indexes are numeric `bigint` values rather than strings:

```ts
// h3-js
const cell = latLngToCell(37.7749, -122.4194, 9)
// "89283082803ffff"

// react-native-nitro-h3
const cell = latLngToCell(37.7749, -122.4194, 9)
// 0x89283082803ffffn
```

A `bigint` cannot be passed to `JSON.stringify` and is never `===` to a string. Convert at the
application boundary, not on the hot path:

```ts
import { cellFromString, cellToString, latLngToCell } from 'react-native-nitro-h3'

const cell = latLngToCell(37.7749, -122.4194, 9)

const hex = cellToString(cell) // "89283082803ffff"
const restored = cellFromString(hex) // 0x89283082803ffffn
```

## Cell sets are `BigUint64Array`

```ts
// h3-js
const ring: string[] = gridDisk('89283082803ffff', 1)
ring.map((cell) => cellToLatLng(cell))

// react-native-nitro-h3
const ring: BigUint64Array = gridDisk(0x89283082803ffffn, 1)
Array.from(ring, (cell) => cellToLatLng(cell))
```

A `BigUint64Array` has `length`, indexing and iteration, but no `map` that returns an array of
objects. Use `Array.from` with a mapping function, or loop with `for...of`.

## Coordinates are `{ lat, lng }` objects

```ts
// h3-js
const [lat, lng] = cellToLatLng('89283082803ffff')

// react-native-nitro-h3
const { lat, lng } = cellToLatLng(0x89283082803ffffn)
```

`cellToLatLng`, `cellToBoundary`, `directedEdgeToBoundary`, `vertexToLatLng` and
`cellsToMultiPolygon` answer `{ lat, lng }` objects, where `h3-js` answers `[lat, lng]` arrays from
all five. Polygon input keeps the `[latitude, longitude]` pair on both sides.

There is no `formatAsGeoJson` and no `isGeoJson` flag, so no call switches to `[lng, lat]` order.

A polygon with a single loop still passes it as `Ring[]`, where `h3-js` also accepts the loop
unwrapped as `number[][]`; `Ring` is a tuple type that `tsc` rejects a bare `number[][]` against.

## Unit suffixes replace unit arguments

```ts
// h3-js
cellArea(cell, 'km2')
edgeLength(edge, 'm')
greatCircleDistance([lat1, lng1], [lat2, lng2], 'km')

// react-native-nitro-h3
cellAreaKm2(cell)
edgeLengthM(edge)
greatCircleDistanceKm(lat1, lng1, lat2, lng2)
```

Units are separate functions such as `cellAreaKm2` rather than a string argument, so the
`E_UNKNOWN_UNIT` error of `h3-js` is one this package cannot raise, and there is no `UNITS` constant
to import. `greatCircleDistanceKm` takes four scalars rather than two coordinate arrays.

## Strict validation

The package throws an `H3Error` for a `k`, resolution, vertex number or child position that is not
an integer, where `h3-js` truncates the value and answers. `cellToParent(cell, 1.5)` throws
`Resolution must be an integer between 0 and 15` here, where `h3-js` answers the resolution 1
parent.

A polygon vertex outside `[-90, 90]` latitude or `[-180, 180]` longitude is refused as well, with
`Polygon coordinates must be within [-90, 90] latitude and [-180, 180] longitude`, where `h3-js`
normalises the vertex and answers. Rejecting rather than wrapping keeps a ring across the
antimeridian where it was drawn.

`cellToLocalIj` and `localIjToCell` follow upstream H3 rather than this package's own compatibility
promise, so their local IJ coordinates are not a serialisation format; see
[Functions that follow upstream H3](./h3-js-divergences.md#functions-that-follow-upstream-h3).

## What has no `h3-js` counterpart

- `latLngsToCells`, `cellsToLatLngs` and `cellsToBoundaries` index, read or trace a whole typed array
  in one native call, see [Typed arrays and batch calls](./concepts/typed-arrays-and-batch.md).
- `configure({ maxCellCount })` sets an optional cell ceiling, see
  [Errors and memory safety](./concepts/errors-and-memory-safety.md).
- `h3IndexToSplitLong` and `splitLongToH3Index` are not provided: a `bigint` already carries all 64
  bits.
- `UNITS` and `POLYGON_TO_CELLS_FLAGS` are not provided: the unit is in the function name, and
  `polygonToCellsExperimental` takes a `ContainmentMode` number or the matching `h3-js` name.

## Every other difference

[Divergences from h3-js 4.5.0](./h3-js-divergences.md) lists every deliberate difference with the
`h3-js` answer beside it, and names what proves each one: most rows are proved by a test in
`parity/divergences.test.ts`, the error contract's package half by `__tests__/H3Error.test.ts`, and
the functions that follow upstream H3 quote the vendored sources instead.
