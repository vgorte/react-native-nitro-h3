import { describe, expect, test } from 'bun:test'
import { EXCLUDED, PAGES, type Page } from '../pages'
import {
  forceDarkSvg,
  frontmatter,
  hasSteps,
  hasTabs,
  mdxGuard,
  rewriteLinks,
  splitTitle,
  stepsToMdx,
  stripHeadingEmoji,
  stripLeadingEmoji,
  tabsToMdx,
  transform,
  unmapped,
} from './sync-docs'

const base = '/react-native-nitro-h3'
const pageFor = (route: string): Page => {
  const page = PAGES.find((entry) => entry.route === route)
  if (!page) throw new Error(`no page for ${route}`)
  return page
}
const perf = pageFor('/performance/')
const api = pageFor('/api/')
const concept = pageFor('/concepts/cells-and-bigint/')

describe('splitTitle', () => {
  test('takes the first H1 and removes it from the body', () => {
    const { title, body } = splitTitle('# 🧮 Performance Guide\n\n> intro\n\n## Section\n')
    expect(title).toBe('🧮 Performance Guide')
    expect(body).toBe('> intro\n\n## Section\n')
  })

  test('ignores a `#` inside a fenced block', () => {
    const { title } = splitTitle('# Title\n\n```sh\n# a comment\n```\n')
    expect(title).toBe('Title')
  })

  test('throws without an H1', () => {
    expect(() => splitTitle('## Only H2\n')).toThrow(/no H1/)
  })

  test('throws on a second H1', () => {
    expect(() => splitTitle('# One\n\n# Two\n')).toThrow(/second H1/)
  })
})

describe('stripLeadingEmoji', () => {
  test('removes one leading emoji and the space after it', () => {
    expect(stripLeadingEmoji('🧮 Performance Guide')).toBe('Performance Guide')
    expect(stripLeadingEmoji('🛡️ Errors and memory safety')).toBe('Errors and memory safety')
  })

  test('leaves a plain title alone', () => {
    expect(stripLeadingEmoji('API reference')).toBe('API reference')
  })
})

describe('stripHeadingEmoji', () => {
  test('strips the emoji from a heading of any level', () => {
    expect(stripHeadingEmoji('## 📦 Installation')).toBe('## Installation')
    expect(stripHeadingEmoji('### 🔬 Methodology')).toBe('### Methodology')
  })

  test('leaves a heading without an emoji alone', () => {
    expect(stripHeadingEmoji('## Next steps')).toBe('## Next steps')
  })

  test('does not touch a heading-shaped line inside a fenced block', () => {
    const text = '```sh\n# 📦 install the package\n```\n'
    expect(stripHeadingEmoji(text)).toBe(text)
  })

  test('does not touch a heading-shaped line inside an indented fence', () => {
    const text = '1. Step.\n\n   ```sh\n# 📦 install the package\n   ```\n'
    expect(stripHeadingEmoji(text)).toBe(text)
  })

  test('leaves an emoji outside a heading alone', () => {
    const text = '| ✅ supported | yes |\n\n> 💡 A tip.\n'
    expect(stripHeadingEmoji(text)).toBe(text)
  })
})

describe('forceDarkSvg', () => {
  const svg = [
    '<style>',
    'text { fill: #727a84 }',
    '@media (prefers-color-scheme: light) {',
    'text { fill: #57606a }',
    '}',
    '@media (prefers-color-scheme: dark) {',
    'text { fill: #8b949e }',
    '}',
    '</style>',
  ].join('\n')

  test('drops the light block and unwraps the dark one after the base rules', () => {
    expect(forceDarkSvg(svg)).toBe(
      ['<style>', 'text { fill: #727a84 }', 'text { fill: #8b949e }', '</style>'].join('\n'),
    )
  })

  test('returns a file without a media block unchanged', () => {
    const plain = '<svg><path d="M0 0h8v8H0z" fill="#219fc9"/></svg>'
    expect(forceDarkSvg(plain)).toBe(plain)
  })

  test('throws on an unclosed media block', () => {
    expect(() => forceDarkSvg('@media (prefers-color-scheme: dark) {\ntext { fill: red }')).toThrow(
      /never closed/,
    )
  })
})

