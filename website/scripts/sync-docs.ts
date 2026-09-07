import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, EXCLUDED, PAGES, type Page, REPO } from '../pages'

const WEBSITE = dirname(dirname(fileURLToPath(import.meta.url)))
const ROOT = dirname(WEBSITE)
const CONTENT = join(WEBSITE, 'src', 'content', 'docs')
// Leading whitespace is allowed so a fence indented inside a list item toggles the state as well.
const FENCE = /^\s*(```|~~~)/
const STEPS_OPEN = '<!-- steps -->'
const STEPS_CLOSE = '<!-- /steps -->'
const TABS_OPEN = '<!-- tabs -->'
const TABS_CLOSE = '<!-- /tabs -->'
const TAB = /^<!-- tab:(.*)-->$/
// The tag lines this script emits; every other `<` outside code is a JSX error in MDX.
const EMITTED_TAG =
  /^(?:<\/?Steps>|<Tabs syncKey="package-manager">|<\/Tabs>|<TabItem label="[^"]*">|<\/TabItem>)$/

/** Returns the H1 text and the body without it. Exactly one H1 outside fenced blocks is required. */
export function splitTitle(markdown: string): { title: string; body: string } {
  const lines = markdown.split('\n')
  let inFence = false
  let title = ''
  let titleIndex = -1
  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) inFence = !inFence
    if (inFence || !line.startsWith('# ')) continue
    if (titleIndex !== -1) throw new Error(`second H1 at line ${index + 1}: ${line}`)
    title = line.slice(2).trim()
    titleIndex = index
  }
  if (titleIndex === -1) throw new Error('no H1 found')
  const rest = lines.filter((_, index) => index !== titleIndex)
  // The H1 is followed by one blank line in every source; drop it so the body starts on content.
  if (rest[titleIndex] === '') rest.splice(titleIndex, 1)
  return { title, body: rest.join('\n') }
}

/** Drops one leading emoji (with its variation selector) and the space after it. */
export function stripLeadingEmoji(title: string): string {
  return title.replace(/^(?:\p{Extended_Pictographic}|\u{FE0F}|\u{200D})+\s*/u, '')
}

/**
 * Drops the leading emoji from every Markdown heading outside fenced blocks. The GitHub copies keep
 * theirs; on the site the heading, its anchor and the table of contents read without one.
 */
export function stripHeadingEmoji(body: string): string {
  let inFence = false
  return body
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) inFence = !inFence
      if (inFence) return line
      return line.replace(/^(#{1,6} )(.*)$/, (_, hashes: string, text: string) => {
        return `${hashes}${stripLeadingEmoji(text)}`
      })
    })
    .join('\n')
}

/** Returns the offsets of the `{ … }` block that opens at or after `from`. */
function blockAt(text: string, from: number): { open: number; close: number } {
  const open = text.indexOf('{', from)
  if (open === -1) throw new Error('a prefers-color-scheme block is never closed')
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return { open, close: i }
    }
  }
  throw new Error('a prefers-color-scheme block is never closed')
}

/**
 * Flattens a chart's dark rules into its base rules. Inside an `<img>` a `prefers-color-scheme`
 * query follows the operating system, not the site theme, so on a dark-only site the block has to
 * go. The declarations keep their source position after the base rules, so they still win.
 */
export function forceDarkSvg(svg: string): string {
  if (!svg.includes('@media (prefers-color-scheme:')) return svg
  let out = svg
  const light = out.indexOf('@media (prefers-color-scheme: light)')
  if (light !== -1) {
    const { close } = blockAt(out, light)
    out = out.slice(0, light) + out.slice(close + 1).replace(/^\n/, '')
  }
  const dark = out.indexOf('@media (prefers-color-scheme: dark)')
  if (dark !== -1) {
    const { open, close } = blockAt(out, dark)
    const inner = out
      .slice(open + 1, close)
      .replace(/^\n/, '')
      .replace(/\n$/, '')
    out = out.slice(0, dark) + inner + out.slice(close + 1)
  }
  return out
}

/**
 * Rewrites every relative link and image to a base-prefixed route or public path. Astro emits
 * Markdown links verbatim, so a `./x.md` link would 404 on the site.
 */
export function rewriteLinks(body: string, page: Page, base: string): string {
  const sourceDir = posix.dirname(page.source)
  const routes = new Map(PAGES.map((entry) => [entry.source, entry.route]))
  const rewrite = (target: string): string => {
    if (/^(https?:|mailto:|#)/.test(target)) return target
    const [path, anchor] = target.split('#', 2)
    const suffix = anchor ? `#${anchor}` : ''
    const repoPath = posix.normalize(posix.join(sourceDir, path ?? ''))
    if (repoPath.startsWith('img/')) return `${base}/${repoPath}`
    const route = routes.get(repoPath)
    if (route) return `${base}${route}${suffix}`
    return `${REPO}/blob/main/${repoPath}${suffix}`
  }
  // Fenced blocks are skipped line by line, so a link-shaped string in code stays as written.
  let inFence = false
  return body
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) inFence = !inFence
      if (inFence) return line
      return line.replace(/\]\(([^)\s]+)\)/g, (_, target: string) => `](${rewrite(target)})`)
    })
    .join('\n')
}

