/**
 * What the pointer is over in the phosphor view: a stack, a milestone marker on the horizon, or a
 * day anywhere else. Labels are hit before this, by the label placer that drew them.
 *
 * Stacks are tried front to back (the reverse of paint order, so the shorter stack drawn over a
 * taller one wins); stacks not drawn (hidden, or not reached yet by the time-lapse) are skipped. A
 * stack is hit from its head block, as drawn by then, down to the ground, a little wider than it is
 * drawn: the same geometry the painter reads (phosphorGeom, blocksAt, headTop).
 */
import type { LifeCamera, LifeHover, LifeViewport } from './lifeTypes'
import { axisHover, onCanvas } from './lifeView'
import type { PhosphorLayout } from './phosphorLayout'
import { BLOCK_PX, blocksAt, headTop, type PhosphorGeom } from './phosphorGeometry'

/** A stack is hit this far beyond its blocks... */
const STACK_SLOP_PX = 2
/** ...and never narrower than this either side of its centre line. */
const MIN_HALF_PX = 4

/** The hover at screen (sx, sy): a stack not in notDrawn, else the axis's milestone or day (axisHover). */
export function hitPhosphor(
  layout: PhosphorLayout,
  g: PhosphorGeom,
  camera: LifeCamera,
  view: LifeViewport,
  sx: number,
  sy: number,
  notDrawn: ReadonlySet<string>,
  at: number | null,
): LifeHover {
  if (!onCanvas(view, sx, sy)) return null
  for (let i = layout.stacks.length - 1; i >= 0; i--) {
    const stack = layout.stacks[i]
    if (notDrawn.has(stack.key) || (at !== null && stack.startDay > at)) continue
    const half = Math.max(MIN_HALF_PX, Math.max(g.head[i], BLOCK_PX) / 2 + STACK_SLOP_PX)
    if (Math.abs(sx - g.x[i]) > half) continue
    const top = headTop(g, i, blocksAt(stack, g.blocks[i], at)) - STACK_SLOP_PX
    if (sy >= top && sy <= g.base + STACK_SLOP_PX) return { kind: 'repo', key: stack.key }
  }
  return axisHover(layout, camera, view, sx, sy)
}
