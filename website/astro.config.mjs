import { readdir, readFile, writeFile } from 'node:fs/promises'
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLinksValidator from 'starlight-links-validator'
import starlightLlmsTxt from 'starlight-llms-txt'
import { BASE, REPO, SITE, sidebar } from './pages'

// The two subsets English text actually renders in; `unicode-range` gates the other eleven.
const LATIN_FONTS = ['inter-latin-wght-normal', 'jetbrains-mono-latin-wght-normal']
const STYLESHEET = '<link rel="stylesheet"'
const HERO_SCRIPT = /<script type="module" src="([^"]*Hero\.astro[^"]*\.js)">/

/**
 * Announces the two latin fonts and the hero module in the head, ahead of the stylesheet whose
 * parse would otherwise discover them. The emitted names carry a per-build hash, so they are read
 * back from the output instead of written by hand.
 */
function preloadHead() {
  const link = (href, rel, extra = '') => `<link rel="${rel}" href="${href}"${extra}>`
  return {
    name: 'nh3-preload-head',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const assets = await readdir(new URL('_astro/', dir))
        const fonts = LATIN_FONTS.map((name) =>
          assets.find((file) => file.startsWith(`${name}.`) && file.endsWith('.woff2')),
        )
        if (fonts.some((file) => !file)) {
          logger.warn('no latin woff2 to preload, the font subsets have moved')
          return
        }
        const preloads = fonts.map((file) =>
          link(`${BASE}/_astro/${file}`, 'preload', ' as="font" type="font/woff2" crossorigin'),
        )
        const pages = (await readdir(dir, { recursive: true })).filter((file) =>
          file.endsWith('.html'),
        )
        let heroPages = 0
        for (const page of pages) {
          const url = new URL(page, dir)
          const html = await readFile(url, 'utf8')
          const cut = html.indexOf(STYLESHEET)
          if (cut === -1) continue
          const hero = HERO_SCRIPT.exec(html)
          if (hero?.[1]) heroPages += 1
          const head = [...preloads, ...(hero?.[1] ? [link(hero[1], 'modulepreload')] : [])]
          await writeFile(url, `${html.slice(0, cut)}${head.join('')}${html.slice(cut)}`)
        }
        // Only the landing carries the hero module. Finding it on no page at all means the emitted
        // name has moved, and a silent miss would cost the landing its first frame.
        if (heroPages === 0)
          throw new Error('no hero module to preload, the emitted name has moved')
      },
    },
  }
}

export default defineConfig({
  site: SITE,
  base: BASE,
  integrations: [
    preloadHead(),
    starlight({
      title: 'react-native-nitro-h3',
      description: 'Fast H3 geospatial indexing for React Native, powered by Nitro Modules.',
      logo: { src: './src/assets/logo-tile.svg' },
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      components: {
        Header: './src/components/Header.astro',
        Hero: './src/components/Hero.astro',
        MarkdownContent: './src/components/MarkdownContent.astro',
        MobileTableOfContents: './src/components/MobileTableOfContents.astro',
        PageTitle: './src/components/PageTitle.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      expressiveCode: {
        styleOverrides: {
          borderColor: 'var(--sl-color-hairline-light)',
          codeBackground: 'var(--sl-color-gray-6)',
        },
      },
      customCss: ['./src/styles/custom.css'],
      lastUpdated: true,
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: `${SITE}${BASE}/og-logo.png` } },
        { tag: 'meta', attrs: { property: 'og:image:alt', content: 'react-native-nitro-h3 logo' } },
        {
          tag: 'meta',
          attrs: {
            name: 'google-site-verification',
            content: 'XVycqMl57U3jc9VVgiBkSQ17AGIoC5eP5OztmujEw34',
          },
        },
      ],
      sidebar: sidebar(),
      plugins: [
        starlightLinksValidator(),
        starlightLlmsTxt({
          projectName: 'react-native-nitro-h3',
          description:
            'react-native-nitro-h3 is a native H3 geospatial indexing binding for React Native, vendoring the H3 C library and calling it through Nitro Modules.',
        }),
      ],
    }),
  ],
})
