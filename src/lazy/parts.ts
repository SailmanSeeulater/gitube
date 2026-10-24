/**
 * The parts of repo-garden that load only when they are used, each its own chunk. Growing a repo
 * and looking at it in the organic layout needs none of them, so a first visit downloads none.
 *
 * Everything else is eager on purpose: the graph and its canvas (react-force-graph), the GitHub
 * client, the branch list, the legend and the theme data (the boot script and the first paint
 * need it; only the picker is lazy). Every dynamic import() of an app module is here, so this file
 * is the list of what is lazy (lazy/chunk.ts only imports these chunks' URLs again after a
 * failure).
 *
 * Each import() here must resolve with the whole module, as the bundler emits it for a module that
 * is a chunk of its own: a plain import of ./X-<hash>.js, with nothing picked out of a shared
 * chunk. A try after a failure imports the chunk's URL directly (lazy/chunk.ts) and must get the
 * same thing.
 */
import { defineChunk } from './chunk'

/** The image and data encoders and the saved-file reader, for the save menu, Open and file drops. */
export const exportersChunk = defineChunk(() => import('../export/exporters'))

/** The save menu's own chunk, without the encoders (see exportMenuChunk). */
const exportMenuOnlyChunk = defineChunk(() => import('../components/ExportMenu'))

/**
 * The save menu; the encoders come with it, so a save runs at once from the click. Each of the two
 * has its own tries, so a try after a failure fetches again only the one that failed.
 */
export const exportMenuChunk = defineChunk(async () => {
  const [menu] = await Promise.all([exportMenuOnlyChunk.load(), exportersChunk.load()])
  return menu
})

/** The theme picker popover (the themes themselves are eager). */
export const themePickerChunk = defineChunk(() => import('../components/ThemePicker'))

/** The time-lapse controls with the music box and the video recorder. */
export const timelapseChunk = defineChunk(() => import('../components/TimelapseBar'))

/** The garden battle overlay and its scoring. */
export const battleChunk = defineChunk(() => import('../components/GardenBattle'))

/** The panel's people (contributors leaderboard) and weeds tabs. */
export const contributorsTabChunk = defineChunk(() => import('../components/ContributorsTab'))
export const weedsTabChunk = defineChunk(() => import('../components/WeedsTab'))

/** The metro layout engine (graph/metro), loaded when metro is picked or was the saved layout. */
export const metroChunk = defineChunk(() => import('../graph/metro'))

/**
 * The pull request overlay's GitHub client (api/pulls) and the node inspector's pull request block,
 * one chunk, loaded as soon as a repo's data is in (usePulls), so it is there before a tip is opened.
 */
export const pullsChunk = defineChunk(() => import('./pullsPart'))
