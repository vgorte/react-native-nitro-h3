# H3 function reference

> Derived from H3 v4.5.0 and `h3-js` v4.5.0 by reading the pinned upstream sources. Do not edit
> ad hoc; rebuild it against the pinned upstream when that version changes.

The authoritative mapping from this package's exported surface to the H3 C library it binds. Every
row is read off the upstream header named under Provenance.

## Provenance

| Item | Value |
|---|---|
| Upstream tag | `v4.5.0` (exact tag name; `refs/tags/v4.5.0` -> commit `1b536c34225191ba24a75a840f634d4a48c3b206`) |
| Primary header | `https://raw.githubusercontent.com/uber/h3/v4.5.0/src/h3lib/include/h3api.h.in` (860 lines) |
| Header verified by | contains `#define DECLSPEC`, `H3_EXPORT(name)`, and `typedef uint64_t H3Index;` (line 69) |
| Impl sources consulted (for doc comments only) | `https://github.com/uber/h3/archive/refs/tags/v4.5.0.tar.gz` -> `src/h3lib/lib/{h3Index,algos,directedEdge,vertex,localij,baseCells}.c` |
| h3-js export list | `https://raw.githubusercontent.com/uber/h3-js/v4.5.0/lib/h3core.js` (1973 lines, 58 `export` statements) |
| h3-js pinned H3 version | `https://raw.githubusercontent.com/uber/h3-js/v4.5.0/H3_VERSION` -> `4.5.0` (confirms the two sources are the same C library) |

**Derived totals** (full derivation under Export surface):

| Total | Value |
|---|---|
| C functions declared in `h3api.h.in` | **79** (`grep -c "^DECLSPEC"` = 79; the 3 other `DECLSPEC` grep hits are the `#define`s at lines 44/46/49) |
| h3-js `export`s | 58 = 2 constants (`UNITS`, `POLYGON_TO_CELLS_FLAGS`) + 56 functions |
| h3-js user-facing *operations* | **54** (56 functions minus the 2 JS-only split-long helpers) |
| Public TS parity functions shipped | **64** (= 54 - 5 unit-dispatch + 13 unit-suffixed + `cellToString` + `cellFromString`) |
| Distinct C functions bound | **75** (79 declared - 4 deliberately unbound) |
| C functions deliberately unbound | **4** |

Note on the "62": counting the 54 h3-js operations with the 5 unit-dispatch ones expanded gives 62
(54 - 5 + 13), and adding `cellToString` / `cellFromString` gives **64**. Both numbers are correct;
they count different things. This table has 64 rows.

Note on the exported surface: the 64 above are the *parity* functions, the ones this table enumerates
from upstream. The package also exports the 3 additive batch functions `latLngsToCells`,
`cellsToLatLngs` and `cellsToBoundaries`, which h3-js does not have and which therefore have no row
here, plus 4 `Async` variants of functions already listed and `configure`. `__tests__/exports.test.ts`
asserts the whole surface of 72 names; `docs/h3-js-divergences.md` records the additive
functions.

Notation used below:

- Signatures are verbatim from `h3api.h.in` with `DECLSPEC ` removed and `H3_EXPORT(x)` collapsed to
  `x` (that is what `H3_EXPORT` expands to when `H3_PREFIX` is undefined, line 38:
  `#define H3_EXPORT(name) name`). Line wrapping in the header is joined; no token is otherwise changed.
- "size source" names the C size function, or a compile-time constant with its value, or
  `caller input length`, or `n/a`.
- Shape ids `S1` to `S14` are this document's own taxonomy, defined under Shape taxonomy.

---

## Function mapping

Sorted by shape (S1..S14, then ONE-OFF), alphabetically within each shape.

