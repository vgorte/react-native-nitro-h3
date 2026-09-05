import { Video } from '@remotion/media'
import type { CSSProperties } from 'react'
import { interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { colours, fontFamily } from '../theme'
import { Cursor, phoneScale, Ripples } from './Overlays'
import { readingAt } from './reading'
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

/** What the phone is scaled to by the end of a scene that pushes in. */
const PUSH_IN = 1.04

interface ActSceneProps {
  scene: Scene
  /** Whether the scene runs in the hero loop, which drops the act name and the two lines. */
  hero?: boolean
}

/**
 * Plays one act: the take on the left of the reading its panel carried while the take ran.
 *
 * The take is drawn at its own pace, never sped up, and the reading steps with the take's own
 * events rather than counting up on its own, so the caption always says what the phone beside it
 * shows. Touches the simulator does not record are drawn back over the phone at the coordinates
 * they landed on.
 */
export function ActScene({ scene, hero = false }: ActSceneProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const measures = hero ? HERO : WIDE
  const skip = hero ? scene.heroSkip : 0
  const seconds = frame / fps + skip

  const reading = readingAt(scene, seconds)
  const height = measures.phone
  const width = Math.round(height * PHONE_ASPECT)
  const push =
    scene.pushIn === true ? interpolate(seconds, [skip, skip + scene.seconds], [1, PUSH_IN]) : 1

  return (
    <div style={styles.stage}>
      <div style={styles.vignette} />
      <div style={{ ...styles.row, gap: measures.gap }}>
        <div style={{ ...styles.caption, width: measures.caption }}>
          {hero ? null : <div style={{ ...styles.act, fontSize: measures.act }}>{scene.act}</div>}
          <div style={{ ...styles.number, fontSize: measures.number }}>
            {reading.value === null ? '' : format(reading.value, scene.decimals)}
            <span style={styles.suffix}>{reading.value === null ? '' : scene.suffix}</span>
          </div>
          <div style={{ ...styles.label, fontSize: measures.label }}>
            {reading.value === null ? '' : reading.label}
          </div>
          {hero ? null : <div style={styles.call}>{scene.call}</div>}
          {/* it keeps its room before a reading exists */}
          {hero || scene.note === undefined ? null : (
            <div style={{ ...styles.note, opacity: reading.value === null ? 0 : 1 }}>
              {scene.note}
            </div>
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

/**
 * Writes a number the way the act's own panel writes it.
 *
 * Counts are grouped, as `formatCount` groups them; a factor is not, because the app's own factor
 * row writes it with `toFixed` and the caption must not disagree with the phone beside it.
 */
function format(value: number, decimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: decimals === 0,
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
    marginBottom: 26,
  },
  number: {
    fontFamily: fontFamily.light,
    color: colours.text,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
    // it keeps its height before a reading exists
    minHeight: '1em',
  },
  suffix: {
    color: colours.contrast,
  },
  label: {
    fontFamily: fontFamily.regular,
    color: colours.muted,
    marginTop: 18,
    minHeight: '1.2em',
  },
  call: {
    fontFamily: fontFamily.regular,
    color: colours.muted,
    opacity: 0.7,
    fontSize: 20,
    marginTop: 40,
    lineHeight: 1.5,
  },
  note: {
    fontFamily: fontFamily.regular,
    color: colours.contrast,
    fontSize: 20,
    marginTop: 10,
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
