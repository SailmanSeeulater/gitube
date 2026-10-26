/// <reference types="vitest/config" />
import { createHash } from 'node:crypto'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defaultThemeCss, themeBootScript } from './src/theme/boot.ts'
import { DEFAULT_THEME } from './src/theme/themes.ts'

/**
 * Puts the theme on the page before the app's JavaScript runs (see src/theme/boot.ts): the
 * default theme's <meta name="theme-color"> and CSS variables, and a blocking script, emitted as a
 * hashed asset (served from memory in dev), that applies a saved theme before the first paint.
 * Every value is generated from src/theme/themes.ts.
 */
function themeBoot(): Plugin {
  const source = themeBootScript()
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 8)
  let fileName = `assets/theme-boot-${hash}.js`
  let url = `/${fileName}`
  return {
    name: 'repo-garden:theme-boot',
    configResolved(config) {
      fileName = `${config.build.assetsDir}/theme-boot-${hash}.js`
      url = `${config.base}${fileName}`
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== url) return next()
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        res.end(source)
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source })
    },
    transformIndexHtml() {
      return [
        { tag: 'meta', attrs: { name: 'theme-color', content: DEFAULT_THEME.canvas }, injectTo: 'head' },
        { tag: 'style', attrs: { id: 'theme-defaults' }, children: defaultThemeCss(), injectTo: 'head' },
        { tag: 'script', attrs: { src: url }, injectTo: 'head' },
      ]
    },
  }
}

/**
 * The large libraries get chunks of their own, so a deploy that only changes the app (most of them)
 * leaves them cached (assets/ is served immutable for a year; see deploy/nginx). The first visit
 * downloads the same bytes either way, in a few parallel files instead of one. The optional parts
 * of the app are split off separately, by dynamic import() (see src/lazy/parts.ts).
 *
 * Caveat: a vendor chunk stays the same file only while the app imports the same set of names from
 * it. A tree-shaken library's chunk holds just the exports in use, so one more import from it
 * changes that chunk. Chunks also import each other by hashed file name, so any change to one
 * renames every chunk that imports it: a change to the react chunk renames force-graph and state
 * too. Hence the tree-shaken state libraries are kept out of the react chunk. React is CommonJS
 * and bundled whole, so its chunk changes only when React is upgraded.
 */
const VENDOR_CHUNKS = [
  // React itself: CommonJS, bundled whole, so this chunk changes only when React is upgraded
  { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 2 },
  // the state libraries: tree-shaken, so this small chunk changes whenever the app starts using
  // one more of their exports
  { name: 'state', test: /node_modules[\\/](@tanstack|zustand)[\\/]/, priority: 2 },
  // the canvas: react-force-graph-2d and everything it pulls in (force-graph, d3-*, bezier-js, ...)
  { name: 'force-graph', test: /node_modules[\\/]react-force-graph-2d[\\/]/, priority: 1 },
  // the GitHub client and its dependencies
  { name: 'octokit', test: /node_modules[\\/]@octokit[\\/]/, priority: 1 },
]

export default defineConfig({
  plugins: [react(), tailwindcss(), themeBoot()],
  build: {
    // the entry stays assets/index-<hash>.js, which the deploy smoke test looks for
    rolldownOptions: { output: { codeSplitting: { groups: VENDOR_CHUNKS } } },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Vitest stubs CSS imports to '' by default; src/theme/themes.test.ts reads index.css?raw.
    css: { include: [/src[\\/]index\.css/] },
    // The person-mode privacy sweeps render or paint every view many times over (1-3 s locally);
    // CI runners are about three times slower, so the 5 s default timed them out there.
    testTimeout: 20_000,
  },
})
