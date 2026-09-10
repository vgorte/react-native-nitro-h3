# 🔢 Cell indexes and bigint

> **Audience: package users who want to know what a cell is in this package.** An H3 index is a
> 64-bit integer. This page explains why it arrives as a `bigint`, what that costs at the
> boundary, and how the surface lines up with `h3-js`.

## A cell is a `bigint`

H3 indexes are represented as JavaScript `bigint` values:

```ts
import { latLngToCell } from 'react-native-nitro-h3'

const cell = latLngToCell(37.7749, -122.4194, 9)

console.log(cell)
// 0x89283082803ffffn
```

This avoids converting every H3 index to and from a hexadecimal string on the hot path.

When a string representation is required, for example when communicating with a backend, convert only at the application boundary:

```ts
import { cellFromString, cellToString } from 'react-native-nitro-h3'

const hex = cellToString(cell)
const restored = cellFromString(hex)
```

> `JSON.stringify` does not support `bigint` directly.

## API compatibility with `h3-js`

The package covers the **`h3-js` 4.5.0 operation set** under the same function names, and answers
typed results instead of strings.

These are the differences a call site meets:

| `h3-js`                                                 | `react-native-nitro-h3`                         |
| ------------------------------------------------------- | ----------------------------------------------- |
| Cell indexes are hexadecimal strings                    | Cell indexes are `bigint`                       |
| Cell collections are `string[]`                         | Cell collections are `BigUint64Array`           |
| Coordinates are `[lat, lng]` arrays                     | Coordinates are `{ lat, lng }` objects          |
| `cellArea(cell, 'km2')`                                 | `cellAreaKm2(cell)`                             |
| `greatCircleDistance([lat1, lng1], [lat2, lng2], 'km')` | `greatCircleDistanceKm(lat1, lng1, lat2, lng2)` |
| A single polygon loop may be unwrapped, `number[][]`    | A loop stays wrapped in an array, `Ring[]`      |
| `formatAsGeoJson` and `isGeoJson` flags                 | Not provided                                    |
| `UNITS` and `POLYGON_TO_CELLS_FLAGS`                    | Not provided; `ContainmentMode` names the modes |
| `h3IndexToSplitLong` / `splitLongToH3Index`             | Not provided                                    |
| Loose JavaScript argument coercion                      | Strict native validation                        |
| No cell allocation limit                                | Optional `maxCellCount`                         |

The table above is the subset a call site meets on the first day.
[Divergences from h3-js 4.5.0](../h3-js-divergences.md) is the exhaustive list, and names what
proves each one: most rows are proved by a test, and the functions that follow upstream H3 point to
the vendored source instead. The call-site changes are walked through in
[Migrating from h3-js](../migrating-from-h3-js.md).
