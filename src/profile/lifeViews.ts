/**
 * Person mode's three views (PROFILE_SPEC.md section 5) and their switcher: the life garden, life
 * lines and the constellation, each as a LifeViewDef (lifeView.ts) that one canvas host (LifeView),
 * one painter (makeViewPaint), the labels, the time-lapse and the poster all drive the same way.
 *
 * switchView is the switcher's one way to change the view: it sends view-switch with the view only
 * (no name ever goes with it), and only for a real change.
 */
import { track } from '../analytics/umami'
import type { PersonView } from '../share/shareUrl'
import type { LifeViewDef } from './lifeView'
import { layoutLifeGarden } from './lifeGardenLayout'
import { GARDEN_SCENE } from './lifePaint'
import { layoutLifeLines, type LifeLinesLayout } from './lifeLinesLayout'
import { linesGeom, type LinesGeom } from './lifeLinesGeometry'
import { hitLifeLines } from './lifeLinesHit'
import { lineColour, linesAnchor, linesKeepOut, linesLabelOrder, paintLifeLines } from './lifeLinesPaint'
import { layoutConstellation, type ConstellationLayout } from './constellationLayout'
import { constellationGeom, type ConstellationGeom } from './constellationGeometry'
import { hitConstellation } from './constellationHit'
import { constellationKeepOut, paintConstellation, starAnchor, starColour, starLabelOrder } from './constellationPaint'
import type { LifeGardenLayout, PlantGeom } from './lifeTypes'

/** The life garden: each repo a plant rooted where the person's part in it starts. */
export const GARDEN_VIEW: LifeViewDef<LifeGardenLayout, PlantGeom[]> = {
  id: 'garden',
  title: 'life garden',
  layout: layoutLifeGarden,
  scene: GARDEN_SCENE,
}

/** Life lines: each repo a line through time, thick while active and thin while dormant, like a tube map. */
export const LINES_VIEW: LifeViewDef<LifeLinesLayout, LinesGeom> = {
  id: 'lines',
  title: 'life lines',
  layout: layoutLifeLines,
  scene: {
    items: (layout) => layout.lines,
    geoms: linesGeom,
    paint: paintLifeLines,
    hit: hitLifeLines,
    anchor: linesAnchor,
    labelOrder: linesLabelOrder,
    keepOut: linesKeepOut,
    itemColour: (layout, i, ink, colourOf) => lineColour(layout.lines[i], ink, colourOf),
  },
}

/** The constellation: each repo a star where their part in it starts, in its language's row. */
export const CONSTELLATION_VIEW: LifeViewDef<ConstellationLayout, ConstellationGeom> = {
  id: 'constellation',
  title: 'constellation',
  layout: layoutConstellation,
  scene: {
    items: (layout) => layout.stars,
    geoms: constellationGeom,
    paint: paintConstellation,
    hit: hitConstellation,
    anchor: starAnchor,
    labelOrder: starLabelOrder,
    keepOut: constellationKeepOut,
    itemColour: (layout, i, ink, colourOf) => starColour(layout.stars[i], ink, colourOf),
  },
}

/** Every view by its id (the share link's view=). */
export const LIFE_VIEWS: { readonly [V in PersonView]: LifeViewDef } = {
  garden: GARDEN_VIEW,
  lines: LINES_VIEW,
  constellation: CONSTELLATION_VIEW,
}

/** The switcher's options, in its order. */
export const VIEW_OPTIONS: ReadonlyArray<{ value: PersonView; label: string }> = [
  { value: 'garden', label: 'garden' },
  { value: 'lines', label: 'lines' },
  { value: 'constellation', label: 'constellation' },
]

/** Shows next in place of current: counts it (view-switch, with the view and nothing else) and sets it; nothing for the same view. */
export function switchView(current: PersonView, next: PersonView, set: (view: PersonView) => void): void {
  if (next === current) return
  track('view-switch', { view: next })
  set(next)
}
