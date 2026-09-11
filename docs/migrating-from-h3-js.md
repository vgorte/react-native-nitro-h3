# 🔄 Migrating from h3-js

A move from `h3-js` to `react-native-nitro-h3` changes the types that cross into JavaScript, tightens validation, and drops a few `h3-js` functions that have no purpose here.

## Cell Indexes as `bigint`

The main change is that H3 indexes are numeric `bigint` values rather than strings:

```ts title="h3-js"
const cell = latLngToCell(37.7749, -122.4194, 9) // "89283082803ffff"
```

The same call answers a `bigint` here:

```ts title="react-native-nitro-h3"
const cell = latLngToCell(37.7749, -122.4194, 9) // 0x89283082803ffffn
```

> [!WARNING]
> A `bigint` cell is never `===` to a hexadecimal string, so a comparison against a stored string id silently never matches.
> `JSON.stringify` throws on a `bigint` rather than serialising it.

Convert at the application boundary, not on the hot path:

```ts
import { cellFromString, cellToString, latLngToCell } from 'react-native-nitro-h3'

const cell = latLngToCell(37.7749, -122.4194, 9)

const hex = cellToString(cell) // "89283082803ffff"
const restored = cellFromString(hex) // 0x89283082803ffffn
```

## Cell Sets as `BigUint64Array`

A cell set answers as a `BigUint64Array`, which has `length`, indexing and iteration, but no `map` that returns an array of objects:

```ts title="h3-js"
const ring: string[] = gridDisk('89283082803ffff', 1)
ring.map((cell) => cellToLatLng(cell))
```

The same call answers a typed array here:

```ts title="react-native-nitro-h3"
const ring: BigUint64Array = gridDisk(0x89283082803ffffn, 1)
Array.from(ring, (cell) => cellToLatLng(cell))
```

Use `Array.from` with a mapping function, or loop with `for...of`.

## Coordinates as `{ lat, lng }` Objects

A coordinate answers as an object with named fields rather than a positional pair:

```ts title="h3-js"
const [lat, lng] = cellToLatLng('89283082803ffff')
```

The same call answers an object here, so the fields come out by name:

```ts title="react-native-nitro-h3"
const { lat, lng } = cellToLatLng(0x89283082803ffffn)
```

[`cellToLatLng`](../packages/react-native-nitro-h3/docs/api.md#celltolatlng), [`cellToBoundary`](../packages/react-native-nitro-h3/docs/api.md#celltoboundary), [`directedEdgeToBoundary`](../packages/react-native-nitro-h3/docs/api.md#directededgetoboundary), [`vertexToLatLng`](../packages/react-native-nitro-h3/docs/api.md#vertextolatlng) and [`cellsToMultiPolygon`](../packages/react-native-nitro-h3/docs/api.md#cellstomultipolygon) answer `{ lat, lng }` objects, where `h3-js` answers `[lat, lng]` arrays from all five.
Polygon input keeps the `[latitude, longitude]` pair on both sides.

There is no `formatAsGeoJson` and no `isGeoJson` flag, so no call switches to `[lng, lat]` order.

A polygon with a single loop still passes it as [`Ring[]`](../packages/react-native-nitro-h3/docs/api.md#ring), where `h3-js` also accepts the loop unwrapped as `number[][]`.
[`Ring`](../packages/react-native-nitro-h3/docs/api.md#ring) is a tuple type, so `tsc` rejects a bare `number[][]` against it.

## Unit Suffixes instead of Unit Arguments

Units are separate functions such as [`cellAreaKm2`](../packages/react-native-nitro-h3/docs/api.md#cellareakm2) rather than a string argument:

```ts title="h3-js"
cellArea(cell, 'km2')
edgeLength(edge, 'm')
greatCircleDistance([lat1, lng1], [lat2, lng2], 'km')
```

The unit sits in the function name here:

```ts title="react-native-nitro-h3"
cellAreaKm2(cell)
edgeLengthM(edge)
greatCircleDistanceKm(lat1, lng1, lat2, lng2)
```

The `E_UNKNOWN_UNIT` error of `h3-js` is therefore one this package cannot raise, and there is no `UNITS` constant to import.
[`greatCircleDistanceKm`](../packages/react-native-nitro-h3/docs/api.md#greatcircledistancekm) takes four scalars rather than two coordinate arrays.

## Strict Validation

The package throws an [`H3Error`](../packages/react-native-nitro-h3/docs/api.md#h3error) for a `k`, resolution, vertex number or child position that is not an integer, where `h3-js` truncates the value and answers.
[`cellToParent(cell, 1.5)`](../packages/react-native-nitro-h3/docs/api.md#celltoparent) throws `Resolution must be an integer between 0 and 15` here, where `h3-js` answers the resolution 1 parent.

A polygon vertex outside `[-90, 90]` latitude or `[-180, 180]` longitude is refused as well, with `Polygon coordinates must be within [-90, 90] latitude and [-180, 180] longitude`, where `h3-js` normalises the vertex and answers.
Rejecting rather than wrapping keeps a ring across the antimeridian where it was drawn.

[`cellToLocalIj`](../packages/react-native-nitro-h3/docs/api.md#celltolocalij) and [`localIjToCell`](../packages/react-native-nitro-h3/docs/api.md#localijtocell) follow upstream H3 rather than this package's own compatibility promise, so their local IJ coordinates are not a serialisation format; see [Functions That Follow Upstream H3](./h3-js-divergences.md#functions-that-follow-upstream-h3).

## What Has No `h3-js` Counterpart

- [`latLngsToCells`](../packages/react-native-nitro-h3/docs/api.md#latlngstocells), [`cellsToLatLngs`](../packages/react-native-nitro-h3/docs/api.md#cellstolatlngs) and [`cellsToBoundaries`](../packages/react-native-nitro-h3/docs/api.md#cellstoboundaries) index, read or trace a whole typed array in one native call, see [Typed Arrays and Batch Calls](./concepts/typed-arrays-and-batch.md).
- [`configure({ maxCellCount })`](../packages/react-native-nitro-h3/docs/api.md#configure) sets an optional cell ceiling, see [Errors and Memory Safety](./concepts/errors-and-memory-safety.md).
- `h3IndexToSplitLong` and `splitLongToH3Index` are not provided: a `bigint` already carries all 64 bits.
- `UNITS` and `POLYGON_TO_CELLS_FLAGS` are not provided: the unit is in the function name, and [`polygonToCellsExperimental`](../packages/react-native-nitro-h3/docs/api.md#polygontocellsexperimental) takes a [`ContainmentMode`](../packages/react-native-nitro-h3/docs/api.md#containmentmode) number or the matching `h3-js` name.

## Every Other Difference

[Divergences from h3-js](./h3-js-divergences.md) lists every deliberate difference with the `h3-js` answer beside it, and names what proves each one: most rows are proved by a test in `parity/divergences.test.ts`, the error contract's package half by `__tests__/H3Error.test.ts`, and the functions that follow upstream H3 quote the vendored sources instead.

## Correctness

Every before and after pair here is written against `h3-js` 4.5.0, the version pinned in `packages/react-native-nitro-h3/package.json` and exercised by the tests in `parity/`.
Open an issue if a call no longer behaves the way this page shows.