| TS name | C function | full C signature (verbatim, macros stripped) | shape | size source | out-param & sentinel | error channel | notes |
|---|---|---|---|---|---|---|---|
| `degsToRads` | `degsToRads` | `double degsToRads(double degrees);` | S1 | n/a | none (scalar return) | none | header line 356. Cannot fail. |
| `radsToDegs` | `radsToDegs` | `double radsToDegs(double radians);` | S1 | n/a | none (scalar return) | none | header line 364. Cannot fail. |
| `getBaseCellNumber` | `getBaseCellNumber` | `int getBaseCellNumber(H3Index h);` | S2 | n/a | none (int return) | none | header line 524. Header doc: "Note: Technically works on H3 edges, but will return base cell of the origin cell." No error channel, so an invalid index yields a garbage-but-in-range number. |
| `getResolution` | `getResolution` | `int getResolution(H3Index h);` | S2 | n/a | none (int return) | none | header line 513. Header doc: "Works on both cells and directed edges." **Parity:** h3-js wraps this with `if (!H3.isValidCell(...)) return -1;` ("Compatability with stated API", h3core.js:787+), so a directed edge answers `-1` too. The C++ layer carries the same guard. |
| `isPentagon` | `isPentagon` | `int isPentagon(H3Index h);` | S2 | n/a | none (int return) | none | header line 680. Returns C int; TS returns `boolean`. |
| `isResClassIII` | `isResClassIII` | `int isResClassIII(H3Index h);` | S2 | n/a | none (int return) | none | header line 672. |
| `isValidCell` | `isValidCell` | `int isValidCell(H3Index h);` | S2 | n/a | none (int return) | none | header line 572. |
| `isValidDirectedEdge` | `isValidDirectedEdge` | `int isValidDirectedEdge(H3Index edge);` | S2 | n/a | none (int return) | none | header line 719. |
| `isValidIndex` | `isValidIndex` | `int isValidIndex(H3Index h);` | S2 | n/a | none (int return) | none | header line 583. |
| `isValidVertex` | `isValidVertex` | `int isValidVertex(H3Index vertex);` | S2 | n/a | none (int return) | none | header line 813. |
| `cellAreaKm2` | `cellAreaKm2` | `H3Error cellAreaKm2(H3Index h, double *out);` | S4 | n/a | `double*`, no sentinel | H3Error | header line 405. Unit split of h3-js `cellArea(cell, 'km2')`. |
| `cellAreaM2` | `cellAreaM2` | `H3Error cellAreaM2(H3Index h, double *out);` | S4 | n/a | `double*`, no sentinel | H3Error | header line 408. |
| `cellAreaRads2` | `cellAreaRads2` | `H3Error cellAreaRads2(H3Index h, double *out);` | S4 | n/a | `double*`, no sentinel | H3Error | header line 401. |
| `edgeLengthKm` | `edgeLengthKm` | `H3Error edgeLengthKm(H3Index edge, double *length);` | S4 | n/a | `double*`, no sentinel | H3Error | header line 430. Out-param is named `length`, not `out`. |
| `edgeLengthM` | `edgeLengthM` | `H3Error edgeLengthM(H3Index edge, double *length);` | S4 | n/a | `double*`, no sentinel | H3Error | header line 433. |
| `edgeLengthRads` | `edgeLengthRads` | `H3Error edgeLengthRads(H3Index edge, double *length);` | S4 | n/a | `double*`, no sentinel | H3Error | header line 427. |
| `getHexagonAreaAvgKm2` | `getHexagonAreaAvgKm2` | `H3Error getHexagonAreaAvgKm2(int res, double *out);` | S5 | n/a | `double*`, no sentinel | H3Error | header line 390. |
| `getHexagonAreaAvgM2` | `getHexagonAreaAvgM2` | `H3Error getHexagonAreaAvgM2(int res, double *out);` | S5 | n/a | `double*`, no sentinel | H3Error | header line 393. |
| `getHexagonEdgeLengthAvgKm` | `getHexagonEdgeLengthAvgKm` | `H3Error getHexagonEdgeLengthAvgKm(int res, double *out);` | S5 | n/a | `double*`, no sentinel | H3Error | header line 416. |
| `getHexagonEdgeLengthAvgM` | `getHexagonEdgeLengthAvgM` | `H3Error getHexagonEdgeLengthAvgM(int res, double *out);` | S5 | n/a | `double*`, no sentinel | H3Error | header line 419. |
| `getNumCells` | `getNumCells` | `H3Error getNumCells(int res, int64_t *out);` | S5 | n/a | `int64_t*`, no sentinel | H3Error | header line 482. **`int64_t` out, not `double`** - S5 is not homogeneous in out type. Max value at res 15 is `2 + 120*7^15` = 569,707,381,193,162, which is below `Number.MAX_SAFE_INTEGER` (5.7e14 < 9.0e15), so a JS `number` stays exact. This package returns a `number`, which stays exact at that magnitude. |
| `getDirectedEdgeDestination` | `getDirectedEdgeDestination` | `H3Error getDirectedEdgeDestination(H3Index edge, H3Index *out);` | S6 | n/a | `H3Index*`, no sentinel (single value) | H3Error | header line 739. |
| `getDirectedEdgeOrigin` | `getDirectedEdgeOrigin` | `H3Error getDirectedEdgeOrigin(H3Index edge, H3Index *out);` | S6 | n/a | `H3Index*`, no sentinel | H3Error | header line 729. |
| `reverseDirectedEdge` | `reverseDirectedEdge` | `H3Error reverseDirectedEdge(H3Index edge, H3Index *out);` | S6 | n/a | `H3Index*`, no sentinel | H3Error | header line 780. |
| `cellToCenterChild` | `cellToCenterChild` | `H3Error cellToCenterChild(H3Index h, int childRes, H3Index *child);` | S7 | n/a | `H3Index*` (named `child`), no sentinel | H3Error | header line 616. |
| `cellToParent` | `cellToParent` | `H3Error cellToParent(H3Index h, int parentRes, H3Index *parent);` | S7 | n/a | `H3Index*` (named `parent`), no sentinel | H3Error | header line 592. |
| `cellToVertex` | `cellToVertex` | `H3Error cellToVertex(H3Index origin, int vertexNum, H3Index *out);` | S7 | n/a | `H3Index*`, no sentinel | H3Error | header line 788. |
| `cellToChildPos` | `cellToChildPos` | `H3Error cellToChildPos(H3Index child, int parentRes, int64_t *out);` | S8 | n/a | `int64_t*`, no sentinel | H3Error | header line 626. |
| `cellToChildrenSize` | `cellToChildrenSize` | `H3Error cellToChildrenSize(H3Index h, int childRes, int64_t *out);` | S8 | n/a | `int64_t*`, no sentinel | H3Error | header line 602. Doubles as the size source for `cellToChildren` (S13). **Parity note:** h3-js pre-validates and throws `E_CELL_INVALID` itself (h3core.js:952+) rather than relying on C. |
| `getIndexDigit` | `getIndexDigit` | `H3Error getIndexDigit(H3Index h, int res, int *out);` | S8 | n/a | `int*`, no sentinel (scalar) | H3Error | header line 535. Header doc: "Indexing digits are 1-indexed beginning with the digit for resolution 1." h3-js names the second parameter `digit`, C names it `res`; same value. |
| `areNeighborCells` | `areNeighborCells` | `H3Error areNeighborCells(H3Index origin, H3Index destination, int *out);` | S9 | n/a | `int*`, no sentinel | H3Error | header line 699. TS returns `boolean`. |
| `cellsToDirectedEdge` | `cellsToDirectedEdge` | `H3Error cellsToDirectedEdge(H3Index origin, H3Index destination, H3Index *out);` | S9 | n/a | `H3Index*`, no sentinel | H3Error | header line 709. |
| `gridDistance` | `gridDistance` | `H3Error gridDistance(H3Index origin, H3Index h3, int64_t *distance);` | S9 | n/a | `int64_t*` (named `distance`), no sentinel | H3Error | header line 821. S9's out type varies (`int` vs `H3Index` vs `int64_t`); template must be parameterized on it. |
| `cellToLatLng` | `cellToLatLng` | `H3Error cellToLatLng(H3Index h3, LatLng *g);` | S10 | n/a | `LatLng*` (named `g`), no sentinel | H3Error | header line 243. |
| `vertexToLatLng` | `vertexToLatLng` | `H3Error vertexToLatLng(H3Index vertex, LatLng *point);` | S10 | n/a | `LatLng*` (named `point`), no sentinel | H3Error | header line 805. |
| `cellToBoundary` | `cellToBoundary` | `H3Error cellToBoundary(H3Index h3, CellBoundary *gp);` | S11 | `MAX_CELL_BNDRY_VERTS` = 10 (compile-time, header line 134) | `CellBoundary*`, length carried by `numVerts` field | H3Error | header line 251. Alignment hazard, see hazard H3. |
| `directedEdgeToBoundary` | `directedEdgeToBoundary` | `H3Error directedEdgeToBoundary(H3Index edge, CellBoundary *gb);` | S11 | `MAX_CELL_BNDRY_VERTS` = 10 | `CellBoundary*`, length via `numVerts` | H3Error | header line 770. h3-js doc notes this "may return 3 coordinates" for icosahedron-face-crossing edges. |
| `cellToVertexes` | `cellToVertexes` | `H3Error cellToVertexes(H3Index origin, H3Index *vertexes);` | S12 | compile-time constant **6** - not in the header; only in `src/h3lib/lib/vertex.c:298` and in h3-js `const maxNumVertexes = 6;` | `H3Index*` (named `vertexes`), H3_NULL padded (pentagons yield 5 real + 1 null) | H3Error | header line 797. Fixed-N buffer with no size function, see hazard H1. |
| `directedEdgeToCells` | `directedEdgeToCells` | `H3Error directedEdgeToCells(H3Index edge, H3Index *originDestination);` | S12 | compile-time constant **2** - **not documented anywhere in the C library**; only in h3-js `const count = 2;` | `H3Index*` (named `originDestination`), no padding in practice (always 2 real cells on success) | H3Error | header line 750. Fixed-N buffer with no size function, see hazard H1. |
| `originToDirectedEdges` | `originToDirectedEdges` | `H3Error originToDirectedEdges(H3Index origin, H3Index *edges);` | S12 | compile-time constant **6** - stated only in the header `@brief` prose, see hazard H1 | `H3Index*` (named `edges`), H3_NULL padded (pentagons yield 5 real + 1 null) | H3Error | header line 761. |
| `cellToChildren` | `cellToChildren` | `H3Error cellToChildren(H3Index h, int childRes, H3Index *children);` | S13 | `cellToChildrenSize` | `H3Index*` (named `children`), size is **exact**, so no padding expected | H3Error | header line 606. `cellToChildrenSize` doc: "determines the exact number of children (or grandchildren, etc) that would be returned for the given cell". The compact-in-place pass is therefore a no-op here but is kept for uniformity. Not one of the four operations with an async variant. |
| `getIcosahedronFaces` | `getIcosahedronFaces` | `H3Error getIcosahedronFaces(H3Index h3, int *out);` | S13 | `maxFaceCount` | `int*`, **-1 padded** (not H3_NULL) | H3Error | header line 691. `h3Index.c:1238-1244`: "The array is sparse; since 0 is a valid value, invalid array values are represented as -1. It is the responsibility of the caller to filter out invalid values." and "@param out Output array. Must be of size maxFaceCount(h3)." This is the row that forces S13 to be parameterized on element type + sentinel predicate. |
| `getPentagons` | `getPentagons` | `H3Error getPentagons(int res, H3Index *out);` | S13 (size from S12-style counter) | `pentagonCount()` -> compile-time **12** | `H3Index*`, no padding (all 12 are real) | H3Error | header line 504. `h3Index.c:1332`: "@param out Output array. Must be of size pentagonCount()." |
| `getRes0Cells` | `getRes0Cells` | `H3Error getRes0Cells(H3Index *out);` | S13 (size from S12-style counter) | `res0CellCount()` -> compile-time **122** (`NUM_BASE_CELLS`) | `H3Index*`, no padding | H3Error | header line 493. `baseCells.c:925-926`: "getRes0Cells generates all base cells storing them into the provided memory pointer. Buffer must be of size NUM_BASE_CELLS * sizeof(H3Index)." Impl `@returns E_SUCCESS.` i.e. cannot fail. |
| `gridDisk` | `gridDisk` | `H3Error gridDisk(H3Index origin, int k, H3Index *out);` | S13 | `maxGridDiskSize` | `H3Index*`, **H3_NULL padded** | H3Error | header line 281. `algos.c:193-198`: "Output is placed in the provided array in no particular order. Elements of the output array may be left zero, as can happen when crossing a pentagon." and "@param out zero-filled array which must be of size maxGridDiskSize(k)". **The buffer must be zero-filled before the call** - `calloc`, not `malloc`. |
| `gridPathCells` | `gridPathCells` | `H3Error gridPathCells(H3Index start, H3Index end, H3Index *out);` | S13 | `gridPathCellsSize` | `H3Index*`, size exact, no padding expected | H3Error | header line 834. `gridPathCellsSize` header doc: "Number of indexes in a line connecting two indexes". |
| `polygonToCells` | `polygonToCells` | `H3Error polygonToCells(const GeoPolygon *geoPolygon, int res, uint32_t flags, H3Index *out);` | S13 | `maxPolygonToCellsSize` | `H3Index*`, **H3_NULL padded** (size is a max, not exact) | H3Error | header line 318. `algos.c:990`: "@param out The slab of zeroed memory to write to. Assumed to be big enough." -> **must be zero-filled**. `flags` is `uint32_t`; for the non-experimental call the only valid value is `0`. Has an async variant `polygonToCellsAsync`. |
| `uncompactCells` | `uncompactCells` | `H3Error uncompactCells(const H3Index *compactedSet, const int64_t numCompacted, H3Index *outSet, const int64_t numOut, const int res);` | S13 and ONE-OFF (it fits both) | `uncompactCellsSize` | `H3Index*` (named `outSet`), size documented as **exact** | H3Error | header line 661. Five arguments carrying two lengths (`numCompacted` in, `numOut` out) is why it counts as a one-off as well. `h3Index.c:798-799`: "uncompactCellsSize takes a compacted set of hexagons and provides **the exact size** of the uncompacted set of hexagons." Has an async variant `uncompactCellsAsync`. |
| `gridRing` | `gridRing` | `H3Error gridRing(H3Index origin, int k, H3Index *out);` | S14 | `maxGridRingSize` (C function exists, header line 299) | `H3Index*`, **H3_NULL padded** | H3Error | header line 305. `algos.c:360-365`: "Elements of the output array may be left zero, as can happen when crossing a pentagon." / "@param out Array which must be of size 6 * k (or 1 if k == 0)". `maxGridRingSize` returns exactly that: `if (k == 0) { *out = 1; ... } *out = 6 * (int64_t)k;` (`algos.c:344-354`), so calling it instead of h3-js's inline `k === 0 ? 1 : 6 * k` is behaviourally identical and adds a `k < 0` -> `E_DOMAIN` check. |
| `gridRingUnsafe` | `gridRingUnsafe` | `H3Error gridRingUnsafe(H3Index origin, int k, H3Index *out);` | S14 | `maxGridRingSize` | `H3Index*`, partial-write on failure - **discard, do not compact** | H3Error | header line 302. Returns `E_PENTAGON` after having already written part of the buffer. |
| `cellFromString` | `stringToH3` | `H3Error stringToH3(const char *str, H3Index *out);` | ONE-OFF | n/a | `H3Index*`, no sentinel | H3Error | header line 554. **Not exported by h3-js** (h3-js indexes *are* hex strings). Renamed to `cellFromString` in this package. Impl (`h3Index.c:180-188`) uses `sscanf(str, "%" PRIx64, &h)` and returns `E_FAILED` on a parse failure; it does **not** validate the resulting index. |
| `cellToLocalIj` | `cellToLocalIj` | `H3Error cellToLocalIj(H3Index origin, H3Index h3, uint32_t mode, CoordIJ *out);` | ONE-OFF | n/a | `CoordIJ*`, no sentinel | H3Error | header line 843. `localij.c:528`: "@param mode Mode, must be 0". Pin `mode = 0`. Impl doc also warns: "This function's output is not guaranteed to be compatible across different versions of H3." |
| `cellToString` | `h3ToString` | `H3Error h3ToString(H3Index h, char *str, size_t sz);` | ONE-OFF | caller-provided `sz` | `char*` buffer, NUL-terminated | H3Error | header line 562. **Not exported by h3-js.** The header gives no required `sz`; `h3Index.c:190-195` only says "@param sz Size of the buffer `str`". A 16-hex-digit `uint64_t` plus NUL needs **17** bytes; use a named constant, not a literal. Returns `E_MEMORY_BOUNDS` if `sz` is too small. |
| `cellsToMultiPolygon` | `cellsToLinkedMultiPolygon` + `destroyLinkedMultiPolygon` | `H3Error cellsToLinkedMultiPolygon(const H3Index *h3Set, const int numHexes, LinkedGeoPolygon *out);` and `void destroyLinkedMultiPolygon(LinkedGeoPolygon *polygon);` | ONE-OFF | caller input length (`numHexes`, an `int` not `int64_t`) | `LinkedGeoPolygon*` root owned by caller; all loops/coords/siblings owned by H3 | H3Error (destroy has none) | header lines 343 / 348. Header group comment: "Functions for cellsToMultiPolygon (currently a binding-only concept)". `numHexes` is `const int`, so an input set larger than `INT_MAX` must be rejected at the boundary. Ownership hazard, see hazard H4. Has an async variant `cellsToMultiPolygonAsync`. |
| `childPosToCell` | `childPosToCell` | `H3Error childPosToCell(int64_t childPos, H3Index parent, int childRes, H3Index *child);` | ONE-OFF | n/a | `H3Index*` (named `child`), no sentinel | H3Error | header line 636. Three inputs `(int64_t, H3Index, int)` match no shape in this taxonomy: S7 is `(H3Index, int)`. h3-js signature is `childPosToCell(childPos, h3Index, childRes)` - same order as C. |
| `compactCells` | `compactCells` | `H3Error compactCells(const H3Index *h3Set, H3Index *compactedSet, const int64_t numHexes);` | ONE-OFF | **caller input length** (`numHexes` is the size of *both* arrays) | `H3Index*` (named `compactedSet`), **H3_NULL padded** | H3Error | header line 645. `h3Index.c:551-553`: "@param compactedSet The output array of compressed hexagons (preallocated)" / "@param numHexes The size of the input and output arrays (possible that no contiguous regions exist in the set at all and no compression possible)". No size function exists anywhere. |
| `constructCell` | `constructCell` | `H3Error constructCell(int res, int baseCellNumber, const int *digits, H3Index *out);` | ONE-OFF | `digits` length is **implied by `res`** | `H3Index*`, no sentinel | H3Error | header line 545. `h3Index.c:130-131`: "@param digits Array of child digits (0--6) of length `res`. NULL allowed for `res=0`." **Argument-order divergence:** h3-js is `constructCell(baseCellNumber, digits, res)`, C is `(res, baseCellNumber, digits)`. This package keeps the h3-js order. |
| `greatCircleDistanceKm` | `greatCircleDistanceKm` | `double greatCircleDistanceKm(const LatLng *a, const LatLng *b);` | ONE-OFF | n/a | none (scalar return) | **none** | header line 377. Two struct inputs, `double` return, no error channel at all. |
| `greatCircleDistanceM` | `greatCircleDistanceM` | `double greatCircleDistanceM(const LatLng *a, const LatLng *b);` | ONE-OFF | n/a | none (scalar return) | **none** | header line 381. |
| `greatCircleDistanceRads` | `greatCircleDistanceRads` | `double greatCircleDistanceRads(const LatLng *a, const LatLng *b);` | ONE-OFF | n/a | none (scalar return) | **none** | header line 372. |
| `gridDiskDistances` | `gridDiskDistances` | `H3Error gridDiskDistances(H3Index origin, int k, H3Index *out, int *distances);` | ONE-OFF | `maxGridDiskSize` (for **both** buffers) | `H3Index* out` H3_NULL padded, parallel `int* distances` | H3Error | header line 290. Two parallel out-params zipped into ragged per-ring buckets. h3-js pre-seeds `ringSize + 1` empty arrays and skips null cells (h3core.js:1062+). Both buffers must be zero-filled (`callocArray` in h3-js). |
| `latLngToCell` | `latLngToCell` | `H3Error latLngToCell(const LatLng *g, int res, H3Index *out);` | ONE-OFF | n/a | `H3Index*`, no sentinel | H3Error | header line 234. Struct input by pointer. TS surface takes `(lat, lng, res)` as in h3-js. Header notes near `H3_NULL` (line 71-75): "Invalid index used to indicate an error from latLngToCell and related functions". |
| `localIjToCell` | `localIjToCell` | `H3Error localIjToCell(H3Index origin, const CoordIJ *ij, uint32_t mode, H3Index *out);` | ONE-OFF | n/a | `H3Index*`, no sentinel | H3Error | header line 852. `mode` pinned to 0, same as `cellToLocalIj`. |
| `polygonToCellsExperimental` | `polygonToCellsExperimental` (+ `maxPolygonToCellsSizeExperimental`) | `H3Error polygonToCellsExperimental(const GeoPolygon *polygon, int res, uint32_t flags, int64_t size, H3Index *out);` | ONE-OFF | `maxPolygonToCellsSizeExperimental` | `H3Index*`, **H3_NULL padded**; the computed size is **also passed back in** as `int64_t size` | H3Error | header line 333. The only function that takes its own computed size as an argument. `flags` carries a `ContainmentMode` value (header lines 177-187). Header group comment: "This is an experimental-only API and is subject to change in minor versions." Has an async variant `polygonToCellsExperimentalAsync`. |

