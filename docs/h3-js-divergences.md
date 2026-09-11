# 🔀 Divergences from h3-js

`h3-js` 4.5.0 bundles exactly the H3 C library this package vendors, so it is an oracle rather than an approximation.
`parity/` compares the two over all 122 resolution 0 cells, all sixteen resolutions, all 192 pentagons, the immediate neighbourhood of every pentagon up to resolution 5, the poles, the antimeridian and seeded random coordinates.
Test paths below are relative to `packages/react-native-nitro-h3/`.

Every row and section below is proved by a test in `parity/divergences.test.ts`, except the error contract's package half, proved in `__tests__/H3Error.test.ts`, and the section on functions that follow upstream H3, which quotes the vendored sources instead of asserting against a test.
Where `parity/divergences.test.ts` does the proving, it asserts both sides; the type-surface rows are proved there for `h3-js` at run time and for this package by `tsc`, because the probe the suite drives speaks JSON.
The additive batch section leans on `parity/batches.test.ts` as well, which is where the three calls are compared with `h3-js` element for element.

This package covers the `h3-js` 4.5.0 operation set under the same names and answers typed results.
Nothing outside the list below answers differently over the corpus `parity/` compares.

`h3-js` runs anywhere JavaScript does, needs no native build step and no New Architecture, and its cells are strings that serialise without a thought.
It is the wider-adopted library and the right one on the web.
This page lists where the two answer differently, not where one is better.

## Input This Package Refuses and `h3-js` Answers

| Input class | This package | `h3-js` | Why |
| --- | --- | --- | --- |
| An invalid cell index, to any operation taking one but the nine exemptions | throws `E_CELL_INVALID` (code 5) | reads the bits and answers: `cellArea('1', 'km2')` is `4106166.33`, `gridDisk('1', 1)` is six cells | H3 checks only the base cell range on most paths (`h3Index.c:1120`), so a malformed index yields a plausible answer rather than an error. Validating once at the boundary is what makes the rest of the binding able to trust its input. |
| An invalid directed edge, such as one whose direction bits are `0` | throws `E_DIR_EDGE_INVALID` (code 6) | `getDirectedEdgeOrigin` answers with a cell | Every reader in `directedEdge.c` goes through `getDirectedEdgeOrigin`, which checks the mode bits and nothing else (`directedEdge.c:157`). |
| An invalid vertex, such as a cell index | throws `E_VERTEX_INVALID` (code 8) | `vertexToLatLng` answers with a coordinate | `vertexToLatLng` clears the mode bits of whatever it is handed and measures the result (`vertex.c:326`). |
| A `k`, resolution, vertex number, child position or local IJ coordinate that is not an integer | throws this package's own wording, with no `code`: `k must be an integer`, `Resolution must be an integer between 0 and 15`, `Vertex number must be an integer`, `Child position must be an integer`, `Local IJ coordinates must be integers` | truncates and answers: `gridDisk(cell, 1.5)` is the `k` of 1 disk, `cellToParent(cell, 1.5)` is the resolution 1 parent, `cellToVertex(cell, 0.5)` is vertex `0`, `childPosToCell(1.5, cell, 10)` is child `1`, `localIjToCell(origin, { i: 1.5, j: 0 })` is the same cell as `{ i: 1, j: 0 }` | Emscripten's argument marshalling truncates the double. A silently different answer is worse than a refusal. |
| A resolution that is not an integer, where `h3-js` validates in JavaScript (`getHexagonAreaAvg*`, `getHexagonEdgeLengthAvg*`, `getNumCells`) | throws `Resolution must be an integer between 0 and 15`, with no `code` | throws `E_RES_DOMAIN` (code 4) with `, value: 1.5` appended | H3 never sees the argument, so there is no H3 error to report. |
| A polygon point that is not a `[lat, lng]` pair | throws `Each polygon point must be a [latitude, longitude] pair` | throws `E_FAILED` (code 1) | Saying what a point has to be is more useful than a generic failure. |
| A polygon coordinate that is not finite | throws `Polygon coordinates must be finite numbers` | throws `E_FAILED` (code 1) | As above. |
| A polygon coordinate outside the globe | throws `Polygon coordinates must be within [-90, 90] latitude and [-180, 180] longitude`, with no `code` | normalises and answers: `polygonToCells([[[91, 0], [0, 0], [1, 1]]], 3)` is 41 cells | H3 builds a polygon's bounding box from raw vertex extrema with no range check (`polygonAlgos.h:176`), so one vertex off the globe engulfs it: the experimental fill then scans the whole cell hierarchy, measured once at about 36 seconds for a single `polygonToCellsExperimental` call over a five-point ring on an Apple M-series host at `-O3`, with no committed reproduction. Rejecting rather than wrapping keeps a ring across the antimeridian where it was drawn. |
| `compactCells` over a set with an invalid member | throws `E_CELL_INVALID` (code 5) | throws `E_RES_MISMATCH` (code 12), because H3 reads the invalid member as another resolution | The boundary check runs before H3 sees the set. |
| `uncompactCells` over a set with an invalid member | throws `E_CELL_INVALID` (code 5) | throws `E_MEMORY_BOUNDS` (code 14) after sizing the output from the invalid member, an allocation that leaves its Emscripten heap unusable for the rest of the process | As above. |
| `constructCell` with a digit count that is not the resolution | throws `constructCell needs exactly res digits`, with no `code` | throws `E_DIGIT_DOMAIN` (code 18) with `, value: 3` | H3 never sees the digit count, so it cannot report on it. |

