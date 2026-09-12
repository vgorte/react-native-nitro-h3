/**
 * Pins every difference from h3-js that is meant, so none can slip through as a bug.
 *
 * The comparison runs through the probe, whose answers are JSON, so cells are hexadecimal strings
 * and cell sets are arrays. The `bigint`, `BigUint64Array` and `LatLng` shapes of the public API
 * are not under test here, and neither are the h3-js containment mode names the wrapper also takes.
 */

import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import h3 from 'h3-js'
import type * as api from '../src/index'
import {
  ContainmentMode,
  type ContainmentModeName,
  type ContainmentModeValue,
  type CoordIJ,
  type LatLng,
  type Ring,
} from '../src/types'
import {
  EXTREME_COORDINATES,
  PENTAGON_NEIGHBOURHOODS,
  PENTAGONS,
  RES0_CELLS,
  RESOLUTIONS,
} from './corpus'
import { callMany, skipWithoutProbe } from './probe'

/** Fails to compile unless its argument is `true`, which is how a type-level row is proved. */
type Expect<T extends true> = T

/** Answers `true` only when the two types are the same in both directions. */
type IsExactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/** Answers `true` only when `A` cannot be assigned to `B`, proving a rejected shape. */
type IsNotAssignable<A, B> = [A] extends [B] ? false : true

// the probe speaks JSON, so `tsc` is what proves this package's half of every shape row; the h3-js
// half is asserted at run time in `divergence: the shape of the public surface`.
export type CellIsABigint = Expect<IsExactly<ReturnType<typeof api.latLngToCell>, bigint>>
export type CellSetIsATypedArray = Expect<
  IsExactly<ReturnType<typeof api.gridDisk>, BigUint64Array>
>
export type CentreIsAnObject = Expect<IsExactly<ReturnType<typeof api.cellToLatLng>, LatLng>>
export type BoundaryIsObjects = Expect<IsExactly<ReturnType<typeof api.cellToBoundary>, LatLng[]>>
export type EdgeBoundaryIsObjects = Expect<
  IsExactly<ReturnType<typeof api.directedEdgeToBoundary>, LatLng[]>
>
export type VertexIsAnObject = Expect<IsExactly<ReturnType<typeof api.vertexToLatLng>, LatLng>>
export type MultiPolygonIsObjects = Expect<
  IsExactly<ReturnType<typeof api.cellsToMultiPolygon>, LatLng[][][]>
>
export type RingsAreTuples = Expect<
  IsNotAssignable<number[][][], Parameters<typeof api.polygonToCells>[0]>
>
export type ASingleLoopIsRejected = Expect<
  IsNotAssignable<Ring, Parameters<typeof api.polygonToCells>[0]>
>
export type GridDiskDistancesIsTypedArrays = Expect<
  IsExactly<ReturnType<typeof api.gridDiskDistances>, BigUint64Array[]>
>
export type GreatCircleDistanceTakesFourScalars = Expect<
  IsExactly<Parameters<typeof api.greatCircleDistanceKm>, [number, number, number, number]>
>
// the four functions h3-js gives a GeoJSON flag take no such argument here
export type BoundaryTakesNoFlag = Expect<IsExactly<Parameters<typeof api.cellToBoundary>, [bigint]>>
export type EdgeBoundaryTakesNoFlag = Expect<
  IsExactly<Parameters<typeof api.directedEdgeToBoundary>, [bigint]>
>
export type MultiPolygonTakesNoFlag = Expect<
  IsExactly<Parameters<typeof api.cellsToMultiPolygon>, [BigUint64Array]>
>
export type PolygonToCellsTakesNoFlag = Expect<
  IsExactly<Parameters<typeof api.polygonToCells>, [Ring[], number]>
>
export type ExperimentalTakesNoFlag = Expect<
  IsExactly<
    Parameters<typeof api.polygonToCellsExperimental>,
    [Ring[], number, ContainmentModeValue | ContainmentModeName]
  >
>
// h3-js exports both constants; the ops list cannot prove their absence, because it holds functions
export type NoUnitConstants = Expect<
  IsExactly<Extract<keyof typeof api, 'UNITS' | 'POLYGON_TO_CELLS_FLAGS'>, never>
>
export type AsyncVariantsPromiseTheSameResults = Expect<
  IsExactly<
    [
      ReturnType<typeof api.polygonToCellsAsync>,
      ReturnType<typeof api.polygonToCellsExperimentalAsync>,
      ReturnType<typeof api.cellsToMultiPolygonAsync>,
      ReturnType<typeof api.uncompactCellsAsync>,
    ],
    [
      Promise<ReturnType<typeof api.polygonToCells>>,
      Promise<ReturnType<typeof api.polygonToCellsExperimental>>,
      Promise<ReturnType<typeof api.cellsToMultiPolygon>>,
      Promise<ReturnType<typeof api.uncompactCells>>,
    ]
  >
>

const CELL = '89283082803ffff'

