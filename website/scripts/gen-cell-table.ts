import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cellToLatLng, latLngToCell } from 'h3-js'
import { LAT_PER_PV, LAT0, LNG_PER_PU, LNG0 } from '../src/scripts/hero/anchor'
import { axialAt, centerOf, type Point, RES, SIZES } from '../src/scripts/hero/geometry'
import { calibrate, SCENES } from '../src/scripts/hero/scene'

const WEBSITE = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(WEBSITE, 'src', 'scripts', 'hero', 'cells.generated.ts')

/** Cells the table keeps beyond the reachable range on every side. */
const MARGIN = 2
/** The card shows four decimals, so the table works in ten thousandths of a degree. */
const SCALE = 1e4
/** Widest offset a record encodes, in ten thousandths of a degree. */
const LAT_OFF = 1
const LNG_OFF = 3

export type Bounds = { qMin: number; qMax: number; rMin: number; rMax: number }

export type Table = {
  bounds: Bounds
  prefix: string
  suffix: string
  stride: number
  /** One string per `q` column, `r` ascending. */
  columns: string[]
}

/**
 * Returns the stage boxes the table is built for: the four reference boxes, plus a sweep of
 * aspects at a fixed width, because `clampU` widens with the aspect while `clampV` does not.
 */
export function stageBoxes(): Point[] {
  const boxes: Point[] = [
    [1440, 810],
    [430, 800],
    [2560, 1080],
    [3440, 1440],
  ]
  for (let tenths = 4; tenths <= 26; tenths++) boxes.push([1440, Math.round(14400 / tenths)])
  return boxes
}

/**
 * Returns the axial range of the cells whose centre lies inside the pointer clamp of any of the
 * given stage boxes, in either scene, grown by `MARGIN` on every side.
 */
export function reachableBounds(boxes: readonly Point[]): Bounds {
  const s = SIZES[RES]
  let qMin = Number.POSITIVE_INFINITY
  let qMax = Number.NEGATIVE_INFINITY
  let rMin = Number.POSITIVE_INFINITY
  let rMax = Number.NEGATIVE_INFINITY
  for (const [W, H] of boxes) {
    for (const scene of Object.values(SCENES)) {
      const cal = calibrate(scene, W, H)
      const [u0, u1] = cal.clampU
      const [v0, v1] = cal.clampV
      // The four clamp corners bracket the rounded axial range; the scan then tests every centre.
      let scanQ0 = Number.POSITIVE_INFINITY
      let scanQ1 = Number.NEGATIVE_INFINITY
      let scanR0 = Number.POSITIVE_INFINITY
      let scanR1 = Number.NEGATIVE_INFINITY
      for (const pu of [u0, u1]) {
        for (const pv of [v0, v1]) {
          const [q, r] = axialAt(pu, pv, s)
          scanQ0 = Math.min(scanQ0, q - 2)
          scanQ1 = Math.max(scanQ1, q + 2)
          scanR0 = Math.min(scanR0, r - 2)
          scanR1 = Math.max(scanR1, r + 2)
        }
      }
      for (let q = scanQ0; q <= scanQ1; q++) {
        for (let r = scanR0; r <= scanR1; r++) {
          const centre = centerOf(q, r, s)
          if (centre[0] < u0 || centre[0] > u1) continue
          if (centre[1] < v0 || centre[1] > v1) continue
          qMin = Math.min(qMin, q)
          qMax = Math.max(qMax, q)
          rMin = Math.min(rMin, r)
          rMax = Math.max(rMax, r)
        }
      }
    }
  }
  if (!Number.isFinite(qMin)) throw new Error('no cell is reachable on any stage box')
  return { qMin: qMin - MARGIN, qMax: qMax + MARGIN, rMin: rMin - MARGIN, rMax: rMax + MARGIN }
}

/** Returns the longest string every id starts with. */
function commonPrefix(ids: readonly string[]): string {
  let prefix = ids[0] ?? ''
  for (const id of ids) {
    let k = 0
    while (k < prefix.length && prefix[k] === id[k]) k++
    prefix = prefix.slice(0, k)
  }
  return prefix
}

/**
 * Builds the packed table over the given bounds. Throws when an id has an unexpected length or
 * when a cell centre sits further from its plane point than a record can encode.
 */
