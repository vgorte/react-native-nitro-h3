import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { glass } from '../../theme/tokens'

/** Configures {@linkcode Panel}. */
export interface PanelProps {
  children: ReactNode
  /** Which edge the contents line up on; the act places the panel itself. */
  align?: 'left' | 'right'
}

/** Draws the glass surface a group of HUD readings sits on. */
export function Panel({ children, align = 'left' }: PanelProps) {
  return (
    <View style={[styles.panel, align === 'right' ? styles.right : styles.left]}>{children}</View>
  )
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: glass.fill,
    borderColor: glass.border,
    borderWidth: 1,
    borderRadius: glass.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  left: { alignItems: 'flex-start' },
  right: { alignItems: 'flex-end' },
})
