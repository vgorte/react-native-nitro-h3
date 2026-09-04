import type { LatLng } from 'react-native-nitro-h3'

/** Holds the centre and the zoom an act's map last came to rest at. */
export interface PlanetPosition {
  centre: LatLng
  zoom: number
}

let settled: PlanetPosition | null = null

/** Records where a map settled, so a later act can open on the same ground. */
export function rememberPlanetPosition(position: PlanetPosition): void {
  settled = position
}

/** Answers where a map last settled, or `null` before any act has settled once. */
export function lastPlanetPosition(): PlanetPosition | null {
  return settled
}
