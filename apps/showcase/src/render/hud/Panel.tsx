import { BlurView } from 'expo-blur'
import { Children, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colours, glass, type } from '../../theme/tokens'

/** Configures {@linkcode Panel}. */
export interface PanelProps {
  children: ReactNode
  /** Which edge the contents line up on; the act places the panel itself. */
  align?: 'left' | 'right'
  /**
   * Turns the first child into a head that folds the rest away, for a panel that covers a scene.
   *
   * The act owns the state, so a collapse lasts as long as the visitor stays on the act and no
   * longer.
   */
  collapsible?: boolean
  collapsed?: boolean
  onToggle?: () => void
}

/** Blur strength of the glass; the theme's 18 px radius over data this bright needs it high. */
const BLUR_INTENSITY = 60

/** Draws the glass surface a group of HUD readings sits on. */
export function Panel({
  children,
  align = 'left',
  collapsible = false,
  collapsed = false,
  onToggle,
}: PanelProps) {
  const items = Children.toArray(children)
  const head = collapsible ? items[0] : null
  const body = collapsible ? items.slice(1) : items

  const edge = align === 'right' ? styles.right : styles.left

  return (
    // only the head of a collapsible panel takes a touch; the readings let the scene have them
    <View style={[styles.panel, edge]} pointerEvents={collapsible ? 'box-none' : 'auto'}>
      {/* Android has no backdrop to sample without a blur target, and falls back to a dark scrim */}
      <BlurView intensity={BLUR_INTENSITY} tint="dark" style={StyleSheet.absoluteFill} />
      {/* the blur alone leaves the labels washed out over a bright city, so the ground comes back */}
      <View style={styles.scrim} pointerEvents="none" />
      <View style={styles.tint} pointerEvents="none" />
      {head === null ? null : (
        <Pressable
          style={styles.head}
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
        >
          {head}
          <Text style={styles.toggle}>{collapsed ? 'more' : 'less'}</Text>
        </Pressable>
      )}
      {collapsed ? null : collapsible ? (
        <View style={[styles.body, edge]} pointerEvents="none">
          {body}
        </View>
      ) : (
        body
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    borderColor: glass.border,
    borderWidth: 1,
    borderRadius: glass.radius,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  scrim: { position: 'absolute', inset: 0, backgroundColor: glass.scrim },
  tint: { position: 'absolute', inset: 0, backgroundColor: glass.fill },
  left: { alignItems: 'flex-start' },
  right: { alignItems: 'flex-end' },
  head: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  body: { alignSelf: 'stretch', gap: 8 },
  toggle: { ...type.label, color: colours.muted, marginTop: 6 },
})
