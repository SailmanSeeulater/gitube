/**
 * The theme's first paint. vite.config.ts injects both of these into index.html, so a reload in a
 * saved theme never flashes another one while the app's JavaScript loads:
 *  - defaultThemeCss: an inline <style> with the default theme (Obsidian) on :root, so even
 *    before any script runs the page is never unstyled;
 *  - themeBootScript: a tiny classic script, loaded blocking from <head>, that applies the saved
 *    theme's CSS variables before the body is parsed. It is a file rather than inline code because
 *    the site's Content-Security-Policy is script-src 'self'.
 * After that, main.tsx and App apply the theme from the store (applyTheme.ts).
 *
 * Pure (string building only), so vite.config.ts can import it.
 */
import { DEFAULT_THEME, DEFAULT_THEME_ID, THEMES, THEME_STORAGE_KEY, themeCssVariables, type Theme } from './themes.ts'
import { STORAGE_MOVES } from '../storageKeys.ts'

function declarations(theme: Theme): string {
  return Object.entries(themeCssVariables(theme))
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
}

/** CSS for an inline <style>: the default theme's variables and color-scheme on :root. */
export function defaultThemeCss(): string {
  return `:root{${declarations(DEFAULT_THEME)};color-scheme:${DEFAULT_THEME.derived.colorScheme}}`
}

/**
 * Source of the blocking boot script. First it moves each setting saved under the app's old name
 * (repo-garden:) to its gitube: key, once, keeping a value already under the new key, so the
 * modules that read them later find them (storageKeys.ts). Then it reads the saved theme id
 * (try/catch: storage may be blocked), and for a known non-default theme sets its variables,
 * color-scheme and theme-color on the document; data-theme is set either way. ES5, no dependencies.
 */
export function themeBootScript(): string {
  const table = Object.fromEntries(
    THEMES.filter((theme) => theme.id !== DEFAULT_THEME_ID).map((theme) => [
      theme.id,
      { vars: themeCssVariables(theme), scheme: theme.derived.colorScheme, meta: theme.canvas },
    ]),
  )
  return [
    '(function () {',
    `  var themes = ${JSON.stringify(table)};`,
    `  var moves = ${JSON.stringify(STORAGE_MOVES)};`,
    '  try {',
    '    var store = window.localStorage;',
    '    for (var i = 0; i < moves.length; i++) {',
    '      var old = store.getItem(moves[i][0]);',
    '      if (old === null) continue;',
    '      if (store.getItem(moves[i][1]) === null) store.setItem(moves[i][1], old);',
    '      store.removeItem(moves[i][0]);',
    '    }',
    '  } catch (e) {}',
    '  var root = document.documentElement;',
    '  var id = null;',
    `  try { id = window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}); } catch (e) {}`,
    '  if (id === null || !Object.prototype.hasOwnProperty.call(themes, id)) {',
    `    root.setAttribute('data-theme', ${JSON.stringify(DEFAULT_THEME_ID)});`,
    '    return;',
    '  }',
    '  var theme = themes[id];',
    '  for (var name in theme.vars) root.style.setProperty(name, theme.vars[name]);',
    '  root.style.colorScheme = theme.scheme;',
    "  root.setAttribute('data-theme', id);",
    '  var meta = document.querySelector(\'meta[name="theme-color"]\');',
    "  if (meta) meta.setAttribute('content', theme.meta);",
    '})();',
    '',
  ].join('\n')
}