**Row count: 64.**

Public functions with async twins (not separate rows above):
`polygonToCellsAsync`, `polygonToCellsExperimentalAsync`, `cellsToMultiPolygonAsync`, `uncompactCellsAsync`.
Counting those, `configure` and the three additive batch functions, the package exports 72 functions; see Export surface.

---

### C functions deliberately not bound

| C function | full C signature (verbatim, macros stripped) | in h3-js? | reason not bound |
|---|---|---|---|
| `gridDiskUnsafe` | `H3Error gridDiskUnsafe(H3Index origin, int k, H3Index *out);` (header line 262) | no | Superseded by `gridDisk`, which is the safe path h3-js exposes. The "unsafe" variant fails with `E_PENTAGON` and leaves a partially written buffer; no user-facing operation is lost. |
| `gridDiskDistancesUnsafe` | `H3Error gridDiskDistancesUnsafe(H3Index origin, int k, H3Index *out, int *distances);` (header line 267) | no | Superseded by `gridDiskDistances`. Same partial-write failure mode. |
| `gridDiskDistancesSafe` | `H3Error gridDiskDistancesSafe(H3Index origin, int k, H3Index *out, int *distances);` (header line 273) | no | Internal fallback; `gridDiskDistances` already dispatches to it. Binding both would ship the same operation twice. |
| `gridDisksUnsafe` | `H3Error gridDisksUnsafe(H3Index *h3Set, int length, int k, H3Index *out);` (header line 277) | no | Batch-of-disks helper with no h3-js counterpart and no documented output size (`length * maxGridDiskSize(k)` is only implied). Excluded as unsafe + undocumented-size. |

