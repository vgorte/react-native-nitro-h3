import { Platform, StyleSheet, Text, View } from 'react-native'
import { MAX_CELL_COUNT } from '../../engine/cells'
import { formatCount } from '../../engine/stats'
import { colours, type } from '../../theme/tokens'

const { major, minor, patch } = Platform.constants.reactNativeVersion

/** Configures {@linkcode FinePrint}. */
export interface FinePrintProps {
  /** Lines the act adds under the shared ones, for what only that act has to qualify. */
  notes?: readonly string[]
}

/** Names the version and the ceiling every figure in the app has to be read against. */
export function FinePrint({ notes = [] }: FinePrintProps) {
  return (
    <View style={styles.block}>
      <Text style={styles.line}>React Native {`${major}.${minor}.${patch}`}</Text>
      <Text style={styles.line}>cell ceiling {formatCount(MAX_CELL_COUNT)}</Text>
      {notes.map((note) => (
        <Text key={note} style={styles.line}>
          {note}
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 2 },
  line: { ...type.label, color: colours.muted },
})
