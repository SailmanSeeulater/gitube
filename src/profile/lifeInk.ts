/**
 * Person mode's colours, all read off the active theme, so every theme works with no extra work.
 * A theme switch is a redraw, never a relayout: callers memoise these on the theme.
 *
 * Languages are coloured the way branches are (assignPalette): the dominant language takes the
 * accent and the rest take the theme's palette in name order, so a language keeps its slot across
 * refetches and themes. A repo without a language is drawn in the theme's fallback. GitHub's own
 * linguist colours are never painted (PROFILE_SPEC.md section 3).
 */
import type { Theme } from '../theme/themes'
import { blendHex } from '../theme/colour'
import { assignPalette } from '../graph/color'
import type { LifeTimeline } from './timeline'
import type { LifeInk } from './lifeTypes'

/** Alternate years are banded in the text colour at this alpha over the canvas: decorative only. */
const ERA_BAND_ALPHA = 0.05

export function lifeInk(theme: Theme): LifeInk {
  const d = theme.derived
  return {
    canvas: theme.canvas,
    text: theme.text,
    muted: theme.muted,
    accent: theme.accent,
    fallback: theme.fallback,
    rootRing: theme.rootRing,
    eraBand: blendHex(theme.text, theme.canvas, ERA_BAND_ALPHA),
    horizon: d.horizon,
    dry: d.dry,
    hoverRing: d.hoverRing,
    inspectedRing: d.inspectedRing,
    textHalo: d.textHalo,
    labelPlateFill: d.labelPlateFill,
    labelPlateRing: d.labelPlateRing,
    dimAlpha: theme.dimAlpha,
  }
}

/**
 * The language of the life: the heaviest over its language eras (commits with a token, active repo
 * days without). With no era at all (no counted commits), the language of the most repos. Name order
 * breaks a tie; null when no repo has a language.
 */
export function dominantLanguage(timeline: LifeTimeline): string | null {
  const weights = new Map<string, number>()
  for (const era of timeline.languageEras) weights.set(era.language, (weights.get(era.language) ?? 0) + era.weight)
  if (weights.size === 0) for (const lane of timeline.lanes) if (lane.language !== null) weights.set(lane.language, (weights.get(lane.language) ?? 0) + 1)
  let best: string | null = null
  let most = -Infinity
  for (const [language, weight] of weights) {
    if (weight > most || (weight === most && best !== null && language < best)) {
      best = language
      most = weight
    }
  }
  return best
}

/** Every language of the life's repos and eras, coloured for the theme; empty when there is none. */
export function languagePalette(timeline: LifeTimeline, theme: Theme): Record<string, string> {
  const dominant = dominantLanguage(timeline)
  if (dominant === null) return {}
  const languages = new Set<string>()
  for (const lane of timeline.lanes) if (lane.language !== null) languages.add(lane.language)
  for (const era of timeline.languageEras) languages.add(era.language)
  return assignPalette([...languages], dominant, theme)
}

/** A language's colour from the palette; the fallback for none, or for one the palette lacks. */
export function languageColour(palette: Record<string, string>, language: string | null, theme: Pick<Theme, 'fallback'>): string {
  return language !== null && Object.hasOwn(palette, language) ? palette[language] : theme.fallback
}
