import type { CSSProperties } from 'react'
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { colours, fontFamily } from '../theme'

/** Closes the video on the package mark, its name and what it is. */
export function Closing() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const growth = spring({ frame, fps, durationInFrames: fps, config: { damping: 200 } })
  const rise = interpolate(growth, [0, 1], [24, 0])

  return (
    <div style={styles.stage}>
      <div style={styles.vignette} />
      <div style={{ ...styles.column, transform: `translateY(${rise}px)`, opacity: growth }}>
        <Img src={staticFile('logo.svg')} style={styles.mark} />
        <div style={styles.name}>react-native-nitro-h3</div>
        <div style={styles.line}>H3 for React Native, native speed</div>
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
    background: `radial-gradient(60% 60% at 50% 45%, ${colours.vignette} 0%, ${colours.ground} 70%)`,
  },
  column: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: 168,
    height: 168,
    borderRadius: 36,
  },
  name: {
    fontFamily: fontFamily.light,
    color: colours.text,
    fontSize: 72,
    marginTop: 56,
    letterSpacing: -1,
  },
  line: {
    fontFamily: fontFamily.regular,
    color: colours.muted,
    fontSize: 26,
    marginTop: 24,
  },
}
