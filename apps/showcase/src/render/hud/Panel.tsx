import { BlurView } from 'expo-blur'
import { Children, type ReactNode, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colours, glass, type } from '../../theme/tokens'
import { PANEL_BORDER, PANEL_HEAD_GAP, PANEL_PADDING } from './panelMetrics'
import { bodyRoom } from './panelRoom'

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
  /**
   * Height the whole panel has to stay inside; the body scrolls once it needs more.
   *
   * The act measures the room, because only the act knows what else stands over its scene.
   */
  maxHeight?: number
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
  maxHeight,
}: PanelProps) {
  const items = Children.toArray(children)
  const head = collapsible ? items[0] : null
  const body = collapsible ? items.slice(1) : items

  const [headHeight, setHeadHeight] = useState(0)

  const edge = align === 'right' ? styles.right : styles.left
  const room = maxHeight === undefined ? null : bodyRoom(maxHeight, headHeight)

  return (
    // a collapsed panel is its head alone, so the scene keeps every touch outside it; expanded, the
    // readings pass their touches on but the glass behind them still takes one on iOS
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
          onLayout={(event) => setHeadHeight(event.nativeEvent.layout.height)}
        >
          {head}
          <Text style={styles.toggle}>{collapsed ? 'more' : 'less'}</Text>
        </Pressable>
      )}
      {collapsed ? null : collapsible ? (
        // a body given a room of its own scrolls rather than run past it, and takes the drag that
        // scrolls it so the scene below never sees one
        <ScrollView
          style={[styles.scroll, room === null ? null : { maxHeight: room }]}
          contentContainerStyle={[styles.body, edge]}
          pointerEvents={room === null ? 'none' : 'auto'}
          bounces={false}
          showsVerticalScrollIndicator
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    borderColor: glass.border,
    borderWidth: PANEL_BORDER,
    borderRadius: glass.radius,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: PANEL_PADDING,
    gap: PANEL_HEAD_GAP,
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
  scroll: { flexGrow: 0 },
  body: { gap: 8 },
  toggle: { ...type.label, color: colours.muted, marginTop: 6 },
})
