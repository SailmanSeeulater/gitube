/**
 * The minimap view's colours (src/profile/minimapPaint.ts): a code editor's dark chrome, after VS
 * Code's Dark+ theme. A console view keeps its look whatever the app's theme, so these are fixed;
 * they live here because every colour the app draws comes from src/theme.
 *
 * minimapInk turns any theme's LifeInk into the editor's, so the shared axis, labels, plates and the
 * time-lapse caption draw on the dark editor whatever the theme.
 */
import type { LifeInk } from '../../profile/lifeTypes'

export interface MinimapPalette {
  /** the editor's background, and the canvas's */
  background: string
  /** the editor's plain text, and the axis's labels over it */
  text: string
  /** the line numbers... */
  lineNumber: string
  /** ...and the hovered or selected line's number */
  lineNumberActive: string
  /** the hovered line's band (the current line) */
  lineHighlight: string
  /** the selected line's band... */
  selection: string
  /** ...and its edge in the gutter */
  selectionEdge: string
  /** a dormant stretch's whitespace dots */
  whitespace: string
  /** a guide at each new year */
  indentGuide: string
  /** the horizon under the rows, and today's tick */
  horizon: string
  /** the year labels and today */
  muted: string
  /** the milestones on the horizon */
  accent: string
  /** the hovered day's guide and a hovered milestone's ring */
  hoverRing: string
  /** the tab bar, its active tab, the tab's top edge, its name and the bar's lower edge */
  tabBar: string
  tabActive: string
  tabAccent: string
  tabText: string
  tabMuted: string
  tabBorder: string
  /** the minimap strip, its edge towards the editor, and the box over what the camera shows */
  stripBackground: string
  stripShadow: string
  stripSlider: string
  /** the hovered or selected row's mark across the strip */
  stripMark: string
  /** a repo without a language */
  plain: string
  /** an archived repo, drawn as a comment */
  comment: string
  /** the syntax tokens, one per language by how many repos use it (the most used first), cycling */
  tokens: readonly string[]
}

export const MINIMAP_PALETTE: MinimapPalette = {
  background: '#1e1e1e',
  text: '#d4d4d4',
  lineNumber: '#858585',
  lineNumberActive: '#c6c6c6',
  lineHighlight: '#2a2d2e',
  selection: '#264f78',
  selectionEdge: '#569cd6',
  whitespace: '#4b4b4b',
  indentGuide: '#404040',
  horizon: '#5a5a5a',
  muted: '#9d9d9d',
  accent: '#dcdcaa',
  hoverRing: '#007fd4',
  tabBar: '#252526',
  tabActive: '#1e1e1e',
  tabAccent: '#0078d4',
  tabText: '#ffffff',
  tabMuted: '#8b8b8b',
  tabBorder: '#2b2b2b',
  stripBackground: '#1e1e1e',
  stripShadow: '#000000',
  stripSlider: '#79797933',
  stripMark: '#c6c6c680',
  plain: '#9e9e9e',
  comment: '#6a9955',
  tokens: ['#569cd6', '#ce9178', '#4ec9b0', '#c586c0', '#dcdcaa', '#9cdcfe', '#b5cea8', '#d7ba7d', '#f48771', '#4fc1ff'],
}

/** Every other line while one is selected, at this alpha, whatever the theme. */
export const MINIMAP_DIM_ALPHA = 0.4

/** The editor's LifeInk: base's other fields kept, every colour the editor's and the dimming the editor's. */
export function minimapInk(base: LifeInk): LifeInk {
  const p = MINIMAP_PALETTE
  return {
    ...base,
    canvas: p.background,
    text: p.text,
    muted: p.muted,
    accent: p.accent,
    fallback: p.plain,
    rootRing: p.lineNumber,
    eraBand: p.indentGuide,
    horizon: p.horizon,
    dry: p.comment,
    hoverRing: p.hoverRing,
    inspectedRing: p.selectionEdge,
    textHalo: p.background,
    labelPlateFill: p.tabBar,
    labelPlateRing: p.indentGuide,
    dimAlpha: MINIMAP_DIM_ALPHA,
  }
}
