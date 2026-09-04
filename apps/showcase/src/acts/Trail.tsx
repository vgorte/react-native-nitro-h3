import { Placeholder } from './Placeholder'
import type { ActProps } from './types'

/** Stands on the Trail act's page until the act itself is built. */
export function Trail({ active }: ActProps) {
  return <Placeholder name="Trail" active={active} />
}
