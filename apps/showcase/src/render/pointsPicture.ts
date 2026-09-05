import {
  PaintStyle,
  PointMode,
  type SkCanvas,
  Skia,
  type SkPaint,
  type SkPoint,
  StrokeCap,
} from '@shopify/react-native-skia'
import { colours } from '../theme/tokens'

/** Alpha a point is drawn at, low enough that a hotspot reads as a bloom and not as a blob. */
export const POINT_ALPHA = 0.55

/** The colour a raw point is drawn in, pale enough to read alone over the dark basemap. */
export const POINT_COLOUR = colours.text

// points one `drawPoints` call takes, the widest batch the call indexes in one draw
const POINT_BATCH = 65_535

/**
 * Answers the paint the raw points are drawn with, in the image's own pixels.
 *
 * A point reads on its own over the basemap and a crowd of them saturates into a pale blob, which
 * is the cloud the hexagons are switched on over. They are drawn square and without anti-aliasing:
 * a million round and smoothed specks cost more than a mark this size can show for it.
 *
 * @param pixelRatio Image pixels a point spans.
 * @param radiusPt The radius a point covers on screen, from `pointRadiusPx`.
 */
export function pointsPaint(pixelRatio: number, radiusPt: number): SkPaint {
  const paint = Skia.Paint()
  paint.setColor(Skia.Color(POINT_COLOUR))
  paint.setAlphaf(POINT_ALPHA)
  paint.setStyle(PaintStyle.Stroke)
  paint.setStrokeCap(StrokeCap.Square)
  // a square cap covers the radius on either side of the position it is drawn at
  paint.setStrokeWidth(2 * radiusPt * pixelRatio)
  paint.setAntiAlias(false)
  return paint
}

/**
 * Draws the projected points, stepping over as many of them as the stride says.
 *
 * @param canvas The offscreen canvas, standing in the image's own pixels.
 * @param xy An `x, y` pair per point, as `projectPoints` packed them.
 * @param count Points `xy` holds.
 * @param stride Points stepped over between two drawn ones, from `sampleStride`.
 * @param paint The paint from {@linkcode pointsPaint}.
 */
export function drawPoints(
  canvas: SkCanvas,
  xy: Float32Array,
  count: number,
  stride: number,
  paint: SkPaint,
): void {
  let batch: SkPoint[] = []
  for (let point = 0; point < count; point += stride) {
    batch.push({ x: xy[point * 2], y: xy[point * 2 + 1] })
    if (batch.length < POINT_BATCH) continue
    canvas.drawPoints(PointMode.Points, batch, paint)
    batch = []
  }
  if (batch.length > 0) canvas.drawPoints(PointMode.Points, batch, paint)
}