/** The triangle h3-js's own test suite uses, as `[lat, lng]` pairs. */
const SAN_FRANCISCO: [number, number][] = [
  [37.813319, -122.408987],
  [37.719806, -122.354474],
  [37.815157, -122.479877],
]

/** The same triangle in GeoJSON order, which is what the h3-js flags expect. */
const SAN_FRANCISCO_GEOJSON: [number, number][] = SAN_FRANCISCO.map(
  ([lat, lng]) => [lng, lat] as [number, number],
)

/** Carries directed edge mode bits and direction `0`, which no real edge ever has. */
const EDGE_WITH_NO_DIRECTION = '109283082803ffff'

/** Returns the probe's answer, or the `Error` it reported. */
function ask(request: string): unknown {
  return callMany([request])[0]
}

/** Returns the probe's answer, failing the test if the probe refused instead. */
function answer(request: string): unknown {
  const value = ask(request)
  expect(value, `${request} was refused`).not.toBeInstanceOf(Error)
  return value
}

/** Returns the message the probe refused with, failing the test if it answered instead. */
function refusal(request: string): string {
  const value = ask(request)
  expect(value, `${request} was answered`).toBeInstanceOf(Error)
  return (value as Error).message
}

/** Returns the message h3-js threw, failing the test if it answered instead. */
function h3jsRefusal(produce: () => unknown): string {
  try {
    produce()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('h3-js answered where a refusal was expected')
}

/** Returns the H3 error code a message carries in its `(code: N)` suffix. */
function codeOf(message: string): number | undefined {
  const match = /\(code: (\d+)[,)]/.exec(message)
  return match === null ? undefined : Number(match[1])
}

/** Removes the `, value: X` h3-js appends where it validated the argument itself. */
function withoutValue(message: string): string {
  return message.replace(/, value: [^)]*\)/, ')')
}

/**
 * Runs one h3-js expression in a fresh process and returns what it printed.
 *
 * `uncompactCells` over an unvalidated member sizes its output from a nonsense index and asks
 * emscripten for the memory, which leaves the module unusable for the rest of the process.
 */
function askH3JsInAFreshProcess(expression: string): string {
  const source =
    "import h3 from 'h3-js'\n" +
    `try { console.log('ok ' + JSON.stringify(${expression})) }\n` +
    "catch (error) { console.log('threw ' + error.message) }"
  const result = spawnSync('bun', ['-e', source], {
    cwd: join(import.meta.dir, '..'),
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`h3-js could not be asked: ${result.stderr}`)
  }
  return result.stdout.trim()
}

describe.skipIf(skipWithoutProbe)('divergence: an invalid index is refused, not read', () => {
  test('an invalid cell earns E_CELL_INVALID where h3-js reads it anyway', () => {
    for (const request of [
      `cellAreaKm2 1`,
      `cellToBoundary 1`,
      `cellToLatLng 1`,
      `gridDisk 1 1`,
      `cellToChildren 1 2`,
    ]) {
      const message = refusal(request)
      expect(message, request).toBe('Cell argument was not valid (code: 5)')
    }
    // h3-js runs the same C code without the guard, so it answers with whatever the bits mean
    expect(h3.cellArea('1', 'km2')).toBe(4106166.3344638464)
    // h3-js's own arithmetic rounds differently per platform, so only twelve digits are pinned
    const [lat, lng] = h3.cellToLatLng('1')
    expect(lat).toBeCloseTo(79.24239850975904, 12)
    expect(lng).toBeCloseTo(38.0234070079698, 12)
    expect(h3.gridDisk('1', 1)).toEqual([
      '1000000000001',
      '200000000001',
      '400000000001',
      '600000000001',
      '800000000001',
      'a00000000001',
    ])
  })

  test('an invalid directed edge earns E_DIR_EDGE_INVALID where h3-js reads it anyway', () => {
    expect(h3.isValidDirectedEdge(EDGE_WITH_NO_DIRECTION)).toBe(false)
    expect(refusal(`getDirectedEdgeOrigin ${EDGE_WITH_NO_DIRECTION}`)).toBe(
      'Directed edge argument was not valid (code: 6)',
    )
    expect(h3.getDirectedEdgeOrigin(EDGE_WITH_NO_DIRECTION)).toBe(CELL)
  })

  test('an invalid vertex earns E_VERTEX_INVALID where h3-js reads it anyway', () => {
    expect(h3.isValidVertex(CELL)).toBe(false)
    expect(refusal(`vertexToLatLng ${CELL}`)).toBe('Vertex argument was not valid (code: 8)')
    expect(h3.vertexToLatLng(CELL)).toEqual([37.7720104773324, -122.41701147197293])
  })

  test('the nine exemptions answer for any input, and agree with h3-js', () => {
    const indexes = ['1', '0', 'ffffffffffffffff', EDGE_WITH_NO_DIRECTION, CELL]
    for (const op of [
      'isValidCell',
      'isValidIndex',
      'isPentagon',
      'isResClassIII',
      'isValidDirectedEdge',
      'isValidVertex',
      'getResolution',
      'getBaseCellNumber',
    ] as const) {
      for (const index of indexes) {
        expect(answer(`${op} ${index}`), `${op}(${index})`).toBe(h3[op](index))
      }
    }
    // `cellToString` is the ninth, and formats any index; h3-js has no counterpart to compare
    for (const index of indexes) {
      expect(answer(`cellToString ${index}`)).toBe(index)
      // `cellFromString` takes text rather than a cell index, so it converts whatever parses
      expect(answer(`cellFromString ${index}`)).toBe(index)
    }
  })
})

