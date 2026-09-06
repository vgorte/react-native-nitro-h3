import { ImageSource, Layer, type RasterLayerSpecification } from '@maplibre/maplibre-react-native'
import { ImageFormat, type SkCanvas, Skia } from '@shopify/react-native-skia'
import { File, Paths } from 'expo-file-system'
import { useEffect, useRef, useState } from 'react'
import { cornersOf, type ImageFrame } from '../engine/imageLayer'

/** Holds what the map carries: the file the image was written to and the ground it covers. */
interface Carried {
  url: string
  coordinates: ReturnType<typeof cornersOf>
}

/** Holds one finished image: where it was written and what drawing and encoding it took. */
interface Rendered {
  url: string
  ms: number
}

/** Configures {@linkcode SceneImage}. */
export interface SceneImageProps {
  /** Identifies the source and its layer on the map; MapLibre freezes it at the first render. */
  id: string
  /** The image to draw, which a settle answers from the ground the map stands over. */
  frame: ImageFrame
  /**
   * Draws the scene into the offscreen canvas, which stands in the frame's own pixels.
   *
   * A new function is a new image, so the act hands in one that changes exactly when the scene
   * does.
   */
  draw: (canvas: SkCanvas) => void
  /** Reports what the offscreen draw, the encode and the write took, in milliseconds. */
  onRendered: (ms: number) => void
  /** Reports a render that answered no image, so the act says so rather than losing its tree. */
  onFailed: (reason: string) => void
}

// the counter stands outside the component, so a remount never writes over a url the map has seen
let renders = 0

/**
 * Files kept on disk, so the map is never handed a url whose file the next render has removed.
 *
 * The map reads the url through its own file source and off the JS thread, so every file kept is
 * one redraw interval of grace it has to finish in.
 */
const KEPT_FILES = 4

const RASTER: NonNullable<RasterLayerSpecification['paint']> = {
  // the image is the act's own scene, which has no business fading in over the one it replaces
  'raster-fade-duration': 0,
}

/** Removes a written image, and says nothing where it has already gone. */
function discard(url: string): void {
  try {
    new File(url).delete()
  } catch {
    // a file the system has already reclaimed out of the cache directory needs no removal
  }
}

/**
 * Draws the scene into an offscreen surface and writes it out as a PNG the map can carry.
 *
 * MapLibre reads an `ImageSource` through its own file source, which takes a `file://` url and not
 * a `data:` one, so the encoded bytes go to the cache directory under a name of their own; a url
 * the map has seen before would be served from its cache rather than read again.
 */
function renderScene(frame: ImageFrame, draw: (canvas: SkCanvas) => void, name: string): Rendered {
  const started = performance.now()
  const surface = Skia.Surface.MakeOffscreen(frame.width, frame.height)
  if (surface === null) throw new Error(`no offscreen surface of ${frame.width}x${frame.height}`)

  let bytes: Uint8Array
  try {
    const canvas = surface.getCanvas()
    canvas.clear(Skia.Color('#00000000'))
    draw(canvas)
    surface.flush()

    const snapshot = surface.makeImageSnapshot()
    // the encoder cannot read a texture from the offscreen context
    const image = snapshot.makeNonTextureImage() ?? snapshot
    bytes = image.encodeToBytes(ImageFormat.PNG)
    if (image !== snapshot) snapshot.dispose()
    image.dispose()
  } finally {
    // a draw that throws leaves the surface behind otherwise, which is the heaviest handle here
    surface.dispose()
  }

  const file = new File(Paths.cache, name)
  file.create({ overwrite: true })
  file.write(bytes)
  return { url: file.uri, ms: performance.now() - started }
}

/**
 * Carries an act's Skia scene on a MapLibre map, the way a canvas layer rides a web map.
 *
 * The scene is drawn offscreen into the frame a settle answered, written out and handed to the map
 * as a georeferenced image; pinch and pan then warp that image natively, and the next settle
 * replaces it. The standing image keeps the map until the new one has been written, so nothing
 * ever flashes empty.
 */
export function SceneImage({ id, frame, draw, onRendered, onFailed }: SceneImageProps) {
  const [carried, setCarried] = useState<Carried | null>(null)
  // the written files, oldest first, which the component owns for as long as it stands
  const written = useRef<string[]>([])
  const report = useRef({ onRendered, onFailed })

  useEffect(() => {
    report.current = { onRendered, onFailed }
  }, [onRendered, onFailed])

  useEffect(() => {
    renders += 1
    let rendered: Rendered
    try {
      rendered = renderScene(frame, draw, `${id}-${renders}.png`)
    } catch (error: unknown) {
      // a surface that cannot be made or a file that cannot be written leaves the map its last
      // image, which is a stale scene rather than an act that has fallen over
      report.current.onFailed(error instanceof Error ? error.message : 'no image')
      return
    }
    written.current.push(rendered.url)
    while (written.current.length > KEPT_FILES) {
      const stale = written.current.shift()
      if (stale !== undefined) discard(stale)
    }
    setCarried({ url: rendered.url, coordinates: cornersOf(frame) })
    report.current.onRendered(rendered.ms)
  }, [id, frame, draw])

  // an act taken off the pager leaves nothing of its own behind in the cache directory
  useEffect(() => {
    const files = written
    return () => {
      for (const url of files.current) discard(url)
      files.current = []
    }
  }, [])

  if (carried === null) return null
  return (
    <ImageSource id={id} url={carried.url} coordinates={carried.coordinates}>
      <Layer id={`${id}-raster`} type="raster" paint={RASTER} />
    </ImageSource>
  )
}
