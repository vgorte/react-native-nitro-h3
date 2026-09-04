import {
  BlendMode,
  Group,
  Path,
  Picture,
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

/** Holds a recorded scene: one picture per colour bucket, the outline, and the extent they cover. */
export interface CellScene {
  pictures: SkPicture[]
  outline: SkPath | null
  bounds: Bounds
}

/** Configures {@linkcode CellPictures}. */
export interface CellPicturesProps {
  scene: CellScene | null
  /** Opacity of the filled cells; the outline always draws at full strength. */
  opacity?: number
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
 * cost is the recording alone.
 */
export function recordCellScene(
  mesh: MeshBuild,
  bounds: Bounds,
  outlinePath: string | null,
): CellScene {
  const rect = Skia.XYWHRect(
    bounds.minX,
    bounds.minY,
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
  )
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
      canvas.drawVertices(vertices, BlendMode.SrcOver, paints[bucket])
    }
    pictures.push(recorder.finishRecordingAsPicture())
    recorder.dispose()
  }
  const outline = outlinePath === null ? null : Skia.Path.MakeFromSVGString(outlinePath)
  return { pictures, outline, bounds }
}

/** Draws a recorded scene; it carries no camera, because it renders inside the camera group. */
export function CellPictures({ scene, opacity = 1 }: CellPicturesProps) {
  if (scene === null) return null
  return (
    <>
      <Group opacity={opacity}>
        {scene.pictures.map((picture, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the pictures are a fixed positional list.
          <Picture key={index} picture={picture} />
        ))}
      </Group>
      {scene.outline === null ? null : (
        <Path path={scene.outline} color={colours.hairline} style="stroke" strokeWidth={0} />
      )}
    </>
  )
}
