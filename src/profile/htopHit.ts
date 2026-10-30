/**
 * What the pointer is over in the htop view: a row's meter (as far as the time-lapse has filled it,
 * with its brackets) or its PID in the gutter, else a milestone marker on the horizon or a day
 * (axisHover). Labels are hit before this, by the label placer that drew them.
 *
 * Only the rows within reach of the pointer are looked at, at least HTOP_MIN_HIT_PX either side
 * however tightly they pack; the nearest row's middle wins, the upper on a tie. Rows in notDrawn (the
 * hidden ones, and those the time-lapse has not reached) are skipped, as they are not drawn.
 */
import type { LifeCamera, LifeHover, LifeViewport } from './lifeTypes'
import { axisHover, onCanvas } from './lifeView'
import type { HtopLayout } from './htopLayout'
import { HTOP_GUTTER_PX, HTOP_MIN_HIT_PX, HTOP_X_SLOP_PX, htopDrawnTo, rowY, type HtopGeom } from './htopGeometry'

export function hitHtop(
  layout: HtopLayout,
  g: HtopGeom,
  camera: LifeCamera,
  view: LifeViewport,
  sx: number,
  sy: number,
  notDrawn: ReadonlySet<string>,
  at: number | null,
): LifeHover {
  if (!onCanvas(view, sx, sy)) return null
  const { rows } = layout
  if (rows.length > 0 && g.pitch > 0 && sy >= g.top - HTOP_MIN_HIT_PX && sy <= g.bottom + HTOP_MIN_HIT_PX) {
    const reach = Math.max(g.pitch / 2, HTOP_MIN_HIT_PX)
    const from = Math.max(0, Math.floor((sy - reach - g.top) / g.pitch))
    const to = Math.min(rows.length - 1, Math.floor((sy + reach - g.top) / g.pitch))
    const gutter = sx < HTOP_GUTTER_PX
    let best = -1
    let bestD = Infinity
    for (let i = from; i <= to; i++) {
      const row = rows[i]
      if (notDrawn.has(row.key)) continue
      const end = htopDrawnTo(row, layout.startDay, at)
      if (end < row.x0) continue
      const d = Math.abs(sy - rowY(g, i))
      if (d > reach) continue
      const a = camera.tx + row.x0 * camera.k - HTOP_X_SLOP_PX
      const b = camera.tx + end * camera.k + HTOP_X_SLOP_PX
      if (!gutter && (sx < a || sx > b)) continue
      if (d < bestD) {
        best = i
        bestD = d
      }
    }
    if (best >= 0) return { kind: 'repo', key: rows[best].key }
  }
  return axisHover(layout, camera, view, sx, sy)
}
