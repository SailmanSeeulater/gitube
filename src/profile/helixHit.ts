/**
 * What the pointer is over in the helix: a thread (its drawn stretch, as far as the time-lapse has
 * wound it, or its start dot), else whatever the shared axis says (a milestone on the horizon, or
 * the day under the pointer). Labels are hit before this, by the label placer that drew them.
 *
 * Every drawn thread's segments are measured to, the nearest within reach winning and the earlier
 * in paint order on a tie; threads in notDrawn (hidden, or not wound on by the time-lapse) are
 * skipped, as they are not drawn. The points are helixGeometry's walkSpan, the same the painter
 * joins, so what is hovered is what is drawn.
 */
import type { LifeCamera, LifeHover, LifeViewport } from './lifeTypes'
import { axisHover, onCanvas } from './lifeView'
import type { HelixLayout } from './helixLayout'
import { START_PX, drawnTo, pointAt, spanWidth, walkSpan, wound, type HelixGeom } from './helixGeometry'

/** A thread is hit this far beyond half its width, and at least MIN_HIT_PX from its line. */
const SLOP_PX = 3
const MIN_HIT_PX = 4

/** The distance from (px, py) to the segment (ax, ay)-(bx, by). */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** The hover at screen (sx, sy); g is helixGeom's for this camera and view. Null off the canvas or the life. */
export function hitHelix(
  layout: HelixLayout,
  g: HelixGeom,
  camera: LifeCamera,
  view: LifeViewport,
  sx: number,
  sy: number,
  notDrawn: ReadonlySet<string>,
  at: number | null,
): LifeHover {
  if (!onCanvas(view, sx, sy)) return null
  const { threads } = layout
  const W = view.width
  let best = -1
  let bestD = Infinity
  let ax = 0
  let ay = 0
  let first = true
  let reach = 0
  const visit = (x: number, y: number) => {
    if (!first) {
      const d = segmentDistance(sx, sy, ax, ay, x, y)
      if (d <= reach && d < bestD) bestD = d
    }
    ax = x
    ay = y
    first = false
  }
  for (let i = 0; i < threads.length; i++) {
    const thread = threads[i]
    if (notDrawn.has(thread.key) || !wound(thread, at)) continue
    const r = g.ring[thread.track]
    // off the canvas, slant and all
    const left = camera.tx + thread.x0 * camera.k - g.skew
    const right = camera.tx + drawnTo(thread, layout.startDay, at) * camera.k + g.skew
    if (right < -MIN_HIT_PX || left > W + MIN_HIT_PX) continue
    const to = drawnTo(thread, layout.startDay, at)
    const before = bestD
    for (const span of thread.spans) {
      if (!(to > span.x0)) break
      reach = Math.max(MIN_HIT_PX, spanWidth(span, g) / 2 + SLOP_PX)
      first = true
      walkSpan(layout, g, r, span, to, visit)
    }
    // its start dot
    const [dx, dy] = pointAt(layout, g, r, thread.x0)
    const d = Math.hypot(sx - dx, sy - dy)
    if (d <= START_PX + SLOP_PX && d < bestD) bestD = d
    if (bestD < before) best = i
  }
  if (best >= 0) return { kind: 'repo', key: threads[best].key }
  return axisHover(layout, camera, view, sx, sy)
}
