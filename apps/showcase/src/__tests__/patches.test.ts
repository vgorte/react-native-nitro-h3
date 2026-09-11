import { describe, expect, test } from 'bun:test'
import { PATCH_DEPTH } from '../engine/atlas'
import { PATCH_RINGS } from '../engine/mesh'
import { PATCH_BUCKETS, type PatchCalls, patchBuckets } from '../engine/patches'

const RES = 9

/** Counts what each call was asked, so the shape of the walk can be read back. */
interface StubCounts {
  parents: number
  centres: bigint[]
  disks: bigint[]
}

/**
 * Stubs the grid as one patch per ancestor, laid out so a cell's ring is readable from its value.
 *
 * An ancestor is the cell divided by `100`, its centre child is the ancestor times `100`, and the
 * ring `n` of that centre holds the centre plus `n`. So the cell `304` sits in ring `4` of the
 * patch `3`, and any cell whose last two digits pass {@linkcode PATCH_RINGS} lies in no ring.
 */
function stub(counts: StubCounts): PatchCalls {
  return {
    getBaseCellNumber: (cell) => Number(cell),
    cellToParent: (cell) => {
      counts.parents++
      return cell / 100n
    },
    cellToCenterChild: (ancestor) => {
      counts.centres.push(ancestor)
      return ancestor * 100n
    },
    gridDiskDistances: (centre, k) => {
      counts.disks.push(centre)
      const rings = new Array<BigUint64Array>(k + 1)
      for (let ring = 0; ring <= k; ring++) {
        rings[ring] = BigUint64Array.from([centre + BigInt(ring)])
      }
      return rings
    },
  }
}

function counts(): StubCounts {
  return { parents: 0, centres: [], disks: [] }
}

describe('patchBuckets', () => {
  test('colours a cell by its ring distance to the centre of its patch', () => {
    const cells = BigUint64Array.from([300n, 301n, 302n, 310n])
    const seen = counts()

    const patched = patchBuckets(cells, RES, stub(seen))

    // the brightest step at the centre, one step down per ring, over 10 rings and 11 steps
    expect(Array.from(patched.buckets)).toEqual([PATCH_RINGS, PATCH_RINGS - 1, PATCH_RINGS - 2, 0])
    expect(PATCH_BUCKETS).toBe(PATCH_RINGS + 1)
    expect(patched.call).toBe('gridDiskDistances')
  })

  test('leaves a cell no ring reaches on the darkest step', () => {
    const cells = BigUint64Array.from([300n, 399n])
    const seen = counts()

    const patched = patchBuckets(cells, RES, stub(seen))

    expect(patched.buckets[1]).toBe(0)
  })

  test('climbs to one centre child and walks one disk per distinct ancestor', () => {
    const cells = BigUint64Array.from([300n, 301n, 400n, 401n, 402n])
    const seen = counts()

    patchBuckets(cells, RES, stub(seen))

    expect(seen.parents).toBe(cells.length)
    expect(seen.centres).toEqual([3n, 4n])
    expect(seen.disks).toEqual([300n, 400n])
  })

  test('asks for the ancestor the patch depth above the cells', () => {
    const asked: number[] = []
    const seen = counts()
    const calls = stub(seen)

    patchBuckets(BigUint64Array.from([300n]), RES, {
      ...calls,
      cellToParent: (cell, res) => {
        asked.push(res)
        return calls.cellToParent(cell, res)
      },
    })

    expect(asked).toEqual([RES - PATCH_DEPTH])
  })

  test('falls back on the base cell where the view is too coarse to hold a patch', () => {
    const cells = BigUint64Array.from([0n, 1n, BigInt(PATCH_BUCKETS)])
    const seen = counts()

    const patched = patchBuckets(cells, PATCH_DEPTH - 1, stub(seen))

    expect(Array.from(patched.buckets)).toEqual([0, 1, 0])
    expect(patched.call).toBe('getBaseCellNumber')
    expect(patched.patchMs).toBeNull()
    expect(seen.disks).toEqual([])
  })
})
