import type { ComponentType } from 'react'

import Spike1Mesh from './Spike1Mesh'

const SPIKES: Record<string, ComponentType> = {
  '1': Spike1Mesh,
}

/** Answers the spike screen selected by `EXPO_PUBLIC_SPIKE`, or `undefined` for the app itself. */
export function spikeScreen(id: string | undefined): ComponentType | undefined {
  return id === undefined ? undefined : SPIKES[id]
}
