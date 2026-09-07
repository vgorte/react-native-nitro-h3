import { StyleSheet, Text, View } from 'react-native'
import { colours, type } from '../../theme/tokens'

/** Configures {@linkcode Row}. */
export interface RowProps {
  label: string
  value: string
  /** The library call the value was measured around, shown before it. */
  call?: string
  tone?: 'text' | 'muted' | 'contrast'
}

/** Draws one reading: its label on the left, the call it came from and the value on the right. */
export function Row({ label, value, call, tone = 'text' }: RowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.trailing}>
        {call === undefined ? null : <Text style={styles.call}>{call}</Text>}
        <Text style={[styles.value, { color: colours[tone] }]}>{value}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
  },
  trailing: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  label: { ...type.label, color: colours.muted },
  call: { ...type.label, color: colours.muted },
  value: type.value,
})
