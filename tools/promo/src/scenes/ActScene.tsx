import { Video } from '@remotion/media'
import type { CSSProperties } from 'react'
import { interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { colours, fontFamily } from '../theme'
import type { Scene } from './scenes'

/** Sizes one variant of the scene: the wide cut, or the short hero loop. */
interface Measures {
  phone: number
  caption: number
  gap: number
  number: number
  act: number
  label: number
}

const WIDE: Measures = { phone: 940, caption: 620, gap: 110, number: 96, act: 30, label: 24 }
const HERO: Measures = { phone: 620, caption: 420, gap: 80, number: 76, act: 22, label: 19 }

/** The aspect of a take, which is the iPhone 17 Pro screen. */
const PHONE_ASPECT = 402 / 874

interface ActSceneProps {
  scene: Scene
  /** Whether the scene runs in the hero loop, which drops the act name and the note. */
  hero?: boolean
}

/**
 * Plays one act: the take on the left of its number, which counts up as the scene opens.
 *
 * The take is drawn at its own pace, never sped up, so the frame rate the phone held is the frame
 * rate the video shows.
 */
export function ActScene({ scene, hero = false }: ActSceneProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const measures = hero ? HERO : WIDE

  const growth = spring({ frame, fps, durationInFrames: fps, config: { damping: 200 } })
  const counted = interpolate(growth, [0, 1], [0, scene.value])
  const rise = interpolate(growth, [0, 1], [18, 0])

  return (
    <div style={styles.stage}>
      <div style={styles.vignette} />
      <div style={{ ...styles.row, gap: measures.gap }}>
        <div
          style={{
            ...styles.caption,
            width: measures.caption,
            transform: `translateY(${rise}px)`,
          }}
        >
          {hero ? null : <div style={{ ...styles.act, fontSize: measures.act }}>{scene.act}</div>}
          <div style={{ ...styles.number, fontSize: measures.number }}>
            {format(counted, scene.decimals)}
            <span style={styles.suffix}>{scene.suffix}</span>
          </div>
          <div style={{ ...styles.label, fontSize: measures.label }}>{scene.label}</div>
          {hero ? null : <div style={styles.note}>{scene.note}</div>}
        </div>
        <div
          style={{
            ...styles.phone,
            height: measures.phone,
            width: Math.round(measures.phone * PHONE_ASPECT),
          }}
        >
          <Video
            src={staticFile(`clips/${scene.id}.mp4`)}
            trimBefore={hero && scene.heroSkip > 0 ? scene.heroSkip : undefined}
            muted
            style={styles.take}
          />
        </div>
      </div>
    </div>
  )
}

function format(value: number, decimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
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
    background: `radial-gradient(70% 70% at 62% 45%, ${colours.vignette} 0%, ${colours.ground} 70%)`,
  },
  row: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    display: 'flex',
    flexDirection: 'column',
    // the block hangs off the phone, so a short label never leaves a hole in the middle of the frame
    alignItems: 'flex-end',
    textAlign: 'right',
  },
  act: {
    fontFamily: fontFamily.regular,
    color: colours.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 26,
  },
  number: {
    fontFamily: fontFamily.light,
    color: colours.text,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  suffix: {
    color: colours.contrast,
  },
  label: {
    fontFamily: fontFamily.regular,
    color: colours.muted,
    marginTop: 18,
  },
  note: {
    fontFamily: fontFamily.regular,
    color: colours.muted,
    opacity: 0.7,
    fontSize: 20,
    marginTop: 40,
    lineHeight: 1.5,
  },
  phone: {
    borderRadius: 28,
    overflow: 'hidden',
    border: `1px solid ${colours.hairline}`,
    boxShadow: '0 40px 120px rgba(0, 0, 0, 0.55)',
  },
  take: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
}
