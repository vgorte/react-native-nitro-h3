import { Group, Path, Skia, type SkPath } from '@shopify/react-native-skia'
import { useEffect } from 'react'
import type { VertexProjector } from '../engine/projection'
import type { StyleClass, TileId, TilePaths, TileSource } from '../engine/tiles'
import { colours, ramp } from '../theme/tokens'

/** Configures {@linkcode TileLayer}. */
export interface TileLayerProps {
  source: TileSource
  tiles: TileId[]
  classes: StyleClass[]
  /** Places a tile's vertices in the scene the camera moves. */
  project: VertexProjector
  /** The view the paths belong to; a new one rebuilds every tile. */
  epoch: number
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
 * Every vertex is projected into the scene at the epoch's settle, so the basemap and the cells sit
 * on the same sphere and move under one camera. A tile that has not arrived yet draws nothing.
 */
export function TileLayer({ source, tiles, classes, project, epoch }: TileLayerProps) {
  // a pan's leftover tiles are dropped before they cost a decode
  useEffect(() => {
    source.prune(tiles)
  }, [source, tiles])

  return (
    <>
      {tiles.map((tile) => {
        const entry = source.paths(tile, classes, project, epoch)
        if (entry === undefined) return null
        return (
          <Group key={`${tile.z}/${tile.x}/${tile.y}`}>
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