describe.skipIf(skipWithoutProbe)('divergence: an argument that is not an integer', () => {
  test('a fractional argument is refused where h3-js truncates it', () => {
    // the fourth element is the answer truncation gives h3-js, so a change of h3-js's mind shows up
    const cases: [string, string, () => unknown, unknown][] = [
      [
        `gridDisk ${CELL} 1.5`,
        'k must be an integer',
        () => h3.gridDisk(CELL, 1.5),
        h3.gridDisk(CELL, 1),
      ],
      [
        `cellToParent ${CELL} 1.5`,
        'Resolution must be an integer between 0 and 15',
        () => h3.cellToParent(CELL, 1.5),
        '81283ffffffffff',
      ],
      [
        `cellToVertex ${CELL} 0.5`,
        'Vertex number must be an integer',
        () => h3.cellToVertex(CELL, 0.5),
        '209283082803ffff',
      ],
      [
        'latLngToCell 0 0 1.5',
        'Resolution must be an integer between 0 and 15',
        () => h3.latLngToCell(0, 0, 1.5),
        '81757ffffffffff',
      ],
      [
        `childPosToCell 1.5 ${CELL} 10`,
        'Child position must be an integer',
        () => h3.childPosToCell(1.5, CELL, 10),
        '8a283082800ffff',
      ],
    ]
    for (const [request, message, produce, truncated] of cases) {
      expect(refusal(request), request).toBe(message)
      // this package's wording carries no `(code: N)`, because H3 never saw the argument
      expect(codeOf(message), request).toBeUndefined()
      expect(produce(), request).toEqual(truncated)
    }
  })

  test('a fractional local IJ coordinate is refused where h3-js truncates it', () => {
    const message = refusal(`localIjToCell ${CELL} 1.5 0`)
    expect(message).toBe('Local IJ coordinates must be integers')
    expect(codeOf(message)).toBeUndefined()
    expect(h3.localIjToCell(CELL, { i: 1.5, j: 0 })).toBe(h3.localIjToCell(CELL, { i: 1, j: 0 }))
  })

  test('a fractional resolution is refused in our wording where h3-js reports E_RES_DOMAIN', () => {
    const cases: [string, () => unknown][] = [
      ['getHexagonAreaAvgKm2 1.5', () => h3.getHexagonAreaAvg(1.5, 'km2')],
      ['getHexagonEdgeLengthAvgKm 1.5', () => h3.getHexagonEdgeLengthAvg(1.5, 'km')],
      ['getNumCells 1.5', () => h3.getNumCells(1.5)],
    ]
    for (const [request, produce] of cases) {
      expect(refusal(request), request).toBe('Resolution must be an integer between 0 and 15')
      expect(h3jsRefusal(produce), request).toBe(
        'Resolution argument was outside of acceptable range (code: 4, value: 1.5)',
      )
    }
  })
})

describe.skipIf(skipWithoutProbe)('divergence: the opt-in cell ceiling', () => {
  test('no ceiling applies until one is set', () => {
    // `__maxCellCount` is what `configure` reaches, so the two requests share one process
    const [before, , after] = callMany([
      `gridDisk ${CELL} 1`,
      '__maxCellCount 3',
      `gridDisk ${CELL} 1`,
    ])
    expect(before).toHaveLength(7)
    expect((after as Error).message).toBe(
      'The requested result of 7 cells exceeds the cell limit of 3 set with configure({ maxCellCount }). Raise or remove the limit to allow it.',
    )
  })

  test('a ceiling refuses a request h3-js allocates', () => {
    // `3 * 1155 * 1156 + 1` is 4,005,541 cells, the first `k` past a ceiling of four million
    const [, refused] = callMany(['__maxCellCount 4000000', `gridDisk ${CELL} 1155`])
    expect((refused as Error).message).toBe(
      'The requested result of 4005541 cells exceeds the cell limit of 4000000 set with configure({ maxCellCount }). Raise or remove the limit to allow it.',
    )
    expect(h3.gridDisk(CELL, 1155)).toHaveLength(4005541)
  })
})

