import { StyleSheet, Text } from 'react-native'
import { colours, type } from '../../theme/tokens'

/** Configures {@linkcode Attribution}. */
export interface AttributionProps {
  /** The line the tile source read from its TileJSON. */
  text: string
}

// clears the blocked readout, which stands 58 pt tall 48 pt off the bottom, and the bar under it
const LINE_BOTTOM = 114

/** Draws the basemap's licence line along the bottom edge, above the blocked readout. */
export function Attribution({ text }: AttributionProps) {
  return <Text style={styles.line}>{text}</Text>
}

const styles = StyleSheet.create({
  line: {
    ...type.label,
    color: colours.muted,
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: LINE_BOTTOM,
  },
})
