/**
 * The htop view's palette (src/profile/htopPaint.ts): a system monitor's screen, near-black with a
 * Dracula-like set of bright meter colours. It ignores the app theme, as a terminal does, so every
 * colour here was picked to read on HTOP_PALETTE.background: the language colours and the text at
 * well over 4.5:1, the dim chrome (gutter numbers, grid) only as decoration.
 *
 * htopInk turns any theme's LifeInk into the console's, so the shared axis pieces (milestones, the
 * day guide) and, if the host passes it to the painter, the shared labels draw on the dark screen
 * whatever the theme.
 */
import type { LifeInk } from '../../profile/lifeTypes'

export const HTOP_PALETTE = {
  /** the screen */
  background: '#0e0f14',
  /** the header strip of years */
  header: '#1c1e29',
  headerText: '#8be9fd',
  /** the PID gutter at the left */
  gutter: '#08090c',
  gutterText: '#6b7191',
  /** year gridlines and the horizon */
  grid: '#2c2f3e',
  /** the meters' [ and ] */
  bracket: '#c9cddb',
  text: '#f8f8f2',
  muted: '#9499b3',
  /** the milestones on the horizon */
  accent: '#f1fa8c',
  /** the selected row's bar, as htop's cursor line */
  select: '#8be9fd',
  hover: '#bd93f9',
  /** an archived repo's meter */
  dry: '#7f88b5',
  /** a repo with no language */
  none: '#b4b8cc',
  /** the shared labels' plates */
  plate: '#1c1e29',
  plateRing: '#44475a',
  /** the languages, the most used first: green, cyan, pink, yellow, purple, orange, red, light green */
  languages: ['#50fa7b', '#8be9fd', '#ff79c6', '#f1fa8c', '#bd93f9', '#ffb86c', '#ff6e6e', '#a4ffbf'],
} as const

/** Every other row while one is selected, at this alpha, whatever the theme. */
export const HTOP_DIM_ALPHA = 0.4

/** The console's LifeInk: base's other fields kept, every colour the screen's and the dimming the screen's. */
export function htopInk(base: LifeInk): LifeInk {
  const p = HTOP_PALETTE
  return {
    ...base,
    canvas: p.background,
    text: p.text,
    muted: p.muted,
    accent: p.accent,
    fallback: p.none,
    rootRing: p.bracket,
    eraBand: p.header,
    horizon: p.grid,
    dry: p.dry,
    hoverRing: p.hover,
    inspectedRing: p.select,
    textHalo: p.background,
    labelPlateFill: p.plate,
    labelPlateRing: p.plateRing,
    dimAlpha: HTOP_DIM_ALPHA,
  }
}
