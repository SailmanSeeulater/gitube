/**
 * Pure geometry for the time-lapse: stems drawn part of the way along a link, nodes popping in.
 * Works on plain numbers so it can be tested without a canvas; RepoGraph turns the results into paths.
 */

/** A node's scale while it grows in (g 0..1): a quick pop that overshoots a little and settles. */
export function popScale(g: number): number {
  if (g <= 0) return 0
  if (g >= 1) return 1
  // easeOutBack
  const c1 = 1.70158
  const c3 = c1 + 1
  const u = g - 1
  return 1 + c3 * u * u * u + c1 * u * u
}

/**
 * The first f (0..1) of a quadratic Bezier from p0 through control c to p2, as a shorter quadratic
 * from p0: [control x, control y, end x, end y] (de Casteljau split at f).
 */
export function partialQuad(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  f: number,
): [number, number, number, number] {
  const t = Math.min(1, Math.max(0, f))
  const qx = x0 + (cx - x0) * t
  const qy = y0 + (cy - y0) * t
  const rx = cx + (x2 - cx) * t
  const ry = cy + (y2 - cy) * t
  return [qx, qy, qx + (rx - qx) * t, qy + (ry - qy) * t]
}

/**
 * The first f (0..1) of a polyline's length, as a new flat [x, y, ...] list starting at its first
 * point. Fewer than two points come back unchanged.
 */
export function partialPolyline(pts: ArrayLike<number>, f: number): number[] {
  const n = pts.length >> 1
  if (n < 2) return Array.from(pts)
  if (f >= 1) return Array.from(pts)
  let total = 0
  for (let i = 1; i < n; i++) total += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1])
  const out = [pts[0], pts[1]]
  let room = Math.max(0, f) * total
  for (let i = 1; i < n && room > 0; i++) {
    const ax = pts[2 * i - 2]
    const ay = pts[2 * i - 1]
    const bx = pts[2 * i]
    const by = pts[2 * i + 1]
    const len = Math.hypot(bx - ax, by - ay)
    if (len <= room) {
      out.push(bx, by)
      room -= len
    } else {
      const u = room / len
      out.push(ax + (bx - ax) * u, ay + (by - ay) * u)
      room = 0
    }
  }
  return out
}
