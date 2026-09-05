import { Series } from 'remotion'
import { ActScene } from './scenes/ActScene'
import { Card } from './scenes/Card'
import { Closing } from './scenes/Closing'
import { PortraitScene } from './scenes/PortraitScene'
import { HERO_SCENES, SCENES, type Scene } from './scenes/scenes'

/** The frame rate of the wide cut, which is the frame rate the takes were recorded at. */
export const SHOWCASE_FPS = 60

/** The frame rate of the hero loop, which a GIF is encoded down from anyway. */
export const HERO_FPS = 30

/** Frames the closing card stands for, at the wide cut's frame rate. */
export const CLOSING_FRAMES = 180

/** Seconds one hero scene stands for. */
export const HERO_SCENE_SECONDS = 3

/** Seconds a portrait card stands before the act it names. */
export const CARD_SECONDS = 0.7

/** Seconds one act of the portrait hero stands for, which is shorter than the full cut's core. */
export const PORTRAIT_HERO_SECONDS = 2.6

const frames = (seconds: number, fps: number): number => Math.round(seconds * fps)

/** Counts the frames the wide cut runs for: the six acts, then the closing card. */
export const SHOWCASE_FRAMES =
  SCENES.reduce((total, scene) => total + frames(scene.seconds, SHOWCASE_FPS), 0) + CLOSING_FRAMES

/** Counts the frames the hero loop runs for. */
export const HERO_FRAMES = HERO_SCENES.length * HERO_SCENE_SECONDS * HERO_FPS

/** Counts the frames a portrait cut runs for: a card and an act each, then the closing card. */
function portraitFrames(scenes: readonly Scene[], seconds: (scene: Scene) => number): number {
  const card = frames(CARD_SECONDS, SHOWCASE_FPS)
  return scenes.reduce((total, scene) => total + card + frames(seconds(scene), SHOWCASE_FPS), 0)
}

export const PORTRAIT_FRAMES =
  portraitFrames(SCENES, (scene) => scene.portrait.seconds) + CLOSING_FRAMES

export const PORTRAIT_HERO_FRAMES = portraitFrames(HERO_SCENES, () => PORTRAIT_HERO_SECONDS)

/** The wide cut: every act in the order the app pages through them, then the closing card. */
export function Showcase() {
  return (
    <Series>
      {SCENES.map((scene) => (
        <Series.Sequence key={scene.id} durationInFrames={frames(scene.seconds, SHOWCASE_FPS)}>
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

interface PortraitProps {
  scenes: readonly Scene[]
  /** How long each act stands, which the hero cuts shorter than the full run. */
  seconds: (scene: Scene) => number
  closing?: boolean
}

/**
 * The portrait cut: a card that names an act, then the act filling the frame, and so on.
 *
 * Nothing is written over a scene, because the phone's own HUD already carries every number the
 * card's line refers to.
 */
function Portrait({ scenes, seconds, closing = false }: PortraitProps) {
  return (
    <Series>
      {scenes.flatMap((scene) => [
        <Series.Sequence
          key={`${scene.id}-card`}
          durationInFrames={frames(CARD_SECONDS, SHOWCASE_FPS)}
        >
          <Card scene={scene} />
        </Series.Sequence>,
        <Series.Sequence key={scene.id} durationInFrames={frames(seconds(scene), SHOWCASE_FPS)}>
          <PortraitScene scene={scene} window={{ ...scene.portrait, seconds: seconds(scene) }} />
        </Series.Sequence>,
      ])}
      {closing ? (
        <Series.Sequence durationInFrames={CLOSING_FRAMES}>
          <Closing />
        </Series.Sequence>
      ) : null}
    </Series>
  )
}

/** The portrait cut the README's side column plays. */
export function ShowcasePortrait() {
  return <Portrait scenes={SCENES} seconds={(scene) => scene.portrait.seconds} closing />
}

/** The portrait loop: the same three acts the wide hero plays, with their cards. */
export function ShowcasePortraitHero() {
  return <Portrait scenes={HERO_SCENES} seconds={() => PORTRAIT_HERO_SECONDS} />
}
