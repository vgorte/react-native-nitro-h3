import { Placeholder } from './Placeholder'
import type { ActProps } from './types'

/** Stands on the Fractal city act's page until the act itself is built. */
export function FractalCity({ active }: ActProps) {
  return <Placeholder name="Fractal city" active={active} />
}
