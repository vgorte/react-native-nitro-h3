import { describe, expect, mock, test } from 'bun:test'

/** Records the arguments the wrapper hands the native method, so their shape can be asserted. */
const calls: unknown[][] = []

// the HybridObject cannot exist off-device, so the module that creates it is replaced wholesale.
mock.module('../src/native', () => ({
  native: {
    localIjToCell: (...args: unknown[]) => {
      calls.push(args)
      return 0n
    },
  },
}))

describe('localIjToCell', () => {
  test('unpacks a CoordIJ into the two coordinates the native method takes', async () => {
    const { localIjToCell } = await import('../src/traversal')
    calls.length = 0
    localIjToCell(0x89283082803ffffn, { i: 1120, j: 616 })
    expect(calls).toEqual([[0x89283082803ffffn, 1120, 616]])
  })
})
