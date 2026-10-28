/**
 * What the pointer is over in the minimap view: a row's bar in the minimap strip (the strip is drawn
 * over everything at the canvas's right edge), a row's line number in the gutter, a row's drawn
 * stretch in the editor (its tokens and the whitespace between them, as far as the time-lapse has
 * drawn it), else the axis (axisHover: a milestone on the horizon, or the day under x). Rows in
 * notDrawn (hidden, or not sown by the time-lapse) are skipped, as they are not drawn. Geometry is
 * minimapLayout's, the same the painter draws with.
 */
import type { LifeCamera, LifeHover, LifeViewport } from './lifeTypes'
import { axisHover, onCanvas } from './lifeView'
import { drawnTo, rowY, sown, stripRowY, tokenSpan, type MinimapGeom, type MinimapLayout } from './minimapLayout'

/** A row is hit this far above and below its centre at least (half its pitch when that is more)... */
export const MIN_ROW_HIT_PX = 3
/** ...and this far past either end of its drawn stretch. */
export const ROW_SLOP_PX = 3
/** A row in the strip is hit this far above and below its bar at least. */
const STRIP_HIT_PX = 1.5

export function hitMinimap(
  layout: MinimapLayout,
  g: MinimapGeom,
  camera: LifeCamera,
  view: LifeViewport,
  sx: number,
  sy: number,
  notDrawn: ReadonlySet<string>,
  at: number | null,
): LifeHover {
  if (!onCanvas(view, sx, sy)) return null
  const { rows } = layout
  const drawn = (i: number) => {
    const row = rows[i]
    return row !== undefined && !notDrawn.has(row.key) && sown(row, at)
  }

  // the strip: the nearest drawn row's bar within reach
  const s = g.strip
  if (sx >= s.x0) {
    if (s.pitch > 0 && sy >= s.y0 - STRIP_HIT_PX && sy <= s.y1 + STRIP_HIT_PX) {
      const reach = Math.max(STRIP_HIT_PX, s.pitch / 2)
      const from = Math.max(0, Math.floor((sy - reach - s.y0) / s.pitch))
      const to = Math.min(rows.length - 1, Math.floor((sy + reach - s.y0) / s.pitch))
      let best = -1
      let bestD = Infinity
      for (let i = from; i <= to; i++) {
        if (!drawn(i)) continue
        const d = Math.abs(sy - (stripRowY(s, i) + s.barH / 2))
        if (d <= reach + s.barH / 2 && d < bestD) {
          best = i
          bestD = d
        }
      }
      if (best >= 0) return { kind: 'repo', key: rows[best].key }
    }
    return axisHover(layout, camera, view, sx, sy)
  }

  // the gutter and the editor: the nearest drawn row within reach, the earlier on a tie
  if (rows.length > 0 && g.pitch > 0 && sy >= g.rowsTop - MIN_ROW_HIT_PX && sy <= g.rowsBottom + MIN_ROW_HIT_PX) {
    const reach = Math.max(MIN_ROW_HIT_PX, g.pitch / 2)
    const inGutter = sx < g.gutterW
    const screenX = (x: number) => camera.tx + x * camera.k
    const from = Math.max(0, Math.floor((sy - reach - g.rowsTop) / g.pitch))
    const to = Math.min(rows.length - 1, Math.floor((sy + reach - g.rowsTop) / g.pitch))
    let best = -1
    let bestD = Infinity
    for (let i = from; i <= to; i++) {
      if (!drawn(i)) continue
      const d = Math.abs(sy - rowY(g, i))
      if (d > reach || d >= bestD) continue
      if (!inGutter) {
        const row = rows[i]
        const [a, b] = tokenSpan(screenX(row.x0), screenX(drawnTo(row, layout.startDay, at)))
        if (sx < a - ROW_SLOP_PX || sx > b + ROW_SLOP_PX) continue
      }
      best = i
      bestD = d
    }
    if (best >= 0) return { kind: 'repo', key: rows[best].key }
  }
  return axisHover(layout, camera, view, sx, sy)
}
