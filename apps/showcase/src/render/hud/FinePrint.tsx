import { Platform, StyleSheet, Text, View } from 'react-native'
import { MAX_CELL_COUNT } from '../../engine/cells'
import { formatCount } from '../../engine/stats'
import { colours, type } from '../../theme/tokens'

// the published figures in docs/benchmark.md were measured on this version
const BENCHMARK_VERSION = '0.87.0'

const { major, minor, patch } = Platform.constants.reactNativeVersion

/** Names the versions and the ceiling every figure in the app has to be read against. */
export function FinePrint() {
  return (
    <View style={styles.block}>
      <Text style={styles.line}>
        React Native {`${major}.${minor}.${patch}`}, the benchmark ran on {BENCHMARK_VERSION}
      </Text>
      <Text style={styles.line}>cell ceiling {formatCount(MAX_CELL_COUNT)}</Text>
      <Text style={styles.line}>documented figures from an iPhone XS release build</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 2 },
  line: { ...type.label, color: colours.muted },
})
