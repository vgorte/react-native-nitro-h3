import type { LatLng } from 'react-native-nitro-h3'

/** Holds the centre and the zoom an act's map camera last stood at. */
export interface MapPosition {
  centre: LatLng
  zoom: number
}

let stood: MapPosition | null = null

/** Records where a map's camera stands, so a later act can open on the same ground. */
export function rememberMapPosition(position: MapPosition): void {
  stood = position
}

/** Answers where a map's camera last stood, or `null` before any act has shown one. */
export function lastMapPosition(): MapPosition | null {
  return stood
}
