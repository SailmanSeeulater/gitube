/**
 * The helix view: person mode's life wound into a coil on an amber vector display, one turn a
 * year, each repo a thread on its own ring (helixLayout, helixGeometry, helixPaint, helixHit), over
 * the time axis every view shares.
 */
import type { LifeViewDef } from './lifeView'
import { layoutHelix, type HelixLayout } from './helixLayout'
import { helixGeom, type HelixGeom } from './helixGeometry'
import { hitHelix } from './helixHit'
import { helixInk } from '../theme/console/helix'
import { helixAnchor, helixColour, helixKeepOut, helixLabelOrder, paintHelix } from './helixPaint'

export const HELIX_VIEW: LifeViewDef<HelixLayout, HelixGeom> = {
  id: 'helix',
  title: 'helix',
  layout: layoutHelix,
  scene: {
    items: (layout) => layout.threads,
    geoms: helixGeom,
    paint: paintHelix,
    hit: hitHelix,
    anchor: helixAnchor,
    labelOrder: helixLabelOrder,
    keepOut: helixKeepOut,
    itemColour: (layout, i) => helixColour(layout.threads[i]),
  },
  ink: helixInk,
}
