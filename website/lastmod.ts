import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { SitemapItem } from '@astrojs/sitemap'
import { BASE, PAGES, SITE } from './pages'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ORIGIN = `${SITE}${BASE}`
// The landing is not a `PAGES` entry; its copy lives in the route file and in the hero component.
const HOME_SOURCES = ['website/src/content/docs/index.mdx', 'website/src/components/Hero.astro']

/** Returns the repository-relative sources behind a route, with leading and trailing slash. */
export function sourcesOf(route: string): string[] {
  if (route === '/') return HOME_SOURCES
  const page = PAGES.find((entry) => entry.route === route)
  if (!page) throw new Error(`no page for route ${route} (${ORIGIN}${route})`)
  return [page.source]
}

/**
 * Returns the newest commit date across the given paths, or `undefined` when git reports none.
 *
 * An untracked path and a shallow clone both answer empty, and no date at all beats a wrong one.
 */
export function lastCommitDate(paths: string[]): Date | undefined {
  const times = paths
    .map((path) =>
      execFileSync('git', ['log', '-1', '--format=%cI', '--', path], {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim(),
    )
    .filter((date) => date !== '')
    .map((date) => new Date(date).getTime())
  return times.length === 0 ? undefined : new Date(Math.max(...times))
}

/** Stamps one sitemap entry with the last commit date of its sources. Throws on an unknown URL. */
export function serializeSitemapItem(item: SitemapItem): SitemapItem {
  if (!item.url.startsWith(ORIGIN)) throw new Error(`sitemap URL outside ${ORIGIN}: ${item.url}`)
  const lastmod = lastCommitDate(sourcesOf(item.url.slice(ORIGIN.length)))
  return lastmod ? { ...item, lastmod: lastmod.toISOString() } : item
}
