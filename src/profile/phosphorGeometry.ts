/**
 * The phosphor view in screen px: every stack of the layout under a camera, in a viewport. The
 * painter, the hit test and the label anchors all read a stack through phosphorGeom and
 * stackTopAt, so what is hovered is what is drawn.
 *
 * x comes from the camera (a zoom spreads stacks apart and never widens them); blocks are a fixed
 * size in px, stacked from STACK_BASE_PX above the horizon, so a stack's block count follows the
 * plot's height and its share of it.
 */
import { revealedShare } from './lifeMeasures'
import { horizonY } from './lifeGeometry'
import type { LifeCamera, LifeViewport } from './lifeTypes'
import type { PhosphorLayout, PhosphorStack } from './phosphorLayout'

/** A body block's side... */
export const BLOCK_PX = 5
/** ...and the dark gap above each one. */
export const GAP_PX = 1
export const PITCH_PX = BLOCK_PX + GAP_PX
/** A head block's side: BLOCK_PX, plus HEAD_EXTRA_PX times its 0..1 star size. */
export const HEAD_EXTRA_PX = 6
/** The lowest block sits this far above the horizon line. */
export const STACK_BASE_PX = 2

/** Every stack in screen px, index-aligned with layout.stacks. */
export interface PhosphorGeom {
  /** the stack's centre line */
  x: Float64Array
  /** the foot of its lowest block */
  base: number
  /** body blocks, fully drawn */
  blocks: Int32Array
  /** the head block's side */
  head: Float64Array
}

/** A head block's side. */
export function headSide(stack: Pick<PhosphorStack, 'head'>): number {
  return BLOCK_PX + HEAD_EXTRA_PX * stack.head
}

export function phosphorGeom(layout: PhosphorLayout, camera: LifeCamera, view: LifeViewport): PhosphorGeom {
  const n = layout.stacks.length
  const plot = Math.max(0, horizonY(view) - view.top)
  const g: PhosphorGeom = { x: new Float64Array(n), base: horizonY(view) - STACK_BASE_PX, blocks: new Int32Array(n), head: new Float64Array(n) }
  layout.stacks.forEach((stack, i) => {
    g.x[i] = camera.tx + stack.x * camera.k
    g.head[i] = headSide(stack)
    // the stack, head included, stands as tall as its share of the plot
    g.blocks[i] = Math.max(0, Math.round((plot * stack.height - g.head[i]) / PITCH_PX))
  })
  return g
}

/** Body blocks drawn by the time-lapse's day: all of them when fully drawn, none on the day it is reached. */
export function blocksAt(stack: Pick<PhosphorStack, 'startDay' | 'endDay'>, blocks: number, at: number | null): number {
  return Math.min(blocks, Math.floor(blocks * revealedShare(stack, at) + 1e-9))
}

/** The top of the head block (screen y) once `drawnBlocks` body blocks stand under it. */
export function headTop(g: PhosphorGeom, i: number, drawnBlocks: number): number {
  return g.base - drawnBlocks * PITCH_PX - g.head[i]
}
