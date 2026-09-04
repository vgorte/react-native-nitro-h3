import type { LatLng } from 'react-native-nitro-h3'

/** Holds the centre and the zoom an act's map last came to rest at. */
export interface MapPosition {
  centre: LatLng
  zoom: number
}

let settled: MapPosition | null = null

/** Records where a map settled, so a later act can open on the same ground. */
export function rememberMapPosition(position: MapPosition): void {
  settled = position
}

/** Answers where a map last settled, or `null` before any act has settled once. */
export function lastMapPosition(): MapPosition | null {
  return settled
}
