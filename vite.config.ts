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

export default defineConfig({
  plugins: [react(), tailwindcss(), themeBoot()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Vitest stubs CSS imports to '' by default; src/theme/themes.test.ts reads index.css?raw.
    css: { include: [/src[\\/]index\.css/] },
  },
})
