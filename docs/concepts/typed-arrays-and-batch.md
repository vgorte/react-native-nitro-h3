# 📦 Typed Arrays and Batch Calls

## Cell Sets as Typed Arrays

Cell collections use `BigUint64Array`:

```ts
import { gridDisk, latLngToCell } from 'react-native-nitro-h3'

const cell = latLngToCell(37.7749, -122.4194, 9)
const cells = gridDisk(cell, 10) // BigUint64Array, 331 cells
```

A result crosses as one `ArrayBuffer` and is viewed in place: no per-element copy, no string conversion.

> [!NOTE]
> A set near a pentagon is shorter than its formula predicts, because H3 pads its output with holes there and this package removes them before the buffer crosses.
> Read `length` rather than assuming the `1 + 3k(k + 1)` cells a disk holds elsewhere.

## The Batch Calls

Three batch calls process a whole typed array in one native call:

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

const cells = latLngsToCells(coords, 9) // BigUint64Array, one cell per pair
const centres = cellsToLatLngs(cells) // Float64Array, [lat0, lng0, lat1, lng1, ...]
```

Coordinates use interleaved `[latitude, longitude]` pairs.

The batch calls are additive and are not part of the `h3-js` compatibility surface, which [Divergences from h3-js](../h3-js-divergences.md#the-additive-batch-calls) records.
`parity/divergences.test.ts` asserts that `h3-js` exports none of the three, so the day it grows one this sentence fails rather than ages.
They are intended for workloads where repeatedly crossing the JS/native boundary would otherwise dominate execution time.

The saving is the crossing, not a faster inner loop.
Host measurements put the native work of a batch call within about 2 % of the native work of the loop it replaces over 100,000 elements, so what disappears is the per-element crossing: roughly 0.38 and 0.89 microseconds per element on the A12, 0.28 and 1.04 on the Galaxy S23.
See [Benchmark Report](../benchmark.md#the-batch-rows) for the conditions.

### `latLngsToCells`

Reach for this call when a coordinate set already sits in a `Float64Array`, because one native call replaces one boundary crossing per pair.
`coords` is interleaved `[lat0, lng0, lat1, lng1, ...]` in degrees, latitude first, the reverse of the GeoJSON order, and the result holds one cell per pair in input order.
The [cell ceiling](../performance.md#the-cell-ceiling-in-detail) applies, counted in cells: one cell per pair.

See [`latLngsToCells`](../../packages/react-native-nitro-h3/docs/api.md#latlngstocells) for the signature and the full error list.

### `cellsToLatLngs`

Reach for this call when a renderer wants centres rather than cells, because it answers the flat coordinate buffer circle layers and heatmaps consume.
The result is interleaved `[lat0, lng0, lat1, lng1, ...]` in degrees, latitude first again, two entries per cell.
The [cell ceiling](../performance.md#the-cell-ceiling-in-detail) applies, counted in cells, and is checked before the first centre is read.

See [`cellsToLatLngs`](../../packages/react-native-nitro-h3/docs/api.md#cellstolatlngs) for the signature and the full error list.

### `cellsToBoundaries`

Reach for this call when a renderer builds meshes or paths, because it reads the boundary of every cell into a fixed-stride buffer that can be walked by index:

```ts
const { stride, vertices, vertexCounts } = cellsToBoundaries(cells)
for (let i = 0; i < cells.length; i++) {
  const base = i * stride
  for (let j = 0; j < vertexCounts[i]; j++) {
    path.lineTo(project(vertices[base + 2 * j], vertices[base + 2 * j + 1]))
  }
}
```

- `stride` is always `20`, ten `[lat, lng]` pairs, which is H3's `MAX_CELL_BNDRY_VERTS` doubled.
  Cell `i` starts at `i * stride`, so any cell is reached without a scan.
- `vertexCounts[i]` is how many of those pairs are real: `5` for a pentagon at an even resolution and `10` at an odd one, `6` for a hexagon, `7` or `8` where a hexagon crosses an icosahedron edge.
- Slots past the count hold `NaN`, never `0`, so a read past the count is visible instead of landing off the coast of Africa.
- Vertices are in the same order and the same degrees [`cellToBoundary`](../../packages/react-native-nitro-h3/docs/api.md#celltoboundary) answers, latitude first.
- The [cell ceiling](../performance.md#the-cell-ceiling-in-detail) applies, counted in cells, and is checked before anything is allocated.
  One cell weighs 161 bytes here, 160 of vertices and 1 of count, rather than the 8 bytes of a cell set.

See [`cellsToBoundaries`](../../packages/react-native-nitro-h3/docs/api.md#cellstoboundaries) for the signature and the full error list.

## What a Batch Call Saves

![One batch call against the loop it replaces, 100,000 elements, lower is better](../../img/benchmark-batch.svg)

The saving is the bridge crossings that no longer happen.
Same conditions as the headline benchmark: iPhone XS, iOS 18.7.9, React Native 0.87.0, Hermes, 20-run median, 2026-09-01.
Full data in [Benchmark Report](../benchmark.md).

Whether a batch call pays for a given input size is covered in [Performance Guide](../performance.md#when-a-batch-call-pays), and the measured rows are `W11` and `W12` in [Benchmark Report](../benchmark.md).
Below a few hundred elements the crossover is unmeasured, so measure the sizes your own app actually passes before you switch a loop to a batch call.