**Bound but not exposed as a public TS function** (used internally; not in the table above and not in the
"not bound" list):

| C function | signature | role |
|---|---|---|
| `describeH3Error` | `const char *describeH3Error(H3Error err);` (line 121) | Error message source: every H3 failure message is read from it. |
| `maxGridDiskSize` | `H3Error maxGridDiskSize(int k, int64_t *out);` (259) | size source for `gridDisk`, `gridDiskDistances` |
| `maxGridRingSize` | `H3Error maxGridRingSize(int k, int64_t *out);` (299) | size source for `gridRing`, `gridRingUnsafe` |
| `maxPolygonToCellsSize` | `H3Error maxPolygonToCellsSize(const GeoPolygon *geoPolygon, int res, uint32_t flags, int64_t *out);` (313) | size source for `polygonToCells` |
| `maxPolygonToCellsSizeExperimental` | `H3Error maxPolygonToCellsSizeExperimental(const GeoPolygon *polygon, int res, uint32_t flags, int64_t *out);` (329) | size source for `polygonToCellsExperimental` |
| `uncompactCellsSize` | `H3Error uncompactCellsSize(const H3Index *compactedSet, const int64_t numCompacted, const int res, int64_t *out);` (656) | size source for `uncompactCells` |
| `gridPathCellsSize` | `H3Error gridPathCellsSize(H3Index start, H3Index end, int64_t *size);` (830) | size source for `gridPathCells` |
| `maxFaceCount` | `H3Error maxFaceCount(H3Index h3, int *out);` (688) | size source for `getIcosahedronFaces` |
| `res0CellCount` | `int res0CellCount(void);` (490) | S3; size source for `getRes0Cells`; returns 122 |
| `pentagonCount` | `int pentagonCount(void);` (501) | S3; size source for `getPentagons`; returns 12 |
| `destroyLinkedMultiPolygon` | `void destroyLinkedMultiPolygon(LinkedGeoPolygon *polygon);` (348) | teardown half of `cellsToMultiPolygon` |

