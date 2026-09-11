import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colours, type } from '../../theme/tokens'

/** Holds one option of a {@linkcode Choice}: what it sets and how it reads. */
export interface ChoiceOption<T> {
  value: T
  label: string
}

/** Configures {@linkcode Choice}. */
export interface ChoiceProps<T> {
  label: string
  options: readonly ChoiceOption<T>[]
  /** The standing value; an option matches it or reads as one of the others. */
  value: T
  onChange(next: T): void
}

/** Draws one row of options an act sets a run with: its label on the left, the options right. */
export function Choice<T>({ label, options, value, onChange }: ChoiceProps<T>) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.options}>
        {options.map((option) => (
          <Pressable
            key={option.label}
            onPress={() => onChange(option.value)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: option.value === value }}
          >
            <Text style={option.value === value ? styles.selected : styles.option}>
              {option.label}
            </Text>
          </Pressable>
        ))}
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
  options: { flexDirection: 'row', alignItems: 'baseline', gap: 14 },
  label: { ...type.label, color: colours.muted },
  option: { ...type.label, color: colours.muted },
  selected: { ...type.label, color: colours.text },
})
