import { describe, expect, mock, test } from 'bun:test'
import { H3Error } from '../src/H3Error'

/** Records the arguments the wrapper hands the native method, so their shape can be asserted. */
const calls: unknown[][] = []

// the HybridObject cannot exist off-device, so the module that creates it is replaced wholesale.
mock.module('../src/native', () => ({
  native: {
    greatCircleDistanceKm: (...args: unknown[]) => {
      calls.push(args)
      return 1
    },
    greatCircleDistanceM: (...args: unknown[]) => {
      calls.push(args)
      return 1
    },
    greatCircleDistanceRads: (...args: unknown[]) => {
      calls.push(args)
      return 1
    },
  },
}))

describe('greatCircleDistance', () => {
  test('unpacks the two pairs into the four scalars the native method takes, in every unit', async () => {
    const measurement = await import('../src/measurement')
    const functions = [
      measurement.greatCircleDistanceKm,
      measurement.greatCircleDistanceM,
      measurement.greatCircleDistanceRads,
    ]
    // asymmetric coordinates, so a transposed argument would change the recorded row
    for (const distance of functions) {
      calls.length = 0
      distance([37.7749, -122.4194], [51.5074, -0.1278])
      expect(calls).toEqual([[37.7749, -122.4194, 51.5074, -0.1278]])
    }
  })

  test('refuses an argument that is not a pair, in every unit', async () => {
    const measurement = await import('../src/measurement')
    const functions = [
      measurement.greatCircleDistanceKm,
      measurement.greatCircleDistanceM,
      measurement.greatCircleDistanceRads,
    ]
    for (const distance of functions) {
      calls.length = 0
      let thrown: unknown
      try {
        distance([0, 0, 0] as unknown as [number, number], [1, 1])
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(H3Error)
      expect((thrown as H3Error).message).toBe(
        'Each coordinate must be a [latitude, longitude] pair',
      )
      // the package refused the input itself, so there is no H3 code to report
      expect((thrown as H3Error).code).toBeUndefined()
      expect(calls).toEqual([])
    }
  })

  test('refuses a non-number, a NaN, an infinity and a missing element', async () => {
    const { greatCircleDistanceKm } = await import('../src/measurement')
    const bad: unknown[] = [
      ['0', 0],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
      [0],
      [],
      null,
      { lat: 0, lng: 0 },
    ]
    for (const argument of bad) {
      calls.length = 0
      expect(() => greatCircleDistanceKm(argument as [number, number], [1, 1])).toThrow(H3Error)
      expect(() => greatCircleDistanceKm([1, 1], argument as [number, number])).toThrow(H3Error)
      expect(calls).toEqual([])
    }
  })
})
