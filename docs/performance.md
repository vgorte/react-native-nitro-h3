# 🧮 Performance guide

## Why native

`react-native-nitro-h3` vendors the H3 C library (v4.5.0) and calls it from C++ through Nitro
Modules. `h3-js` runs the same C library compiled to JavaScript with Emscripten, and every cell that
crosses into `h3-js` is a hexadecimal string.

![The data path from JavaScript through Nitro Modules and the h3ops C++ layer to the vendored H3 C core](../img/architecture.svg)

Three things are cheap on this path and expensive on the other:

- **One crossing per call, not one per element.** A `BigUint64Array` result is one `ArrayBuffer`
  that JavaScript views in place. `h3-js` returns a `string[]`, one allocation per cell.
- **No string conversion.** A cell is a 64-bit integer on both sides of the boundary. `h3-js`
  formats and parses a hexadecimal string per cell on the way in and out.
- **No marshalling below the boundary.** The `h3ops` layer validates arguments, sizes the result and
  applies the cell ceiling, then makes plain C calls into the vendored core.

The difference is largest where `h3-js`'s string handling dominates the work the call does:
`compactCells` on a `k=20` disk of 1,261 cells is 862× faster on the iPhone XS (iOS 18.7.9, React
Native 0.87.0, Hermes, 20-run median, 2026-09-01). Where a call does little work per element, the
factor is smaller: `latLngToCell` over 100,000 calls is 24×. Both rows are in
[Benchmark report](benchmark.md).

## When a Batch Call Pays

The batch rows in the benchmark run one native call against the JavaScript loop it replaces, over
100,000 elements. That size is favourable by construction. Below a few hundred, one crossing plus a
typed-array allocation is a larger share of the total, and that crossover is unmeasured. Building
the input `Float64Array` is not timed on either side either, so a caller who assembles one from
JavaScript objects pays for that on top. The measured rows are `W11` and `W12` in
[benchmark.md](benchmark.md).

The contract of all three calls is in [Typed arrays and batch calls](concepts/typed-arrays-and-batch.md).

## The Cell Ceiling in Detail

There is no cell limit until you set one: a call returns whatever you ask for, exactly as `h3-js`
does. Sizes grow fast, and a cell costs 8 bytes in the returned `BigUint64Array`. A batch call that
answers coordinates weighs more per cell: `cellsToBoundaries` costs 161 bytes, so the same ceiling
admits about twenty times the memory there.
`gridDisk(cell, k)` returns `1 + 3k(k+1)` cells, so `k` of 1,155 is 4,005,541 cells or 32 MB, and
`polygonToCells` over San Francisco at resolution 12 is 412,377.

A request keeps growing from there: `gridDisk(cell, 4000)` is 48,012,001 cells, 384 MB packed, and a
polygon covering a country at resolution 15 reports far more. On a mobile device an allocation at
that scale is not a slow call. It is a silent process kill that your JavaScript `try/catch` cannot
intercept. Set a cell ceiling and the request is refused before anything is allocated:

```ts
import { configure } from 'react-native-nitro-h3'

// 4,000,000 cells is exactly 32 MB at 8 bytes per cell
configure({ maxCellCount: 4_000_000 })
```

Every cell-producing function then queries the required size first and throws a catchable `H3Error`
when the answer is over the ceiling:

```text
The requested result of 4005541 cells exceeds the cell limit of 4000000 set with configure({ maxCellCount }). Raise or remove the limit to allow it.
```

With a ceiling in force, `polygonToCellsExperimental` refuses an unaffordable polygon before its own
size query walks it, priced by the bounding-box estimate `polygonToCells` uses, or by the length of
the outline where that box has no area.

`configure({ maxCellCount: Infinity })` removes a ceiling set earlier. The value must be a positive
integer or `Infinity`, and it applies to every sync and async cell-producing function from the
moment it is set.

### How It Compares to h3-js

`h3-js` offers no equivalent setting; it only bounds its Emscripten heap at a massive 2 GB. A heavy
call there will just execute: `gridDisk(cell, 1155)` allocates all 4,005,541 cells,
[measured on a desktop machine in benchmark.md](benchmark.md#the-cost-of-unbounded-requests-what-the-cell-ceiling-guards).

The four async variants and what a thread hop costs are in
[Sync and async](concepts/sync-and-async.md); the `H3Error` contract and the ceiling from the
caller's side are in [Errors and memory safety](concepts/errors-and-memory-safety.md).
