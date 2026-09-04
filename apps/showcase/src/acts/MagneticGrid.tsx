import { Placeholder } from './Placeholder'
import type { ActProps } from './types'

/** Stands on the Magnetic grid act's page until the act itself is built. */
export function MagneticGrid({ active }: ActProps) {
  return <Placeholder name="Magnetic grid" active={active} />
}
