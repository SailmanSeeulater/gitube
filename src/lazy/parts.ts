/**
 * The parts of repo-garden that load only when they are used, each its own chunk. Growing a repo
 * and looking at it in the organic layout needs none of them, so a first visit downloads none.
 *
 * Everything else is eager on purpose: the graph and its canvas (react-force-graph), the GitHub
 * client, the branch list, the legend and the theme data (the boot script and the first paint
 * need it; only the picker is lazy). Every dynamic import() of the app is here, so this file is
 * the list of what is lazy.
 */
import { defineChunk } from './chunk'

/** The image and data encoders and the saved-file reader, for the save menu, Open and file drops. */
export const exportersChunk = defineChunk(() => import('../export/exporters'))

/** The save menu; the encoders come with it, so a save runs at once from the click. */
export const exportMenuChunk = defineChunk(async () => {
  const [menu] = await Promise.all([import('../components/ExportMenu'), exportersChunk.load()])
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
