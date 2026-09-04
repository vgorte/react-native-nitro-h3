import { Image, type SkImage, Skia, type SkRect, TileMode } from '@shopify/react-native-skia'
import type { CellScene } from './CellPictures'

/** Holds the blurred copy of a settled scene and the scene rectangle it covers. */
export interface GlowImage {
  image: SkImage
  rect: SkRect
}

/** Configures {@linkcode GlowLayer}. */
export interface GlowLayerProps {
  glow: GlowImage | null
}

/** Opacity of the blurred copy under the sharp pictures. */
export const GLOW_OPACITY = 0.55

/** Blur radius in offscreen pixels, so 24 px at full resolution. */
export const GLOW_SIGMA = 12

// half resolution, because the blur hides the missing detail
const GLOW_SCALE = 0.5

/**
 * Renders the scene into a half-resolution offscreen surface and blurs it once.
 *
 * The image is kept in scene coordinates covering the settled viewport, so a later pan moves it
 * with the camera until the next settle replaces it.
 *
 * @param scene The recorded pictures to blur.
 * @param viewport The visible scene rectangle, in scene units.
 * @param scale Pixels per scene unit, the camera's current scale.
 */
export function renderGlow(scene: CellScene, viewport: SkRect, scale: number): GlowImage | null {
  const width = Math.round(viewport.width * scale * GLOW_SCALE)
  const height = Math.round(viewport.height * scale * GLOW_SCALE)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null

  const surface = Skia.Surface.MakeOffscreen(width, height)
  if (surface === null) return null

  const canvas = surface.getCanvas()
  const paint = Skia.Paint()
  paint.setImageFilter(Skia.ImageFilter.MakeBlur(GLOW_SIGMA, GLOW_SIGMA, TileMode.Decal, null))
  // the matrix scales the sigma, so the layer precedes it
  canvas.saveLayer(paint)
  canvas.scale(scale * GLOW_SCALE, scale * GLOW_SCALE)
  canvas.translate(-viewport.x, -viewport.y)
  for (const picture of scene.pictures) canvas.drawPicture(picture)
  canvas.restore()
  surface.flush()

  const snapshot = surface.makeImageSnapshot()
  // the display canvas cannot draw a texture from the offscreen context
  const image = snapshot.makeNonTextureImage()
  // a raster surface answers the snapshot itself, and that one is the image
  if (image !== snapshot) snapshot.dispose()
  surface.dispose()
  return image === null ? null : { image, rect: viewport }
}

/** Draws the blurred copy under the sharp pictures, inside the camera group. */
export function GlowLayer({ glow }: GlowLayerProps) {
  if (glow === null) return null
  return (
    <Image
      image={glow.image}
      x={glow.rect.x}
      y={glow.rect.y}
      width={glow.rect.width}
      height={glow.rect.height}
      fit="fill"
      opacity={GLOW_OPACITY}
    />
  )
}
