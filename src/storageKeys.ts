/**
 * Every localStorage key the app writes, under the `gitube:` prefix, in one place.
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