/**
 * Replaces the `<!-- steps -->` and `<!-- /steps -->` markers with `<Steps>` and `</Steps>`.
 * Both markers sit on their own line around a single ordered list, carry no attributes and never
 * nest; GitHub hides them, so the same list stays a plain list there.
 */
export function stepsToMdx(body: string): string {
  let inFence = false
  let openedAt = 0
  const lines = body.split('\n').map((line, index) => {
    if (FENCE.test(line)) inFence = !inFence
    if (inFence) return line
    const trimmed = line.trim()
    if (trimmed === STEPS_OPEN) {
      if (openedAt !== 0)
        throw new Error(
          `line ${index + 1}: ${STEPS_OPEN} inside the block opened on line ${openedAt}`,
        )
      openedAt = index + 1
      return '<Steps>'
    }
    if (trimmed === STEPS_CLOSE) {
      if (openedAt === 0) throw new Error(`line ${index + 1}: ${STEPS_CLOSE} without ${STEPS_OPEN}`)
      openedAt = 0
      return '</Steps>'
    }
    // A tab boundary inside a step list would split the list across two components.
    if (openedAt !== 0 && (trimmed.startsWith('<Tabs') || trimmed.startsWith('<TabItem')))
      throw new Error(
        `line ${index + 1}: a tabs block inside the ${STEPS_OPEN} block opened on line ${openedAt}`,
      )
    return line
  })
  if (openedAt !== 0) throw new Error(`line ${openedAt}: unclosed ${STEPS_OPEN}`)
  return lines.join('\n')
}

/** Returns whether an opening `<!-- steps -->` marker appears outside every fenced block. */
export function hasSteps(body: string): boolean {
  let inFence = false
  return body.split('\n').some((line) => {
    if (FENCE.test(line)) inFence = !inFence
    return !inFence && line.trim() === STEPS_OPEN
  })
}

/**
 * Replaces the tabs markers with a `<Tabs>` block whose tabs sync on `package-manager`.
 * A block opens with `<!-- tabs -->`, every `<!-- tab: LABEL -->` opens a tab and closes the
 * previous one, and `<!-- /tabs -->` closes the last tab and the block; GitHub hides all three.
 */
export function tabsToMdx(body: string): string {
  let inFence = false
  let openedAt = 0
  let tabOpen = false
  const lines: string[] = []
  for (const [index, line] of body.split('\n').entries()) {
    if (FENCE.test(line)) inFence = !inFence
    const trimmed = inFence ? '' : line.trim()
    if (trimmed === TABS_OPEN) {
      if (openedAt !== 0)
        throw new Error(
          `line ${index + 1}: ${TABS_OPEN} inside the block opened on line ${openedAt}`,
        )
      openedAt = index + 1
      lines.push('<Tabs syncKey="package-manager">')
      continue
    }
    if (trimmed === TABS_CLOSE) {
      if (openedAt === 0) throw new Error(`line ${index + 1}: ${TABS_CLOSE} without ${TABS_OPEN}`)
      if (!tabOpen) throw new Error(`line ${openedAt}: ${TABS_OPEN} block without a tab`)
      openedAt = 0
      tabOpen = false
      lines.push('</TabItem>', '</Tabs>')
      continue
    }
    const tab = TAB.exec(trimmed)
    if (tab) {
      if (openedAt === 0)
        throw new Error(`line ${index + 1}: ${trimmed} outside a ${TABS_OPEN} block`)
      if (tabOpen) lines.push('</TabItem>')
      tabOpen = true
      lines.push(`<TabItem label="${tab[1]?.trim() ?? ''}">`)
      continue
    }
    lines.push(line)
  }
  if (openedAt !== 0) throw new Error(`line ${openedAt}: unclosed ${TABS_OPEN}`)
  return lines.join('\n')
}

/** Returns whether an opening `<!-- tabs -->` marker appears outside every fenced block. */
export function hasTabs(body: string): boolean {
  let inFence = false
  return body.split('\n').some((line) => {
    if (FENCE.test(line)) inFence = !inFence
    return !inFence && line.trim() === TABS_OPEN
  })
}

/**
 * Throws when a page that becomes MDX carries a `{`, `}` or `<` that MDX would read as JSX.
 * Fenced blocks, inline code spans and the tag lines this script emits are exempt.
 */
export function mdxGuard(body: string, source: string): void {
  let inFence = false
  for (const [index, line] of body.split('\n').entries()) {
    if (FENCE.test(line)) inFence = !inFence
    if (inFence) continue
    if (EMITTED_TAG.test(line.trim())) continue
    const jsx = line.replace(/(`+)[^`]*?\1/g, '').match(/[{}<]/)
    if (jsx) throw new Error(`${source}:${index + 1}: "${jsx[0]}" outside code is JSX in MDX`)
  }
}

