import { toBuffer } from './buffers'
import { toContainmentFlags } from './containment'
import { rethrowAsH3Error } from './H3Error'
import { native } from './native'
import type { ContainmentModeName, ContainmentModeValue, LatLng, Ring } from './types'

/**
 * Finds the outline of a set of cells, as GeoJSON-shaped polygons.
 *
 * The result nests polygons, then loops, then points. The first loop of each polygon is its outer
 * ring and any further loops are holes; no loop repeats its first point at the end.
 *
 * @param cells The cells to outline. They must all be valid, unique and of the same resolution.
 * @returns One entry per disjoint outline.
 * @throws {@linkcode H3Error} if the set is invalid, mixes resolutions or contains duplicates.
 */
export function cellsToMultiPolygon(cells: BigUint64Array): LatLng[][][] {
  try {
    return native.cellsToMultiPolygon(toBuffer(cells))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds every cell whose centre falls inside a polygon.
 *
 * The polygon is GeoJSON-shaped: the first ring is the outer boundary, any further rings are holes,
 * and each point is a `[latitude, longitude]` pair in degrees. Note the order, which GeoJSON itself
 * reverses; a ring is not closed, so its first point is not repeated at the end.
 *
 * @param rings The outer ring first, then holes. An empty polygon yields no cells.
 * @param res The resolution, `0` to `15`.
 * @returns The cells covering the polygon, as a view onto the native buffer.
 * @throws {@linkcode H3Error} if a point is not a `[latitude, longitude]` pair of finite numbers
 * inside `[-90, 90]` latitude and `[-180, 180]` longitude, the resolution is out of range, or the
 * result would exceed a cell ceiling set with {@linkcode configure}.
 */
export function polygonToCells(rings: Ring[], res: number): BigUint64Array {
  try {
    return new BigUint64Array(native.polygonToCells(rings, res))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds the cells covering a polygon as {@linkcode polygonToCells} does, with a choice of
 * containment rule.
 *
 * The mode is either a {@linkcode ContainmentMode} constant or the h3-js name for it; the constants
 * are cheaper and are what this package recommends. This binds an experimental H3 API, so its
 * results may change when the vendored H3 version changes.
 *
 * @param rings The outer ring first, then holes, as `[latitude, longitude]` degrees.
 * @param res The resolution, `0` to `15`.
 * @param flags One of `ContainmentMode.center`, `.full`, `.overlapping` or `.overlappingBbox`, or
 * the matching h3-js name such as `'containmentCenter'`.
 * @returns The cells covering the polygon, as a view onto the native buffer.
 * @throws {@linkcode H3Error} if the polygon, the resolution or the mode is invalid, or the result
 * would exceed a cell ceiling set with {@linkcode configure}. With a ceiling set, an unaffordable
 * polygon is refused before any work, priced by the bounding-box estimate of
 * {@linkcode polygonToCells} or, where that box has no area, by the length of the outline.
 */
export function polygonToCellsExperimental(
  rings: Ring[],
  res: number,
  flags: ContainmentModeValue | ContainmentModeName,
): BigUint64Array {
  const mode = toContainmentFlags(flags)
  try {
    return new BigUint64Array(native.polygonToCellsExperimental(rings, res, mode))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}