describe('rewriteLinks', () => {
  test('maps a sibling docs link to its route and keeps the anchor', () => {
    const out = rewriteLinks('see [x](benchmark.md#the-size-ledger)', perf, base)
    expect(out).toBe('see [x](/react-native-nitro-h3/benchmark/#the-size-ledger)')
  })

  test('maps a ./ and a ../ link from a nested page', () => {
    const out = rewriteLinks(
      '[a](../performance.md) [b](./typed-arrays-and-batch.md)',
      concept,
      base,
    )
    expect(out).toBe(
      '[a](/react-native-nitro-h3/performance/) [b](/react-native-nitro-h3/concepts/typed-arrays-and-batch/)',
    )
  })

  test('maps the api.md path to /api/', () => {
    const out = rewriteLinks(
      '[api](../packages/react-native-nitro-h3/docs/api.md#h3error)',
      perf,
      base,
    )
    expect(out).toBe('[api](/react-native-nitro-h3/api/#h3error)')
  })

  test('rewrites an image under img/ to the public path', () => {
    const out = rewriteLinks('![chart](../img/benchmark.svg)', perf, base)
    expect(out).toBe('![chart](/react-native-nitro-h3/img/benchmark.svg)')
  })

  test('sends an unmapped repository file to GitHub', () => {
    const out = rewriteLinks(
      '[c](../CONTRIBUTING.md) [r](releasing.md#quick-release-checklist)',
      perf,
      base,
    )
    expect(out).toBe(
      '[c](https://github.com/vgorte/react-native-nitro-h3/blob/main/CONTRIBUTING.md) [r](https://github.com/vgorte/react-native-nitro-h3/blob/main/docs/releasing.md#quick-release-checklist)',
    )
  })

  test('leaves absolute URLs and in-page anchors alone', () => {
    const text = '[h3](https://h3geo.org/) [top](#indexing) <https://example.com>'
    expect(rewriteLinks(text, perf, base)).toBe(text)
  })

  test('does not touch a fenced block', () => {
    const text = '```ts\nconst x = "[a](b.md)"\n```\n'
    expect(rewriteLinks(text, perf, base)).toBe(text)
  })
})

const stepsBody = [
  '<!-- steps -->',
  '1. First step.',
  '',
  '   ```bash',
  '   command',
  '   ```',
  '',
  '2. Second step.',
  '<!-- /steps -->',
  '',
].join('\n')

describe('stepsToMdx', () => {
  test('replaces both markers and leaves the list untouched', () => {
    const out = stepsToMdx(stepsBody)
    expect(out).toBe(
      stepsBody.replace('<!-- steps -->', '<Steps>').replace('<!-- /steps -->', '</Steps>'),
    )
  })

  test('leaves a marker inside a fenced block untouched', () => {
    const text = '```md\n<!-- steps -->\n1. First step.\n<!-- /steps -->\n```\n'
    expect(stepsToMdx(text)).toBe(text)
  })

  test('throws on an unclosed marker', () => {
    expect(() => stepsToMdx('<!-- steps -->\n1. First step.\n')).toThrow(/line 1: unclosed/)
  })

  test('throws on a close without an open marker', () => {
    expect(() => stepsToMdx('1. First step.\n<!-- /steps -->\n')).toThrow(/line 2/)
  })

  test('throws on a nested open marker', () => {
    const text = '<!-- steps -->\n1. First step.\n<!-- steps -->\n<!-- /steps -->\n'
    expect(() => stepsToMdx(text)).toThrow(/line 3/)
  })

  test('throws on a tabs block inside an open steps block', () => {
    const text =
      '<!-- steps -->\n1. First step.\n<TabItem label="bun">\n</TabItem>\n<!-- /steps -->\n'
    expect(() => stepsToMdx(text)).toThrow(/line 3/)
  })
})