describe.skipIf(skipWithoutProbe)('divergence: a malformed polygon', () => {
  test('a point that is not a pair is refused, where h3-js reports E_FAILED', () => {
    expect(refusal('polygonToCells 0,0;0;1,1 3')).toBe(
      'Each polygon point must be a [latitude, longitude] pair',
    )
    const theirs = h3jsRefusal(() =>
      h3.polygonToCells([[[0, 0], [0] as unknown as [number, number], [1, 1]]], 3),
    )
    expect(theirs).toBe('The operation failed but a more specific error is not available (code: 1)')
  })

  test('a coordinate that is not finite is named, where h3-js reports E_FAILED', () => {
    expect(refusal('polygonToCells 0,0;nan,1;1,1 3')).toBe(
      'Polygon coordinates must be finite numbers',
    )
    const theirs = h3jsRefusal(() =>
      h3.polygonToCells(
        [
          [
            [0, 0],
            [Number.NaN, 1],
            [1, 1],
          ],
        ],
        3,
      ),
    )
    expect(theirs).toBe('The operation failed but a more specific error is not available (code: 1)')
  })

  test('a coordinate off the globe is refused, where h3-js normalises it', () => {
    expect(refusal('polygonToCells 91,0;0,0;1,1 3')).toBe(
      'Polygon coordinates must be within [-90, 90] latitude and [-180, 180] longitude',
    )
    expect(refusal('polygonToCellsExperimental 91,0;0,0;1,1 3 0')).toBe(
      'Polygon coordinates must be within [-90, 90] latitude and [-180, 180] longitude',
    )
    // h3-js hands the vertex to H3, which normalises it into a seed cell and fills from there
    expect(
      h3.polygonToCells(
        [
          [
            [91, 0],
            [0, 0],
            [1, 1],
          ],
        ],
        3,
      ),
    ).toHaveLength(41)
  })
})

describe.skipIf(skipWithoutProbe)('parity: error codes and wording', () => {
  test('a failure from H3 carries the same code and the same text as h3-js', () => {
    const cases: [string, () => unknown][] = [
      ['latLngToCell 0 0 42', () => h3.latLngToCell(0, 0, 42)],
      [`cellToChildren ${CELL} 20`, () => h3.cellToChildren(CELL, 20)],
      [`cellToParent ${CELL} 12`, () => h3.cellToParent(CELL, 12)],
      [`gridPathCells ${CELL} 85283083fffffff`, () => h3.gridPathCells(CELL, '85283083fffffff')],
      [
        'gridDistance 8009fffffffffff 8075fffffffffff',
        () => h3.gridDistance('8009fffffffffff', '8075fffffffffff'),
      ],
      [
        'cellToLocalIj 8009fffffffffff 8075fffffffffff',
        () => h3.cellToLocalIj('8009fffffffffff', '8075fffffffffff'),
      ],
      ['edgeLengthKm 1', () => h3.edgeLength('1', 'km')],
      ['directedEdgeToCells 1', () => h3.directedEdgeToCells('1')],
      [`cellToVertex ${CELL} 7`, () => h3.cellToVertex(CELL, 7)],
      ['getHexagonAreaAvgKm2 16', () => h3.getHexagonAreaAvg(16, 'km2')],
      ['getNumCells 16', () => h3.getNumCells(16)],
      [`getIndexDigit ${CELL} 0`, () => h3.getIndexDigit(CELL, 0)],
      [`childPosToCell 100000 ${CELL} 10`, () => h3.childPosToCell(100000, CELL, 10)],
      [`uncompactCells ${CELL} 5`, () => h3.uncompactCells([CELL], 5)],
      ['constructCell 200 - 0', () => h3.constructCell(200, [], 0)],
    ]
    for (const [request, produce] of cases) {
      const ours = refusal(request)
      const theirs = h3jsRefusal(produce)
      expect(withoutValue(theirs), request).toBe(ours)
      expect(codeOf(ours), request).toBe(codeOf(theirs) as number)
    }
  })

  test('E_OPTION_INVALID keeps its code but not h3-js wording', () => {
    // h3-js rejects an unknown containment mode in JavaScript, from a table that has no entry 15
    const ours = refusal('polygonToCellsExperimental 0,0;0,1;1,1 3 4')
    const theirs = h3jsRefusal(() =>
      h3.polygonToCellsExperimental(
        [
          [
            [0, 0],
            [0, 1],
            [1, 1],
          ],
        ],
        3,
        4 as unknown as 'containmentCenter',
      ),
    )
    expect(ours).toBe('Mode or flags argument was not valid (code: 15)')
    expect(theirs).toBe('Unknown error (code: 15, value: 4)')
    expect(codeOf(ours)).toBe(codeOf(theirs) as number)
  })

  test('the two codes whose h3-js wording has drifted from describeH3Error', () => {
    // h3-js keeps its own copy of the message table, and these two entries no longer match H3's
    const digitDomain = refusal('constructCell 20 7 1')
    expect(digitDomain).toBe('Child digits invalid (code: 18)')
    expect(h3jsRefusal(() => h3.constructCell(20, [7], 1))).toBe(
      'Child indexing digits invalid (code: 18)',
    )

    const deletedDigit = refusal('constructCell 4 1 1')
    expect(deletedDigit).toBe('Deleted subsequence indicates invalid index (code: 19)')
    expect(h3jsRefusal(() => h3.constructCell(4, [1], 1))).toBe(
      'Child indexing digits refer to a deleted subsequence (code: 19)',
    )
  })

  test('a digit count that does not match the resolution is refused in our own wording', () => {
    expect(refusal('constructCell 20 1,2,3 5')).toBe('constructCell needs exactly res digits')
    expect(h3jsRefusal(() => h3.constructCell(20, [1, 2, 3], 5))).toBe(
      'Child indexing digits invalid (code: 18, value: 3)',
    )
  })
})

