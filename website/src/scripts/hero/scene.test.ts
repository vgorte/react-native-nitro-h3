import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MODE_QUERY } from './scene'

const source = (path: string): string => readFileSync(join(import.meta.dir, '../..', path), 'utf8')

describe('MODE_QUERY', () => {
  test('is the string the pre-paint script and the stylesheet carry', () => {
    expect(source('components/Hero.astro')).toContain(MODE_QUERY)
    expect(source('styles/custom.css')).toContain(MODE_QUERY)
  })
})
