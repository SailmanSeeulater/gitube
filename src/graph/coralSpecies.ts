/**
 * The coral layout's species: which growth form a repo's coral takes, picked by its primary
 * language. A species is four numbers the layout grows by, nothing more, so every form is the same
 * coral grown differently.
 *
 * Pure data, and small: the legend names the species, so this is in the first download, while the
 * layout that grows by it (graph/coral) stays in its own chunk.
 */

export type CoralSpeciesId = 'fan' | 'staghorn' | 'table' | 'bush'

export interface CoralSpecies {
  id: CoralSpeciesId
  /** as the legend names it */
  name: string
  /** one line on its shape */
  shape: string
  /** each side of the coral opens at most this far from the vertical, in radians (before the bend) */
  fan: number
  /**
   * how fast an arm turns away from its parent: the tangent of the angle between them (1 is 45
   * degrees). Smaller is a steeper, longer arm; larger a flatter, shorter one.
   */
  armSlope: number
  /** how much an arm has leaned back towards the vertical by the top of the coral (0 none, 1 upright) */
  bend: number
  /** neighbouring arms are at least this far apart, in lanes */
  spacing: number
  /** how thick it grows: a factor on every line's width */
  girth: number
}

export const CORAL_SPECIES: Readonly<Record<CoralSpeciesId, CoralSpecies>> = {
  // the default: wide and fine, arms fanning out and reaching up
  fan: { id: 'fan', name: 'sea fan', shape: 'wide and fine', fan: 1.3, armSlope: 1.25, bend: 0.3, spacing: 1.15, girth: 0.9 },
  // long arms that leave steeply and are pulled upright: taller than it is wide
  staghorn: { id: 'staghorn', name: 'staghorn', shape: 'long, steep arms', fan: 0.95, armSlope: 0.8, bend: 0.55, spacing: 1.25, girth: 0.85 },
  // arms set far apart that stay out: about three times as wide as it is tall
  table: { id: 'table', name: 'table coral', shape: 'flat and wide', fan: 1.2, armSlope: 1.4, bend: 0.12, spacing: 1.8, girth: 1 },
  // short arms close together, and thick: the most compact
  bush: { id: 'bush', name: 'bush coral', shape: 'short and dense', fan: 1.05, armSlope: 1.6, bend: 0.25, spacing: 1, girth: 1.2 },
}

/** Languages by the species they grow, lower-case as GitHub names them. Anything else is a sea fan. */
const BY_LANGUAGE: Readonly<Record<string, CoralSpeciesId>> = {
  // close to the machine: staghorn
  c: 'staghorn',
  'c++': 'staghorn',
  rust: 'staghorn',
  go: 'staghorn',
  zig: 'staghorn',
  assembly: 'staghorn',
  nim: 'staghorn',
  d: 'staghorn',
  // the big managed platforms: table coral
  java: 'table',
  kotlin: 'table',
  'c#': 'table',
  scala: 'table',
  swift: 'table',
  'objective-c': 'table',
  dart: 'table',
  groovy: 'table',
  // data, scripts and notebooks: bush coral
  python: 'bush',
  r: 'bush',
  julia: 'bush',
  shell: 'bush',
  'jupyter notebook': 'bush',
  matlab: 'bush',
  perl: 'bush',
  lua: 'bush',
}

/** The species a repo's coral grows as: by its primary language, a sea fan when it has none or one not listed. */
export function coralSpecies(language: string | null | undefined): CoralSpecies {
  const id = typeof language === 'string' ? BY_LANGUAGE[language.trim().toLowerCase()] : undefined
  // an own entry only: 'constructor' is not a language
  return CORAL_SPECIES[id !== undefined && Object.hasOwn(CORAL_SPECIES, id) ? id : 'fan']
}
