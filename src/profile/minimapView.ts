/**
 * The minimap view (a console view): each repo a line of code in a dark code editor, its active
 * spans syntax tokens along the shared time axis, with line numbers, a file tab and a minimap strip.
 * Laid out by minimapLayout, drawn by minimapPaint, hit by minimapHit.
 */
import type { LifeViewDef } from './lifeView'
import { layoutMinimap, minimapGeom, type MinimapGeom, type MinimapLayout } from './minimapLayout'
import { hitMinimap } from './minimapHit'
import { minimapInk } from '../theme/console/minimap'
import { minimapAnchor, rowColour, minimapKeepOut, minimapLabelOrder, paintMinimap } from './minimapPaint'

export const MINIMAP_VIEW: LifeViewDef<MinimapLayout, MinimapGeom> = {
  id: 'minimap',
  title: 'minimap',
  layout: layoutMinimap,
  scene: {
    items: (layout) => layout.rows,
    geoms: minimapGeom,
    paint: paintMinimap,
    hit: hitMinimap,
    anchor: minimapAnchor,
    labelOrder: minimapLabelOrder,
    keepOut: minimapKeepOut,
    itemColour: (layout, i) => rowColour(layout.rows[i]),
  },
  ink: minimapInk,
}
