import { describe, expect, test } from 'bun:test'
import { numberLine } from '../scenes/numberLine'
import { readingAt } from '../scenes/reading'
import { SCENES } from '../scenes/scenes'

function sceneOf(id: string) {
  const scene = SCENES.find((candidate) => candidate.id === id)
  if (scene === undefined) throw new Error(`no scene ${id}`)
  return scene
}

describe('numberLine', () => {
  test('a line of words alone carries no number', () => {
    const fractal = sceneOf('fractal')
    const line = numberLine(fractal, readingAt(fractal, 1))
    expect(line.number).toBe('')
    expect(line.suffix).toBe('')
    expect(line.unit).toBe('Recursive splitting')
  })

  test('a claim keeps its lead in front of the number', () => {
    const engine = sceneOf('engine')
    const line = numberLine(engine, readingAt(engine, 1))
    expect(line.lead).toBe('up to ')
    expect(line.number).toBe('755.2')
    expect(line.suffix).toBe('×')
    expect(line.unit).toBe('faster')
  })

  test('a factor is written the way the panel writes it, ungrouped', () => {
    const engine = sceneOf('engine')
    const key = engine.keys[0]
    expect(numberLine(engine, readingAt(engine, key.at + 1)).number).toBe('1104.9')
  })

  test('a disk names the ring count it was walked at', () => {
    const grid = sceneOf('grid')
    expect(numberLine(grid, readingAt(grid, 0)).unit).toBe('cells at k=1')
    const last = grid.keys[grid.keys.length - 1]
    const closing = numberLine(grid, readingAt(grid, last.at + 1))
    expect(closing.number).toBe('7,651')
    expect(closing.unit).toBe('cells at k=50')
  })

  test('the switch renames what the heatmap counts', () => {
    const heatmap = sceneOf('heatmap')
    expect(numberLine(heatmap, readingAt(heatmap, 0)).unit).toBe('points placed')
    const after = numberLine(heatmap, readingAt(heatmap, heatmap.keys[0].at + 1))
    expect(after.number).toBe('547')
    expect(after.unit).toBe('cells from 1M points')
  })

  test('every act names a call and a headline', () => {
    for (const scene of SCENES) {
      expect(scene.headline.length).toBeGreaterThan(0)
      expect(scene.call.length).toBeGreaterThan(0)
    }
  })
})
