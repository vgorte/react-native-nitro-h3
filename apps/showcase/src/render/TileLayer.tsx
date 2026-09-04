import { Group, Path, Skia, type SkPath } from '@shopify/react-native-skia'
import { mercatorX, mercatorY } from '../engine/projection'
import {
  type StyleClass,
  type TileId,
  type TilePaths,
  type TileSource,
  tileOriginMetres,
} from '../engine/tiles'
import { colours, ramp } from '../theme/tokens'
import type { CameraAnchor } from './camera'

/** Configures {@linkcode TileLayer}. */
export interface TileLayerProps {
  source: TileSource
  tiles: TileId[]
  classes: StyleClass[]
  /** The coordinate the scene's metre space is measured from, as the camera holds it. */
  anchor: CameraAnchor
}

/** Opacity per style class, so a motorway reads above a service road at the same hue. */
export const CLASS_OPACITY: Record<StyleClass, number> = {
  water: 1,
  motorway: 0.9,
  trunk: 0.8,
  primary: 0.7,
  secondary: 0.55,
  tertiary: 0.45,
  minor: 0.3,
  service: 0.22,
  building: 0.28,
}

// two steps above the ground colour, so water reads as a surface
const WATER_FILL = colours.hairline
const HAIRLINE = ramp[2]

const parsed = new WeakMap<TilePaths, Map<StyleClass, SkPath | null>>()

/** Answers a tile's path for one class, parsing the string on the first draw that needs it. */
function classPath(entry: TilePaths, style: StyleClass): SkPath | null {
  let paths = parsed.get(entry)
  if (paths === undefined) {
    paths = new Map()
    parsed.set(entry, paths)
  }
  const known = paths.get(style)
  if (known !== undefined) return known
  const path = entry.paths[style] === '' ? null : Skia.Path.MakeFromSVGString(entry.paths[style])
  paths.set(style, path)
  return path
}

/**
 * Draws the basemap as hairlines under the geometry, one group per tile.
 *
 * The group places the tile in the scene's metre space, so the basemap and the cells move under
 * one camera and cannot drift apart. A tile that has not arrived yet draws nothing.
 */
export function TileLayer({ source, tiles, classes, anchor }: TileLayerProps) {
  const anchorX = mercatorX(anchor.lng)
  const anchorY = mercatorY(anchor.lat)

  return (
    <>
      {tiles.map((tile) => {
        const entry = source.paths(tile, classes)
        if (entry === undefined) return null
        const origin = tileOriginMetres(tile)
        const transform = [
          { translateX: origin.x - anchorX },
          { translateY: anchorY - origin.y },
          { scale: origin.span / entry.extent },
        ]
        return (
          <Group key={`${tile.z}/${tile.x}/${tile.y}`} transform={transform}>
            {classes.map((style) => {
              const path = classPath(entry, style)
              if (path === null) return null
              return style === 'water' ? (
                <Path key={style} path={path} color={WATER_FILL} opacity={CLASS_OPACITY[style]} />
              ) : (
                <Path
                  key={style}
                  path={path}
                  color={HAIRLINE}
                  style="stroke"
                  strokeWidth={0}
                  opacity={CLASS_OPACITY[style]}
                />
              )
            })}
          </Group>
        )
      })}
    </>
  )
}
