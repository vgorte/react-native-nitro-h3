/** Represents a coordinate as a `[latitude, longitude]` pair in degrees, the `h3-js` `CoordPair`. */
export type CoordPair = [lat: number, lng: number]

/** Represents local IJ hexagon coordinates, whose axes are spaced 120 degrees apart. */
export interface CoordIJ {
  i: number
  j: number
}

/** Represents a ring of {@linkcode CoordPair} points whose first point is not repeated at the end. */
export type Ring = CoordPair[]

/**
 * Holds the boundaries of a whole cell set, as {@linkcode cellsToBoundaries} answers them.
 *
 * Cell `i` occupies `stride` doubles of `vertices` from `i * stride`, of which the first
 * `vertexCounts[i]` pairs are its vertices and the rest are `NaN`.
 */
export interface CellBoundaries {
  /** Counts the doubles each cell occupies in `vertices`, always `20`, which is ten `[lat, lng]` pairs. */
  stride: number
  /** Holds `stride` doubles per cell: `[lat, lng]` pairs in degrees, in `cellToBoundary` order. */
  vertices: Float64Array
  /** Counts the vertices each cell uses, `5` to `10`. Slots past the count hold `NaN`. */
  vertexCounts: Uint8Array
}

/**
 * Names the containment modes of `polygonToCellsExperimental`, matching H3's `ContainmentMode`
 * values.
 *
 * These numbers cross the bridge as they are; h3-js's names work too, at the cost of a lookup on a
 * path this package exists to make fast.
 */
export const ContainmentMode = Object.freeze({
  /** Requires the cell centre to be contained in the shape. */
  center: 0,
  /** Requires the cell to be fully contained in the shape. */
  full: 1,
  /** Requires the cell to overlap the shape at any point. */
  overlapping: 2,
  /** Requires the cell's bounding box to overlap the shape. */
  overlappingBbox: 3,
} as const)

/** Holds one of the numeric {@linkcode ContainmentMode} values. */
export type ContainmentModeValue = (typeof ContainmentMode)[keyof typeof ContainmentMode]

/** Names a containment mode the way h3-js's `POLYGON_TO_CELLS_FLAGS` does. */
export type ContainmentModeName =
  | 'containmentCenter'
  | 'containmentFull'
  | 'containmentOverlapping'
  | 'containmentOverlappingBbox'

/**
 * Maps each h3-js containment mode name to its {@linkcode ContainmentMode} value.
 *
 * Not part of the public surface: it exists so `polygonToCellsExperimental` accepts h3-js's
 * strings. An unknown name is left to the native layer, which rejects it.
 */
export const CONTAINMENT_MODE_BY_NAME: Readonly<Record<ContainmentModeName, ContainmentModeValue>> =
  Object.freeze({
    containmentCenter: ContainmentMode.center,
    containmentFull: ContainmentMode.full,
    containmentOverlapping: ContainmentMode.overlapping,
    containmentOverlappingBbox: ContainmentMode.overlappingBbox,
  })
