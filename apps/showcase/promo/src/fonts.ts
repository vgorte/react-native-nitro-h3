import { continueRender, delayRender, staticFile } from 'remotion'
import { fontFamily } from './theme'

const faces = [
  { family: fontFamily.light, file: 'fonts/InterTight-ExtraLight.ttf' },
  { family: fontFamily.regular, file: 'fonts/InterTight-Regular.ttf' },
]

// a frame drawn before the faces arrive would fall back to the system font, so the render waits
const handle = delayRender('loading Inter Tight')

Promise.all(
  faces.map(async ({ family, file }) => {
    const face = new FontFace(family, `url(${staticFile(file)}) format("truetype")`)
    await face.load()
    document.fonts.add(face)
  }),
)
  .then(() => continueRender(handle))
  .catch((error: unknown) => {
    throw error
  })
