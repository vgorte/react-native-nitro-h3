import { Placeholder } from './Placeholder'
import type { ActProps } from './types'

/** Stands on the Heatmap act's page until the act itself is built. */
export function Heatmap({ active }: ActProps) {
  return <Placeholder name="Heatmap" active={active} />
}
