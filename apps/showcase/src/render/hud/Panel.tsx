import { BlurView } from 'expo-blur'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { glass } from '../../theme/tokens'

/** Configures {@linkcode Panel}. */
export interface PanelProps {
  children: ReactNode
  /** Which edge the contents line up on; the act places the panel itself. */
  align?: 'left' | 'right'
}

/** Blur strength of the glass; the theme's 18 px radius over data this bright needs it high. */
const BLUR_INTENSITY = 60

/** Draws the glass surface a group of HUD readings sits on. */
export function Panel({ children, align = 'left' }: PanelProps) {
  return (
    <View style={[styles.panel, align === 'right' ? styles.right : styles.left]}>
      <BlurView
        intensity={BLUR_INTENSITY}
        tint="dark"
        // the Android blur is opt-in and falls back to a flat tint without it
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.tint} pointerEvents="none" />
      {children}
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
  tint: { position: 'absolute', inset: 0, backgroundColor: glass.fill },
  left: { alignItems: 'flex-start' },
  right: { alignItems: 'flex-end' },
})
