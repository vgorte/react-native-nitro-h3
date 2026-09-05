import { Video } from '@remotion/media'
import type { CSSProperties } from 'react'
import { interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { colours, fontFamily } from '../theme'
import { numberLine } from './numberLine'
import { Cursor, phoneScale, Ripples } from './Overlays'
import { readingAt } from './reading'
import type { Scene } from './scenes'

/** Sizes one variant of the scene: the wide cut, or the short hero loop. */
interface Measures {
  phone: number
  caption: number
  gap: number
  headline: number
  number: number
  unit: number
  call: number
}

const WIDE: Measures = {
  phone: 940,
  caption: 780,
  gap: 100,
  headline: 30,
  number: 78,
  unit: 44,
  call: 20,
}
const HERO: Measures = {
  phone: 620,
  caption: 520,
  gap: 80,
  headline: 22,
  number: 62,
  unit: 34,
  call: 17,
}

/** The aspect of a take, which is the iPhone 17 Pro screen. */
export const PHONE_ASPECT = 402 / 874

/** What the phone is scaled to by the end of a scene that pushes in. */
const PUSH_IN = 1.04

interface ActSceneProps {
  scene: Scene
  /** Whether the scene runs in the hero loop, which drops the headline and the call line. */
  hero?: boolean
}

/**
 * Plays one act: the take beside three lines, what it is for, what it counted, and the call behind it.
 *
 * The take is drawn at its own pace, never sped up, and the number steps with the take's own events
 * rather than counting up on its own, so the line always says what the phone beside it shows.
 * Touches the simulator does not record are drawn back over the phone at the coordinates they
 * landed on.
 */
export function ActScene({ scene, hero = false }: ActSceneProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const measures = hero ? HERO : WIDE
  const skip = hero ? scene.heroSkip : 0
  const seconds = frame / fps + skip

  const line = numberLine(scene, readingAt(scene, seconds))
  const height = measures.phone
  const width = Math.round(height * PHONE_ASPECT)
  const push =
    scene.pushIn === true ? interpolate(seconds, [skip, skip + scene.seconds], [1, PUSH_IN]) : 1

  return (
    <div style={styles.stage}>
      <div style={styles.vignette} />
      <div style={{ ...styles.row, gap: measures.gap }}>
        <div style={{ ...styles.caption, width: measures.caption }}>
          {hero ? null : (
            <div style={{ ...styles.headline, fontSize: measures.headline }}>{scene.headline}</div>
          )}
          <div style={{ ...styles.number, fontSize: measures.number }}>
            {line.lead}
            {line.number}
            <span style={styles.suffix}>{line.suffix}</span>
            <span style={{ ...styles.unit, fontSize: measures.unit }}>{line.unit}</span>
          </div>
          {hero ? null : (
            <div style={{ ...styles.call, fontSize: measures.call }}>{scene.call}</div>
          )}
        </div>
        {/* the overlays ride the phone, so a push-in carries them with it */}
        <div style={{ ...styles.phone, height, width, transform: `scale(${push})` }}>
          <Video
            src={staticFile(`clips/${scene.id}.mp4`)}
            trimBefore={skip > 0 ? Math.round(skip * fps) : undefined}
            muted
            style={styles.take}
          />
          {scene.taps === undefined ? null : (
            <Ripples taps={scene.taps} seconds={seconds} scale={phoneScale(height)} />
          )}
          {scene.drag === undefined ? null : (
            <Cursor drag={scene.drag} seconds={seconds} scale={phoneScale(height)} />
          )}
        </div>
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
    // the block hangs off the phone, so a short line never leaves a hole in the middle of the frame
    alignItems: 'flex-end',
    textAlign: 'right',
  },
  headline: {
    fontFamily: fontFamily.regular,
    color: colours.muted,
    letterSpacing: 1,
    marginBottom: 24,
  },
  number: {
    fontFamily: fontFamily.light,
    color: colours.text,
    lineHeight: 1.1,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  suffix: {
    color: colours.contrast,
  },
  unit: {
    marginLeft: '0.35em',
  },
  call: {
    fontFamily: fontFamily.regular,
    color: colours.muted,
    opacity: 0.7,
    marginTop: 32,
    lineHeight: 1.5,
  },
  phone: {
    position: 'relative',
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
