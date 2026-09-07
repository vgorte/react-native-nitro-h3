import { Path } from '@shopify/react-native-skia'
import { useMemo } from 'react'
import { type SharedValue, useDerivedValue } from 'react-native-reanimated'
import { colours } from '../theme/tokens'
import { CellPictures } from './CellPictures'
import { buildHighlight, disposeHighlight } from './inspectScene'
import type { CameraAnchor } from './useCamera'
import { useDisposed } from './useDisposed'

/** Alpha the neighbours are filled at, low enough that the cells under them still read. */
const NEIGHBOUR_ALPHA = 0.22

/** Alpha of the parent outline, which is a ghost over the cells it holds. */
const PARENT_ALPHA = 0.8

/** Points the outlines are drawn at, whatever the camera has zoomed to. */
const PARENT_WIDTH_PX = 1.5
const NEIGHBOUR_WIDTH_PX = 1

/** Configures {@linkcode InspectHighlight}. */
export interface InspectHighlightProps {
  /** The cell the Inspector stands open on, `null` while it is closed. */
  cell: bigint | null
  /** The coordinate the scene's metre space is measured from. */
  anchor: CameraAnchor
  /** The camera's pixel scale, which keeps the outline one width at every zoom. */
  scale: SharedValue<number>
}

/**
 * Draws what an inspected cell stands between: the parent as a ghost outline, the children filled
 * and the neighbours in the contrast colour.
 *
 * It renders inside the camera group of the act's canvas, over the act's own scene.
 */
export function InspectHighlight({ cell, anchor, scale }: InspectHighlightProps) {
  const highlight = useMemo(
    () => (cell === null ? null : buildHighlight(cell, anchor)),
    [cell, anchor],
  )
  useDisposed(highlight, disposeHighlight)
  const parentWidth = useDerivedValue(() => PARENT_WIDTH_PX / scale.value)
  const neighbourWidth = useDerivedValue(() => NEIGHBOUR_WIDTH_PX / scale.value)

  if (highlight === null) return null

  return (
    <>
      <Path
        path={highlight.neighbours}
        color={colours.contrast}
        style="fill"
        opacity={NEIGHBOUR_ALPHA}
      />
      {/* the fills of six touching cells merge into one shape, so every ring keeps its own edge */}
      <Path
        path={highlight.neighbours}
        color={colours.contrast}
        style="stroke"
        strokeWidth={neighbourWidth}
      />
      <CellPictures scene={highlight.children} />
      {highlight.parent === null ? null : (
        <Path
          path={highlight.parent}
          color={colours.text}
          style="stroke"
          strokeWidth={parentWidth}
          opacity={PARENT_ALPHA}
        />
      )}
    </>
  )
}
