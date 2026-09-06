# 🎬 Showcase

> **Audience: package users who want to see the package inside an app.** One app, five acts, every
> cell computed on the phone by `react-native-nitro-h3`. Each act is a pattern you can lift into
> your own app.

<video src="/react-native-nitro-h3/img/showcase.mp4" autoplay muted loop playsinline controls style="width: 100%"></video>

[Watch the video](../img/showcase.mp4) (25.6 seconds, no sound).

The showcase is not a benchmark. It puts the package where it will actually run: under a map, inside
a gesture, on a JS thread that also has to animate. It shows what a hexagonal grid buys you once it
is cheap: a grid that follows the viewport, a drill-down that costs one call, a neighbourhood that
grows ring by ring, a million points folded into a few hundred cells, and a track stored as cells
instead of coordinates.

A readout in every act watches the JS thread and reports the longest block of the run, making the
true cost of every step visible.

## The five acts

### Atlas

`gridDisk · gridDiskDistances · cellToParent · cellsToBoundaries`

A hexagon grid that follows the map through every zoom. The resolution comes from the view, the grid
is rebuilt while you pinch (at most every 120 ms) and once more where the map settles, and each cell
is coloured by its ring distance inside its parent. This act takes the classic path: cell boundaries
become a GeoJSON string that MapLibre parses, so the panel also shows what that string costs.

**Useful for** a coverage, pricing or service-area layer whose cells must be re-derived from the
viewport, and any map that keeps its own data in cells rather than polygons.

### Fractal city

`cellToChildren · cellToParent`

Tap a cell and it splits into its seven children; long-press and a cell folds back into its parent
with its siblings. Six levels deep, the children never tile the parent exactly, because H3's
aperture is 7 and each level is rotated. Every split is one call, so the detail follows your finger.

**Useful for** drill-down analytics, adaptive detail (coarse where nothing happens, fine where it
does) and choosing a resolution per region instead of per layer.

### Magnetic grid

`gridRing · gridDisk`

Drag k from 1 to 50 and the neighbourhood grows ring by ring, 7,651 cells at k=50. Each ring is
built once and kept until a smaller k drops it, so the slider only pays for the rings it has not
drawn yet.

**Useful for** proximity queries without geometry: everything within n cells of a point, a search
radius that widens step by step, a buffer around an area.

### Heatmap

`latLngsToCells`

A million points, forty weighted hotspots over 30 percent uniform noise, are binned into cells in
one batch call, counted and coloured on a ramp anchored at the quantiles of the run. Switch between
points, heatmap and both, and between resolutions 7 to 9, to watch noise become density.

**Useful for** aggregating events, telemetry, deliveries or sales before drawing them: the cell
counts are what the map shows, and a few hundred cells draw where a million points would not.

### Trail

`latLngToCell · gridPathCells`

A 16 km ride through Berlin replays at 60x. Every fix becomes a cell, a gap in the fixes is bridged
with the grid path, and the camera leads the head. The resolution slider runs from 7 to 12 independently of the
zoom.

**Useful for** movement analytics and visited-area tracking, and for data minimisation: storing the
cell instead of the coordinate is a privacy decision you can make per resolution.

> **Every number on screen is measured on the device**, in the run you are looking at. The
> documented factors in the [Benchmark report](benchmark.md) come from a Release build; a
> development build runs slower on both sides.
