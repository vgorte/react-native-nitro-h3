import type {
  FillLayerSpecification,
  LineLayerSpecification,
} from '@maplibre/maplibre-react-native'
import { boundariesOf, NEIGHBOURHOOD_CALLS } from '../engine/cells'
import { cellsToFeatureCollection } from '../engine/geojson'
import { type Highlight, neighbourhoodOf } from '../engine/inspect'
import { colours, ramp } from '../theme/tokens'

type FillPaint = NonNullable<FillLayerSpecification['paint']>
type LinePaint = NonNullable<LineLayerSpecification['paint']>

const NEIGHBOUR_FILL_OPACITY = 0.22
const NEIGHBOUR_LINE_WIDTH = 1
const CHILD_FILL_OPACITY = 0.45
// the ghost of the parent is lighter than the outline of the cell itself, so the two read apart
const GHOST_LINE_WIDTH = 1
const GHOST_LINE_OPACITY = 0.8

// the highlight's own cell carries no ring distance, and no layer of it draws by bucket
const ONE_BUCKET = new Uint8Array(1)

/** The collection a source is handed while it has nothing to draw. */
export const EMPTY_COLLECTION = '{"type":"FeatureCollection","features":[]}'

/** Holds what a map draws around an inspected cell, one GeoJSON collection a layer. */
export type MapHighlight = Highlight<string, string>

/** Fills the ring around the inspected cell, low enough that the cells under it still read. */
export const NEIGHBOUR_FILL: FillPaint = {
  'fill-color': colours.contrast,
  'fill-opacity': NEIGHBOUR_FILL_OPACITY,
}

/** Strokes the ring, so six touching fills keep an edge each rather than merging into one shape. */
export const NEIGHBOUR_LINE: LinePaint = {
  'line-color': colours.contrast,
  'line-width': NEIGHBOUR_LINE_WIDTH,
}

/** Fills the children in the brightest step of the ramp, which is what the Skia hosts use. */
export const CHILD_FILL: FillPaint = {
  'fill-color': ramp[ramp.length - 1],
  'fill-opacity': CHILD_FILL_OPACITY,
}

/** Strokes the parent as a ghost over the cells it holds. */
export const GHOST_LINE: LinePaint = {
  'line-color': colours.text,
  'line-width': GHOST_LINE_WIDTH,
  'line-opacity': GHOST_LINE_OPACITY,
}

/** Builds the collection of a cell set, which one layer of the highlight draws from. */
export function collectionOf(cells: BigUint64Array): string {
  return cellsToFeatureCollection(boundariesOf(cells).value, new Uint8Array(cells.length))
}

/** Builds the collection of one cell, which a map applies sooner than a filter over a whole set. */
export function oneCellCollection(cell: bigint): string {
  return cellsToFeatureCollection(boundariesOf(BigUint64Array.of(cell)).value, ONE_BUCKET)
}

/** Answers the three collections the sheet's highlight is drawn from. */
export function highlightOf(cell: bigint): MapHighlight {
  const around = neighbourhoodOf(cell, NEIGHBOURHOOD_CALLS)
  return {
    neighbours: collectionOf(around.neighbours),
    children: around.children.length === 0 ? null : collectionOf(around.children),
    parent: around.parent === null ? null : collectionOf(BigUint64Array.of(around.parent)),
  }
}
