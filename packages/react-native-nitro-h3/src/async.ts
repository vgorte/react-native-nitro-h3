import { toBuffer } from './buffers'
import { toContainmentFlags } from './containment'
import { rethrowAsH3Error } from './H3Error'
import { native } from './native'
import type { ContainmentModeName, ContainmentModeValue, LatLng, Ring } from './types'

/**
 * Finds the cells covering a polygon as {@linkcode polygonToCells} does, off the JS thread.
 *
 * Worth the thread hop once the fill is long enough to drop frames: San Francisco at resolution
 * `12` is 412,377 cells and about five frames of work, measured in
 * https://github.com/vgorte/react-native-nitro-h3/blob/main/docs/benchmark.md. Below that the
 * synchronous call is cheaper, because it has no hop at all.
 *
 * @param rings The outer ring first, then holes, as `[latitude, longitude]` degrees.
 * @param res The resolution, `0` to `15`.
 * @returns The cells covering the polygon, as a view onto the native buffer.
 * @throws {@linkcode H3Error} if a point is not a `[latitude, longitude]` pair of finite numbers
 * inside `[-90, 90]` latitude and `[-180, 180]` longitude, the resolution is out of range, or the
 * result would exceed a cell ceiling set with {@linkcode configure}.
 */
export async function polygonToCellsAsync(rings: Ring[], res: number): Promise<BigUint64Array> {
  try {
    return new BigUint64Array(await native.polygonToCellsAsync(rings, res))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds the cells covering a polygon as {@linkcode polygonToCellsExperimental} does, off the JS
 * thread.
 *
 * The mode is resolved on the JS thread, by the helper the synchronous call uses, so the two take
 * the same arguments and answer alike. This binds the same experimental H3 API as
 * {@linkcode polygonToCellsExperimental}, so its results may change when the vendored H3 version
 * changes.
 *
 * @param rings The outer ring first, then holes, as `[latitude, longitude]` degrees.
 * @param res The resolution, `0` to `15`.
 * @param flags One of `ContainmentMode.center`, `.full`, `.overlapping` or `.overlappingBbox`, or
 * the matching h3-js name such as `'containmentCenter'`.
 * @returns The cells covering the polygon, as a view onto the native buffer.
 * @throws {@linkcode H3Error} if the polygon, the resolution or the mode is invalid, or the result
 * would exceed a cell ceiling set with {@linkcode configure}.
 */
export async function polygonToCellsExperimentalAsync(
  rings: Ring[],
  res: number,
  flags: ContainmentModeValue | ContainmentModeName,
): Promise<BigUint64Array> {
  const mode = toContainmentFlags(flags)
  try {
    return new BigUint64Array(await native.polygonToCellsExperimentalAsync(rings, res, mode))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Finds the outline of a set of cells as {@linkcode cellsToMultiPolygon} does, off the JS thread.
 *
 * The buffer is copied natively before the work starts, so the caller may overwrite it as soon as
 * this function returns.
 *
 * @param cells The cells to outline. They must all be valid, unique and of the same resolution.
 * @returns One entry per disjoint outline.
 * @throws {@linkcode H3Error} if the set is invalid, mixes resolutions or contains duplicates.
 */
export async function cellsToMultiPolygonAsync(cells: BigUint64Array): Promise<LatLng[][][]> {
  try {
    return await native.cellsToMultiPolygonAsync(toBuffer(cells))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}

/**
 * Expands a compacted cell set as {@linkcode uncompactCells} does, off the JS thread.
 *
 * The buffer is copied natively before the work starts, so the caller may overwrite it as soon as
 * this function returns.
 *
 * @param cells A compacted cell set.
 * @param res The resolution to expand to, no finer than any cell in the set.
 * @throws {@linkcode H3Error} if the set is invalid, the resolution is out of range, or the result
 * would exceed a cell ceiling set with {@linkcode configure}.
 */
export async function uncompactCellsAsync(
  cells: BigUint64Array,
  res: number,
): Promise<BigUint64Array> {
  try {
    return new BigUint64Array(await native.uncompactCellsAsync(toBuffer(cells), res))
  } catch (error) {
    rethrowAsH3Error(error)
  }
}