`cellToChildrenSize` is *both* a public TS function (h3-js exports it) and the size source for
`cellToChildren`; it is listed as a public row above.

**h3-js cross-check.** h3-js v4.5.0 exports 56 functions. Two are JS-only workarounds for emscripten's
lack of 64-bit integer arguments and have no C counterpart:

| h3-js export | reason not applicable |
|---|---|
| `h3IndexToSplitLong(h3Index)` (h3core.js:254) | JS-only: splits an H3 index into `[lower32, upper32]` for the emscripten ABI. Irrelevant to a native binding that passes `uint64_t` directly. |
| `splitLongToH3Index(lower, upper)` (h3core.js:296) | JS-only inverse of the above. |

The remaining **54** are all covered by the 64-row table (the 5 unit-dispatch operations expand to 13
rows). **No user-facing h3-js operation is missing.** Conversely this package adds two operations h3-js does not
have (`cellToString`/`h3ToString`, `cellFromString`/`stringToH3`), because h3-js represents indexes as
hex strings natively and therefore needs no conversion functions.

---

## Header declarations

Quoted verbatim from `h3api.h.in` at `v4.5.0`, with line numbers, for the types the binding has to match.

### `H3Index`, `H3_NULL`, `H3Error` (lines 65-79)

```c
/** @brief Identifier for an object (cell, edge, etc) in the H3 system.
 *
 * The H3Index fits within a 64-bit unsigned integer.
 */
typedef uint64_t H3Index;

/**
 * Invalid index used to indicate an error from latLngToCell and related
 * functions or missing data in arrays of H3 indices. Analogous to NaN in
 * floating point.
 */
#define H3_NULL 0

/** @brief Result code (success or specific error) from an H3 operation */
typedef uint32_t H3Error;
```

### `H3ErrorCodes` enum, values 0..19 (lines 81-114)

