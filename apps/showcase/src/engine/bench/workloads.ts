import {
  cellToBoundary,
  cellToString,
  compactCells,
  gridDisk,
  latLngToCell,
} from 'react-native-nitro-h3'
import { reference, toStrings } from './h3js'

export { REFERENCE_CHUNK, RUN_CEILING_MS } from './runner'

const ORIGIN_LAT = 37.7749
const ORIGIN_LNG = -122.4194
const ORIGIN_RES = 9
const CALLS = 100_000
const CALLS_PER_RUN = 1_000
const DISK_K = 20
// `3k(k+1)+1` cells at `k = 182` is 99,919, the documented 100,000 scale
const FINALE_K = 182

/** Describes one workload: its two timed sides, their pass counts and its documented factor. */
export interface Workload {
  id: string
  label: string
  detail: string
  documented: number | undefined
  runs: number
  referenceRuns: number
  calls: number
  own(): void
  reference(from: number, to: number): void
}

interface DiskInputs {
  origin: bigint
  originString: string
  disk: BigUint64Array
  diskStrings: string[]
}

let inputs: DiskInputs | undefined

/**
 * Builds the disk the first four workloads share, on first use and never inside a timed window.
 *
 * The 1,261 cells and their strings cost about as many native calls, which the app used to pay
 * while it started; the runner's untimed warm-up is what asks for them now.
 */
function diskInputs(): DiskInputs {
  if (inputs === undefined) {
    const origin = latLngToCell(ORIGIN_LAT, ORIGIN_LNG, ORIGIN_RES)
    const disk = gridDisk(origin, DISK_K)
    inputs = { origin, originString: cellToString(origin), disk, diskStrings: toStrings(disk) }
  }
  return inputs
}

/**
 * Builds the shared disk and loads h3-js, so the Engine act pays for both before it times anything.
 *
 * The finale's 99,919 cells are left to its own untimed warm-up, which is the only run that wants
 * them.
 */
export function prepareBench(): void {
  diskInputs()
  reference()
}

/** Holds the four documented workloads, sized as the iPhone XS column of the benchmark report. */
export const WORKLOADS: Workload[] = [
  {
    id: 'W1',
    label: 'latLngToCell',
    detail: '100,000 calls on the documented coordinate',
    documented: 23.6,
    runs: 5,
    referenceRuns: 1,
    calls: CALLS,
    own: () => {
      for (let call = 0; call < CALLS; call++) latLngToCell(ORIGIN_LAT, ORIGIN_LNG, ORIGIN_RES)
    },
    reference: (from, to) => {
      const h3 = reference()
      for (let call = from; call < to; call++) h3.latLngToCell(ORIGIN_LAT, ORIGIN_LNG, ORIGIN_RES)
    },
  },
  {
    id: 'W2',
    label: 'gridDisk(k=20)',
    detail: '1,000 calls, 1,261 cells per call',
    documented: 176.9,
    runs: 5,
    referenceRuns: 1,
    calls: CALLS_PER_RUN,
    own: () => {
      const { origin } = diskInputs()
      for (let call = 0; call < CALLS_PER_RUN; call++) gridDisk(origin, DISK_K)
    },
    reference: (from, to) => {
      const h3 = reference()
      const { originString } = diskInputs()
      for (let call = from; call < to; call++) h3.gridDisk(originString, DISK_K)
    },
  },
  {
    id: 'W4',
    label: 'compactCells',
    detail: 'the k=20 disk, 1,261 cells, median of 20',
    documented: 862.1,
    runs: 20,
    referenceRuns: 20,
    calls: 1,
    own: () => {
      compactCells(diskInputs().disk)
    },
    reference: () => {
      reference().compactCells(diskInputs().diskStrings)
    },
  },
  {
    id: 'W7',
    label: 'cellToBoundary',
    detail: '100,000 calls over the 1,261 cells of the disk',
    documented: 8.6,
    runs: 5,
    referenceRuns: 1,
    calls: CALLS,
    own: () => {
      const { disk } = diskInputs()
      for (let call = 0; call < CALLS; call++) cellToBoundary(disk[call % disk.length])
    },
    reference: (from, to) => {
      const h3 = reference()
      const { disk, diskStrings } = diskInputs()
      for (let call = from; call < to; call++) h3.cellToBoundary(diskStrings[call % disk.length])
    },
  },
]

interface FinaleInputs {
  cells: BigUint64Array
  strings: string[]
}

let finale: FinaleInputs | undefined

// built on first use, the runner's untimed warm-up, and never inside a timed window
function finaleInputs(): FinaleInputs {
  if (finale === undefined) {
    const cells = gridDisk(diskInputs().origin, FINALE_K)
    finale = { cells, strings: toStrings(cells) }
  }
  return finale
}

/** Holds the finale: one unchunked `compactCells` per side, at the scale that blocks h3-js. */
export const FINALE: Workload = {
  id: 'finale',
  label: 'compactCells, 99,919 cells',
  detail: 'one call on each side, unchunked',
  documented: undefined,
  runs: 1,
  referenceRuns: 1,
  calls: 1,
  own: () => {
    compactCells(finaleInputs().cells)
  },
  reference: () => {
    reference().compactCells(finaleInputs().strings)
  },
}