describe('hasSteps', () => {
  test('is false on a page without markers', () => {
    expect(hasSteps('## Installation\n\n1. First step.\n')).toBe(false)
  })

  test('is false for a marker inside a fenced block', () => {
    expect(hasSteps('```md\n<!-- steps -->\n```\n')).toBe(false)
  })

  test('is true for a marker outside fenced blocks', () => {
    expect(hasSteps(stepsBody)).toBe(true)
  })
})

const tabsBody = [
  '<!-- tabs -->',
  '<!-- tab: bun -->',
  '',
  'Add the package with bun.',
  '',
  '<!-- tab: npm -->',
  '',
  'Add the package with npm.',
  '',
  '<!-- /tabs -->',
  '',
].join('\n')

describe('tabsToMdx', () => {
  test('opens the block, closes every tab and keeps the content', () => {
    expect(tabsToMdx(tabsBody)).toBe(
      [
        '<Tabs syncKey="package-manager">',
        '<TabItem label="bun">',
        '',
        'Add the package with bun.',
        '',
        '</TabItem>',
        '<TabItem label="npm">',
        '',
        'Add the package with npm.',
        '',
        '</TabItem>',
        '</Tabs>',
        '',
      ].join('\n'),
    )
  })

  test('leaves a marker inside a fenced block untouched', () => {
    const text = '```md\n<!-- tabs -->\n<!-- tab: bun -->\n<!-- /tabs -->\n```\n'
    expect(tabsToMdx(text)).toBe(text)
  })

  test('throws on a tab marker outside a block', () => {
    expect(() => tabsToMdx('<!-- tab: bun -->\n')).toThrow(/line 1/)
  })

  test('throws on a nested open marker', () => {
    const text = '<!-- tabs -->\n<!-- tab: bun -->\n<!-- tabs -->\n<!-- /tabs -->\n'
    expect(() => tabsToMdx(text)).toThrow(/line 3/)
  })

  test('throws on a close without an open marker', () => {
    expect(() => tabsToMdx('text\n<!-- /tabs -->\n')).toThrow(/line 2/)
  })

  test('throws on a block without a tab', () => {
    expect(() => tabsToMdx('<!-- tabs -->\ntext\n<!-- /tabs -->\n')).toThrow(/line 1/)
  })

  test('throws on an unclosed marker', () => {
    expect(() => tabsToMdx('<!-- tabs -->\n<!-- tab: bun -->\n')).toThrow(/line 1: unclosed/)
  })
})

describe('hasTabs', () => {
  test('is false on a page without markers', () => {
    expect(hasTabs('## Installation\n\n1. First step.\n')).toBe(false)
  })

  test('is false for a marker inside a fenced block', () => {
    expect(hasTabs('```md\n<!-- tabs -->\n```\n')).toBe(false)
  })

  test('is true for a marker outside fenced blocks', () => {
    expect(hasTabs(tabsBody)).toBe(true)
  })
})

describe('mdxGuard', () => {
  test('throws on a brace in prose', () => {
    expect(() => mdxGuard('The options are {a, b}.\n', 'docs/x.md')).toThrow(
      'docs/x.md:1: "{" outside code is JSX in MDX',
    )
  })

  test('passes on a brace inside an inline code span', () => {
    expect(() => mdxGuard('Call `latLngToCell({ lat })` first.\n', 'docs/x.md')).not.toThrow()
  })

  test('passes on a brace inside a fenced block', () => {
    expect(() => mdxGuard('```ts\nimport { Steps } from "x"\n```\n', 'docs/x.md')).not.toThrow()
  })

  test('passes on the Steps lines', () => {
    expect(() => mdxGuard('<Steps>\n1. First step.\n</Steps>\n', 'docs/x.md')).not.toThrow()
  })

  test('passes on the Tabs and TabItem lines', () => {
    const text =
      '<Tabs syncKey="package-manager">\n<TabItem label="bun">\ntext\n</TabItem>\n</Tabs>\n'
    expect(() => mdxGuard(text, 'docs/x.md')).not.toThrow()
  })
})