// the signature row that used to diverge: `tsc` proves the shape, the test below the answer
export type LocalIjToCellTakesACoordIJ = Expect<
  IsExactly<Parameters<typeof api.localIjToCell>, [bigint, CoordIJ]>
>

describe.skipIf(skipWithoutProbe)('parity: where a divergence would be easy to assume', () => {
  test('getResolution answers -1 for an invalid index, exactly as h3-js does', () => {
    for (const index of ['ffffffffffffffff', '0', '1']) {
      expect(answer(`getResolution ${index}`), index).toBe(-1)
      expect(h3.getResolution(index), index).toBe(-1)
    }
  })

  test('constructCell keeps the h3-js argument order rather than the C order', () => {
    // h3-js: `constructCell(baseCellNumber, digits, res)`. C: `constructCell(res, baseCellNumber,
    // digits)`. Matching h3-js means a caller migrating does not have to transpose.
    const digits = Array.from({ length: 9 }, (_, i) => h3.getIndexDigit(CELL, i + 1))
    expect(answer(`constructCell 20 ${digits.join(',')} 9`)).toBe(CELL)
    expect(h3.constructCell(20, digits, 9)).toBe(CELL)
    // the C order would be `(9, digits, 20)`, and 20 is not a resolution
    expect(refusal(`constructCell 9 ${digits.join(',')} 20`)).toBe(
      'Resolution argument was outside of acceptable range (code: 4)',
    )
  })

  test('localIjToCell reads the CoordIJ cellToLocalIj answers, exactly as h3-js does', () => {
    // the `[bigint, CoordIJ]` parameters this package takes are proved by `tsc` above
    const ij = h3.cellToLocalIj(CELL, CELL)
    expect(h3.localIjToCell(CELL, ij)).toBe(CELL)
    // the probe takes the two coordinates the wrapper unpacks the object into
    expect(answer(`localIjToCell ${CELL} ${ij.i} ${ij.j}`)).toBe(CELL)
  })

  test('a containment mode number covers the same cells as the h3-js flag name', () => {
    const rings = '37.813319,-122.408987;37.719806,-122.354474;37.815157,-122.479877'
    const polygon: [number, number][][] = [
      [
        [37.813319, -122.408987],
        [37.719806, -122.354474],
        [37.815157, -122.479877],
      ],
    ]
    const flags = [
      'containmentCenter',
      'containmentFull',
      'containmentOverlapping',
      'containmentOverlappingBbox',
    ] as const
    for (const [mode, flag] of flags.entries()) {
      expect(answer(`polygonToCellsExperimental ${rings} 7 ${mode}`), flag).toEqual(
        h3.polygonToCellsExperimental(polygon, 7, flag),
      )
    }
  })

  test('compactCells refuses an invalid member with a different code, and ignores 0 alike', () => {
    const ours = refusal(`compactCells ${CELL},1`)
    const theirs = h3jsRefusal(() => h3.compactCells([CELL, '1']))
    expect(ours).toBe('Cell argument was not valid (code: 5)')
    // h3-js lets the invalid member through to H3, which reads it as another resolution
    expect(theirs).toBe('Cell arguments had incompatible resolutions (code: 12)')

    expect(answer(`compactCells ${CELL},0`)).toEqual(h3.compactCells([CELL, '0']))
  })

  // spawns a fresh bun process for h3-js, which can exceed bun's default 5 s timeout on a cold CI runner
  test('uncompactCells refuses an invalid member with a different code, and ignores 0 alike', () => {
    expect(refusal(`uncompactCells ${CELL},1 10`)).toBe('Cell argument was not valid (code: 5)')
    expect(askH3JsInAFreshProcess(`h3.uncompactCells(['${CELL}', '1'], 10)`)).toBe(
      'threw Bounds of provided memory were insufficient (code: 14)',
    )

    expect(answer(`uncompactCells ${CELL},0 10`)).toEqual(h3.uncompactCells([CELL, '0'], 10))
  }, 30_000)
})

