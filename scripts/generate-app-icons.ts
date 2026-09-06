/**
 * Generates the example app's launcher icons and `img/logo-tile.svg` from `img/logo.svg`.
 *
 * The logo is the single source of truth, so the icons are derived rather than drawn twice.
 * No SVG rasteriser is assumed to be installed: the mark is eight simple polygons, which a
 * supersampling scanline fill and a hand-rolled PNG encoder cover exactly.
 *
 * Usage:
 *   bun run icons           rewrite the generated files from `img/logo.svg`
 *   bun run icons --check   fail if the committed files differ from `img/logo.svg`
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const LOGO = join(ROOT, 'img', 'logo.svg')
const TILE = join('img', 'logo-tile.svg')
const IOS_ICONSET = 'apps/example/ios/H3Example/Images.xcassets/AppIcon.appiconset'
const ANDROID_RES = 'apps/example/android/app/src/main/res'

// The mark sits on an opaque ground: iOS rejects alpha outright, and the dark outer hexagon
// is what carries the silhouette on a light surface.
const BACKGROUND = '#FFFFFF'

// Android's adaptive icon guarantees only the central 66 of 108dp survives every mask shape,
// and the hexagon's points are its extremities, so the mark is fitted to exactly that circle.
const ADAPTIVE_CANVAS = 108
const ADAPTIVE_SAFE_DIAMETER = 66

const LEGACY_DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }

// Share of the icon's width the mark's bounding circle spans on the pre-adaptive launcher icons.
const LEGACY_FILL = 0.8

// the public logo is the mark inside an app icon's outline, unfilled so it sits on any ground
const TILE_STROKE = '#8A8F99'
const TILE_STROKE_WIDTH = 8
const TILE_CORNER = 56
const TILE_SCALE = 0.78

type Point = { x: number; y: number }
type Polygon = { points: Point[]; fill: string }

function parsePolygons(svg: string): Polygon[] {
  const polygons: Polygon[] = []
  // `fill` is either on the polygon or inherited from the one enclosing `<g>`
  let groupFill: string | null = null
  const tags = svg.matchAll(/<(g|\/g|polygon)\b([^>]*)>/g)
  for (const [, tag = '', attributes = ''] of tags) {
    if (tag === '/g') {
      groupFill = null
      continue
    }
    const fill = attributes.match(/fill="([^"]+)"/)?.[1] ?? null
    if (tag === 'g') {
      groupFill = fill
      continue
    }
    const points = attributes.match(/points="([^"]+)"/)?.[1]
    const resolved = fill ?? groupFill
    if (points == null || resolved == null) {
      throw new Error(`Polygon without points or fill: ${attributes}`)
    }
    polygons.push({
      fill: resolved,
      points: points
        .trim()
        .split(/\s+/)
        .map((pair) => {
          const [x, y] = pair.split(',').map(Number)
          if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`Malformed point "${pair}"`)
          }
          return { x, y }
        }),
    })
  }
  return polygons
}

function parseViewBox(svg: string): number {
  const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
  const width = viewBox?.[1]
  if (width == null || width !== viewBox?.[2]) {
    throw new Error('Expected a square viewBox anchored at the origin')
  }
  return Number(width)
}

function parseTitle(svg: string): string {
  const title = svg.match(/<title>([^<]+)<\/title>/)?.[1]
  if (title == null) {
    throw new Error('The logo has no <title>; the tile takes its label from there')
  }
  return title
}

function parseColor(hex: string): [number, number, number] {
  // `none` and the three-digit shorthand would silently become NaN channels
  const digits = hex.match(/^#([0-9a-fA-F]{6})$/)?.[1]
  if (digits == null) {
    throw new Error(`Unsupported fill "${hex}"; only six-digit hex colours are rendered`)
  }
  const value = Number.parseInt(digits, 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

/** Throws unless polygon 0, the enclosing hexagon, bounds every other polygon. */
function assertOuterEnclosesTheRest(polygons: Polygon[]): void {
  const [outer, ...rest] = polygons
  if (outer == null) {
    throw new Error('The logo has no polygons')
  }
  const xs = outer.points.map((p) => p.x)
  const ys = outer.points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  for (const [index, polygon] of rest.entries()) {
    for (const point of polygon.points) {
      if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) {
        throw new Error(
          `Polygon ${index + 1} leaves the outer hexagon at ${point.x},${point.y}; ` +
            'the mark radius is taken from polygon 0',
        )
      }
    }
  }
}

