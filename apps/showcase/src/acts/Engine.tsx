import { Placeholder } from './Placeholder'
import type { ActProps } from './types'

/** Stands on the Engine act's page until the act itself is built. */
export function Engine({ active }: ActProps) {
  return <Placeholder name="Engine" active={active} />
}
