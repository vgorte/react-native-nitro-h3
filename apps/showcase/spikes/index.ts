import type { ComponentType } from 'react'

import Spike1Mesh from './Spike1Mesh'
import Spike2Tiles from './Spike2Tiles'

const SPIKES: Record<string, ComponentType> = {
  '1': Spike1Mesh,
  '2': Spike2Tiles,
}

/** Answers the spike screen selected by `EXPO_PUBLIC_SPIKE`, or `undefined` for the app itself. */
export function spikeScreen(id: string | undefined): ComponentType | undefined {
  return id === undefined ? undefined : SPIKES[id]
}
