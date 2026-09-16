import { Series } from 'remotion'
import { ActScene } from './scenes/ActScene'
import { Card } from './scenes/Card'
import { Closing } from './scenes/Closing'
import { PortraitScene } from './scenes/PortraitScene'
import { HERO_SCENES, SCENES, type Scene, type Window } from './scenes/scenes'

/** The frame rate of the wide cut, which is the frame rate the takes were recorded at. */
export const SHOWCASE_FPS = 60

/** The frame rate of the hero loop, which a GIF is encoded down from anyway. */
export const HERO_FPS = 30

/** Frames the closing card stands for, at the wide cut's frame rate. */
export const CLOSING_FRAMES = 180

/** Seconds a portrait card stands before the act it names, long enough to read it twice. */
export const CARD_SECONDS = 2.5

const frames = (seconds: number, fps: number): number => Math.round(seconds * fps)

/** Counts the frames the wide cut runs for: the six acts, then the closing card. */
export const SHOWCASE_FRAMES =
  SCENES.reduce((total, scene) => total + frames(scene.seconds, SHOWCASE_FPS), 0) + CLOSING_FRAMES

/** Counts the frames the hero loop runs for, whose acts carry windows of their own. */
export const HERO_FRAMES = HERO_SCENES.reduce(
  (total, scene) => total + frames(scene.hero.seconds, HERO_FPS),
  0,
)

/** Counts the frames a portrait cut runs for: a card and an act each, then the closing card. */
function portraitFrames(
  scenes: readonly Scene[],
  card: number,
  seconds: (scene: Scene) => number,
): number {
  const held = frames(card, SHOWCASE_FPS)
  return scenes.reduce((total, scene) => total + held + frames(seconds(scene), SHOWCASE_FPS), 0)
}

export const PORTRAIT_FRAMES =
  portraitFrames(SCENES, CARD_SECONDS, (scene) => scene.portrait.seconds) + CLOSING_FRAMES

export const PORTRAIT_HERO_FRAMES = portraitFrames(
  HERO_SCENES,
  CARD_SECONDS,
  (scene) => scene.hero.seconds,
)

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

/** The hero loop: every act around its own interaction, the number line and nothing else. */
export function ShowcaseHero() {
  return (
    <Series>
      {HERO_SCENES.map((scene) => (
        <Series.Sequence key={scene.id} durationInFrames={frames(scene.hero.seconds, HERO_FPS)}>
          <ActScene scene={scene} hero />
        </Series.Sequence>
      ))}
    </Series>
  )
}

interface PortraitProps {
  scenes: readonly Scene[]
  /** The window each act plays, which the loop takes tighter than the full run. */
  window: (scene: Scene) => Window
  /** Seconds the card before an act stands for. */
  card: number
  closing?: boolean
}

/**
 * The portrait cut: a card that names an act, then the act filling the frame, and so on.
 *
 * Nothing is written over a scene, because the phone's own HUD already carries every number the
 * card's line refers to.
 */
function Portrait({ scenes, window, card, closing = false }: PortraitProps) {
  return (
    <Series>
      {scenes.flatMap((scene) => [
        <Series.Sequence key={`${scene.id}-card`} durationInFrames={frames(card, SHOWCASE_FPS)}>
          <Card scene={scene} />
        </Series.Sequence>,
        <Series.Sequence
          key={scene.id}
          durationInFrames={frames(window(scene).seconds, SHOWCASE_FPS)}
        >
          <PortraitScene scene={scene} window={window(scene)} />
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
  return <Portrait scenes={SCENES} window={(scene) => scene.portrait} card={CARD_SECONDS} closing />
}

/** The portrait loop: the same three acts the wide hero plays, with their cards. */
export function ShowcasePortraitHero() {
  return <Portrait scenes={HERO_SCENES} window={(scene) => scene.hero} card={CARD_SECONDS} />
}
