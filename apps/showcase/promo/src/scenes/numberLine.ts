import type { Reading } from './reading'
import type { Scene } from './scenes'
import { ringsOf } from './track'

/** Holds the number line broken into the pieces the caption sets at different sizes. */
export interface NumberLine {
  lead: string
  number: string
  suffix: string
  unit: string
}

/**
 * Writes the line the caption's big row carries, from the reading the scene stands on.
 *
 * A line with no number is the unit alone, which the caption sets smaller so words never shout at
 * the size a number is read at. `{k}` in a unit names the ring count the reading was walked at,
 * which only a disk carries.
 */
export function numberLine(scene: Scene, reading: Reading): NumberLine {
  if (reading.value === null) {
    return { lead: '', number: '', suffix: '', unit: reading.unit }
  }
  return {
    lead: scene.lead ?? '',
    number: format(reading.value, scene.decimals),
    suffix: scene.suffix,
    unit: reading.unit.replace('{k}', `${ringsOf(Math.round(reading.value))}`),
  }
}

/**
 * Writes a number the way the act's own panel writes it.
 *
 * Counts are grouped, as `formatCount` groups them; a factor is not, because the app's own factor
 * row writes it with `toFixed` and the caption must not disagree with the phone beside it.
 */
export function format(value: number, decimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: decimals === 0,
  })
}
