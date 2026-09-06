import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const WEBSITE = dirname(dirname(fileURLToPath(import.meta.url)))
const IMG = join(dirname(WEBSITE), 'img')
const OUT = join(WEBSITE, 'public')
const WIDTH = 1200
const HEIGHT = 630
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

// Social previews do not render SVG and show transparency as black, hence PNG on a white canvas.
async function render(source: string, width: number, left: number, target: string) {
  const image = await sharp(join(IMG, source)).resize({ width }).png().toBuffer()
  const { height = 0 } = await sharp(image).metadata()
  await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: WHITE } })
    .composite([{ input: image, left, top: Math.round((HEIGHT - height) / 2) }])
    .png()
    .toFile(join(OUT, target))
  console.log(`wrote public/${target}`)
}

await render('benchmark.svg', WIDTH, 0, 'og-benchmark.png')
await render('logo-tile.svg', 480, (WIDTH - 480) / 2, 'og-logo.png')
