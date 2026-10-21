import { themeCssVariables, type Theme } from './themes'

/** Set on <html> for the one restyle of a theme switch; src/index.css turns transitions off under it. */
const SWITCHING_ATTRIBUTE = 'data-theme-switching'

/**
 * Puts a theme on the document: its CSS custom properties (which drive every Tailwind garden-*
 * colour, see src/index.css) as inline styles on <html>, color-scheme (native scrollbars, form
 * controls), data-theme, and <meta name="theme-color"> (the browser's toolbar tint). The canvas
 * is not touched here: Garden paints from the theme object.
 *
 * A switch from another theme recolours the page in one step: CSS transitions are held off for
 * that restyle, so elements with transition-colors do not fade from the old theme while the rest
 * (and the canvas) have already changed.
 */
export function applyTheme(theme: Theme, doc: Document = document): void {
  const root = doc.documentElement
  const switching = root.dataset.theme !== undefined && root.dataset.theme !== theme.id
  if (switching) root.setAttribute(SWITCHING_ATTRIBUTE, '')
  for (const [name, value] of Object.entries(themeCssVariables(theme))) root.style.setProperty(name, value)
  root.style.colorScheme = theme.derived.colorScheme
  root.dataset.theme = theme.id
  let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta === null) {
    meta = doc.createElement('meta')
    meta.name = 'theme-color'
    doc.head.appendChild(meta)
  }
  meta.content = theme.canvas
  if (switching) {
    // restyle now, with transitions off; the new colours are then the current ones, so turning
    // transitions back on starts none
    doc.body?.getBoundingClientRect()
    root.removeAttribute(SWITCHING_ATTRIBUTE)
  }
}
