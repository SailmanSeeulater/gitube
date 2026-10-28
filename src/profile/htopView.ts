/**
 * The htop view (a console view of person mode): a system monitor's process list, one row per repo
 * in lane order, each a meter along the shared time axis lit where the repo was active. Its layout
 * (htopLayout), geometry (htopGeometry), drawing, labels (htopPaint) and hit test (htopHit) as one
 * LifeViewDef for lifeViews.ts.
 */
import type { LifeViewDef } from './lifeView'
import { layoutHtop, type HtopLayout } from './htopLayout'
import { htopGeom, type HtopGeom } from './htopGeometry'
import { hitHtop } from './htopHit'
import { htopInk } from '../theme/console/htop'
import { htopAnchor, htopKeepOut, htopLabelOrder, htopRowColour, paintHtop } from './htopPaint'

/** htop: each repo a meter row, lit while active and dim while dormant, on a terminal's dark screen. */
export const HTOP_VIEW: LifeViewDef<HtopLayout, HtopGeom> = {
  id: 'htop',
  title: 'htop',
  layout: layoutHtop,
  scene: {
    items: (layout) => layout.rows,
    geoms: htopGeom,
    paint: paintHtop,
    hit: hitHtop,
    anchor: htopAnchor,
    labelOrder: htopLabelOrder,
    keepOut: htopKeepOut,
    itemColour: (layout, i) => htopRowColour(layout.rows[i]),
  },
  ink: htopInk,
}
