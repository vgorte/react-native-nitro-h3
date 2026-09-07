import { Composition } from 'remotion'
import './fonts'
import {
  HERO_FPS,
  HERO_FRAMES,
  PORTRAIT_FRAMES,
  PORTRAIT_HERO_FRAMES,
  SHOWCASE_FPS,
  SHOWCASE_FRAMES,
  Showcase,
  ShowcaseHero,
  ShowcasePortrait,
  ShowcasePortraitHero,
} from './Showcase'
import { PHONE_ASPECT } from './scenes/ActScene'

/** The portrait frame, which is the take's own aspect at the width the README column wants. */
const PORTRAIT_WIDTH = 1080
const PORTRAIT_HEIGHT = Math.round(PORTRAIT_WIDTH / PHONE_ASPECT)

/** Registers the four cuts: the wide video and loop, and the portrait video and loop. */
export function Root() {
  return (
    <>
      <Composition
        id="Showcase"
        component={Showcase}
        durationInFrames={SHOWCASE_FRAMES}
        fps={SHOWCASE_FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="ShowcaseHero"
        component={ShowcaseHero}
        durationInFrames={HERO_FRAMES}
        fps={HERO_FPS}
        width={1280}
        height={720}
      />
      <Composition
        id="ShowcasePortrait"
        component={ShowcasePortrait}
        durationInFrames={PORTRAIT_FRAMES}
        fps={SHOWCASE_FPS}
        width={PORTRAIT_WIDTH}
        height={PORTRAIT_HEIGHT}
      />
      <Composition
        id="ShowcasePortraitHero"
        component={ShowcasePortraitHero}
        durationInFrames={PORTRAIT_HERO_FRAMES}
        fps={SHOWCASE_FPS}
        width={PORTRAIT_WIDTH}
        height={PORTRAIT_HEIGHT}
      />
    </>
  )
}