```c
typedef enum {
    E_SUCCESS = 0,  // Success (no error)
    E_FAILED = 1,   // The operation failed but a more specific error is not
                    // available
    E_DOMAIN = 2,   // Argument was outside the acceptable range (when a more
                    // specific error code is not available)
    E_LATLNG_DOMAIN = 3,  // Latitude or longitude arguments were outside the
                          // acceptable range
    E_RES_DOMAIN = 4,    // Resolution argument was outside the acceptable range
    E_CELL_INVALID = 5,  // `H3Index` cell argument was not valid
    E_DIR_EDGE_INVALID = 6,  // `H3Index` directed edge argument was not valid
    E_UNDIR_EDGE_INVALID =
        7,                 // `H3Index` undirected edge argument was not valid
    E_VERTEX_INVALID = 8,  // `H3Index` vertex argument was not valid
    E_PENTAGON = 9,  // Pentagon distortion was encountered which the algorithm
                     // could not handle
    E_DUPLICATE_INPUT = 10,  // Duplicate input was encountered in the arguments
                             // and the algorithm could not handle it
    E_NOT_NEIGHBORS = 11,    // `H3Index` cell arguments were not neighbors
    E_RES_MISMATCH =
        12,  // `H3Index` cell arguments had incompatible resolutions
    E_MEMORY_ALLOC = 13,   // Necessary memory allocation failed
    E_MEMORY_BOUNDS = 14,  // Bounds of provided memory were not large enough

    E_OPTION_INVALID = 15,  // Mode or flags argument was not valid
    E_INDEX_INVALID = 16,   // `H3Index` argument was not valid
    E_BASE_CELL_DOMAIN =
        17,                // Base cell number was outside of acceptable range
    E_DIGIT_DOMAIN = 18,   // Child digits invalid
    E_DELETED_DIGIT = 19,  // Deleted subsequence indicates invalid index

    // Sentinel value; not a real error. One past the last valid code.
    H3_ERROR_END
} H3ErrorCodes;
```

Codes 0..19 are contiguous with no gaps. `H3_ERROR_END` == 20 and is **not** a real error; the C++
mapping table must have exactly 20 entries and must reject `code >= H3_ERROR_END` rather than index
past the end. The `H3ErrorCode` string union therefore has 19 members (0 = success is not an
error).

### `LatLng`, `CellBoundary`, `MAX_CELL_BNDRY_VERTS` (lines 131-150)

```c
/** Maximum number of cell boundary vertices; worst case is pentagon:
 *  5 original verts + 5 edge crossings
 */
#define MAX_CELL_BNDRY_VERTS 10

/** @struct LatLng
    @brief latitude/longitude in radians
*/
typedef struct {
    double lat;  ///< latitude in radians
    double lng;  ///< longitude in radians
} LatLng;

/** @struct CellBoundary
    @brief cell boundary in latitude/longitude
*/
typedef struct {
    int numVerts;                        ///< number of vertices
    LatLng verts[MAX_CELL_BNDRY_VERTS];  ///< vertices in ccw order
} CellBoundary;
```

### `GeoLoop`, `GeoPolygon`, `GeoMultiPolygon` (lines 152-175)

```c
/** @struct GeoLoop
 *  @brief similar to CellBoundary, but requires more alloc work
 */
typedef struct {
    int numVerts;
    LatLng *verts;
} GeoLoop;

/** @struct GeoPolygon
 *  @brief Simplified core of GeoJSON Polygon coordinates definition
 */
typedef struct {
    GeoLoop geoloop;  ///< exterior boundary of the polygon
    int numHoles;     ///< number of elements in the array pointed to by holes
    GeoLoop *holes;   ///< interior boundaries (holes) in the polygon
} GeoPolygon;

/** @struct GeoMultiPolygon
 *  @brief Simplified core of GeoJSON MultiPolygon coordinates definition
 */
typedef struct {
    int numPolygons;
    GeoPolygon *polygons;
} GeoMultiPolygon;
```

`GeoMultiPolygon` is declared but is not an argument or return type of any function in the header; it
is unused by this binding.

### `ContainmentMode` (lines 177-187)

```c
/**
 * Values representing polyfill containment modes, to be used in
 * the `flags` bit field for `polygonToCellsExperimental`.
 */
typedef enum {
    CONTAINMENT_CENTER = 0,       ///< Cell center is contained in the shape
    CONTAINMENT_FULL = 1,         ///< Cell is fully contained in the shape
    CONTAINMENT_OVERLAPPING = 2,  ///< Cell overlaps the shape at any point
    CONTAINMENT_OVERLAPPING_BBOX = 3,  ///< Cell bounding box overlaps shape
    CONTAINMENT_INVALID = 4  ///< This mode is invalid and should not be used
} ContainmentMode;
```

Note: `polygonToCellsExperimental` takes `uint32_t flags`, not `ContainmentMode`. `CONTAINMENT_INVALID`
(4) is a sentinel, so valid input is `0 <= flags < 4`; validate at the boundary and return
`E_OPTION_INVALID` semantics rather than passing through.

### Linked geo structures (lines 189-216)

```c
/** @struct LinkedLatLng
 *  @brief A coordinate node in a linked geo structure, part of a linked list
 */
typedef struct LinkedLatLng LinkedLatLng;
struct LinkedLatLng {
    LatLng vertex;
    LinkedLatLng *next;
};

/** @struct LinkedGeoLoop
 *  @brief A loop node in a linked geo structure, part of a linked list
 */
typedef struct LinkedGeoLoop LinkedGeoLoop;
struct LinkedGeoLoop {
    LinkedLatLng *first;
    LinkedLatLng *last;
    LinkedGeoLoop *next;
};

/** @struct LinkedGeoPolygon
 *  @brief A polygon node in a linked geo structure, part of a linked list.
 */
typedef struct LinkedGeoPolygon LinkedGeoPolygon;
struct LinkedGeoPolygon {
    LinkedGeoLoop *first;
    LinkedGeoLoop *last;
    LinkedGeoPolygon *next;
};
```

### `CoordIJ` (lines 218-226)

```c
/** @struct CoordIJ
 * @brief IJ hexagon coordinates
 *
 * Each axis is spaced 120 degrees apart.
 */
typedef struct {
    int i;  ///< i component
    int j;  ///< j component
} CoordIJ;
```

---

## Export surface

### Public TS functions

| Bucket | Count |
|---|---|
| h3-js user-facing operations at v4.5.0 | 54 |
| ... of which unit-dispatch operations | 5 (`cellArea`, `edgeLength`, `getHexagonAreaAvg`, `getHexagonEdgeLengthAvg`, `greatCircleDistance`) |
| ... expanded to unit-suffixed C functions | 13 |
| Subtotal after unit split (54 - 5 + 13) | **62** |
| Added: `cellToString`, `cellFromString` | +2 |
| **Public TS functions (rows in the main table)** | **64** |
| Additional async variants | +4 |
| `configure` | +1 |
| The three additive batch functions (`latLngsToCells`, `cellsToLatLngs`, `cellsToBoundaries`) | +3 |
| **Total exported functions** | **72** |