/** Reports whether the point is inside the polygon, by counting ray crossings. */
function contains(polygon: Point[], x: number, y: number): boolean {
  let inside = false
  let b = polygon[polygon.length - 1]
  if (b == null) return false
  for (const a of polygon) {
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
    b = a
  }
  return inside
}

type RenderOptions = {
  size: number
  /** Fraction of the canvas the logo's viewBox is scaled to occupy. */
  contentScale: number
  /** Clips the background to an inscribed circle, for the legacy round launcher icon. */
  round?: boolean
}

const SAMPLES = 4

/** Source-over with premultiplication undone, so edges over transparency stay clean. */
function blend(
  source: number,
  previous: number,
  alpha: number,
  under: number,
  over: number,
): number {
  return Math.round((source * alpha + previous * under * (1 - alpha)) / over)
}

function render(polygons: Polygon[], viewBox: number, options: RenderOptions): Uint8Array {
  const { size, contentScale, round = false } = options
  const rgba = new Uint8Array(size * size * 4)

  const [backgroundR, backgroundG, backgroundB] = parseColor(BACKGROUND)
  const radius = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let coverage = 1
      if (round) {
        coverage = 0
        for (let sy = 0; sy < SAMPLES; sy++) {
          for (let sx = 0; sx < SAMPLES; sx++) {
            const dx = x + (sx + 0.5) / SAMPLES - radius
            const dy = y + (sy + 0.5) / SAMPLES - radius
            if (dx * dx + dy * dy <= radius * radius) coverage++
          }
        }
        coverage /= SAMPLES * SAMPLES
      }
      const at = (y * size + x) * 4
      rgba[at] = backgroundR
      rgba[at + 1] = backgroundG
      rgba[at + 2] = backgroundB
      rgba[at + 3] = Math.round(coverage * 255)
    }
  }

  // viewBox units to pixels, centred
  const scale = (size * contentScale) / viewBox
  const offset = (size - viewBox * scale) / 2
  const project = (point: Point): Point => ({
    x: point.x * scale + offset,
    y: point.y * scale + offset,
  })

  for (const polygon of polygons) {
    const projected = polygon.points.map(project)
    const [r, g, b] = parseColor(polygon.fill)
    const minX = Math.max(0, Math.floor(Math.min(...projected.map((p) => p.x))))
    const maxX = Math.min(size - 1, Math.ceil(Math.max(...projected.map((p) => p.x))))
    const minY = Math.max(0, Math.floor(Math.min(...projected.map((p) => p.y))))
    const maxY = Math.min(size - 1, Math.ceil(Math.max(...projected.map((p) => p.y))))

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let hits = 0
        for (let sy = 0; sy < SAMPLES; sy++) {
          for (let sx = 0; sx < SAMPLES; sx++) {
            if (contains(projected, x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES)) {
              hits++
            }
          }
        }
        if (hits === 0) continue

        const alpha = hits / (SAMPLES * SAMPLES)
        const at = (y * size + x) * 4
        const under = (rgba[at + 3] ?? 0) / 255
        const over = alpha + under * (1 - alpha)
        rgba[at] = blend(r, rgba[at] ?? 0, alpha, under, over)
        rgba[at + 1] = blend(g, rgba[at + 1] ?? 0, alpha, under, over)
        rgba[at + 2] = blend(b, rgba[at + 2] ?? 0, alpha, under, over)
        rgba[at + 3] = Math.round(over * 255)
      }
    }
  }

  return rgba
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Encodes RGBA pixels as a PNG, dropping the alpha channel when opacity is not wanted. */
function encodePng(rgba: Uint8Array, size: number, withAlpha: boolean): Buffer {
  const channels = withAlpha ? 4 : 3
  const raw = Buffer.alloc(size * (size * channels + 1))
  for (let y = 0; y < size; y++) {
    const row = y * (size * channels + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4
      const to = row + 1 + x * channels
      raw[to] = rgba[from] ?? 0
      raw[to + 1] = rgba[from + 1] ?? 0
      raw[to + 2] = rgba[from + 2] ?? 0
      if (withAlpha) raw[to + 3] = rgba[from + 3] ?? 0
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = withAlpha ? 6 : 2 // colour type
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ])
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

type Decoded = { width: number; height: number; channels: number; pixels: Buffer }

/** Decodes an 8-bit RGB or RGBA PNG to unfiltered scanlines. */
function decodePng(bytes: Buffer): Decoded {
  let header: Buffer | null = null
  const parts: Buffer[] = []
  let at = 8
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('ascii', at + 4, at + 8)
    const data = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') header = Buffer.from(data)
    if (type === 'IDAT') parts.push(Buffer.from(data))
    at += 12 + length
  }
  if (header == null || parts.length === 0) {
    throw new Error('Not a PNG this script can read: no IHDR or no IDAT')
  }

  const width = header.readUInt32BE(0)
  const height = header.readUInt32BE(4)
  const colourType = header[9]
  if (header[8] !== 8 || (colourType !== 2 && colourType !== 6)) {
    throw new Error(`Unsupported PNG: bit depth ${header[8]}, colour type ${colourType}`)
  }
  const channels = colourType === 6 ? 4 : 3

  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)
  let from = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[from++] ?? 0
    const row = y * stride
    const prior = row - stride
    for (let i = 0; i < stride; i++) {
      const x = raw[from + i] ?? 0
      const a = i >= channels ? (pixels[row + i - channels] ?? 0) : 0
      const b = y > 0 ? (pixels[prior + i] ?? 0) : 0
      const c = i >= channels && y > 0 ? (pixels[prior + i - channels] ?? 0) : 0
      let value: number
      switch (filter) {
        case 0:
          value = x
          break
        case 1:
          value = x + a
          break
        case 2:
          value = x + b
          break
        case 3:
          value = x + ((a + b) >> 1)
          break
        case 4:
          value = x + paeth(a, b, c)
          break
        default:
          throw new Error(`Unknown PNG filter type ${filter}`)
      }
      pixels[row + i] = value & 0xff
    }
    from += stride
  }
  return { width, height, channels, pixels }
}

