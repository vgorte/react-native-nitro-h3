import { describe, expect, test } from 'bun:test'
import type { CoordPair as ExportedCoordPair } from '../src/index'
import type { CoordPair, Ring } from '../src/types'
import { CONTAINMENT_MODE_BY_NAME, ContainmentMode } from '../src/types'

describe('containment modes', () => {
  test('maps every h3-js name to its H3 value', () => {
    // the names are h3-js's `POLYGON_TO_CELLS_FLAGS` keys, the numbers are H3's `ContainmentMode`.
    expect(CONTAINMENT_MODE_BY_NAME).toEqual({
      containmentCenter: ContainmentMode.center,
      containmentFull: ContainmentMode.full,
      containmentOverlapping: ContainmentMode.overlapping,
      containmentOverlappingBbox: ContainmentMode.overlappingBbox,
    })
    expect(Object.values(CONTAINMENT_MODE_BY_NAME)).toEqual([0, 1, 2, 3])
  })

  test('is frozen, so a caller cannot teach it a new name', () => {
    expect(Object.isFrozen(CONTAINMENT_MODE_BY_NAME)).toBe(true)
  })

  test('answers undefined for a name h3-js does not have', () => {
    // `containment.ts` turns that into `4`, which is H3's `CONTAINMENT_INVALID`.
    const unknown = (CONTAINMENT_MODE_BY_NAME as Record<string, number | undefined>).containmentNone
    expect(unknown).toBeUndefined()
  })
})

/** Fails to compile unless its argument is `true`, which is how a type-level row is proved. */
type Expect<T extends true> = T

/** Answers `true` only when the two types are the same in both directions. */
type IsExactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// the pair is the public shape of every coordinate answer, and only `tsc` can prove it
export type CoordPairIsATuple = Expect<IsExactly<CoordPair, [number, number]>>
export type RingIsCoordPairs = Expect<IsExactly<Ring, CoordPair[]>>
export type BarrelExportsCoordPair = Expect<IsExactly<ExportedCoordPair, CoordPair>>
