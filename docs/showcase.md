# 🎬 Showcase

<video src="https://raw.githubusercontent.com/vgorte/react-native-nitro-h3/main/img/showcase.mp4" autoplay muted loop playsinline controls style="width: 100%"></video>

[Watch the video](../img/showcase.mp4).

The showcase is not a benchmark.
It puts the package where it will actually run: under a map, inside a gesture, on a JS thread that also has to animate.
It shows what a hexagonal grid buys you once it is cheap: a grid that follows the viewport, a drill-down that costs one call, a neighbourhood that grows ring by ring, a million points folded into a few hundred cells, and a track stored as cells instead of coordinates.

A readout in every act watches the JS thread and reports the longest block of the run, making the true cost of every step visible.

## The Five Acts

### Atlas

[`gridDisk`](../packages/react-native-nitro-h3/docs/api.md#griddisk) · [`gridDiskDistances`](../packages/react-native-nitro-h3/docs/api.md#griddiskdistances) · [`cellToParent`](../packages/react-native-nitro-h3/docs/api.md#celltoparent) · [`cellsToBoundaries`](../packages/react-native-nitro-h3/docs/api.md#cellstoboundaries)

A grid that picks its resolution from the zoom and rebuilds while you pinch, at most every 120 ms, then once more where the map settles.
Each cell is coloured by its ring distance inside its parent.
This act takes the classic path, cell boundaries as a GeoJSON string for MapLibre, and the panel shows what that string costs next to the JS thread readout.

<p class="use"><strong>Derive spatial layers directly from the viewport.</strong></p>

Coverage layers, pricing zones, service areas, cells instead of polygons.

### Fractal City

[`cellToChildren`](../packages/react-native-nitro-h3/docs/api.md#celltochildren) · [`cellToParent`](../packages/react-native-nitro-h3/docs/api.md#celltoparent)

Tap a cell and it splits into its seven children; long-press and they fold back into the parent.
Every split is one call, so the detail follows your finger.

<p class="use"><strong>Drill down where the data is dense.</strong></p>

Drill-down analytics, adaptive detail, a resolution per region.

### Magnetic Grid

[`gridRing`](../packages/react-native-nitro-h3/docs/api.md#gridring) · [`gridDisk`](../packages/react-native-nitro-h3/docs/api.md#griddisk)

Drag the slider to grow the neighbourhood up to 50 rings (7,651 cells).
Each ring is computed once and kept, so the slider never waits for a ring it already has.

<p class="use"><strong>Run proximity queries without heavy geometry.</strong></p>

Everything within n cells, widening search radius, buffers.

### Heatmap

[`latLngsToCells`](../packages/react-native-nitro-h3/docs/api.md#latlngstocells)

Up to a million noisy points are binned into cells in a single batch call, at 100,000 or 1,000,000 points.
The map draws a few hundred hexagons instead of a million overlapping markers.

<p class="use"><strong>Aggregate heavy data before it hits the map.</strong></p>

Density maps, hotspot detection, event aggregation, telemetry.

### Trail

[`latLngToCell`](../packages/react-native-nitro-h3/docs/api.md#latlngtocell) · [`gridPathCells`](../packages/react-native-nitro-h3/docs/api.md#gridpathcells)

A fast-forwarded GPS track where every fix is snapped to a cell.
If the signal drops, the package computes the missing cells and bridges the gap.

<p class="use"><strong>Track continuous movement without storing raw coordinates.</strong></p>

Movement analytics, visited areas, data minimisation, privacy by resolution.

> [!NOTE]
> Every number on screen is measured on the device, in the run you are looking at.
> The documented factors in the [Benchmark Report](benchmark.md) come from a Release build, and a development build runs slower on both sides.
