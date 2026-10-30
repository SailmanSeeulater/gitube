/**
 * Every localStorage key the app writes, under the `gitube:` prefix. Before the rename they were
 * `repo-garden:`; the theme boot script (theme/boot.ts), the first script on every page, moves an
 * old value to its new key once, before any of the app's modules read one, so nobody loses their
 * token, theme, layout or sound setting.
 *
 * Pure constants (vite.config.ts imports this through theme/boot.ts).
 */

/** The GitHub personal access token. */
export const TOKEN_STORAGE_KEY = 'gitube:token'
/** The repo layout: 'metro' or 'organic'. */
export const LAYOUT_STORAGE_KEY = 'gitube:layout'
/** The colour theme's id. */
export const THEME_STORAGE_KEY = 'gitube:theme'
/** The music box switch: 'on' or 'off'. */
export const SOUND_STORAGE_KEY = 'gitube:sound'

/** The prefix the same keys had before the rename. */
export const LEGACY_STORAGE_PREFIX = 'repo-garden:'

/** Old key, new key: what the boot script moves over. */
export const STORAGE_MOVES: ReadonlyArray<readonly [string, string]> = [TOKEN_STORAGE_KEY, LAYOUT_STORAGE_KEY, THEME_STORAGE_KEY, SOUND_STORAGE_KEY].map(
  (key) => [LEGACY_STORAGE_PREFIX + key.slice(key.indexOf(':') + 1), key] as const,
)
