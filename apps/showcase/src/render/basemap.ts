import type { StyleSpecification } from '@maplibre/maplibre-react-native'
import { plainAttribution } from '../engine/tiles/source'
import { colours } from '../theme/tokens'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'
const DEFAULT_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles, data from OpenStreetMap'

/** Holds the basemap an act draws on and the line its licence requires. */
export interface Basemap {
  /** The recoloured style, or the plain URL where the style could not be read. */
  style: string | StyleSpecification
  attribution: string
  /** `false` where the style could not be read here; the map's own fetch may still succeed. */
  loaded: boolean
}

/** The basemap an act falls back on where the style itself will not load. */
export const PLAIN_BASEMAP: Basemap = {
  style: STYLE_URL,
  attribution: DEFAULT_ATTRIBUTION,
  loaded: false,
}

/** Pulls the style's ground and water toward the theme, which is all the spec lets an app set. */
function recolour(style: StyleSpecification): StyleSpecification {
  const layers = style.layers.map((layer) => {
    if (layer.type === 'background') {
      return { ...layer, paint: { ...layer.paint, 'background-color': colours.ground } }
    }
    if (layer.type === 'fill' && layer.id === 'water') {
      return { ...layer, paint: { ...layer.paint, 'fill-color': colours.vignette } }
    }
    if (layer.type === 'line' && layer.id === 'waterway') {
      return { ...layer, paint: { ...layer.paint, 'line-color': colours.vignette } }
    }
    return layer
  })
  return { ...style, layers }
}

/**
 * Reads the licence line off the style's sources, following a source's TileJSON where it has one.
 */
async function attributionOf(style: StyleSpecification): Promise<string> {
  const sources = Object.values(style.sources)
  for (const source of sources) {
    if ('attribution' in source && typeof source.attribution === 'string') {
      return plainAttribution(source.attribution)
    }
  }
  for (const source of sources) {
    if (!('url' in source) || typeof source.url !== 'string') continue
    const json = (await (await fetch(source.url)).json()) as { attribution?: string }
    if (typeof json.attribution === 'string') return plainAttribution(json.attribution)
  }
  return DEFAULT_ATTRIBUTION
}

/** Loads the basemap once: the style JSON in the theme's colours and the line under the map. */
export async function loadBasemap(): Promise<Basemap> {
  const style = recolour((await (await fetch(STYLE_URL)).json()) as StyleSpecification)
  try {
    return { style, attribution: await attributionOf(style), loaded: true }
  } catch {
    // a source whose TileJSON will not answer costs the licence line, not the recoloured style
    return { style, attribution: DEFAULT_ATTRIBUTION, loaded: true }
  }
}