`__tests__/exports.test.ts` asserts exactly those 72 names, plus the `H3Error` class and the
`ContainmentMode` constants.

### C functions

| Bucket | Count |
|---|---|
| Declared in `h3api.h.in` | 79 |
| Deliberately not bound | 4 |
| **Distinct C functions bound** | **75** |
| ... called directly by a public TS function | 64 |
| ... internal only (size functions, `describeH3Error`, `destroyLinkedMultiPolygon`) | 11 |

(`cellToChildrenSize` is counted once, in the 64: it is both public and a size source.)

## Shape taxonomy

| Shape | Operations | Members |
|---|---|---|
| S1 | 2 | `degsToRads`, `radsToDegs` |
| S2 | 8 | `isValidCell`, `isValidIndex`, `isPentagon`, `isResClassIII`, `isValidDirectedEdge`, `isValidVertex`, `getResolution`, `getBaseCellNumber` |
| S3 | 0 public | `res0CellCount`, `pentagonCount` (internal only) |
| S4 | 2 | `cellArea`, `edgeLength` |
| S5 | 3 | `getHexagonAreaAvg`, `getHexagonEdgeLengthAvg`, `getNumCells` |
| S6 | 3 | `getDirectedEdgeOrigin`, `getDirectedEdgeDestination`, `reverseDirectedEdge` |
| S7 | 3 | `cellToParent`, `cellToCenterChild`, `cellToVertex` |
| S8 | 3 | `cellToChildrenSize`, `cellToChildPos`, `getIndexDigit` |
| S9 | 3 | `areNeighborCells`, `cellsToDirectedEdge`, `gridDistance` |
| S10 | 2 | `cellToLatLng`, `vertexToLatLng` |
| S11 | 2 | `cellToBoundary`, `directedEdgeToBoundary` |
| S12 | 3 | `directedEdgeToCells`, `originToDirectedEdges`, `cellToVertexes` (`getRes0Cells`/`getPentagons` take their size here but are implemented as S13) |
| S13 | 8 | `gridDisk`, `cellToChildren`, `gridPathCells`, `polygonToCells`, `uncompactCells`, `getIcosahedronFaces`, `getRes0Cells`, `getPentagons` |
| S14 | 2 | `gridRing`, `gridRingUnsafe` |
| **Shape subtotal** | **44** | |
| ONE-OFF | **11** | `gridDiskDistances`, `compactCells`, `uncompactCells`*, `polygonToCellsExperimental`, `cellsToMultiPolygon`, `cellToLocalIj`, `localIjToCell`, `latLngToCell`, `greatCircleDistance`, `constructCell`, **`childPosToCell`** |

\* `uncompactCells` appears in both S13 and ONE-OFF. Distinct operations covered:
44 + 11 - 1 (the `uncompactCells` overlap) = **54**. Balanced.

Per shape, counting **table rows** (after the unit split, including `cellToString`/`cellFromString`):
S1 2, S2 8, S4 6, S5 5, S6 3, S7 3, S8 3, S9 3, S10 2, S11 2, S12 3, S13 8, S14 2 = 50 shape rows;
ONE-OFF = 14 rows (the 11 operations above with `greatCircleDistance` expanded to 3, minus the
`uncompactCells` row already counted under S13, plus `cellToString` and `cellFromString`).
50 + 14 = **64**.

## Implementation hazards

### H1. Fixed-N buffers with no size function

Three fixed-N buffers have no size function. Their sizes are documented only in prose, and for two
of the three not even in the header.

**`originToDirectedEdges` - size 6, stated only as prose in the header `@brief`:**

```c
/** @brief Returns the 6 (or 5 for pentagons) edges associated with the H3Index
 */
DECLSPEC H3Error H3_EXPORT(originToDirectedEdges)(H3Index origin,
                                                  H3Index *edges);
```
(h3api.h.in lines 759-762)

The implementation's doc comment does **not** repeat the number:

```c
/**
 * Provides all of the directed edges from the current H3Index.
 * @param origin The origin hexagon H3Index to find edges for.
 * @param edges The memory to store all of the edges inside.
 */
```
(`src/h3lib/lib/directedEdge.c:229-233`)

**`cellToVertexes` - size 6, NOT in the header at all:**

```c
/** @brief Returns all vertexes for a given cell, as H3 indexes */
DECLSPEC H3Error H3_EXPORT(cellToVertexes)(H3Index origin, H3Index *vertexes);
```
(h3api.h.in lines 796-797)

The header gives no number. The only place in the C library that states it is the implementation:

```c
/**
 * Get all vertexes for the given cell
 * @param cell      Cell to get the vertexes for
 * @param vertexes  Array to hold vertex output. Must have length >= 6.
 */
```
(`src/h3lib/lib/vertex.c:295-298`)

**`directedEdgeToCells` - size 2, NOT documented anywhere in the C library:**

```c
/** @brief Returns the origin and destination hexagons from the directed
 * edge H3Index */
DECLSPEC H3Error H3_EXPORT(directedEdgeToCells)(H3Index edge,
                                                H3Index *originDestination);
```
(h3api.h.in lines 748-751)

The implementation doc is likewise numberless:

```c
/**
 * Returns the origin, destination pair of hexagon IDs for the given edge ID
 * @param edge The directed edge H3Index
 * @param originDestination Pointer to memory to store origin and destination
 * IDs
 */
```
(`src/h3lib/lib/directedEdge.c:208-213`)

The value 2 is inferable only from the prose ("origin, destination pair") and from h3-js's
`const count = 2;` (`h3core.js:1463`). `grep -rn -i "overestimate\|must be of size\|length >=" ` over the
tarball confirms no size statement for this function.

**How the binding handles this:** `cpp/core/BufferSizes.hpp` pins all three as named constants,
each carrying the header or implementation text it comes from; for `directedEdgeToCells`, where there
is no header text to quote, it cites the implementation prose and the h3-js constant.
`cpp/test/BufferSizesTest.cpp` asserts the count H3 actually writes for each one, including for a
pentagon, so a future upstream change fails a test rather than corrupting the heap.

### H2. Buffers H3 requires to be pre-zeroed

Three functions document that they write into *zeroed* memory and leave holes:

```c
 * Output is placed in the provided array in no particular order. Elements of
 * the output array may be left zero, as can happen when crossing a pentagon.
 *
 * @param  origin   origin cell
 * @param  k        k >= 0
 * @param  out      zero-filled array which must be of size maxGridDiskSize(k)
```
(`src/h3lib/lib/algos.c:193-198`, `gridDisk`)