/** Returns the mark's bounding radius in viewBox units, taken from the outer hexagon. */
function markRadius(outer: Polygon, viewBox: number): number {
  const centre = viewBox / 2
  return Math.max(...outer.points.map((p) => Math.hypot(p.x - centre, p.y - centre)))
}

/** Rewrites viewBox coordinates into the adaptive icon's 108dp canvas. */
function toAdaptivePath(points: Point[], viewBox: number, radius: number): string {
  const scale = ADAPTIVE_SAFE_DIAMETER / 2 / radius
  const centre = ADAPTIVE_CANVAS / 2
  return `${points
    .map((point, index) => {
      const x = ((point.x - viewBox / 2) * scale + centre).toFixed(3)
      const y = ((point.y - viewBox / 2) * scale + centre).toFixed(3)
      return `${index === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')} Z`
}

function vectorDrawable(paths: string): string {
  return `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${ADAPTIVE_CANVAS}dp"
    android:height="${ADAPTIVE_CANVAS}dp"
    android:viewportWidth="${ADAPTIVE_CANVAS}"
    android:viewportHeight="${ADAPTIVE_CANVAS}">
${paths}
</vector>
`
}

/** Groups consecutive polygons of one fill, so the tile mirrors the source's `<g>` structure. */
function runsByFill(polygons: Polygon[]): { fill: string; polygons: Polygon[] }[] {
  const runs: { fill: string; polygons: Polygon[] }[] = []
  for (const polygon of polygons) {
    const last = runs[runs.length - 1]
    if (last != null && last.fill === polygon.fill) last.polygons.push(polygon)
    else runs.push({ fill: polygon.fill, polygons: [polygon] })
  }
  return runs
}

/** Emits the mark inside a rounded outline, unprojected: the coordinates carry a transform instead. */
function tileSvg(polygons: Polygon[], viewBox: number, title: string): string {
  const points = (polygon: Polygon) =>
    polygon.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

  const marks: string[] = []
  for (const run of runsByFill(polygons)) {
    const single = run.polygons.length === 1 ? run.polygons[0] : null
    if (single != null) {
      marks.push(`    <polygon points="${points(single)}" fill="${run.fill}" />`)
      continue
    }
    marks.push(`    <g fill="${run.fill}">`)
    for (const polygon of run.polygons) marks.push(`      <polygon points="${points(polygon)}" />`)
    marks.push('    </g>')
  }

  const inset = TILE_STROKE_WIDTH / 2
  const side = viewBox - TILE_STROKE_WIDTH
  const offset = ((viewBox * (1 - TILE_SCALE)) / 2).toFixed(2)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox} ${viewBox}" width="${viewBox}" height="${viewBox}" role="img" aria-label="${title}">
  <title>${title}</title>
  <!-- Generated from \`img/logo.svg\` by \`bun run icons\`. Do not edit by hand. -->
  <rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${TILE_CORNER}" fill="none" stroke="${TILE_STROKE}" stroke-width="${TILE_STROKE_WIDTH}" />
  <g transform="translate(${offset} ${offset}) scale(${TILE_SCALE})">
${marks.join('\n')}
  </g>
</svg>
`
}

