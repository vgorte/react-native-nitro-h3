import {
  BlendMode,
  PaintStyle,
  Path,
  Picture,
  type SkCanvas,
  Skia,
  type SkPath,
  type SkPicture,
  type SkPoint,
  VertexMode,
} from '@shopify/react-native-skia'
import type { MeshBuild } from '../engine/mesh'
import type { Bounds } from '../engine/projection'
import { BUCKETS, colours, rampColours } from '../theme/tokens'
import { bucketBatches } from './pictures'

export { bucketBatches } from './pictures'

/** Holds a recorded scene: a picture per colour bucket, the outline, and the extent covered. */
export interface CellScene {
  pictures: SkPicture[]
  outline: SkPath | null
  bounds: Bounds
}

/** Configures {@linkcode CellPictures}. */
export interface CellPicturesProps {
  scene: CellScene | null
}

const paints = rampColours(BUCKETS).map((colour) => {
  const paint = Skia.Paint()
  paint.setColor(Skia.Color(colour))
  paint.setAntiAlias(true)
  return paint
})

/**
 * Records one picture per colour bucket plus the outline, in scene coordinates.
 *
 * A recolour re-buckets the mesh and calls this again; the vertex positions never move, so the
 * cost is the recording alone. `opacity` is folded into the recorded paint, because a Skia group
 * opacity is a paint property and `drawPicture` ignores the paint it is drawn under.
 *
 * @param opacity Alpha of the filled cells, `1` for solid; the outline always draws solid.
 */
export function recordCellScene(
  mesh: MeshBuild,
  bounds: Bounds,
  outlinePath: string | null,
  opacity = 1,
): CellScene {
  const rect = Skia.XYWHRect(
    bounds.minX,
    bounds.minY,
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
  )
  const fills =
    opacity === 1
      ? paints
      : paints.map((paint) => {
          const faded = paint.copy()
          faded.setAlphaf(opacity)
          return faded
        })
  const pictures: SkPicture[] = []
  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    const batches = bucketBatches(mesh, bucket)
    if (batches.length === 0) continue
    const recorder = Skia.PictureRecorder()
    const canvas = recorder.beginRecording(rect)
    for (const batch of batches) {
      const points = new Array<SkPoint>(batch.positions.length / 2)
      for (let point = 0; point < points.length; point++) {
        points[point] = { x: batch.positions[point * 2], y: batch.positions[point * 2 + 1] }
      }
      const vertices = Skia.MakeVertices(
        VertexMode.Triangles,
        points,
        undefined,
        undefined,
        Array.from(batch.indices),
        false,
      )
      canvas.drawVertices(vertices, BlendMode.SrcOver, fills[bucket])
    }
    pictures.push(recorder.finishRecordingAsPicture())
    recorder.dispose()
  }
  const outline = outlinePath === null ? null : Skia.Path.MakeFromSVGString(outlinePath)
  return { pictures, outline, bounds }
}

// the grid strip holds one device pixel at any zoom, which is what a stroke width of zero means
const hairline = Skia.Paint()
hairline.setColor(Skia.Color(colours.hairline))
hairline.setStyle(PaintStyle.Stroke)
hairline.setStrokeWidth(0)
hairline.setAntiAlias(true)

/**
 * Draws a recorded scene onto a canvas of its own, for a host that keeps no Skia tree.
 *
 * The canvas carries the transform, so the scene draws in the metre space it was recorded in.
 *
 * @param canvas The canvas to draw into, already under the transform the scene stands in.
 * @param scene The recorded pictures and outline, from {@linkcode recordCellScene}.
 */
export function drawCellScene(canvas: SkCanvas, scene: CellScene): void {
  for (const picture of scene.pictures) canvas.drawPicture(picture)
  if (scene.outline !== null) canvas.drawPath(scene.outline, hairline)
}

/** Draws a recorded scene; it carries no camera, because it renders inside the camera group. */
export function CellPictures({ scene }: CellPicturesProps) {
  if (scene === null) return null
  return (
    <>
      {scene.pictures.map((picture, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the pictures are a fixed positional list.
        <Picture key={index} picture={picture} />
      ))}
      {scene.outline === null ? null : (
        <Path path={scene.outline} color={colours.hairline} style="stroke" strokeWidth={0} />
      )}
    </>
  )
}