describe('frontmatter', () => {
  test('writes title, description, editUrl and lastUpdated', () => {
    const out = frontmatter(perf, 'Performance Guide', '2026-09-01T10:00:00+02:00')
    expect(out).toBe(
      [
        '---',
        'title: "Performance Guide"',
        `description: ${JSON.stringify(perf.description)}`,
        'editUrl: "https://github.com/vgorte/react-native-nitro-h3/edit/main/docs/performance.md"',
        'lastUpdated: 2026-09-01T10:00:00+02:00',
        '---',
        '',
      ].join('\n'),
    )
  })

  test('omits lastUpdated when the source has no history yet', () => {
    expect(frontmatter(perf, 'Performance Guide', null)).not.toContain('lastUpdated')
  })

  test('a generated page has no edit link and a two-level table of contents', () => {
    const out = frontmatter(api, 'API reference', null)
    expect(out).toContain('editUrl: false')
    expect(out).toContain('tableOfContents:\n  minHeadingLevel: 2\n  maxHeadingLevel: 2')
  })
})

describe('transform', () => {
  test('produces frontmatter followed by the body without the H1', () => {
    const out = transform('# 🧮 Performance Guide\n\nSee [b](benchmark.md).\n', perf, base, null)
    expect(out.content.startsWith('---\ntitle: "Performance Guide"\n')).toBe(true)
    expect(out.content.endsWith('---\n\nSee [b](/react-native-nitro-h3/benchmark/).\n')).toBe(true)
  })

  test('strips the emoji from the body headings too', () => {
    const out = transform('# 🧮 Performance Guide\n\n## 📦 Installation\n', perf, base, null)
    expect(out.content.endsWith('---\n\n## Installation\n')).toBe(true)
  })

  test('refuses GitHub alert syntax', () => {
    expect(() => transform('# T\n\n> [!NOTE]\n> x\n', perf, base, null)).toThrow(/\[!NOTE\]/)
  })

  test('a page without markers stays Markdown and gets no import', () => {
    const out = transform('# 🧮 Performance Guide\n\n1. First step.\n', perf, base, null)
    expect(out.extension).toBe('md')
    expect(out.content).not.toContain('import { Steps }')
  })

  test('a page with markers becomes MDX with the import first in the body', () => {
    const out = transform(`# 🧮 Performance Guide\n\n${stepsBody}`, perf, base, null)
    expect(out.extension).toBe('mdx')
    expect(out.content).toContain(
      "---\n\nimport { Steps } from '@astrojs/starlight/components'\n\n<Steps>\n",
    )
    expect(out.content).toContain('\n</Steps>\n')
  })

  test('a page with tabs only imports Tabs and TabItem', () => {
    const out = transform(`# 🧮 Performance Guide\n\n${tabsBody}`, perf, base, null)
    expect(out.extension).toBe('mdx')
    expect(out.content).toContain(
      '---\n\nimport { TabItem, Tabs } from \'@astrojs/starlight/components\'\n\n<Tabs syncKey="package-manager">\n',
    )
    expect(out.content).toContain('\n</TabItem>\n</Tabs>\n')
  })

  test('a page with tabs and steps imports all three components', () => {
    const body = `<!-- tabs -->\n<!-- tab: bun -->\n\n${stepsBody}\n<!-- /tabs -->\n`
    const out = transform(`# 🧮 Performance Guide\n\n${body}`, perf, base, null)
    expect(out.extension).toBe('mdx')
    expect(out.content).toContain(
      "import { Steps, TabItem, Tabs } from '@astrojs/starlight/components'",
    )
    expect(out.content).toContain('<TabItem label="bun">\n\n<Steps>\n')
  })
})

describe('unmapped', () => {
  test('does not return a mapped source', () => {
    expect(unmapped(['docs/performance.md'], PAGES, EXCLUDED)).toEqual([])
  })

  test('does not return a file excluded by name or by directory prefix', () => {
    expect(unmapped(['docs/releasing.md', 'docs/superpowers/plan.md'], PAGES, EXCLUDED)).toEqual([])
  })

  test('returns a docs file that is neither mapped nor excluded', () => {
    expect(unmapped(['docs/stray.md'], PAGES, EXCLUDED)).toEqual(['docs/stray.md'])
  })
})
