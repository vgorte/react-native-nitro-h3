import h3 from 'h3-js'
import { cellToString } from 'react-native-nitro-h3'

/** Converts a cell set to the strings h3-js takes, outside every timed window. */
export function toStrings(cells: BigUint64Array): string[] {
  const strings = new Array<string>(cells.length)
  for (let index = 0; index < cells.length; index++) strings[index] = cellToString(cells[index])
  return strings
}

/** Names the four h3-js calls the act measures, taken directly so no wrapper is timed. */
export const reference = {
  latLngToCell: h3.latLngToCell,
  gridDisk: h3.gridDisk,
  compactCells: h3.compactCells,
  cellToBoundary: h3.cellToBoundary,
}