The nine exemptions have no error channel and answer for any input, exactly as `h3-js` does: [`isValidCell`](../packages/react-native-nitro-h3/docs/api.md#isvalidcell), [`isValidIndex`](../packages/react-native-nitro-h3/docs/api.md#isvalidindex), [`isPentagon`](../packages/react-native-nitro-h3/docs/api.md#ispentagon), [`isResClassIII`](../packages/react-native-nitro-h3/docs/api.md#isresclassiii), [`isValidDirectedEdge`](../packages/react-native-nitro-h3/docs/api.md#isvaliddirectededge), [`isValidVertex`](../packages/react-native-nitro-h3/docs/api.md#isvalidvertex), [`getResolution`](../packages/react-native-nitro-h3/docs/api.md#getresolution), [`getBaseCellNumber`](../packages/react-native-nitro-h3/docs/api.md#getbasecellnumber) and [`cellToString`](../packages/react-native-nitro-h3/docs/api.md#celltostring).
[`getResolution`](../packages/react-native-nitro-h3/docs/api.md#getresolution) answers `-1` for an index that is not a valid cell, which is what `h3-js` answers too.
[`cellFromString`](../packages/react-native-nitro-h3/docs/api.md#cellfromstring) takes text rather than a cell index, so it converts whatever parses and leaves the verdict to the operation the result is passed to.

## The Optional Cell Ceiling

[`configure({ maxCellCount })`](../packages/react-native-nitro-h3/docs/api.md#configure) caps how many cells one call may allocate.
Nothing is capped until a call sets a ceiling, so by default a request is answered at whatever size H3 reports, as `h3-js` answers it.

With a ceiling of 4,000,000 in force, [`gridDisk(cell, 1155)`](../packages/react-native-nitro-h3/docs/api.md#griddisk) throws
`The requested result of 4005541 cells exceeds the cell limit of 4000000 set with configure({ maxCellCount }). Raise or remove the limit to allow it.`
with no `code`, where `h3-js` allocates all 4,005,541 cells and has no such control.
Every cell-producing call sizes its result before allocating anything, which is what makes the refusal possible at all.

## Functions That Follow Upstream H3

Four exports track the H3 C library rather than this package's own compatibility promise.
Their names, argument order and return types are covered like every other export.
The cells and coordinates they answer are upstream's to change, and may change when the vendored H3 version changes.

| Function | What upstream says |
| --- | --- |
| `polygonToCellsExperimental` | "This is an experimental-only API and is subject to change in minor versions" (`h3api.h:325`) |
| `polygonToCellsExperimentalAsync` | binds the same C function, so the same sentence applies |
| `cellToLocalIj` | "This function's output is not guaranteed to be compatible across different versions of H3" (`localij.c:523`) |
| `localIjToCell` | reads the coordinates `cellToLocalIj` produces, so the same sentence applies |

> [!WARNING]
> Local IJ coordinates are not a serialisation format.
> Do not store them, and do not send them between systems that may run different H3 versions.

## The Additive Batch Calls

[`latLngsToCells`](../packages/react-native-nitro-h3/docs/api.md#latlngstocells), [`cellsToLatLngs`](../packages/react-native-nitro-h3/docs/api.md#cellstolatlngs) and [`cellsToBoundaries`](../packages/react-native-nitro-h3/docs/api.md#cellstoboundaries) run a scalar operation over a whole typed array in one native call.
`h3-js` exports none of them, so they are additive rather than a difference in behaviour: element for element they answer what a [`latLngToCell`](../packages/react-native-nitro-h3/docs/api.md#latlngtocell), [`cellToLatLng`](../packages/react-native-nitro-h3/docs/api.md#celltolatlng) or [`cellToBoundary`](../packages/react-native-nitro-h3/docs/api.md#celltoboundary) loop answers, which `parity/batches.test.ts` proves over the corpus.
`parity/divergences.test.ts` asserts that `h3-js` has none of the three exports, so the day it grows one this section fails rather than ages.

| Case | This package | `h3-js` |
| --- | --- | --- |
| `latLngsToCells` | takes a `Float64Array` of interleaved `[lat, lng]` pairs and answers one `BigUint64Array`, one cell per pair | no counterpart |
| `cellsToLatLngs` | takes a `BigUint64Array` of cells and answers one interleaved `Float64Array`, two doubles per cell | no counterpart |
| `cellsToBoundaries` | takes a `BigUint64Array` of cells and answers `{ stride, vertices, vertexCounts }`: 20 doubles per cell of `[lat, lng]` pairs, padded with `NaN`, and the vertex count of each | no counterpart |

An invalid element is refused the way every other input is, with the index in the message
(`cells[1]: Cell argument was not valid (code: 5)`), and the optional cell ceiling applies to all
three, counted in cells.

## The Error Contract

Every failure this package raises is an [`H3Error`](../packages/react-native-nitro-h3/docs/api.md#h3error).
Its `code` is the contract and its `message` is informational.

`code` carries H3's own numeric error code when H3 reported the failure, and is `undefined` when this package refused the input before H3 saw it.
Branch on `code`, and treat `undefined` as this package's own refusal.
The numbers are H3's, listed in the [H3 error table](https://h3geo.org/docs/library/errors#table-of-error-codes).

`message` is H3's `describeH3Error` wording, or this package's own wording for an input it refused itself.
It may change when the vendored H3 version changes, and the two rows below show that `h3-js`'s copy of the same table has already drifted from it.
Do not parse it.

## Wording

| Case | This package | `h3-js` | Why |
| --- | --- | --- | --- |
| Every H3 failure | `<describeH3Error text> (code: N)` | the same text and code, with `, value: X` appended where `h3-js` validated the argument itself | Both read the same table for 17 of the 19 codes. |
| `E_DIGIT_DOMAIN` (code 18) | `Child digits invalid` | `Child indexing digits invalid` | `h3-js` keeps a copy of the message table and this entry no longer matches `describeH3Error`. |
| `E_DELETED_DIGIT` (code 19) | `Deleted subsequence indicates invalid index` | `Child indexing digits refer to a deleted subsequence` | As above. |
| `E_OPTION_INVALID` (code 15) | `Mode or flags argument was not valid (code: 15)` | `Unknown error (code: 15, value: 4)` | `h3-js` rejects an unknown containment mode in JavaScript, from a second table that has no entry for 15. The code is the same on both sides. |

## Arithmetic

Both sides run the same C source, so a difference here is the compiler's, not the algorithm's.
The host and device builds are arm64 and contract a multiply and an add into one instruction; Emscripten does not.

That shows only where the arithmetic is ill-conditioned: near a pole, and on a cell small enough that a length or an area is the difference of near-equal terms.
Every figure below is the worst case measured over the corpus, and each is asserted at two to four times itself.

| Measurement | Agreement | Why |
| --- | --- | --- |
| Cell centres, boundaries and vertexes away from a pole, at every resolution | `5.7e-14` degrees | the last bit of a double |
| Great circle distances | `2.0e-15` relative | the haversine runs on the arguments themselves, so there is nothing to amplify |
| `getHexagonAreaAvg*`, `getHexagonEdgeLengthAvg*`, `degsToRads` | bit-identical | one lookup in a compiled-in table, or one multiply |
| `radsToDegs` | `1.6e-16` relative | one multiply by a constant whose last bit differs |
| Cell areas up to resolution 6 | `4.6e-13` relative | the last bit of a double |
| Cell areas at resolution 15 | `3.0e-9` relative, worst at the pentagon `8f0800000000000` | at half a metre across the area is a difference of near-equal terms, so the contraction reaches the ninth digit |
| `edgeLengthKm`, `edgeLengthM`, `edgeLengthRads` | `3.4e-15` relative at resolution 0, `1.4e-8` at resolution 15, worst at `14f0800000000000` | an edge half a metre long is the difference of two coordinates that agree to fourteen digits, so the contraction reaches the eighth digit |
| Cell boundaries within a degree of a pole | `2.84e-14` degrees at resolution 0, `1.46e-11` at 5, `5.89e-10` at 10, `1.82e-7` at 15, two centimetres on a cell half a metre across | the inverse projection is ill-conditioned at a pole, so the contracted multiply-add moves the result by more than a bit. Building with `-ffp-contract=off` brings the whole corpus back to `2.84e-14`. |

**Data provenance.** Every figure comes from the `parity/` suite, which compares the host probe `cpp/test/ParityProbe.cpp` against `h3-js` 4.5.0 over the corpus named at the top of this page.
The bounds they are asserted against live in `parity/divergences.test.ts`, `parity/scalars.test.ts`, `parity/cellSets.test.ts` and `parity/geometry.test.ts`.
The probe is built with `-DCMAKE_BUILD_TYPE=Release`, the configuration those bounds were measured on.

These are host figures read off a local arm64 run by hand, so nothing in CI reproduces them: `.github/workflows/parity.yml` builds the probe on `ubuntu-latest` and re-checks the bounds rather than the worst cases, and no device run is reduced into this table.
Cutoff 2026-08-28, against `h3-js` 4.5.0 and the vendored H3 `v4.5.0`.

## Shape and Surface

These are the differences a migration notices first, and nothing outside them answers differently over the corpus `parity/` compares.
[Cell Indexes and bigint](./concepts/cells-and-bigint.md#api-compatibility-with-h3-js) explains the ones a call site meets on the first day.

| Case | This package | `h3-js` |
| --- | --- | --- |
| A cell | `bigint` | hexadecimal `string` |
| A cell set | `BigUint64Array` | `string[]` |
| A cell argument | a `bigint` and nothing else | a hexadecimal `string` or a `[lower, upper]` pair of 32-bit numbers, the `H3IndexInput` type |
| A coordinate | a `LatLng` object, `{ lat, lng }`, from `cellToLatLng`, `cellToBoundary`, `directedEdgeToBoundary`, `vertexToLatLng` and `cellsToMultiPolygon` | a `CoordPair` array, `[lat, lng]`, from all five |
| GeoJSON output | no counterpart | `formatAsGeoJson` on `cellToBoundary`, `directedEdgeToBoundary` and `cellsToMultiPolygon` closes the loop and answers `[lng, lat]`; `isGeoJson` on `polygonToCells` and `polygonToCellsExperimental` reads `[lng, lat]` input |
| A polygon | `Ring[]`, so a single loop is still wrapped in an array, and `Ring` is a tuple type that a bare `number[][]` fails `tsc` against | `number[][] \| number[][][]`, so a single loop may be passed unwrapped and a ring is a plain `number[][]` |
| Units | separate functions (`cellAreaKm2`) | a string argument (`cellArea(cell, 'km2')`), and an `E_UNKNOWN_UNIT` this package cannot raise |
| `greatCircleDistance` | four scalars with the unit in the name: `greatCircleDistanceKm(lat1, lng1, lat2, lng2)` | two arrays and a unit string: `greatCircleDistance([lat1, lng1], [lat2, lng2], 'km')` |
| `localIjToCell` | an origin and two coordinate scalars: `localIjToCell(origin, i, j)` | an origin and a `CoordIJ` object: `localIjToCell(origin, coords)` |
| `gridDiskDistances` | one `BigUint64Array` per ring, so `BigUint64Array[]` | one `H3Index[]` per ring, so `string[][]` |
| `UNITS`, `POLYGON_TO_CELLS_FLAGS` | no counterpart: the unit is in the function name and a containment mode is a number | two frozen objects of strings |
| `ContainmentMode` | a frozen object of H3's four `ContainmentMode` numbers | no counterpart |
| `polygonToCellsExperimental` flags | a `ContainmentMode` number, or the `h3-js` name | the name only |
| `H3Error` | a class, so `instanceof` identifies it, whose `code` is `undefined` for an input this package refused itself | a plain `Error` with a numeric `code` property for an H3 failure, typed as `{ message, code }` |
| `constructCell` | `(baseCellNumber, digits, res)`, `h3-js`'s order rather than the C library's | `(baseCellNumber, digits, res)` |
| `cellToString`, `cellFromString` | convert between `bigint` and hexadecimal | no counterpart: `h3-js` cells already are strings |
| The four `Async` variants | `polygonToCellsAsync`, `polygonToCellsExperimentalAsync`, `cellsToMultiPolygonAsync` and `uncompactCellsAsync` run the operation on a background thread and answer a `Promise` of what the synchronous call answers | no counterpart |
| `h3IndexToSplitLong`, `splitLongToH3Index` | no counterpart | work around the lack of 64-bit integers in an Emscripten build |

The containment mode number and the `h3-js` name are proved to cover the same cells.
The name form the wrapper also takes is the device harness's to prove, because the probe takes the number.

## Correctness

Every row here is asserted against `h3-js` 4.5.0 by a test in `parity/`.
Open an issue if a row no longer matches what the two libraries do.
