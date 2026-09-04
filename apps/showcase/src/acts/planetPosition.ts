import type { LatLng } from 'react-native-nitro-h3'

/** Holds where the Planet act last came to rest. */
export interface PlanetPosition {
  centre: LatLng
  zoom: number
}

let settled: PlanetPosition | null = null

/** Records where Planet settled, so a later act can open on the same ground. */
export function rememberPlanetPosition(position: PlanetPosition): void {
  settled = position
}

/** Answers where Planet last settled, or `null` before it has settled once. */
export function lastPlanetPosition(): PlanetPosition | null {
  return settled
}
