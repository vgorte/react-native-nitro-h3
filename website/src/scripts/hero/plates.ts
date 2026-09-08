import { PARA_REF_W } from './parallax'

/** The layer's own 0.85 opacity is CSS, `.nh3-clouds`, so the bake carries no alpha field. */
export type Plate = { levels: string; whiten: boolean; gain: number }

/**
 * The mask preset: the plate keeps the photograph's own colour and luma becomes the alpha, so the
 * grey clouds read as grey haze rather than as white.
 */
export const CLOUD_PLATE: Plate = { levels: 'none', whiten: false, gain: 1 }

/** Rendered blur at the reference stage width. */
export const DOF_BLUR_PX = 6

/** The cloud layer's share of the stage width, which is what image pixels are scaled against. */
const CLOUD_SPAN = 1.12

/** The band between the two zeroes stays sharp; the blurred copy is let through above and below. */
export const DOF_STOPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.07, 1],
  [0.25, 0],
  [0.73, 0],
  [1, 1],
]

/** Writes luma into the alpha channel in place. Pure, so it is the part under test. */
export function alphaFromLuma(data: Uint8ClampedArray, gain: number, whiten: boolean): void {
  for (let p = 0; p < data.length; p += 4) {
    const r = data[p] ?? 0
    const g = data[p + 1] ?? 0
    const b = data[p + 2] ?? 0
    const l = (r * 0.299 + g * 0.587 + b * 0.114) / 255
    data[p + 3] = Math.round(Math.min(1, l * gain) * 255)
    if (!whiten) continue
    const k = Math.max(l, 0.06)
    data[p] = Math.min(255, r / k)
    data[p + 1] = Math.min(255, g / k)
    data[p + 2] = Math.min(255, b / k)
  }
}

/** Bakes the source image once and resolves with an object URL for the layer. */
export function bakeCloudPlate(source: HTMLImageElement, plate: Plate): Promise<string> {
  const iw = source.naturalWidth
  const ih = source.naturalHeight
  if (!iw || !ih) return Promise.reject(new Error('the cloud source has not decoded yet'))
  const canvas = document.createElement('canvas')
  canvas.width = iw
  canvas.height = ih
  const g = canvas.getContext('2d')
  if (!g) return Promise.reject(new Error('the cloud plate needs a 2d canvas context'))
  g.filter = plate.levels
  g.drawImage(source, 0, 0)

  const blurred = document.createElement('canvas')
  blurred.width = iw
  blurred.height = ih
  const bg = blurred.getContext('2d')
  if (!bg) return Promise.reject(new Error('the cloud plate needs a 2d canvas context'))
  const blur = (DOF_BLUR_PX * iw) / (CLOUD_SPAN * PARA_REF_W)
  bg.filter = `${plate.levels === 'none' ? '' : `${plate.levels} `}blur(${blur.toFixed(2)}px)`
  bg.drawImage(source, 0, 0)
  bg.filter = 'none'
  bg.globalCompositeOperation = 'destination-in'
  const band = bg.createLinearGradient(0, 0, 0, ih)
  for (const [stop, alpha] of DOF_STOPS) band.addColorStop(stop, `rgba(0,0,0,${alpha})`)
  bg.fillStyle = band
  bg.fillRect(0, 0, iw, ih)
  bg.globalCompositeOperation = 'source-over'
  g.filter = 'none'
  g.drawImage(blurred, 0, 0)

  const image = g.getImageData(0, 0, iw, ih)
  alphaFromLuma(image.data, plate.gain, plate.whiten)
  g.putImageData(image, 0, 0)

  return new Promise((resolve, reject) => {
    // PNG, because the plate needs its alpha channel.
    canvas.toBlob((blob) => {
      if (blob) resolve(URL.createObjectURL(blob))
      else reject(new Error('the cloud plate did not encode'))
    }, 'image/png')
  })
}