describe.skipIf(skipWithoutProbe)('parity: arithmetic away from a pole', () => {
  test('cell centres, boundaries and vertexes agree to 5.7e-14 degrees', () => {
    // measured `5.68e-14` over this corpus, and the bound is three times that
    const bound = 2e-13
    const cells = [...RES0_CELLS, ...PENTAGONS]
    const centres = callMany(cells.map((cell) => `cellToLatLng ${cell}`))
    const boundaries = callMany(cells.map((cell) => `cellToBoundary ${cell}`))
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i] as string
      const centre = centres[i] as [number, number]
      const theirCentre = h3.cellToLatLng(cell)
      expect(Math.abs(centre[0] - theirCentre[0]), `cellToLatLng(${cell})`).toBeLessThan(bound)
      expect(Math.abs(centre[1] - theirCentre[1]), `cellToLatLng(${cell})`).toBeLessThan(bound)
      const ring = boundaries[i] as number[][]
      const theirRing = h3.cellToBoundary(cell)
      for (let v = 0; v < theirRing.length; v++) {
        const a = ring[v] as number[]
        const b = theirRing[v] as number[]
        expect(Math.abs((a[0] as number) - (b[0] as number)), `${cell}[${v}]`).toBeLessThan(bound)
        expect(Math.abs((a[1] as number) - (b[1] as number)), `${cell}[${v}]`).toBeLessThan(bound)
      }
    }
    const vertexes = PENTAGONS.flatMap((cell) => h3.cellToVertexes(cell))
    const answers = callMany(vertexes.map((vertex) => `vertexToLatLng ${vertex}`))
    for (let i = 0; i < vertexes.length; i++) {
      const ours = answers[i] as [number, number]
      const theirs = h3.vertexToLatLng(vertexes[i] as string)
      expect(Math.abs(ours[0] - theirs[0]), `vertexToLatLng(${vertexes[i]})`).toBeLessThan(bound)
      expect(Math.abs(ours[1] - theirs[1]), `vertexToLatLng(${vertexes[i]})`).toBeLessThan(bound)
    }
  })

  test('cell areas agree to 4.6e-13 relative and the resolution averages bit for bit', () => {
    // measured `4.58e-13` over this corpus, which reaches resolution 6, and the bound is twice that
    const bound = 1e-12
    const cells = [...RES0_CELLS, ...PENTAGON_NEIGHBOURHOODS]
    const answers = callMany(cells.map((cell) => `cellAreaKm2 ${cell}`))
    for (let i = 0; i < cells.length; i++) {
      const theirs = h3.cellArea(cells[i] as string, 'km2')
      expect(Math.abs((answers[i] as number) - theirs) / theirs, `${cells[i]}`).toBeLessThan(bound)
    }
    for (const res of RESOLUTIONS) {
      expect(answer(`getHexagonAreaAvgKm2 ${res}`)).toBe(h3.getHexagonAreaAvg(res, 'km2'))
      expect(answer(`getHexagonEdgeLengthAvgKm ${res}`)).toBe(h3.getHexagonEdgeLengthAvg(res, 'km'))
    }
  })

  test('great circle distances agree to 2.0e-15 relative, and degsToRads bit for bit', () => {
    // the haversine runs on the arguments themselves, so there is nothing for the contraction to
    // amplify. Measured `2.02e-15` over the seeded pairs, and the bound is five times that.
    const pairs: [number, number, number, number][] = [
      [0, 0, 90, 0],
      [37.7749, -122.4194, 51.5074, -0.1278],
      [-89.9999, -179.9999, 89.9999, 179.9999],
      [10, 179, -10, -179],
    ]
    for (const [aLat, aLng, bLat, bLng] of pairs) {
      const ours = answer(`greatCircleDistanceKm ${aLat} ${aLng} ${bLat} ${bLng}`) as number
      const theirs = h3.greatCircleDistance([aLat, aLng], [bLat, bLng], 'km')
      expect(Math.abs(ours - theirs), `${aLat},${aLng}`).toBeLessThan(Math.abs(theirs) * 1e-14)
    }
    // `degsToRads` is one multiply and agrees exactly; the reverse constant differs in its last
    // bit, so `radsToDegs` carries the `1e-15` of `scalars.test.ts`, six times its `1.57e-16`
    for (const degrees of [-180, -1, 0, 1, 90, 180]) {
      expect(answer(`degsToRads ${degrees}`), `${degrees}`).toBe(h3.degsToRads(degrees))
      const radians = degrees / 57
      const ours = answer(`radsToDegs ${radians}`) as number
      const theirs = h3.radsToDegs(radians)
      expect(Math.abs(ours - theirs), `${radians}`).toBeLessThanOrEqual(Math.abs(theirs) * 1e-15)
    }
  })
})

