import type * as h3js from 'h3-js'
import { cellToString } from 'react-native-nitro-h3'

/** Converts a cell set to the strings h3-js takes, outside every timed window. */
export function toStrings(cells: BigUint64Array): string[] {
  const strings = new Array<string>(cells.length)
  for (let index = 0; index < cells.length; index++) strings[index] = cellToString(cells[index])
  return strings
}

function refuseUtf16(): never {
  throw new RangeError('this runtime decodes utf-8 only')
}

/**
 * Loads h3-js past the `utf-16le` decoder its Emscripten prologue builds as the module evaluates.
 *
 * The runtime's `TextDecoder` rejects that label, so the import throws without a stand-in; h3-js
 * reads no string through it, and the stand-in refuses to decode, so nothing can read one silently.
 */
function loadH3(): typeof h3js {
  const runtime: typeof TextDecoder | undefined = globalThis.TextDecoder
  // a runtime without `TextDecoder` builds no decoder at all, so it needs no stand-in
  if (runtime === undefined) return require('h3-js')
  globalThis.TextDecoder = class extends runtime {
    constructor(label?: string, options?: TextDecoderOptions) {
      const utf16 = label?.toLowerCase() === 'utf-16le'
      super(utf16 ? 'utf-8' : label, options)
      if (utf16) this.decode = refuseUtf16
    }
  }
  try {
    return require('h3-js')
  } finally {
    globalThis.TextDecoder = runtime
  }
}

const h3 = loadH3()

/** Names the four h3-js calls the act measures, taken directly so no wrapper is timed. */
export const reference = {
  latLngToCell: h3.latLngToCell,
  gridDisk: h3.gridDisk,
  compactCells: h3.compactCells,
  cellToBoundary: h3.cellToBoundary,
}
