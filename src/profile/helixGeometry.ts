/**
 * The helix in screen px: the coil's centre line and radius from the viewport, each ring's radius
 * by track, and the slant that gives the coil its depth. The painter, the hit test and the label
 * anchors all turn a sample (a world x and its angle) into the same point here, so what is hovered
 * is what is drawn.
 *
 * The coil's axis is the shared time axis: a sample's screen x is the camera's for its world x,
 * slanted by its depth (the near side of the coil a little to the right, the far side a little to
 * the left, by at most the plot's side margin, so the coil never leaves the canvas). Its screen y is
 * the coil's centre less its ring's radius times the cosine of its angle: January 1 at the top, the
 * middle of the year at the bottom. The first half of a year winds down the near side of the coil,
 * the second half back up the far side, which the painter draws dimmer.
 *
 * A zoom spreads the turns apart along x and never changes the coil's size, which the viewport
 * alone sets. Widths are px, thinned as the turns crowd together zoomed out (thin), so a whole life
 * at once reads as a coil of threads rather than a band.
 */
import { horizonY } from './lifeGeometry'
import type { LifeCamera, LifeViewport } from './lifeTypes'
import { angleAt, type HelixLayout, type HelixSpan, type HelixThread } from './helixLayout'

/** The axis coil keeps this far inside the plot's top and bottom. */
export const HELIX_MARGIN_PX = 10
/** The near side of the coil sits this share of its radius to the right of the far side... */
const SKEW_SHARE = 0.25
/** ...kept within the plot's side margin, less this, so the coil never leaves the canvas. */
const SKEW_INSET_PX = 2
/** Each ring in is smaller than the last by this share of the axis coil's radius... */
const RING_STEP_MAX = 0.035
/** ...and the innermost ring is never smaller than this share of it. */
const RING_INNER = 0.4
/** An active span's width at each weight level: light, medium, heavy. */
export const ACTIVE_PX: readonly [number, number, number] = [1, 1.8, 2.8]
/** A dormant span's width. */
export const DORMANT_PX = 0.6
/** A thread's start dot, where it is wound on: its radius. */
export const START_PX = 2
/** Threads draw at full width once a turn is this many px long along the axis... */
const TURN_FULL_PX = 160
/** ...and no thinner than this share of it when the turns crowd together, zoomed out. */
const THIN_MIN = 0.45

export interface HelixGeom {
  /** the camera it was made under: screen x = camera.tx + world x * camera.k, before the slant */
  camera: LifeCamera
  /** the coil's centre line */
  cy: number
  /** the axis coil's radius */
  R: number
  /** px the near side of the axis coil sits to the right of its axis (the far side as far left) */
  skew: number
  /** each ring's radius, by track */
  ring: Float64Array
  /** what every thread's width is scaled by: 1 with a turn TURN_FULL_PX long or more, down to THIN_MIN zoomed out */
  thin: number
}

/** An active span's weight level: 0 up to a third, 1 up to two thirds, 2 above. */
export function weightLevel(weight: number): 0 | 1 | 2 {
  return weight > 2 / 3 ? 2 : weight > 1 / 3 ? 1 : 0
}

/** A span's stroke width: by its weight level when active, DORMANT_PX when dormant, thinned with the geometry's zoom. */
export function spanWidth(span: Pick<HelixSpan, 'kind' | 'weight'>, g: Pick<HelixGeom, 'thin'>): number {
  return (span.kind === 'dormant' ? DORMANT_PX : ACTIVE_PX[weightLevel(span.weight)]) * g.thin
}

export function helixGeom(layout: Pick<HelixLayout, 'tracks'>, camera: LifeCamera, view: LifeViewport): HelixGeom {
  const top = view.top
  const bottom = horizonY(view)
  const R = Math.max(4, (bottom - top) / 2 - HELIX_MARGIN_PX)
  const step = Math.min(RING_STEP_MAX, (1 - RING_INNER) / Math.max(1, layout.tracks))
  const ring = new Float64Array(layout.tracks)
  for (let t = 0; t < layout.tracks; t++) ring[t] = R * (1 - step * t)
  return {
    camera,
    cy: (top + bottom) / 2,
    R,
    skew: Math.max(0, Math.min(R * SKEW_SHARE, view.side - SKEW_INSET_PX)),
    ring,
    thin: Math.min(1, Math.max(THIN_MIN, (camera.k * 365.25) / TURN_FULL_PX)),
  }
}

/** Screen x of a point on ring r at world x with sine s of its angle (the slant by its depth). */
export function pointX(g: HelixGeom, r: number, x: number, s: number): number {
  return g.camera.tx + x * g.camera.k + (r / g.R) * g.skew * s
}

/** Screen y of a point on ring r with cosine c of its angle. */
export function pointY(g: HelixGeom, r: number, c: number): number {
  return g.cy - r * c
}

/** The point on ring r at world x, as [x, y, near], near being the sine of its angle (positive on the near side). */
export function pointAt(layout: Pick<HelixLayout, 'yearStarts'>, g: HelixGeom, r: number, x: number): [number, number, number] {
  const a = angleAt(layout.yearStarts, x)
  const s = Math.sin(a)
  return [pointX(g, r, x, s), pointY(g, r, Math.cos(a)), s]
}

// ---------- the time-lapse: what of a thread is drawn by its day (paint, hit and labels agree) ----------

/** World x the thread is drawn to by the time-lapse's day: its end, or the day reached. */
export function drawnTo(thread: Pick<HelixThread, 'end'>, startDay: number, at: number | null): number {
  return at === null ? thread.end : Math.min(thread.end, at - startDay)
}

/** Whether the time-lapse has wound the thread on (its start dot is drawn). */
export function wound(thread: Pick<HelixThread, 'startDay'>, at: number | null): boolean {
  return at === null || thread.startDay <= at
}

/** Whether the time-lapse has reached a mark at world x (a day's middle). */
export function markReached(x: number, startDay: number, at: number | null): boolean {
  return at === null || at - startDay >= Math.floor(x)
}

/**
 * Walks the drawn stretch of a span, up to world x `to`, as screen points: its samples under `to`,
 * then the point at `to` itself (unless a sample sits there). Calls visit for each point in order
 * with its x, y and depth (the sine of its angle: positive on the near side). Returns how many.
 */
export function walkSpan(
  layout: Pick<HelixLayout, 'yearStarts' | 'sampleX' | 'sampleCos' | 'sampleSin'>,
  g: HelixGeom,
  r: number,
  span: Pick<HelixSpan, 'x0' | 'x1' | 'from' | 'count'>,
  to: number,
  visit: (x: number, y: number, depth: number) => void,
): number {
  if (!(to > span.x0)) return 0
  const end = Math.min(span.x1, to)
  let n = 0
  let last = -Infinity
  for (let k = span.from; k < span.from + span.count; k++) {
    const x = layout.sampleX[k]
    if (x > end) break
    const s = layout.sampleSin[k]
    visit(pointX(g, r, x, s), pointY(g, r, layout.sampleCos[k]), s)
    last = x
    n++
  }
  if (end > last) {
    const [x, y, s] = pointAt(layout, g, r, end)
    visit(x, y, s)
    n++
  }
  return n
}