describe.skipIf(skipWithoutProbe)('divergence: fused multiply-add near a pole', () => {
  test('polar geometry moves further from h3-js with every resolution', () => {
    // arm64 contracts a multiply-add and emscripten does not; a pole amplifies the last bit
    // each bound is two to four times the worst case measured over `EXTREME_COORDINATES`
    const bounds: [number, number][] = [
      [0, 8e-14], // measured `2.84e-14` degrees
      [5, 5e-11], // measured `1.46e-11`
      [10, 2e-9], // measured `5.89e-10`
      [15, 5e-7], // measured `1.82e-7`
    ]
    for (const [res, bound] of bounds) {
      const cells = Array.from(
        new Set(EXTREME_COORDINATES.map(({ lat, lng }) => h3.latLngToCell(lat, lng, res))),
      )
      const answers = callMany(cells.map((cell) => `cellToBoundary ${cell}`))
      for (let c = 0; c < cells.length; c++) {
        const label = `res ${res} ${cells[c]}`
        const ours = answers[c] as number[][]
        const theirs = h3.cellToBoundary(cells[c] as string)
        expect(ours.length, label).toBe(theirs.length)
        for (let i = 0; i < theirs.length; i++) {
          const a = ours[i] as number[]
          const b = theirs[i] as number[]
          expect(Math.abs((a[0] as number) - (b[0] as number)), `${label} lat`).toBeLessThan(bound)
          expect(Math.abs((a[1] as number) - (b[1] as number)), `${label} lng`).toBeLessThan(bound)
        }
      }
    }
  })

  test('the worst resolution 15 edge length agrees to eight digits, not to the last bit', () => {
    // this edge is where the whole pentagon corpus disagrees most, at `1.38e-8` relative
    const edge = '14f0800000000000'
    const ours = answer(`edgeLengthKm ${edge}`) as number
    const theirs = h3.edgeLength(edge, 'km')
    expect(Math.abs(ours - theirs)).toBeLessThan(Math.abs(theirs) * 4e-8)
  })

  test('a resolution 15 pentagon area agrees to nine digits, not to the last bit', () => {
    // the same cancellation: at half a metre across, the area is a difference of near-equal terms.
    // Measured `3.01e-9` relative over every pentagon, worst here; the bound is three times that.
    const cell = '8f0800000000000'
    const ours = answer(`cellAreaKm2 ${cell}`) as number
    const theirs = h3.cellArea(cell, 'km2')
    expect(Math.abs(ours - theirs)).toBeLessThan(Math.abs(theirs) * 1e-8)
  })
})

