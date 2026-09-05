import { Series } from 'remotion'
import { ActScene } from './scenes/ActScene'
import { Closing } from './scenes/Closing'
import { HERO_SCENES, SCENES } from './scenes/scenes'

/** Frames the closing card stands for, at the composition's own frame rate. */
export const CLOSING_FRAMES = 180

/** Frames one hero scene stands for, at the hero's 30 fps. */
export const HERO_SCENE_FRAMES = 90

/** Counts the frames the wide cut runs for: the six acts, then the closing card. */
export const SHOWCASE_FRAMES =
  SCENES.reduce((total, scene) => total + scene.duration, 0) + CLOSING_FRAMES

/** Counts the frames the hero loop runs for. */
export const HERO_FRAMES = HERO_SCENES.length * HERO_SCENE_FRAMES

/** The wide cut: every act in the order the app pages through them, then the closing card. */
export function Showcase() {
  return (
    <Series>
      {SCENES.map((scene) => (
        <Series.Sequence key={scene.id} durationInFrames={scene.duration}>
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
        <Series.Sequence key={scene.id} durationInFrames={HERO_SCENE_FRAMES}>
          <ActScene scene={scene} hero />
        </Series.Sequence>
      ))}
    </Series>
  )
}
