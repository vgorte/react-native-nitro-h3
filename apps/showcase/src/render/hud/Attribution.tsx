import { StyleSheet, Text, View } from 'react-native'
import { colours, type } from '../../theme/tokens'
import { LINE_BOTTOM, LINE_HEIGHT, READOUT_WIDTH } from './hudBands'

/** Configures {@linkcode Attribution}. */
export interface AttributionProps {
  /** The line the tile source read from its TileJSON. */
  text: string
  /** `false` where the style would not load, which adds a note above the line. */
  loaded?: boolean
}

// the readout starts on this same margin, so the note reads clear of it
const NOTE_INSET = READOUT_WIDTH + 8

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
