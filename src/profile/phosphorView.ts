/**
 * The phosphor view: person mode's life on a green-phosphor CRT, each repo a stack of blocks
 * rising from the ground where the person's part in it starts (phosphorLayout, phosphorGeometry,
 * phosphorPaint, phosphorHit), over the time axis every view shares.
 */
import type { LifeViewDef } from './lifeView'
import { layoutPhosphor, type PhosphorLayout } from './phosphorLayout'
import { phosphorGeom, type PhosphorGeom } from './phosphorGeometry'
import { hitPhosphor } from './phosphorHit'
import { phosphorInk } from '../theme/console/phosphor'
import { paintPhosphor, phosphorAnchor, phosphorColour, phosphorKeepOut, phosphorLabelOrder } from './phosphorPaint'

export const PHOSPHOR_VIEW: LifeViewDef<PhosphorLayout, PhosphorGeom> = {
  id: 'phosphor',
  title: 'phosphor',
  layout: layoutPhosphor,
  scene: {
    items: (layout) => layout.stacks,
    geoms: phosphorGeom,
    paint: paintPhosphor,
    hit: hitPhosphor,
    anchor: phosphorAnchor,
    labelOrder: phosphorLabelOrder,
    keepOut: phosphorKeepOut,
    itemColour: (layout, i) => phosphorColour(layout.stacks[i]),
  },
  ink: phosphorInk,
}
