import { Composition } from 'remotion'
import './fonts'
import { HERO_FRAMES, SHOWCASE_FRAMES, Showcase, ShowcaseHero } from './Showcase'

/** Registers the two cuts: the full video and the short loop the README autoplays. */
export function Root() {
  return (
    <>
      <Composition
        id="Showcase"
        component={Showcase}
        durationInFrames={SHOWCASE_FRAMES}
        fps={60}
        width={1920}
        height={1080}
      />
      <Composition
        id="ShowcaseHero"
        component={ShowcaseHero}
        durationInFrames={HERO_FRAMES}
        fps={30}
        width={1280}
        height={720}
      />
    </>
  )
}
