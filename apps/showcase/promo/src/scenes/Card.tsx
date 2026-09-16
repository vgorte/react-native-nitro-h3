import type { CSSProperties } from 'react'
import { colours, fontFamily } from '../theme'
import type { Scene } from './scenes'

/** Draws the card that names an act before the portrait cut plays it: what it is for, and the call. */
export function Card({ scene }: { scene: Scene }) {
  return (
    <div style={styles.stage}>
      <div style={styles.vignette} />
      <div style={styles.column}>
        <div style={styles.headline}>{scene.headline}</div>
        <div style={styles.call}>{scene.call}</div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  stage: {
    position: 'absolute',
    inset: 0,
    backgroundColor: colours.ground,
    overflow: 'hidden',
  },
  vignette: {
    position: 'absolute',
    inset: 0,
    background: `radial-gradient(60% 40% at 50% 50%, ${colours.vignette} 0%, ${colours.ground} 70%)`,
  },
  column: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 80px',
    gap: 28,
    textAlign: 'center',
  },
  headline: {
    // only two weights of Inter Tight ship with the project, so the lighter one carries the card
    fontFamily: fontFamily.light,
    color: colours.text,
    fontSize: 64,
    lineHeight: 1.2,
  },
  call: {
    fontFamily: fontFamily.regular,
    color: colours.muted,
    fontSize: 34,
  },
}
