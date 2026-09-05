import { Video } from '@remotion/media'
import type { CSSProperties } from 'react'
import { interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { colours } from '../theme'
import { Cursor, phoneScale, Ripples } from './Overlays'
import type { Scene, Window } from './scenes'

/** The radius the screen is rounded to, which stands in for a device frame the cut does not draw. */
const CORNER = 84

/** What the phone is scaled to by the end of a scene that pushes in. */
const PUSH_IN = 1.04

interface PortraitSceneProps {
  scene: Scene
  /** The core of the clip this cut plays. */
  window: Window
}

/**
 * Plays one act in portrait: the take alone, filling the frame, with nothing written over it.
 *
 * The phone's own HUD carries every number, so the scene stays clean and the words live on the card
 * before it. Touches the simulator does not record are drawn back on at the take's coordinates.
 */
export function PortraitScene({ scene, window }: PortraitSceneProps) {
  const frame = useCurrentFrame()
  const { fps, height } = useVideoConfig()
  const seconds = frame / fps + window.skip
  const push =
    scene.pushIn === true
      ? interpolate(seconds, [window.skip, window.skip + window.seconds], [1, PUSH_IN])
      : 1

  return (
    <div style={styles.stage}>
      <div style={{ ...styles.screen, transform: `scale(${push})` }}>
        <Video
          src={staticFile(`clips/${scene.id}.mp4`)}
          trimBefore={window.skip > 0 ? Math.round(window.skip * fps) : undefined}
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
  )
}

const styles: Record<string, CSSProperties> = {
  stage: {
    position: 'absolute',
    inset: 0,
    backgroundColor: colours.ground,
    overflow: 'hidden',
  },
  screen: {
    position: 'absolute',
    inset: 0,
    borderRadius: CORNER,
    overflow: 'hidden',
  },
  take: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
}
