/**
 * The helix view's palette (src/profile/helix*.ts): an amber vector display, the look of a coil
 * drawn in light on a dark tube. A console view keeps this look whatever the app's theme is, so it
 * lives here, apart from the themes, and is the only place its colours are spelled (the 'no stray
 * colour literals' test reads everything outside src/theme). Shades come from alpha on the one amber
 * family, never from per-language colours.
 *
 * The thread, the text and the bright colour keep at least 4.5:1 against the screen
 * (tests/helixView.test.ts checks it), so the view stays readable at any size.
 *
 * helixInk turns any theme's LifeInk into the display's, so the shared axis, labels, plates and
 * the time-lapse caption all draw in amber on the dark screen whatever the theme.
 */
import type { LifeInk } from '../../profile/lifeTypes'

export interface HelixPalette {
  /** the dark tube behind everything */
  screen: string
  /** the faint band behind alternate years (the ink's eraBand; the view draws hoops instead) */
  band: string
  /** the axis coil and the year hoops: the cage the threads wind on */
  cage: string
  /** a repo's thread */
  thread: string
  /** the selected thread, its halo, a landed pull request's mark and the milestones */
  bright: string
  /** years, "today", the hovered thread's halo: readable on the screen */
  text: string
  /** the horizon and the language ribbon */
  ground: string
  /** an archived repo's thread */
  dim: string
  /** the shared labels' plates, and their ring */
  plate: string
  plateRing: string
}

export const HELIX_PALETTE: HelixPalette = {
  screen: '#0b0804',
  band: '#17100a',
  cage: '#4a3415',
  thread: '#ffb000',
  bright: '#ffe6a8',
  text: '#e0a84f',
  ground: '#8a5e1e',
  dim: '#7a5a2a',
  plate: '#1a120a',
  plateRing: '#8a5e1e',
}

/** Every other thread while one is selected, at this alpha, whatever the theme. */
export const HELIX_DIM_ALPHA = 0.3

/** The display's LifeInk: base's other fields kept, every colour the display's amber and the dimming its own. */
export function helixInk(base: LifeInk): LifeInk {
  const p = HELIX_PALETTE
  return {
    ...base,
    canvas: p.screen,
    text: p.text,
    muted: p.text,
    accent: p.bright,
    fallback: p.thread,
    rootRing: p.ground,
    eraBand: p.band,
    horizon: p.ground,
    dry: p.dim,
    hoverRing: p.text,
    inspectedRing: p.bright,
    textHalo: p.screen,
    labelPlateFill: p.plate,
    labelPlateRing: p.plateRing,
    dimAlpha: HELIX_DIM_ALPHA,
  }
}
