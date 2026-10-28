/**
 * The phosphor view's palette (src/profile/phosphor*.ts): a green P1-phosphor monitor. It is a
 * terminal screen, so it keeps these colours whatever the app's theme is; shades come from alpha on
 * one green hue family, never from per-language colours.
 *
 * phosphorInk turns any theme's LifeInk into the screen's, so the shared axis, labels, plates and
 * the time-lapse caption all draw in green on the dark screen whatever the theme.
 */
import type { LifeInk } from '../../profile/lifeTypes'

export interface PhosphorPalette {
  /** the dark screen behind everything */
  screen: string
  /** the faint band behind alternate years */
  band: string
  /** a stack's body blocks */
  phosphor: string
  /** a head block, the selection's frame, the milestones */
  bright: string
  /** years, "today", the horizon: readable on the screen */
  text: string
  /** the ground line and the language ribbon */
  ground: string
  /** an archived repo's blocks */
  dim: string
  /** the scanlines and the vignette, laid over the screen at low alpha */
  shade: string
  /** the shared labels' plates, and their ring */
  plate: string
  plateRing: string
}

export const PHOSPHOR: PhosphorPalette = {
  screen: '#03130a',
  band: '#082a14',
  phosphor: '#33ff66',
  bright: '#c8ffd4',
  text: '#5cf582',
  ground: '#1f9c42',
  dim: '#1b7a35',
  shade: '#000000',
  plate: '#06200f',
  plateRing: '#1f9c42',
}

/** Every other stack while one is selected, at this alpha, whatever the theme. */
export const PHOSPHOR_DIM_ALPHA = 0.3

/** The screen's LifeInk: base's garden ink kept, every colour the screen's green and the dimming the screen's. */
export function phosphorInk(base: LifeInk): LifeInk {
  const p = PHOSPHOR
  return {
    ...base,
    canvas: p.screen,
    text: p.text,
    muted: p.text,
    accent: p.bright,
    fallback: p.phosphor,
    rootRing: p.ground,
    eraBand: p.band,
    horizon: p.ground,
    dry: p.dim,
    hoverRing: p.text,
    inspectedRing: p.bright,
    textHalo: p.screen,
    labelPlateFill: p.plate,
    labelPlateRing: p.plateRing,
    dimAlpha: PHOSPHOR_DIM_ALPHA,
  }
}
