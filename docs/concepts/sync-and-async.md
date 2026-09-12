# 🧵 Sync and Async

## Synchronous by Default

Most H3 operations are intentionally synchronous.

For small native calls, the cost of moving work to another thread can exceed the cost of the H3 operation itself.

## The Four Async Variants

Four expensive operations provide async variants.
[`polygonToCellsAsync`](../../packages/react-native-nitro-h3/docs/api.md#polygontocellsasync) fills a polygon off the JavaScript thread and resolves with the same `BigUint64Array` the synchronous call returns:

```ts
import { polygonToCellsAsync, type Ring } from 'react-native-nitro-h3'

const sanFrancisco: Ring[] = [
  [
    [37.8133, -122.409],
    [37.7198, -122.3545],
    [37.7076, -122.5123],
  ],
]

const cells = await polygonToCellsAsync(sanFrancisco, 12)
```

The four variants are:

- [`polygonToCellsAsync`](../../packages/react-native-nitro-h3/docs/api.md#polygontocellsasync)
- [`cellsToMultiPolygonAsync`](../../packages/react-native-nitro-h3/docs/api.md#cellstomultipolygonasync)
- [`polygonToCellsExperimentalAsync`](../../packages/react-native-nitro-h3/docs/api.md#polygontocellsexperimentalasync)
- [`uncompactCellsAsync`](../../packages/react-native-nitro-h3/docs/api.md#uncompactcellsasync)

Each of the four can answer a result set of hundreds of thousands of cells, which is what makes a thread hop worth considering, and what the hop actually costs is measured below.

[`polygonToCellsExperimentalAsync`](../../packages/react-native-nitro-h3/docs/api.md#polygontocellsexperimentalasync) binds the same experimental H3 API as [`polygonToCellsExperimental`](../../packages/react-native-nitro-h3/docs/api.md#polygontocellsexperimental), so its results may change when the vendored H3 version changes.
It is one of four exports that follow the upstream H3 library rather than this package's own compatibility promise, listed in [Functions That Follow Upstream H3](../h3-js-divergences.md#functions-that-follow-upstream-h3).

## Guarantees

**Buffer safety.** An async variant copies an inbound cell set in the synchronous prologue, before it dispatches, so the buffer is yours to overwrite as soon as the call returns its promise.
The result is the one its synchronous sibling produces, which `apps/example/__tests__/async.harness.ts` asserts by zeroing the input while the promise is in flight.

**Error parity.** Async variants throw the same errors, with the same messages and the same numeric codes, as their synchronous siblings, which the same harness asserts.

## What the Hop Costs

On the iPhone XS the hop is inside the noise: [`polygonToCellsAsync`](../../packages/react-native-nitro-h3/docs/api.md#polygontocellsasync) came in at 214.5 ms against 220.7 ms for [`polygonToCells`](../../packages/react-native-nitro-h3/docs/api.md#polygontocells), and [`uncompactCellsAsync`](../../packages/react-native-nitro-h3/docs/api.md#uncompactcellsasync) at 4.1 ms against 3.9 ms for [`uncompactCells`](../../packages/react-native-nitro-h3/docs/api.md#uncompactcells).
On the Galaxy S23 the same hop costs about 97 ms on the 178.5 ms [`polygonToCells`](../../packages/react-native-nitro-h3/docs/api.md#polygontocells) call, and about 0.7 ms on the 4.3 ms [`uncompactCells`](../../packages/react-native-nitro-h3/docs/api.md#uncompactcells) call.
Both figures in each pair come from one run of [Benchmark Report](../benchmark.md): the `W3` rows are the median of 3 timed passes, the `W8` rows the median of 20.
Measure the hop on your own device before you move a call off the JavaScript thread, because the two devices here disagree on whether it costs anything at all.
