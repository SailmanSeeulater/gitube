/**
 * Person mode's frame in screen px, which every view shares: the room above the plot, the margin
 * either side, the room under the horizon for the ground's marks and the status strip, and the
 * horizon itself.
 */
import type { LifeViewport } from './lifeTypes'

/** The plot's frame in CSS px (the canvas's LifeViewport): room for the top bar above it... */
export const VIEW_TOP = 72
/** ...and a margin either side. */
export const VIEW_SIDE = 28
/**
 * How far under the horizon the ground's marks reach: the language ribbon, the year labels and
 * today's label under them (lifeAxis.ts draws the last one's 10 px text from 23 px down). Pinned
 * against the axis painter in tests/lifeGeometry.test.ts.
 */
export const GROUND_MARKS_PX = 36
/**
 * The room the status strip (PersonStatus) takes at the canvas's foot: 16 px under it, its one row
 * about 34 px tall, and a 10 px margin above it.
 */
export const STRIP_CLEARANCE = 16 + 34 + 10
/** The room under the horizon: the ground's marks, all of them above the status strip. */
export const VIEW_GROUND = GROUND_MARKS_PX + STRIP_CLEARANCE

/** The horizon's y: the plot's bottom, with the ground's room under it. */
export function horizonY(view: LifeViewport): number {
  return view.height - view.ground
}
