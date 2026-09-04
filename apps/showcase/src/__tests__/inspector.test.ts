import { describe, expect, test } from 'bun:test'
import {
  type InspectCalls,
  inspectRows,
  type NeighbourhoodCalls,
  neighbourhoodOf,
  REPEATS,
  repeatMedianMs,
} from '../engine/inspect'

const CELL = 0x8a1fb46622dffffn

/** Answers a stub of every H3 call the Inspector makes, standing at one resolution. */
const stub = (res: number): InspectCalls & NeighbourhoodCalls => ({
  cellToString: (cell) => cell.toString(16),
  getResolution: () => res,
  getBaseCellNumber: () => 31,
  isPentagon: () => false,
  cellAreaKm2: () => 0.010_53,
  getHexagonEdgeLengthAvgM: () => 22.6,
  cellToParent: (cell) => cell - 1n,
  cellToChildren: (cell) => BigUint64Array.from([cell, cell + 1n, cell + 2n]),
  cellToChildrenSize: () => 7,
  gridDisk: (cell) => BigUint64Array.from([cell, 1n, 2n, 3n, 4n, 5n, 6n]),
})

describe('repeatMedianMs', () => {
  test('runs the call the full repeat count and answers a duration', () => {
    let calls = 0

    const ms = repeatMedianMs(() => {
      calls += 1
    })

    // one warm-up plus the repeats
    expect(calls).toBe(REPEATS + 1)
    expect(ms).toBeGreaterThanOrEqual(0)
  })

  test('takes the repeat count it is given', () => {
    let calls = 0

    repeatMedianMs(() => {
      calls += 1
    }, 3)

    expect(calls).toBe(4)
  })
})

describe('inspectRows', () => {
  test('answers every reading of a cell in the middle of the ladder', () => {
    const rows = inspectRows(CELL, stub(10))

    expect(rows.map((row) => row.label)).toEqual([
      'index',
      'decimal',
      'resolution',
      'base cell',
      'pentagon',
      'cell area',
      'average for res 10',
      'parent',
      'next level',
      'neighbours',
      'shape',
    ])
  })

  test('leaves the parent out at resolution 0', () => {
    const labels = inspectRows(CELL, stub(0)).map((row) => row.label)

    expect(labels).not.toContain('parent')
    expect(labels).toContain('next level')
    expect(labels).toHaveLength(10)
  })

  test('leaves the next level out at resolution 15', () => {
    const labels = inspectRows(CELL, stub(15)).map((row) => row.label)

    expect(labels).toContain('parent')
    expect(labels).not.toContain('next level')
    expect(labels).toHaveLength(10)
  })

  test('names the call behind every reading it timed', () => {
    const rows = inspectRows(CELL, stub(10))
    const timed = rows.filter((row) => row.ms !== undefined)

    expect(timed.map((row) => row.call)).toEqual([
      'cellToString',
      'getResolution',
      'getBaseCellNumber',
      'isPentagon',
      'cellAreaKm2',
      'getHexagonEdgeLengthAvgM',
      'cellToParent',
      'cellToChildrenSize',
      'gridDisk',
    ])
    // the decimal is the cell itself and the shape describes a call already timed above
    expect(rows.filter((row) => row.ms === undefined).map((row) => row.label)).toEqual([
      'decimal',
      'shape',
    ])
  })

  test('reads the values off the calls', () => {
    const rows = inspectRows(CELL, stub(10))
    const value = (label: string) => rows.find((row) => row.label === label)?.value

    expect(value('index')).toBe('8a1fb46622dffff')
    expect(value('decimal')).toBe('622054503267303423')
    expect(value('resolution')).toBe('10')
    expect(value('base cell')).toBe('31')
    expect(value('pentagon')).toBe('no')
    expect(value('cell area')).toBe('0.01053 km²')
    expect(value('average for res 10')).toBe('22.6 m')
    expect(value('parent')).toBe('8a1fb46622dfffe')
    expect(value('next level')).toBe('7')
    expect(value('neighbours')).toBe('6')
  })

  test('prints the literal shape of the call that answers an array', () => {
    const shape = inspectRows(CELL, stub(10)).find((row) => row.label === 'shape')

    expect(shape?.value).toBe('bigint -> BigUint64Array of 7, 56 bytes')
  })
})

describe('neighbourhoodOf', () => {
  test('answers the parent, the children and the ring around the cell', () => {
    const around = neighbourhoodOf(CELL, stub(10))

    expect(around.parent).toBe(CELL - 1n)
    expect(Array.from(around.children)).toEqual([CELL, CELL + 1n, CELL + 2n])
    // the disk carries the cell itself, which the highlight draws as neither of the three
    expect(Array.from(around.neighbours)).toEqual([1n, 2n, 3n, 4n, 5n, 6n])
  })

  test('has no parent at resolution 0 and no children at resolution 15', () => {
    expect(neighbourhoodOf(CELL, stub(0)).parent).toBeNull()
    expect(neighbourhoodOf(CELL, stub(15)).children).toHaveLength(0)
  })
})