export function buildTable(bounds: Bounds): Table {
  const s = SIZES[RES]
  const ids: string[] = []
  const codes: number[] = []
  for (let q = bounds.qMin; q <= bounds.qMax; q++) {
    for (let r = bounds.rMin; r <= bounds.rMax; r++) {
      const centre = centerOf(q, r, s)
      const lat = LAT0 - centre[1] * LAT_PER_PV
      const lng = LNG0 + centre[0] * LNG_PER_PU
      // The card prints the index as written, so the canonical lowercase form is baked in here.
      const id = latLngToCell(lat, lng, RES).toLowerCase()
      const [cellLat, cellLng] = cellToLatLng(id)
      const dLat = Math.round(cellLat * SCALE) - Math.round(lat * SCALE)
      const dLng = Math.round(cellLng * SCALE) - Math.round(lng * SCALE)
      if (Math.abs(dLat) > LAT_OFF || Math.abs(dLng) > LNG_OFF) {
        throw new Error(`cell ${q},${r} sits ${dLat},${dLng} from its plane point, too far to pack`)
      }
      ids.push(id)
      codes.push((dLat + LAT_OFF) * (2 * LNG_OFF + 1) + dLng + LNG_OFF)
    }
  }
  const length = ids[0]?.length ?? 0
  if (ids.some((id) => id.length !== length)) throw new Error('the indexes differ in length')
  const prefix = commonPrefix(ids)
  const suffix = commonPrefix(ids.map((id) => [...id].reverse().join('')))
  const tail = [...suffix].reverse().join('')
  const stride = length - prefix.length - suffix.length + 1
  const rCount = bounds.rMax - bounds.rMin + 1
  const columns: string[] = []
  for (let index = 0; index < ids.length; index += rCount) {
    let column = ''
    for (let k = 0; k < rCount; k++) {
      const id = ids[index + k] ?? ''
      column += id.slice(prefix.length, length - suffix.length)
      column += (codes[index + k] ?? 0).toString(36)
    }
    columns.push(column)
  }
  return { bounds, prefix, suffix: tail, stride, columns }
}

/** Returns the source of the generated module. */
export function render(table: Table): string {
  const { bounds } = table
  const lines = [
    '// Generated by website/scripts/gen-cell-table.ts. Do not edit; run `bun run gen:cells`.',
    '',
    "import { LAT_PER_PV, LAT0, LNG_PER_PU, LNG0 } from './anchor'",
    "import { centerOf, RES, SIZES } from './geometry'",
    '',
    'export type Cell = { id: string; lat: number; lng: number }',
    '',
    '/** The axial cell the table starts at, and how many cells it holds along each axis. */',
    `export const Q_MIN = ${bounds.qMin}`,
    `export const R_MIN = ${bounds.rMin}`,
    `export const Q_COUNT = ${bounds.qMax - bounds.qMin + 1}`,
    `export const R_COUNT = ${bounds.rMax - bounds.rMin + 1}`,
    '',
    '/** Every index over this patch opens and closes the same way, so both are stored once. */',
    `const PREFIX = '${table.prefix}'`,
    `const SUFFIX = '${table.suffix}'`,
    '/** Characters per record: the varying part of the index, then one offset code. */',
    `const STRIDE = ${table.stride}`,
    '/** The card shows four decimals, so the table works in ten thousandths of a degree. */',
    `const SCALE = ${SCALE}`,
    '',
    '/**',
    ' * One string per `q` column, `R_COUNT` records of `STRIDE` characters with `r` ascending. A',
    ' * record is the varying part of the index followed by one base 36 digit, the offset from the',
    ` * plane point to the cell centre as \`(dLat + ${LAT_OFF}) * ${2 * LNG_OFF + 1} + dLng + ${LNG_OFF}\`.`,
    ' */',
    'export const CELLS: readonly string[] = [',
    ...table.columns.map((column) => `  '${column}',`),
    ']',
    '',
    '/** Returns the table entry for an axial cell, or `undefined` when the cell is not in it. */',
    'export function cellAt(q: number, r: number): Cell | undefined {',
    '  const column = CELLS[q - Q_MIN]',
    '  if (column === undefined || r < R_MIN || r >= R_MIN + R_COUNT) return undefined',
    '  const at = (r - R_MIN) * STRIDE',
    '  const code = Number.parseInt(column.slice(at + STRIDE - 1, at + STRIDE), 36)',
    '  const centre = centerOf(q, r, SIZES[RES])',
    `  const lat = Math.round((LAT0 - centre[1] * LAT_PER_PV) * SCALE) + Math.floor(code / ${2 * LNG_OFF + 1}) - ${LAT_OFF}`,
    `  const lng = Math.round((LNG0 + centre[0] * LNG_PER_PU) * SCALE) + (code % ${2 * LNG_OFF + 1}) - ${LNG_OFF}`,
    '  return {',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the emitted line is a template literal.
    '    id: `${PREFIX}${column.slice(at, at + STRIDE - 1)}${SUFFIX}`,',
    '    lat: lat / SCALE,',
    '    lng: lng / SCALE,',
    '  }',
    '}',
    '',
  ]
  return lines.join('\n')
}

async function main() {
  const bounds = reachableBounds(stageBoxes())
  const table = buildTable(bounds)
  const source = render(table)
  await writeFile(OUT, source)
  const cells = table.columns.length * (bounds.rMax - bounds.rMin + 1)
  const range = `q ${bounds.qMin}..${bounds.qMax}, r ${bounds.rMin}..${bounds.rMax}`
  console.log(`wrote ${cells} cells over ${range}, ${source.length} bytes, into ${OUT}`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
