import { describe, expect, test } from 'bun:test'
import type { Rect } from './geometry'
import { buildSignature } from './render'

const column: Rect = { left: -120, top: 280.3, right: 477.3, bottom: 589.4 }

describe('buildSignature', () => {
  test('is stable for the same box, so a repeated trigger rebuilds nothing', () => {
    expect(buildSignature('desk', 1440, 810, 1, column)).toBe(
      buildSignature('desk', 1440, 810, 1, { ...column }),
    )
  })

  test('absorbs a sub-pixel box change and reports every whole pixel one', () => {
    const base = buildSignature('desk', 1440, 810, 1, column)
    expect(buildSignature('desk', 1440.4, 810.2, 1, column)).toBe(base)
    expect(buildSignature('desk', 1441, 810, 1, column)).not.toBe(base)
    expect(buildSignature('desk', 1440, 811, 1, column)).not.toBe(base)
  })

  test('changes with the mode, the device ratio and the keep-out column', () => {
    const base = buildSignature('desk', 1440, 810, 1, column)
    expect(buildSignature('mob', 1440, 810, 1, column)).not.toBe(base)
    expect(buildSignature('desk', 1440, 810, 2, column)).not.toBe(base)
    for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
      const moved = { ...column, [edge]: column[edge] + 2 }
      expect(buildSignature('desk', 1440, 810, 1, moved)).not.toBe(base)
    }
  })

  test('a missing column is its own state', () => {
    expect(buildSignature('desk', 1440, 810, 1, null)).not.toBe(
      buildSignature('desk', 1440, 810, 1, column),
    )
  })
})
