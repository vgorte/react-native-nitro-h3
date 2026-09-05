import { Series } from 'remotion'
import { ActScene } from './scenes/ActScene'
import { Closing } from './scenes/Closing'
import { HERO_SCENES, SCENES } from './scenes/scenes'

/** The frame rate of the wide cut, which is the frame rate the takes were recorded at. */
export const SHOWCASE_FPS = 60

/** The frame rate of the hero loop, which a GIF is encoded down from anyway. */
export const HERO_FPS = 30

/** Frames the closing card stands for, at the wide cut's frame rate. */
export const CLOSING_FRAMES = 180

/** Seconds one hero scene stands for. */
export const HERO_SCENE_SECONDS = 3

/** Counts the frames the wide cut runs for: the six acts, then the closing card. */
export const SHOWCASE_FRAMES =
  SCENES.reduce((total, scene) => total + Math.round(scene.seconds * SHOWCASE_FPS), 0) +
  CLOSING_FRAMES

/** Counts the frames the hero loop runs for. */
export const HERO_FRAMES = HERO_SCENES.length * HERO_SCENE_SECONDS * HERO_FPS

/** The wide cut: every act in the order the app pages through them, then the closing card. */
export function Showcase() {
  return (
    <Series>
      {SCENES.map((scene) => (
        <Series.Sequence key={scene.id} durationInFrames={Math.round(scene.seconds * SHOWCASE_FPS)}>
          <ActScene scene={scene} />
        </Series.Sequence>
      ))}
      <Series.Sequence durationInFrames={CLOSING_FRAMES}>
        <Closing />
      </Series.Sequence>
    </Series>
  )
}

/** The hero loop: three acts, three seconds each, the number and nothing else. */
export function ShowcaseHero() {
  return (
    <Series>
      {HERO_SCENES.map((scene) => (
        <Series.Sequence key={scene.id} durationInFrames={HERO_SCENE_SECONDS * HERO_FPS}>
          <ActScene scene={scene} hero />
        </Series.Sequence>
      ))}
    </Series>
  )
}