describe.skipIf(skipWithoutProbe)('divergence: the shape of the public surface', () => {
  test('units are separate functions here and a string argument in h3-js', () => {
    const ops = answer('__ops') as string[]
    expect(ops).toContain('cellAreaKm2')
    expect(ops).not.toContain('cellArea')
    expect(Object.keys(h3)).toContain('cellArea')
    expect(Object.keys(h3)).not.toContain('cellAreaKm2')
    // h3-js can therefore raise an error over the unit itself, and this package has no such channel
    expect(h3jsRefusal(() => h3.cellArea(CELL, 'furlongs' as 'km2'))).toBe(
      'Unknown unit (code: 1000, value: furlongs)',
    )
  })

  test('the two split-long helpers exist in h3-js and nowhere here', () => {
    // they work around the lack of 64-bit integers in an emscripten build
    const ops = answer('__ops') as string[]
    for (const name of ['h3IndexToSplitLong', 'splitLongToH3Index']) {
      expect(Object.keys(h3)).toContain(name)
      expect(ops).not.toContain(name)
    }
  })

  test('the four Async variants exist here and nowhere in h3-js', () => {
    // that each answers a `Promise` of its sibling's result is proved by `tsc` above
    for (const name of [
      'polygonToCellsAsync',
      'polygonToCellsExperimentalAsync',
      'cellsToMultiPolygonAsync',
      'uncompactCellsAsync',
    ]) {
      expect(Object.keys(h3), name).not.toContain(name)
    }
  })

  test('the three batch calls exist here and nowhere in h3-js', () => {
    // they run a scalar operation over a whole typed array, which h3-js has no counterpart for
    const ops = answer('__ops') as string[]
    for (const name of ['latLngsToCells', 'cellsToLatLngs', 'cellsToBoundaries']) {
      expect(ops, name).toContain(name)
      expect(Object.keys(h3), name).not.toContain(name)
    }
  })

  test('cellToString and cellFromString exist here and nowhere in h3-js', () => {
    expect(answer(`cellToString ${CELL}`)).toBe(CELL)
    expect(answer(`cellFromString ${CELL}`)).toBe(CELL)
    expect(Object.keys(h3)).not.toContain('cellToString')
    expect(Object.keys(h3)).not.toContain('cellFromString')
  })

  test('a cell is a string in h3-js, where the type assertions above make it a bigint', () => {
    expect(typeof h3.latLngToCell(37.7749, -122.4194, 9)).toBe('string')
    const disk = h3.gridDisk(CELL, 1)
    expect(Array.isArray(disk)).toBe(true)
    expect(typeof (disk[0] as string)).toBe('string')
  })

  test('the five coordinate functions answer arrays in h3-js', () => {
    // the `LatLng` object this package answers is proved by `tsc` in the assertions above
    const vertex = h3.cellToVertexes(CELL)[0] as string
    const edge = h3.originToDirectedEdges(CELL)[0] as string
    expect(h3.cellToLatLng(CELL)).toHaveLength(2)
    expect(Array.isArray(h3.cellToLatLng(CELL))).toBe(true)
    expect(Array.isArray(h3.cellToBoundary(CELL)[0])).toBe(true)
    expect(Array.isArray(h3.vertexToLatLng(vertex))).toBe(true)
    expect(Array.isArray(h3.directedEdgeToBoundary(edge)[0])).toBe(true)
    expect(Array.isArray(h3.cellsToMultiPolygon([CELL])[0]?.[0]?.[0])).toBe(true)
  })

  test('the GeoJSON output flags exist in h3-js, where the types above take none', () => {
    // the flag closes the loop and swaps to `[lng, lat]`, which is the ambiguity this package avoids
    const open = h3.cellToBoundary(CELL)
    const closed = h3.cellToBoundary(CELL, true)
    expect(open).toHaveLength(6)
    expect(closed).toHaveLength(7)
    expect(closed[0]).toEqual(closed[closed.length - 1] as [number, number])
    expect(closed[0]).toEqual([open[0]?.[1], open[0]?.[0]] as [number, number])
    const edge = h3.originToDirectedEdges(CELL)[0] as string
    expect(h3.directedEdgeToBoundary(edge, true)[0]).toEqual([
      h3.directedEdgeToBoundary(edge)[0]?.[1],
      h3.directedEdgeToBoundary(edge)[0]?.[0],
    ] as [number, number])
    expect(h3.cellsToMultiPolygon([CELL], true)[0]?.[0]).toHaveLength(7)
    expect(h3.polygonToCells([SAN_FRANCISCO_GEOJSON], 7, true)).toHaveLength(7)
    expect(
      h3.polygonToCellsExperimental([SAN_FRANCISCO_GEOJSON], 7, 'containmentCenter', true),
    ).toHaveLength(7)
  })

  test('h3-js takes a single loop unwrapped, where Ring[] is required here', () => {
    expect(h3.polygonToCells(SAN_FRANCISCO, 7)).toHaveLength(7)
    expect(h3.polygonToCells([SAN_FRANCISCO], 7)).toHaveLength(7)
    // the probe takes rings only, and matches the wrapped form's cells
    expect(
      answer(`polygonToCells ${SAN_FRANCISCO.map(([lat, lng]) => `${lat},${lng}`).join(';')} 7`),
    ).toEqual(h3.polygonToCells([SAN_FRANCISCO], 7))
  })

  test('greatCircleDistance is two arrays and a unit string in h3-js', () => {
    const ops = answer('__ops') as string[]
    expect(ops).toContain('greatCircleDistanceKm')
    expect(ops).not.toContain('greatCircleDistance')
    expect(Object.keys(h3)).toContain('greatCircleDistance')
    expect(Object.keys(h3)).not.toContain('greatCircleDistanceKm')
    const ours = answer('greatCircleDistanceKm 0 0 1 1') as number
    expect(ours).toBeCloseTo(h3.greatCircleDistance([0, 0], [1, 1], 'km'), 10)
  })

  test('gridDiskDistances answers arrays of strings in h3-js', () => {
    // the `BigUint64Array[]` this package answers is proved by `tsc` in the assertions above
    const rings = h3.gridDiskDistances(CELL, 1)
    expect(rings).toHaveLength(2)
    expect(rings[0]).toEqual([CELL])
    expect(rings[1]).toHaveLength(6)
    expect(typeof (rings[1] as string[])[0]).toBe('string')
  })

  test('UNITS and POLYGON_TO_CELLS_FLAGS exist in h3-js, ContainmentMode only here', () => {
    // the absence of both constants from this package is proved by `tsc` in the assertions above
    expect(Object.keys(h3.UNITS)).toEqual(['m', 'm2', 'km', 'km2', 'rads', 'rads2'])
    expect(Object.keys(h3.POLYGON_TO_CELLS_FLAGS)).toEqual([
      'containmentCenter',
      'containmentFull',
      'containmentOverlapping',
      'containmentOverlappingBbox',
    ])
    expect(Object.keys(h3)).not.toContain('ContainmentMode')
    expect(ContainmentMode).toEqual({
      center: 0,
      full: 1,
      overlapping: 2,
      overlappingBbox: 3,
    })
  })

  test('h3-js takes a cell as a split-long pair as well as a string', () => {
    // `H3IndexInput` is `string | number[]`; this package takes a `bigint` and nothing else
    const split = h3.h3IndexToSplitLong(CELL)
    expect(split).toHaveLength(2)
    expect(h3.getResolution(split)).toBe(9)
    expect(h3.getResolution(CELL)).toBe(9)
  })

  test('an h3-js H3 failure is a plain Error with a numeric code', () => {
    // this package throws an `H3Error` class whose `code` is `undefined` for its own refusals,
    // which `__tests__/H3Error.test.ts` asserts
    let thrown: unknown
    try {
      h3.getNumCells(16)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).name).toBe('Error')
    expect(typeof (thrown as { code: unknown }).code).toBe('number')
  })
})
