/**
 * Generates `packages/react-native-nitro-h3/docs/api.md` from the package's public TypeScript sources.
 *
 * Every entry is rendered from the same JSDoc the editor shows, so the reference and the tooltips
 * cannot disagree. `src/index.ts` is the definition of public: a declaration the barrel does not
 * re-export never reaches the page.
 *
 * Usage:
 *   bun run docs:api           rewrite `packages/react-native-nitro-h3/docs/api.md`
 *   bun run docs:api --check   fail if `packages/react-native-nitro-h3/docs/api.md` is out of date
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'packages', 'react-native-nitro-h3', 'src')
const BARREL = join(SRC, 'index.ts')
const OUT = join(HERE, '..', 'packages', 'react-native-nitro-h3', 'docs', 'api.md')

/** Maps each source file to its section title. A file that is not listed is title-cased. */
const TITLES: Record<string, string> = {
  H3Error: 'Errors',
  async: 'Async variants',
  batches: 'Batch operations',
  configure: 'Configuration',
  edges: 'Directed edges',
  hierarchy: 'Hierarchy',
  indexing: 'Indexing',
  inspection: 'Inspection',
  measurement: 'Measurement',
  misc: 'Miscellaneous',
  regions: 'Regions',
  traversal: 'Traversal',
  types: 'Types',
  units: 'Angle conversion',
  vertexes: 'Vertexes',
}

/**
 * Orders the sections the way a reader meets the API: making a cell, asking about one, moving
 * between them, then the shapes, the numbers, and finally the machinery around the calls. A file
 * missing from this list still renders, after the listed ones, in filename order.
 */
const ORDER = [
  'indexing',
  'inspection',
  'traversal',
  'hierarchy',
  'regions',
  'edges',
  'vertexes',
  'measurement',
  'units',
  'misc',
  'batches',
  'async',
  'configure',
  'H3Error',
  'types',
]

/** Widest signature that still reads well on one line, matching the repository's line width. */
const MAX_SIGNATURE_WIDTH = 100

interface Entry {
  name: string
  signature: string
  doc: string
}

function titleOf(base: string): string {
  const known = TITLES[base]
  if (known != null) {
    return known
  }
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/** Collects the local names `src/index.ts` re-exports, which is the whole public surface. */
function publicNames(barrel: string): Set<string> {
  const source = ts.createSourceFile('index.ts', barrel, ts.ScriptTarget.Latest, true)
  const names = new Set<string>()

  source.forEachChild((node) => {
    if (!ts.isExportDeclaration(node) || node.exportClause == null) {
      return
    }
    if (!ts.isNamedExports(node.exportClause)) {
      return
    }
    for (const element of node.exportClause.elements) {
      // `propertyName` is the local name in `export { local as exported }`
      names.add((element.propertyName ?? element.name).text)
    }
  })

  return names
}

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function docOf(code: string, node: ts.Node): string {
  const ranges = ts.getLeadingCommentRanges(code, node.getFullStart()) ?? []
  const block = ranges.filter((range) => code.slice(range.pos, range.pos + 3) === '/**').pop()
  if (block == null) {
    return ''
  }
  return code
    .slice(block.pos + 3, block.end - 2)
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim()
}

/** Rewrites `{@linkcode X}` and `{@link X}` as `` `X` ``, keeping any label that follows. */
function inlineLinks(text: string): string {
  return text.replace(
    /\{@link(?:code|plain)?\s+([^}\s|]+)\s*\|?\s*([^}]*)\}/g,
    (_, target, label) => {
      const rest = String(label).trim()
      return rest === '' ? `\`${target}\`` : `\`${target}\` ${rest}`
    },
  )
}

interface Tag {
  name: string
  text: string
}

/** Splits a doc block into its summary lines and its tags, joining each tag's continuation lines. */
function splitTags(doc: string): { summary: string[]; tags: Tag[] } {
  const summary: string[] = []
  const tags: Tag[] = []

  for (const line of doc.split('\n')) {
    const start = /^@(\w+)\s*(.*)$/.exec(line)
    if (start != null) {
      tags.push({ name: start[1] ?? '', text: start[2] ?? '' })
      continue
    }
    const open = tags[tags.length - 1]
    if (open == null) {
      summary.push(line)
      continue
    }
    // a blank line ends the tag, so trailing prose is not swallowed into it
    if (line.trim() === '') {
      tags.push({ name: '', text: '' })
      continue
    }
    open.text = `${open.text} ${line.trim()}`.trim()
  }

  return { summary, tags: tags.filter((tag) => tag.name !== '') }
}

/** Renders one tag as Markdown; `@param` is a list item, the rest are labelled lines. */
function renderTag(tag: Tag): string[] {
  if (tag.name === 'param') {
    const named = /^(\S+)\s*(.*)$/.exec(tag.text)
    if (named == null) {
      return [`- ${tag.text}`]
    }
    return [`- \`${named[1]}\`: ${named[2] ?? ''}`.trimEnd()]
  }
  if (tag.name === 'example') {
    return ['Example:', '', '```ts', tag.text, '```']
  }
  const label = tag.name.charAt(0).toUpperCase() + tag.name.slice(1)
  return [`${label}: ${tag.text}`.trimEnd()]
}

/** Turns a doc block into the Markdown body of an entry: prose first, then the tags it carries. */
function renderDoc(doc: string): string[] {
  if (doc === '') {
    return []
  }
  const { summary, tags } = splitTags(inlineLinks(doc))
  const lines = summary.join('\n').trim().split('\n')
  const body = lines[0] === '' ? [] : [...lines, '']

  const params = tags.filter((tag) => tag.name === 'param')
  const rest = tags.filter((tag) => tag.name !== 'param')
  if (params.length > 0) {
    body.push(...params.flatMap(renderTag), '')
  }
  for (const tag of rest) {
    body.push(...renderTag(tag), '')
  }

  return body
}

