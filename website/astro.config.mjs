import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLinksValidator from 'starlight-links-validator'
import starlightLlmsTxt from 'starlight-llms-txt'
import { BASE, REPO, SITE, sidebar } from './pages'

export default defineConfig({
  site: SITE,
  base: BASE,
  integrations: [
    starlight({
      title: 'react-native-nitro-h3',
      description: 'Fast H3 geospatial indexing for React Native, powered by Nitro Modules.',
      logo: { src: './src/assets/logo-tile.svg' },
      social: [
        { icon: 'github', label: 'GitHub', href: REPO },
        { icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/package/react-native-nitro-h3' },
      ],
      components: { Footer: './src/components/Footer.astro' },
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