/** Writes the YAML block Starlight needs. Values go through `JSON.stringify`, which is valid YAML. */
export function frontmatter(page: Page, title: string, lastUpdated: string | null): string {
  const lines = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(page.description)}`,
  ]
  if (page.generated) {
    lines.push('editUrl: false', 'tableOfContents:', '  minHeadingLevel: 2', '  maxHeadingLevel: 2')
  } else {
    lines.push(`editUrl: ${JSON.stringify(`${REPO}/edit/main/${page.source}`)}`)
  }
  if (lastUpdated) lines.push(`lastUpdated: ${lastUpdated}`)
  lines.push('---', '')
  return lines.join('\n')
}

/**
 * Returns the frontmatter followed by the rewritten body, and the extension the page needs.
 * A page with steps or tabs markers turns into MDX, which needs the Starlight import and rules
 * out stray JSX characters in the prose.
 */
export function transform(
  markdown: string,
  page: Page,
  base: string,
  lastUpdated: string | null,
): { content: string; extension: 'md' | 'mdx' } {
  const alert = markdown.match(/^> \[!\w+\]/m)
  if (alert) throw new Error(`${page.source} uses ${alert[0]}, which Starlight renders literally`)
  const { title, body } = splitTitle(markdown)
  const rewritten = stripHeadingEmoji(rewriteLinks(body, page, base))
  const head = frontmatter(page, stripLeadingEmoji(title), lastUpdated)
  const steps = hasSteps(rewritten)
  const tabs = hasTabs(rewritten)
  if (!steps && !tabs) return { content: `${head}\n${rewritten}`, extension: 'md' }
  // Tabs run first so the steps pass sees the emitted tag lines and can reject a nested block.
  const converted = stepsToMdx(tabsToMdx(rewritten))
  mdxGuard(converted, page.source)
  const used = [...(steps ? ['Steps'] : []), ...(tabs ? ['TabItem', 'Tabs'] : [])]
  const line = `import { ${used.join(', ')} } from '@astrojs/starlight/components'`
  return { content: `${head}\n${line}\n\n${converted}`, extension: 'mdx' }
}

function lastCommitDate(source: string): string | null {
  const result = Bun.spawnSync(['git', 'log', '-1', '--format=%cI', '--', source], { cwd: ROOT })
  const date = result.stdout.toString().trim()
  return date === '' ? null : date
}

/**
 * Returns the files that are neither a mapped `source` nor excluded. A trailing-slash entry in
 * `excluded` matches by prefix, every other entry by equality.
 */
export function unmapped(
  files: readonly string[],
  pages: readonly Page[],
  excluded: readonly string[],
): string[] {
  const mapped = new Set(pages.map((page) => page.source))
  const isExcluded = (file: string): boolean =>
    excluded.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry))
  return files.filter((file) => !mapped.has(file) && !isExcluded(file))
}

async function main() {
  // The gate runs first so a docs file nobody mapped leaves the generated tree as it was.
  const files: string[] = []
  for await (const file of new Bun.Glob('docs/**/*.md').scan({ cwd: ROOT })) files.push(file)
  const missing = unmapped(files, PAGES, EXCLUDED)
  if (missing.length > 0) {
    throw new Error(`not mapped in website/pages.ts and not excluded: ${missing.join(', ')}`)
  }

  await mkdir(CONTENT, { recursive: true })
  // The landing page is written by hand and lives in the same tree, so only generated pages go.
  for (const entry of await readdir(CONTENT)) {
    if (entry !== 'index.mdx') await rm(join(CONTENT, entry), { recursive: true, force: true })
  }
  for (const page of PAGES) {
    const sourcePath = join(ROOT, page.source)
    if (!existsSync(sourcePath)) throw new Error(`${page.source} does not exist`)
    const markdown = await readFile(sourcePath, 'utf8')
    const { content, extension } = transform(markdown, page, BASE, lastCommitDate(page.source))
    const out = join(CONTENT, `${page.route.replace(/^\/|\/$/g, '')}.${extension}`)
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, content)
  }

  await mkdir(join(WEBSITE, 'public', 'img'), { recursive: true })
  await mkdir(join(WEBSITE, 'src', 'assets'), { recursive: true })
  // Everything under `img/` ships, so a page that references a new chart needs no change here.
  for (const entry of await readdir(join(ROOT, 'img'), { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const from = join(ROOT, 'img', entry.name)
    const to = join(WEBSITE, 'public', 'img', entry.name)
    if (!entry.name.endsWith('.svg')) {
      await copyFile(from, to)
      continue
    }
    const svg = await readFile(from, 'utf8')
    let dark: string
    try {
      dark = forceDarkSvg(svg)
    } catch (error) {
      throw new Error(`img/${entry.name}: ${error instanceof Error ? error.message : error}`)
    }
    await writeFile(to, dark)
  }
  await copyFile(
    join(ROOT, 'img', 'logo-tile.svg'),
    join(WEBSITE, 'src', 'assets', 'logo-tile.svg'),
  )
  await copyFile(join(ROOT, 'img', 'logo-tile.svg'), join(WEBSITE, 'public', 'favicon.svg'))

  console.log(`synced ${PAGES.length} pages into ${CONTENT}`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