type Generated = { files: string[]; markShare: number }

/** Writes every icon below `root` and returns their paths relative to it. */
async function generate(root: string): Promise<Generated> {
  const svg = await readFile(LOGO, 'utf8')
  if (svg.includes('transform=')) {
    throw new Error('The logo carries a transform; this renderer projects raw coordinates only')
  }

  const viewBox = parseViewBox(svg)
  const polygons = parsePolygons(svg)
  const outer = polygons[0]
  if (polygons.length !== 8 || outer == null) {
    throw new Error(`Expected 8 polygons in the logo, found ${polygons.length}`)
  }
  assertOuterEnclosesTheRest(polygons)

  const radius = markRadius(outer, viewBox)
  // the contentScale that makes the mark's bounding circle span the given share of the canvas
  const fill = (share: number) => (share * viewBox) / (2 * radius)

  const files: string[] = []
  const write = async (relative: string, contents: Buffer | string): Promise<void> => {
    const absolute = join(root, relative)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, contents)
    files.push(relative)
  }

  // The tile logo the README and the docs site show; the bare mark stays the source.
  await write(TILE, tileSvg(polygons, viewBox, parseTitle(svg)))

  // iOS: one universal 1024 slot, opaque, the viewBox filling the canvas.
  await write(
    join(IOS_ICONSET, 'AppIcon.png'),
    encodePng(render(polygons, viewBox, { size: 1024, contentScale: 1 }), 1024, false),
  )
  await write(
    join(IOS_ICONSET, 'Contents.json'),
    `${JSON.stringify(
      {
        images: [
          { filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
        ],
        info: { author: 'xcode', version: 1 },
      },
      null,
      2,
    )}\n`,
  )

  // Android: PNGs for API 24 and 25, which predate the adaptive icon.
  for (const [density, size] of Object.entries(LEGACY_DENSITIES)) {
    const directory = join(ANDROID_RES, `mipmap-${density}`)
    const contentScale = fill(LEGACY_FILL)
    await write(
      join(directory, 'ic_launcher.png'),
      encodePng(render(polygons, viewBox, { size, contentScale }), size, true),
    )
    await write(
      join(directory, 'ic_launcher_round.png'),
      encodePng(render(polygons, viewBox, { size, contentScale, round: true }), size, true),
    )
  }

  // Android: the adaptive icon stays vector, so no density loses detail.
  const foreground = polygons
    .map((polygon) => {
      const path = toAdaptivePath(polygon.points, viewBox, radius)
      return `    <path android:fillColor="${polygon.fill}" android:pathData="${path}" />`
    })
    .join('\n')
  const drawable = join(ANDROID_RES, 'drawable')
  await write(join(drawable, 'ic_launcher_foreground.xml'), vectorDrawable(foreground))

  // The themed icon is the outer hexagon with the seven children punched out, so the system
  // can tint one shape. `evenOdd` over a single path is what makes the holes holes.
  const monochromePath = polygons
    .map((polygon) => toAdaptivePath(polygon.points, viewBox, radius))
    .join(' ')
  await write(
    join(drawable, 'ic_launcher_monochrome.xml'),
    vectorDrawable(
      `    <path android:fillColor="#FFFFFF" android:fillType="evenOdd" android:pathData="${monochromePath}" />`,
    ),
  )

  const anydpi = join(ANDROID_RES, 'mipmap-anydpi-v26')
  const adaptive = `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`
  await write(join(anydpi, 'ic_launcher.xml'), adaptive)
  await write(join(anydpi, 'ic_launcher_round.xml'), adaptive)

  await write(
    join(ANDROID_RES, 'values', 'ic_launcher_background.xml'),
    `<resources>
    <color name="ic_launcher_background">${BACKGROUND}</color>
</resources>
`,
  )

  return { files, markShare: (2 * radius) / viewBox }
}

