# 📦 Typed arrays and batch calls

## Cell sets are typed arrays

Cell collections use `BigUint64Array`:

```ts
import { gridDisk, latLngToCell } from 'react-native-nitro-h3'

const cell = latLngToCell(37.7749, -122.4194, 9)
const cells = gridDisk(cell, 10)

console.log(cells instanceof BigUint64Array) // true
```

A result crosses as one `ArrayBuffer` and is viewed in place: no per-element copy, no string
conversion.

## The batch calls

Three additional APIs process complete typed arrays in a single native call:

```ts
import {
  latLngsToCells,
  cellsToLatLngs,
  cellsToBoundaries,
} from 'react-native-nitro-h3'

const coords = new Float64Array([
  37.7749, -122.4194,
  37.8044, -122.2712,
])

const cells = latLngsToCells(coords, 9)
// BigUint64Array

const centres = cellsToLatLngs(cells)
// Float64Array: [lat0, lng0, lat1, lng1, ...]
```

Coordinates use interleaved `[latitude, longitude]` pairs.

These APIs are additive and are not part of the `h3-js` compatibility surface, which [Divergences from h3-js 4.5.0](../h3-js-divergences.md#the-additive-batch-calls) records and a test asserts. They are intended for workloads where repeatedly crossing the JS/native boundary would otherwise dominate execution time.

The saving is the crossing, not a faster inner loop. Host measurements put the native work of
`latLngsToCells` and `cellsToLatLngs` within about 2 % of the native work of the loop each replaces,
so what disappears is the per-element boundary crossing.

### `latLngsToCells`

```ts
function latLngsToCells(coords: Float64Array, res: number): BigUint64Array
```

Indexes a whole coordinate set in one native call. `coords` is interleaved
`[lat0, lng0, lat1, lng1, ...]` in degrees, latitude first, the reverse of the GeoJSON order.
Returns one cell per pair, in input order.

- An odd `coords.length` throws an `H3Error` reading `A coordinate set must hold an even number of
  doubles`.
- A rejected pair throws an `H3Error` whose message carries its index, as in `coords[3]: ...`.
- A `res` outside `0` to `15` is rejected on the first pair, so the message reads
  `coords[0]: Resolution argument was outside of acceptable range (code: 4)`.
- An empty `coords` returns an empty `BigUint64Array`, and `res` is never judged.
- The [cell ceiling](../performance.md#the-cell-ceiling-in-detail) applies, counted in cells: one cell per pair.

### `cellsToLatLngs`

```ts
function cellsToLatLngs(cells: BigUint64Array): Float64Array
```

Reads the centres of a whole cell set in one native call. Returns interleaved
`[lat0, lng0, lat1, lng1, ...]` in degrees, latitude first again, two entries per cell, which is the
flat coordinate buffer circle layers and heatmaps consume.

- An invalid cell throws an `H3Error` whose message carries its index, such as
  `cells[1]: Cell argument was not valid (code: 5)`.
- An empty `cells` returns an empty `Float64Array`, and no element is validated.
- The [cell ceiling](../performance.md#the-cell-ceiling-in-detail) applies, counted in cells, and is checked before the first centre is read.

### `cellsToBoundaries`

```ts
function cellsToBoundaries(cells: BigUint64Array): CellBoundaries

interface CellBoundaries {
  stride: number
  vertices: Float64Array
  vertexCounts: Uint8Array
}
```

Reads the boundary of every cell in one native call, into a fixed-stride buffer a renderer can walk
by index:

```ts
const { stride, vertices, vertexCounts } = cellsToBoundaries(cells)
for (let i = 0; i < cells.length; i++) {
  const base = i * stride
  for (let j = 0; j < vertexCounts[i]; j++) {
    path.lineTo(project(vertices[base + 2 * j], vertices[base + 2 * j + 1]))
  }
}
```

- `stride` is always `20`, ten `[lat, lng]` pairs, which is H3's `MAX_CELL_BNDRY_VERTS` doubled. Cell
  `i` starts at `i * stride`, so any cell is reached without a scan.
- `vertexCounts[i]` is how many of those pairs are real: `5` for a pentagon at an even resolution and
  `10` at an odd one, `6` for a hexagon, `7` or `8` where a hexagon crosses an icosahedron edge.
- Slots past the count hold `NaN`, never `0`, so a read past the count is visible instead of landing
  off the coast of Africa.
- Vertices are in the same order and the same degrees `cellToBoundary` answers, latitude first.
- An invalid cell throws an `H3Error` whose message carries its index, such as
  `cells[1]: Cell argument was not valid (code: 5)`.
- An empty `cells` returns empty arrays, with `stride` still `20`.
- The [cell ceiling](../performance.md#the-cell-ceiling-in-detail) applies, counted in cells, and is
  checked before anything is allocated. One cell weighs 161 bytes here, 160 of vertices and 1 of
  count, rather than the 8 bytes of a cell set.

## What a batch call saves

![One batch call against the loop it replaces, 100,000 elements](../../img/benchmark-batch.svg)

The saving is the bridge crossings that no longer happen. Same conditions as the headline benchmark: iPhone XS, iOS 18.7.9, React Native 0.87.0, Hermes, 20-run median, 2026-09-01. Full data in [Benchmark report](../benchmark.md).

Whether a batch call pays for a given input size is covered in
[Performance guide](../performance.md#when-a-batch-call-pays), and the measured rows are `W11` and
`W12` in [Benchmark report](../benchmark.md).
