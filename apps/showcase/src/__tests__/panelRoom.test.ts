import { describe, expect, test } from 'bun:test'
import { bodyRoom, CLEARANCE, panelRoom } from '../render/hud/panelRoom'

describe('panelRoom', () => {
  test('leaves the clearance between the panel and the foot', () => {
    expect(panelRoom(874, 104, 277)).toBe(874 - 277 - CLEARANCE - 104)
  })

  test('shrinks as the thing at the foot grows', () => {
    expect(panelRoom(874, 104, 300)).toBeLessThan(panelRoom(874, 104, 200))
  })

  test('gives the panel the rest of the window while the foot is unmeasured', () => {
    expect(panelRoom(874, 104, 0)).toBe(758)
  })

  test('never answers a negative height', () => {
    expect(panelRoom(600, 500, 200)).toBe(0)
  })
})

describe('bodyRoom', () => {
  test('takes the panel glass and the head off the room', () => {
    expect(bodyRoom(481, 60)).toBe(481 - 26 - 60 - 8)
  })

  test('charges nothing for a head that has not been measured', () => {
    expect(bodyRoom(481, 0)).toBe(481 - 26)
  })

  test('never answers a negative height', () => {
    expect(bodyRoom(20, 60)).toBe(0)
  })
})
