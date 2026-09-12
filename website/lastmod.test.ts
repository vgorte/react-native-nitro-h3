import { describe, expect, test } from 'bun:test'
import { lastCommitDate, serializeSitemapItem, sourcesOf } from './lastmod'
import { BASE, SITE } from './pages'

const origin = `${SITE}${BASE}`

describe('sourcesOf', () => {
  test('gives the landing both of its sources', () => {
    expect(sourcesOf('/')).toEqual([
      'website/src/content/docs/index.mdx',
      'website/src/components/Hero.astro',
    ])
  })

  test('gives a page its Markdown source', () => {
    expect(sourcesOf('/performance/')).toEqual(['docs/performance.md'])
    expect(sourcesOf('/api/')).toEqual(['packages/react-native-nitro-h3/docs/api.md'])
  })

  test('throws on a route the page table does not carry', () => {
    expect(() => sourcesOf('/stray/')).toThrow(/no page for route \/stray\//)
  })
})

describe('lastCommitDate', () => {
  test('returns a date for a tracked path', () => {
    const date = lastCommitDate(['docs/performance.md'])
    expect(date).toBeInstanceOf(Date)
    expect(Number.isNaN(date?.getTime())).toBe(false)
  })

  test('returns the newest date across several paths', () => {
    const both = lastCommitDate(['docs/performance.md', 'docs/benchmark.md'])
    const single = [
      lastCommitDate(['docs/performance.md']),
      lastCommitDate(['docs/benchmark.md']),
    ].map((date) => date?.getTime() ?? 0)
    expect(both?.getTime()).toBe(Math.max(...single))
  })

  test('returns undefined for a path git does not know', () => {
    expect(lastCommitDate(['docs/no-such-file.md'])).toBeUndefined()
  })

  test('returns undefined without a path', () => {
    expect(lastCommitDate([])).toBeUndefined()
  })
})

describe('serializeSitemapItem', () => {
  test('stamps a page with an ISO date', () => {
    const item = serializeSitemapItem({ url: `${origin}/performance/` })
    expect(item.lastmod).toBe(lastCommitDate(['docs/performance.md'])?.toISOString())
  })

  test('stamps the landing', () => {
    expect(serializeSitemapItem({ url: `${origin}/` }).lastmod).toBe(
      lastCommitDate(sourcesOf('/'))?.toISOString(),
    )
  })

  test('throws on an unknown URL', () => {
    expect(() => serializeSitemapItem({ url: `${origin}/stray/` })).toThrow(/\/stray\//)
    expect(() => serializeSitemapItem({ url: 'https://example.com/x/' })).toThrow(/outside/)
  })
})