/**
 * Renders a declaration's signature, dropping `export` and any body.
 *
 * A signature the source wrapped is collapsed onto one line only when it still fits the
 * repository's line width; otherwise the source's own line breaks are kept.
 */
function signatureOf(
  code: string,
  node: ts.Node,
  source: ts.SourceFile,
  bodyStart?: number,
): string {
  const end = bodyStart ?? node.getEnd()
  const text = code
    .slice(node.getStart(source), end)
    .replace(/^export\s+/, '')
    .trimEnd()
  const collapsed = text
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/,?\s+\)/g, ')')
    .trim()
  return collapsed.length <= MAX_SIGNATURE_WIDTH ? collapsed : text
}

/** Rebuilds a doc comment as the source wrote it, indented for a class member. */
function docCommentOf(doc: string, indent: string): string[] {
  if (doc === '') {
    return []
  }
  const lines = doc.split('\n')
  if (lines.length === 1) {
    return [`${indent}/** ${lines[0]} */`]
  }
  return [
    `${indent}/**`,
    ...lines.map((line) => `${indent} *${line === '' ? '' : ` ${line}`}`),
    `${indent} */`,
  ]
}

/** Renders a class as its header, heritage clauses and member signatures, with no bodies. */
function classSignatureOf(code: string, node: ts.ClassDeclaration, source: ts.SourceFile): string {
  const header = code
    .slice(node.getStart(source), node.members.pos)
    .replace(/^export\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const members = node.members.flatMap((member) => {
    const body = 'body' in member && member.body != null ? (member.body as ts.Node) : undefined
    const text = code
      .slice(member.getStart(source), body?.getStart(source) ?? member.getEnd())
      .replace(/\s+/g, ' ')
      .trim()
    return [...docCommentOf(docOf(code, member), '  '), `  ${text}`]
  })
  return [header, ...members, '}'].join('\n')
}

function entriesOf(code: string, fileName: string, publicApi: ReadonlySet<string>): Entry[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true)
  const entries: Entry[] = []

  const push = (name: string, signature: string, node: ts.Node): void => {
    if (!publicApi.has(name)) {
      return
    }
    entries.push({ name, signature, doc: docOf(code, node) })
  }

  source.forEachChild((node) => {
    if (!isExported(node)) {
      return
    }
    if (ts.isFunctionDeclaration(node) && node.name != null) {
      push(node.name.text, signatureOf(code, node, source, node.body?.getStart(source)), node)
      return
    }
    if (ts.isClassDeclaration(node) && node.name != null) {
      push(node.name.text, classSignatureOf(code, node, source), node)
      return
    }
    if (
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      push(node.name.text, node.getText(source).replace(/^export\s+/, ''), node)
      return
    }
    // `ContainmentMode` is a frozen const, which none of the branches above reach
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          push(declaration.name.text, node.getText(source).replace(/^export\s+/, ''), node)
        }
      }
    }
  })

  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

/** Returns the source file bases in reading order, with anything unlisted appended by filename. */
async function orderedBases(): Promise<string[]> {
  const bases = (await readdir(SRC))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => file.replace(/\.ts$/, ''))
  const listed = ORDER.filter((base) => bases.includes(base))
  const rest = bases.filter((base) => !ORDER.includes(base)).sort()
  return [...listed, ...rest]
}

/** Returns the GitHub heading anchor for a section title. */
function anchorOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/ /g, '-')
}

async function render(): Promise<string> {
  const publicApi = publicNames(await readFile(BARREL, 'utf8'))

  const contents: string[] = []
  const body: string[] = []
  let count = 0

  for (const base of await orderedBases()) {
    const code = await readFile(join(SRC, `${base}.ts`), 'utf8')
    const entries = entriesOf(code, `${base}.ts`, publicApi)
    if (entries.length === 0) {
      continue
    }
    const title = titleOf(base)
    contents.push(`- [${title}](#${anchorOf(title)})`)
    body.push(`## ${title}`, '')
    for (const entry of entries) {
      count += 1
      body.push(`### ${entry.name}`, '', '```ts', entry.signature, '```', '')
      body.push(...renderDoc(entry.doc))
    }
  }

  const lines: string[] = [
    '# API Reference',
    '',
    '<!-- Generated by `scripts/gen-api-docs.ts`. Do not edit by hand; edit the JSDoc in',
    '     `packages/react-native-nitro-h3/src` and run `bun run docs:api`. -->',
    '',
    'Every function throws [`H3Error`](#h3error) on failure. Cells are `bigint`; cell sets are',
    '`BigUint64Array` views over the buffer C++ produced, containing only real cells.',
    '',
    ...contents,
    '',
    ...body,
    // the correctness section every reference page under `docs/` closes with
    '## Correctness',
    '',
    'Every signature here is generated from the JSDoc in `packages/react-native-nitro-h3/src`.',
    'Open an issue if a signature or a described behaviour does not match what the package does.',
    '',
    `<!-- ${count} exported symbols -->`,
    '',
  ]
  return lines.join('\n')
}

async function main(): Promise<void> {
  const rendered = await render()
  if (process.argv.includes('--check')) {
    const current = await readFile(OUT, 'utf8').catch(() => '')
    if (current !== rendered) {
      process.stderr.write(
        'packages/react-native-nitro-h3/docs/api.md is out of date; run `bun run docs:api`\n',
      )
      process.exit(1)
    }
    process.stdout.write('packages/react-native-nitro-h3/docs/api.md is up to date\n')
    return
  }
  await writeFile(OUT, rendered)
  process.stdout.write(`Wrote ${OUT}\n`)
}

await main()
