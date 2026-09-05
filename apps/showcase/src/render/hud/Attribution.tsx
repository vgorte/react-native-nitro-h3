import { Platform, StyleSheet, Text, View } from 'react-native'
import { colours, type } from '../../theme/tokens'

/** Configures {@linkcode Attribution}. */
export interface AttributionProps {
  /** The line the tile source read from its TileJSON. */
  text: string
  /** `false` where the style would not load, which adds a note above the line. */
  loaded?: boolean
}

// there is no safe-area provider, so the bottom inset is per platform: the home indicator on
// iPhone, the gesture bar on Android
const LINE_BOTTOM = Platform.select({ ios: 42, default: 34 })
// the line has no leading of its own, and the band below has to be a number
const LINE_HEIGHT = 14
// the readout starts on this same margin and runs 208 pt wide, so the note reads clear of it
const NOTE_INSET = 208 + 8

/** Points the licence line takes along the bottom edge, which the rest of the stack sits above. */
export const ATTRIBUTION_BAND = LINE_BOTTOM + LINE_HEIGHT

/**
 * Draws the basemap's licence line along the very bottom edge, under the blocked readout.
 *
 * The credit stands whatever `loaded` says: the style is fetched twice, once here and once by the
 * map itself, and the map's own fetch can be served from its cache after this one has failed, so a
 * screen with tiles on it must carry the line either way. A failed fetch adds a note above it.
 */
export function Attribution({ text, loaded = true }: AttributionProps) {
  return (
    <View style={styles.lines} pointerEvents="none">
      {loaded ? null : <Text style={styles.note}>basemap unavailable</Text>}
      <Text style={styles.line}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  lines: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: LINE_BOTTOM,
    gap: 2,
  },
  line: {
    ...type.label,
    lineHeight: LINE_HEIGHT,
    color: colours.muted,
  },
  note: {
    ...type.label,
    lineHeight: LINE_HEIGHT,
    color: colours.muted,
    marginLeft: NOTE_INSET,
    textAlign: 'right',
  },
})