// PNGs are compared decoded: the compressed bytes depend on the zlib build, the committed
// pixels do not.
async function differs(committed: string, generated: string): Promise<boolean> {
  const fresh = await readFile(generated)
  let existing: Buffer
  try {
    existing = await readFile(committed)
  } catch {
    return true
  }
  if (!committed.endsWith('.png')) {
    return existing.toString('utf8') !== fresh.toString('utf8')
  }
  const a = decodePng(existing)
  const b = decodePng(fresh)
  return (
    a.width !== b.width ||
    a.height !== b.height ||
    a.channels !== b.channels ||
    !a.pixels.equals(b.pixels)
  )
}

async function check(): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'app-icons-'))
  try {
    const { files } = await generate(scratch)
    const differing: string[] = []
    for (const relative of files) {
      if (await differs(join(ROOT, relative), join(scratch, relative))) {
        differing.push(relative)
      }
    }
    if (differing.length > 0) {
      process.stderr.write('Generated files differ from img/logo.svg; run `bun run icons`:\n')
      for (const relative of differing) {
        process.stderr.write(`  ${relative}\n`)
      }
      process.exit(1)
    }
    process.stdout.write(`${files.length} generated files match img/logo.svg\n`)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) {
    await check()
    return
  }

  const { files, markShare } = await generate(ROOT)
  console.log(
    `Wrote the tile logo, the iOS icon, ${Object.keys(LEGACY_DENSITIES).length * 2} legacy PNGs and the adaptive icon (${files.length} files).`,
  )
  console.log(
    `Mark spans ${markShare * 100}% of the iOS canvas and ` +
      `${ADAPTIVE_SAFE_DIAMETER}dp of the ${ADAPTIVE_CANVAS}dp adaptive canvas.`,
  )
}

await main()
