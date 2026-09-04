import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'
import { colours, type } from '../../theme/tokens'

/** Configures {@linkcode ActIndicator}. */
export interface ActIndicatorProps {
  acts: readonly string[]
  current: number
  onSelect(index: number): void
}

// there is no safe-area provider, so the status-bar inset is per platform
const TOP_INSET = Platform.select({ ios: 62, default: (StatusBar.currentHeight ?? 24) + 12 })

/** Lists the acts along the top and moves to the one that is tapped. */
export function ActIndicator({ acts, current, onSelect }: ActIndicatorProps) {
  return (
    <View style={styles.bar}>
      {acts.map((act, index) => (
        <Pressable
          key={act}
          onPress={() => onSelect(index)}
          hitSlop={8}
          accessibilityRole="tab"
          accessibilityState={{ selected: index === current }}
        >
          <Text style={index === current ? styles.currentLabel : styles.label}>{act}</Text>
          <View style={index === current ? styles.currentRule : styles.rule} />
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: TOP_INSET,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  label: { ...type.label, color: colours.muted },
  currentLabel: { ...type.label, color: colours.text },
  rule: { height: 1, marginTop: 6, backgroundColor: colours.hairline },
  currentRule: { height: 1, marginTop: 6, backgroundColor: colours.text },
})