```c
 * Elements of the output array may be left zero, as can happen when crossing a
 * pentagon.
 *
 * @param origin Origin location.
 * @param k k >= 0
 * @param out Array which must be of size 6 * k (or 1 if k == 0)
```
(`src/h3lib/lib/algos.c:360-365`, `gridRing`)

```c
 * @param out The slab of zeroed memory to write to. Assumed to be big enough.
```
(`src/h3lib/lib/algos.c:990`, `polygonToCells`)

`CellBuffer` must therefore value-initialize (`calloc` / `std::vector<H3Index>(n)`), never
`malloc`/`reserve`. Uninitialized memory would be read back as bogus cells after the H3_NULL compaction
pass, silently.

### H3. `CellBoundary` alignment

```c
typedef struct {
    int numVerts;                        ///< number of vertices
    LatLng verts[MAX_CELL_BNDRY_VERTS];  ///< vertices in ccw order
} CellBoundary;
```
(h3api.h.in lines 147-150)

`LatLng` is `{ double; double; }` so it has 8-byte alignment; `verts` therefore starts at offset 8 with
4 bytes of padding after `numVerts`. Use `offsetof(CellBoundary, verts)`, never `sizeof(int)`.
`sizeof(CellBoundary)` is 8 + 10*16 = 168 on every mainstream ABI.

### H4. `LinkedGeoPolygon` ownership split

```c
DECLSPEC H3Error H3_EXPORT(cellsToLinkedMultiPolygon)(const H3Index *h3Set,
                                                      const int numHexes,
                                                      LinkedGeoPolygon *out);

/** @brief Free all memory created for a LinkedGeoPolygon */
DECLSPEC void H3_EXPORT(destroyLinkedMultiPolygon)(LinkedGeoPolygon *polygon);
```
(h3api.h.in lines 343-348)

`out` is a caller-provided root node (stack is fine); every `LinkedGeoLoop`, `LinkedLatLng` and sibling
`LinkedGeoPolygon` reachable from it is heap-allocated by H3 and must be released by
`destroyLinkedMultiPolygon`, **including on the error path**, since partial structure may already be
linked. `destroyLinkedMultiPolygon` returns `void` and does not free the root itself.

Also note `const int numHexes` (not `int64_t`): input sets larger than `INT_MAX` must be rejected at the
boundary before the call.

### H5. `GeoPolygon` must outlive both calls

```c
DECLSPEC H3Error H3_EXPORT(maxPolygonToCellsSize)(const GeoPolygon *geoPolygon,
                                                  int res, uint32_t flags,
                                                  int64_t *out);

DECLSPEC H3Error H3_EXPORT(polygonToCells)(const GeoPolygon *geoPolygon,
                                           int res, uint32_t flags,
                                           H3Index *out);
```
(h3api.h.in lines 313-320)

Both take the same `const GeoPolygon *`. The `GeoLoop::verts` arrays it points at must stay alive across
both calls. Same for the experimental pair (lines 329-335).

### H6. `gridRingUnsafe` fails mid-write

```c
/** @brief hollow hexagon ring k distance from origin */
DECLSPEC H3Error H3_EXPORT(gridRingUnsafe)(H3Index origin, int k, H3Index *out);
```
(h3api.h.in lines 301-302)

The header itself gives no warning; h3-js documents it as "Unlike gridDisk, this function will throw an
error if there is a pentagon anywhere in the ring" (`h3core.js`, `gridRingUnsafe` doc block). On
`E_PENTAGON` the buffer holds partial output; discard it entirely rather than compacting and returning
it.

### H7. Every size function except the two nullary counters returns `H3Error`

```c
DECLSPEC int H3_EXPORT(res0CellCount)(void);     // line 490
DECLSPEC int H3_EXPORT(pentagonCount)(void);     // line 501
```

All other size sources (`maxGridDiskSize`, `maxGridRingSize`, `maxPolygonToCellsSize`,
`maxPolygonToCellsSizeExperimental`, `uncompactCellsSize`, `gridPathCellsSize`, `maxFaceCount`,
`cellToChildrenSize`) return `H3Error` and must be checked before the allocation.

### H8. The size query itself can request an unbounded allocation

`maxPolygonToCellsSize` returns an `int64_t` with no upper bound, which is what the optional cell
ceiling guards; note that `getNumCells(15)` = 569,707,381,193,162 cells is the theoretical maximum, i.e.
~4.5 petabytes at 8 bytes each. The ceiling must be applied to the *returned size*, before any
allocation, and must produce a clean `H3Error` (`E_MEMORY_ALLOC` is the closest upstream code) rather
than an OOM abort.

### H9. `mode` parameters that must be 0

```c
DECLSPEC H3Error H3_EXPORT(cellToLocalIj)(H3Index origin, H3Index h3,
                                          uint32_t mode, CoordIJ *out);
DECLSPEC H3Error H3_EXPORT(localIjToCell)(H3Index origin, const CoordIJ *ij,
                                          uint32_t mode, H3Index *out);
```
(h3api.h.in lines 843-853)

The header does not say what `mode` may be. The implementation does:

```c
 * @param mode Mode, must be 0
```
(`src/h3lib/lib/localij.c:528`)

The same file also warns:

```c
 * This function's output is not guaranteed
 * to be compatible across different versions of H3.
```
(`src/h3lib/lib/localij.c:523-524`)

The TS JSDoc carries this: `src/traversal.ts` documents that local IJ coordinates are not a
serialization format, because H3 does not guarantee them across its own versions.

### H10. `h3ToString` has no documented buffer size

```c
/** @brief converts an H3Index to a canonical string */
DECLSPEC H3Error H3_EXPORT(h3ToString)(H3Index h, char *str, size_t sz);
```
(h3api.h.in lines 561-562)

Implementation doc gives nothing more than "@param sz Size of the buffer `str`"
(`src/h3lib/lib/h3Index.c:190-195`). A `uint64_t` in lowercase hex is at most 16 characters, so 17 bytes
including the NUL. `cpp/core/BufferSizes.hpp` pins that as `kH3ToStringBufferSize` alongside the H1
constants, and `cpp/test/BufferSizesTest.cpp` pins it from both sides: 17 bytes succeed for an
all-ones index, 16 return `E_MEMORY_BOUNDS`. Too small a buffer yields `E_MEMORY_BOUNDS`, not a crash,
so the failure is at least clean.
