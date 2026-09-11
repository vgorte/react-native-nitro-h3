# 🔢 Cell Indexes and bigint

## A Cell as a `bigint`

A cell is a JavaScript `bigint`, the 64-bit H3 index itself rather than its hexadecimal spelling:

```ts
import { latLngToCell } from 'react-native-nitro-h3'

const cell = latLngToCell(37.7749, -122.4194, 9) // 617700169957507071n
```

This avoids converting every H3 index to and from a hexadecimal string on the hot path.

When a string representation is required, for example when communicating with a backend, convert only at the application boundary:

```ts
import { cellFromString, cellToString } from 'react-native-nitro-h3'

const hex = cellToString(cell) // '89283082803ffff'
const restored = cellFromString(hex) // 617700169957507071n
```

> [!NOTE]
> `JSON.stringify` throws on a `bigint`, so convert at the boundary before serialising.

## API Compatibility with `h3-js`

The package covers the `h3-js` 4.5.0 operation set under the same function names, and answers typed results instead of strings.

These are the differences a call site meets on the first day:

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

[Divergences from h3-js](../h3-js-divergences.md) is the exhaustive list, and names what proves each one: most rows are proved by a test, and the functions that follow upstream H3 point to the vendored source instead.
The call-site changes are walked through in [Migrating from h3-js](../migrating-from-h3-js.md).
