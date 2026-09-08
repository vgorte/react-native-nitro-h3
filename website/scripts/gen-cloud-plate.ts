import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  alphaFromLuma,
  bandAlphaAt,
  CLOUD_PLATE,
  cloudBlurPx,
  type Plate,
} from '../src/scripts/hero/plates'

const WEBSITE = dirname(dirname(fileURLToPath(import.meta.url)))
const HERO = join(WEBSITE, 'src', 'assets', 'hero')
/** The in-repo source. The originals live outside the repository and are passed as an argument. */
const SOURCE = join(HERO, 'clouds-layer.webp')
const OUT = join(HERO, 'clouds-plate.webp')
/** The quality the two hero images are accepted at, see the design's section 5.4. */
const QUALITY = 85

type Raw = { data: Buffer; width: number; height: number }

/** Returns the plate's depth-of-field band as one alpha byte per pixel, constant along a row. */
export function bandMask(width: number, height: number): Buffer {
  const mask = Buffer.alloc(width * height)
  for (let y = 0; y < height; y += 1) {
    const alpha = Math.round(bandAlphaAt((y + 0.5) / height) * 255)
    mask.fill(alpha, y * width, (y + 1) * width)
  }
  return mask
}

async function readRgba(path: string): Promise<Raw> {
  const { data, info } = await sharp(path).removeAlpha().ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  })
  return { data, width: info.width, height: info.height }
}

/**
 * Bakes the cloud plate: the sharp photograph, the blurred copy cut to the depth-of-field band
 * drawn over it, then luma into alpha. Mirrors the pipeline the page used to run at load.
 */
async function bake(source: string, plate: Plate): Promise<Raw> {
  if (plate.levels !== 'none')
    throw new Error(`levels ${plate.levels} has no build-time equivalent`)
  const base = await readRgba(source)
  const { width, height } = base
  const blurred = await sharp(source).removeAlpha().blur(cloudBlurPx(width)).raw().toBuffer()
  const cut = await sharp(blurred, { raw: { width, height, channels: 3 } })
    .joinChannel(bandMask(width, height), { raw: { width, height, channels: 1 } })
    .raw()
    .toBuffer()
  const data = await sharp(base.data, { raw: { width, height, channels: 4 } })
    .composite([{ input: cut, raw: { width, height, channels: 4 }, blend: 'over' }])
    .raw()
    .toBuffer()
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length)
  alphaFromLuma(pixels, plate.gain, plate.whiten)
  return { data, width, height }
}

async function main() {
  const source = process.argv[2] ?? SOURCE
  const { data, width, height } = await bake(source, CLOUD_PLATE)
  const { size } = await sharp(data, { raw: { width, height, channels: 4 } })
    .webp({ quality: QUALITY })
    .toFile(OUT)
  console.log(`baked ${width} x ${height} from ${source}, ${size} bytes, into ${OUT}`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
