/**
 * The life garden in screen px: a plant of the layout, under a camera, in a viewport. The painter and
 * the hit test both read a plant through plantGeom, so what is hovered is what is drawn.
 *
 * A stem is one quadratic curve from its root on the horizon to its head, so zoom moves plants apart
 * along x and never stretches them, and every glyph is drawn in screen px. Stem time t runs from 0 at
 * the root to 1 at the head; the layout's stem parts and leaves are placed by it.
 */
import { DROOP, stemWidthPx } from '../components/gardenLook'
import type { LifeCamera, LifeLeaf, LifePlant, LifeViewport, PlantGeom } from './lifeTypes'

/** The plot's frame in CSS px (LifeGarden's LifeViewport): room for the top bar above it... */
export const VIEW_TOP = 72
/** ...and a margin either side. */
export const VIEW_SIDE = 28
/**
 * How far under the horizon the ground's marks reach: the language ribbon, the year labels and
 * today's label under them (lifeGardenPaint.ts draws the last one's 10 px text from 23 px down), and
 * the roots. Pinned against the painter in tests/lifeGeometry.test.ts.
 */
export const GROUND_MARKS_PX = 36
/**
 * The room the status strip (PersonStatus) takes at the canvas's foot: 16 px under it, its one row
 * about 34 px tall, and a 10 px margin above it.
 */
export const STRIP_CLEARANCE = 16 + 34 + 10
/** The room under the horizon: the ground's marks, all of them above the status strip. */
export const VIEW_GROUND = GROUND_MARKS_PX + STRIP_CLEARANCE

/** Each row back roots this much higher... */
export const ROW_LIFT_PX = 6
/** ...and draws this much smaller. */
export const ROW_SHRINK = 0.1
/** The shortest stem, so a plant with little weight still shows. */
const MIN_STEM_PX = 8
/** How far a head sits to the side of its root, at most, as a share of the stem's height... */
const LEAN = 0.18
/** ...how far the stem bows sideways at most... */
const BEND = 0.12
/** ...and how far a dry plant's head hangs to the side. */
const HANG = 0.22
/** A bud's body radius, and the least a seedling's head shrinks to. */
const BUD_R = 2.4
/** A head's body radius: this, plus BLOOM_R times its 0..1 star size. */
const HEAD_R = 2.2
const BLOOM_R = 7.8
/** A seedling (no counted commits) draws its head and stem smaller. */
const SEEDLING_HEAD = 0.5
const SEEDLING_STEM = 0.6

/** The horizon's y: the plot's bottom, with the ground's room under it. */
export function horizonY(view: LifeViewport): number {
  return view.height - view.ground
}

/** A row's scale: 1 at the front. */
export function rowScale(row: number): number {
  return 1 - ROW_SHRINK * row
}

/** A head's body radius before the row scale: a bud's, or sized by stars (a wilted head too). */
function headRadius(plant: LifePlant): number {
  if (plant.tip === 'bud') return BUD_R
  const r = HEAD_R + BLOOM_R * plant.bloom
  return plant.seedling ? Math.max(BUD_R, r * SEEDLING_HEAD) : r
}

export function plantGeom(plant: LifePlant, camera: LifeCamera, view: LifeViewport): PlantGeom {
  const scale = rowScale(plant.row)
  const ground = horizonY(view)
  const x0 = camera.tx + plant.x * camera.k
  const y0 = ground - ROW_LIFT_PX * plant.row
  const h = Math.max(MIN_STEM_PX, Math.max(0, ground - view.top) * plant.height * scale)
  const topX = x0 + plant.lean * LEAN * h
  const topY = y0 - h
  let cx: number
  let cy: number
  let x2: number
  let y2: number
  if (plant.dry) {
    // The stem rises to its full height and arcs over, and the head hangs DROOP of that height below
    // the top, to the side it leans to. The control point sits above the top by sqrt(DROOP) of the
    // height, where the curve's highest point is the top itself (at t = 1 / (1 + sqrt(DROOP))), so a
    // dry plant stands as tall as a live one of the same weight and only its head droops.
    cx = topX
    cy = y0 - h * (1 + Math.sqrt(DROOP))
    x2 = topX + (plant.lean < 0 ? -1 : 1) * HANG * h
    y2 = y0 - h * (1 - DROOP)
  } else {
    // The control point is the stem's middle, moved sideways (across the stem) by its bend.
    x2 = topX
    y2 = topY
    const len = Math.hypot(x2 - x0, y2 - y0)
    const off = plant.bend * BEND * h
    cx = (x0 + x2) / 2 + (-(y2 - y0) / len) * off
    cy = (y0 + y2) / 2 + ((x2 - x0) / len) * off
  }
  return {
    x0,
    y0,
    cx,
    cy,
    x2,
    y2,
    scale,
    width: stemWidthPx(plant.reach) * scale * (plant.seedling ? SEEDLING_STEM : 1),
    tipR: headRadius(plant) * scale,
  }
}

/** The stem's point at stem time t (0 root .. 1 head). */
export function pointAt(g: PlantGeom, t: number): [number, number] {
  const u = 1 - t
  return [u * u * g.x0 + 2 * u * t * g.cx + t * t * g.x2, u * u * g.y0 + 2 * u * t * g.cy + t * t * g.y2]
}

/** The stem's direction at stem time t, as a canvas angle (radians; -PI/2 is straight up). */
export function tangentAt(g: PlantGeom, t: number): number {
  const dx = 2 * (1 - t) * (g.cx - g.x0) + 2 * t * (g.x2 - g.cx)
  const dy = 2 * (1 - t) * (g.cy - g.y0) + 2 * t * (g.y2 - g.cy)
  return dx === 0 && dy === 0 ? -Math.PI / 2 : Math.atan2(dy, dx)
}

/**
 * The stretch of the stem from t0 to t1 (each clamped to 0..1) as a quadratic of its own:
 * [start x, start y, control x, control y, end x, end y]. Drawing every stem part this way traces
 * the whole stem exactly.
 */
export function subQuad(g: PlantGeom, t0: number, t1: number): [number, number, number, number, number, number] {
  const a = Math.min(1, Math.max(0, t0))
  const b = Math.min(1, Math.max(a, t1))
  const [sx, sy] = pointAt(g, a)
  const [ex, ey] = pointAt(g, b)
  // the control point is the start plus half the span's length of the curve's derivative there
  const half = b - a
  const dx = (1 - a) * (g.cx - g.x0) + a * (g.x2 - g.cx)
  const dy = (1 - a) * (g.cy - g.y0) + a * (g.y2 - g.cy)
  return [sx, sy, sx + half * dx, sy + half * dy, ex, ey]
}

/** Where a leaf sits on the stem, which way it points (off the stem, by its side) and its size, in px. */
export function leafGeom(g: PlantGeom, leaf: LifeLeaf, turn: number): { x: number; y: number; angle: number; length: number; width: number } {
  const [x, y] = pointAt(g, leaf.t)
  const length = (4 + 9 * leaf.size) * g.scale
  return { x, y, angle: tangentAt(g, leaf.t) + leaf.side * (0.95 + (turn - 0.5) * 0.3), length, width: 0.38 * length }
}
