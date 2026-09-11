/** Origin of the site. `BASE` is the GitHub Pages project subpath, without a trailing slash. */
export const SITE = 'https://vgorte.github.io'
export const BASE = '/react-native-nitro-h3'
export const REPO = 'https://github.com/vgorte/react-native-nitro-h3'

export const GROUPS = ['Start Here', 'Core Concepts', 'Performance', 'Reference'] as const
export type Group = (typeof GROUPS)[number]

export type Page = {
  /** Route under `BASE`, with leading and trailing slash. */
  route: string
  /** Sidebar label. */
  label: string
  /** Repository-relative path of the Markdown source. */
  source: string
  /** Meta description, one sentence, distinct per page. */
  description: string
  group: Group
  /** A generated source gets a table of contents limited to `##` headings. */
  generated?: boolean
}

// Order within a group is the order here; Starlight ignores `sidebar.order` in an explicit sidebar.
export const PAGES: readonly Page[] = [
  {
    route: '/getting-started/',
    label: 'Getting Started',
    source: 'docs/getting-started.md',
    description:
      'Install react-native-nitro-h3 with bun, npm or Expo and make a first H3 call on iOS and Android.',
    group: 'Start Here',
  },
  {
    route: '/requirements/',
    label: 'Requirements',
    source: 'docs/requirements.md',
    description:
      'The React Native, Nitro Modules, iOS, Android and C++ toolchain versions a project needs before react-native-nitro-h3 builds.',
    group: 'Start Here',
  },
  {
    route: '/showcase/',
    label: 'Showcase',
    source: 'docs/showcase.md',
    description:
      'The showcase app: five acts that put react-native-nitro-h3 under a map, inside a gesture and on a busy JS thread, with the video and the pattern behind each act.',
    group: 'Start Here',
  },
  {
    route: '/migrating-from-h3-js/',
    label: 'Migrating from h3-js',
    source: 'docs/migrating-from-h3-js.md',
    description:
      'Before and after examples for moving from h3-js to react-native-nitro-h3: bigint cells, BigUint64Array cell sets, unit suffixes and strict validation.',
    group: 'Start Here',
  },
  {
    route: '/concepts/cells-and-bigint/',
    label: 'Cell Indexes and bigint',
    source: 'docs/concepts/cells-and-bigint.md',
    description:
      'Why an H3 cell is a bigint in react-native-nitro-h3, how to convert at the boundary and how the package covers the h3-js 4.5.0 operation set.',
    group: 'Core Concepts',
  },
  {
    route: '/concepts/typed-arrays-and-batch/',
    label: 'Typed Arrays and Batch Calls',
    source: 'docs/concepts/typed-arrays-and-batch.md',
    description:
      'The contract of BigUint64Array cell sets, Float64Array coordinates and the batch calls latLngsToCells, cellsToLatLngs and cellsToBoundaries.',
    group: 'Core Concepts',
  },
  {
    route: '/concepts/sync-and-async/',
    label: 'Sync and Async',
    source: 'docs/concepts/sync-and-async.md',
    description:
      'Which four H3 operations have async variants in react-native-nitro-h3, what they guarantee and what the thread hop costs.',
    group: 'Core Concepts',
  },
  {
    route: '/concepts/errors-and-memory-safety/',
    label: 'Errors and Memory Safety',
    source: 'docs/concepts/errors-and-memory-safety.md',
    description:
      'H3Error, native error codes and the optional cell ceiling that turns an oversized allocation into a catchable error.',
    group: 'Core Concepts',
  },
  {
    route: '/performance/',
    label: 'Performance Guide',
    source: 'docs/performance.md',
    description:
      'Where the speed of react-native-nitro-h3 comes from: one boundary crossing per call, no string conversion, and when a batch call or a cell ceiling pays.',
    group: 'Performance',
  },
  {
    route: '/benchmark/',
    label: 'Benchmark Report',
    source: 'docs/benchmark.md',
    description:
      'Methodology and full measurements of react-native-nitro-h3 against h3-js 4.5.0 on an iPhone XS and a Galaxy S23, with the size ledger.',
    group: 'Performance',
  },
  {
    route: '/api/',
    label: 'API',
    source: 'packages/react-native-nitro-h3/docs/api.md',
    description:
      'Every exported function of react-native-nitro-h3 with its signature, arguments, return type and errors, grouped by H3 category.',
    group: 'Reference',
    generated: true,
  },
  {
    route: '/h3-function-table/',
    label: 'H3 Function Reference',
    source: 'docs/h3-function-table.md',
    description:
      'Every react-native-nitro-h3 export mapped to the H3 v4.5.0 C function it binds, with the header declarations and implementation hazards.',
    group: 'Reference',
  },
  {
    route: '/h3-js-divergences/',
    label: 'Divergences from h3-js',
    source: 'docs/h3-js-divergences.md',
    description:
      'Every intentional difference between react-native-nitro-h3 and h3-js 4.5.0, with the test or the vendored source that proves each one.',
    group: 'Reference',
  },
]

/** Repository paths under `docs/` that the site leaves out on purpose. Prefixes match directories. */
export const EXCLUDED: readonly string[] = [
  'docs/releasing.md',
  'docs/superpowers/',
  'docs/research/',
]

/** Builds the Starlight sidebar: one group per entry of `GROUPS`, pages in table order. */
export function sidebar() {
  return GROUPS.map((label) => ({
    label,
    items: PAGES.filter((page) => page.group === label).map((page) => ({
      slug: slugOf(page.route),
      label: page.label,
    })),
  }))
}

/** Turns `'/concepts/cells-and-bigint/'` into `'concepts/cells-and-bigint'`. */
export function slugOf(route: string): string {
  return route.replace(/^\/|\/$/g, '')
}
