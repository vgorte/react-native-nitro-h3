import { StyleSheet, Text, View } from 'react-native'
import { colours, type } from '../../theme/tokens'

/** Configures {@linkcode Metric}. */
export interface MetricProps {
  value: string
  unit?: string
  caption: string
}

/** Draws the one number a HUD group is about, with its unit beside it and its caption under it. */
export function Metric({ value, unit, caption }: MetricProps) {
  return (
    <View>
      <View style={styles.line}>
        <Text style={styles.value}>{value}</Text>
        {unit === undefined ? null : <Text style={styles.unit}>{unit}</Text>}
      </View>
      <Text style={styles.caption}>{caption}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  value: { ...type.metric, color: colours.text },
  unit: { ...type.label, color: colours.muted },
  caption: { ...type.label, color: colours.muted, marginTop: 2 },
})
