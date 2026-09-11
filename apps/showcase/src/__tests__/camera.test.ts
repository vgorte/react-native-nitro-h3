import { describe, expect, test } from 'bun:test'
import { DEG_TO_RAD, EARTH_RADIUS_M, mercatorY, metresPerPixel } from '../engine/projection'
import { fitTo, sceneToLatLng, sceneViewport, screenToScene, zoomForScale } from '../render/camera'

describe('screenToScene', () => {
  test('inverts the camera transform', () => {
    const camera = { translateX: 40, translateY: -20, scale: 2.5 }

    const scene = screenToScene(140, 80, camera)

    expect(scene.x).toBeCloseTo(40, 9)
    expect(scene.y).toBeCloseTo(40, 9)
  })
})

describe('sceneViewport', () => {
  test('spans the screen corners in scene units', () => {
    const camera = { translateX: 40, translateY: -20, scale: 2.5 }

    const rect = sceneViewport(400, 800, camera)
    const corner = screenToScene(400, 800, camera)

    expect(rect.x).toBeCloseTo(-16, 9)
    expect(rect.y).toBeCloseTo(8, 9)
    expect(rect.x + rect.width).toBeCloseTo(corner.x, 9)
    expect(rect.y + rect.height).toBeCloseTo(corner.y, 9)
  })
})

describe('sceneToLatLng', () => {
  test('answers the anchor at the scene origin', () => {
    const anchor = { lat: 52.52, lng: 13.405 }

    const centre = sceneToLatLng(0, 0, anchor)

    expect(centre.lat).toBeCloseTo(anchor.lat, 9)
    expect(centre.lng).toBeCloseTo(anchor.lng, 9)
  })

  test('reads x eastward and y southward', () => {
    const anchor = { lat: 0, lng: 0 }

    const east = sceneToLatLng(EARTH_RADIUS_M * DEG_TO_RAD, 0, anchor)
    const north = sceneToLatLng(0, -mercatorY(1), anchor)

    expect(east.lng).toBeCloseTo(1, 9)
    expect(east.lat).toBeCloseTo(0, 9)
    expect(north.lat).toBeCloseTo(1, 9)
  })
})

describe('zoomForScale', () => {
  test('answers the zoom whose pixel spans the same ground metres', () => {
    const lat = 52.52
    const scale = 0.004

    const zoom = zoomForScale(scale, lat)

    expect(metresPerPixel(zoom, lat)).toBeCloseTo(Math.cos(lat * DEG_TO_RAD) / scale, 9)
  })
})

describe('fitTo', () => {
  test('centres the bounds and leaves a tenth of the viewport free', () => {
    const bounds = { minX: 100, minY: -50, maxX: 300, maxY: 50 }

    const fit = fitTo(bounds, 400, 400)

    expect(fit.scale).toBeCloseTo(1.8, 9)
    expect(fit.translateX).toBeCloseTo(-160, 9)
    expect(fit.translateY).toBeCloseTo(200, 9)
  })
})
