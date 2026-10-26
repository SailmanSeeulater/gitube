/**
 * What the pointer is over in the constellation: a star, a milestone marker on the horizon, or a day
 * anywhere else. Labels are hit before this, by the label placer that drew them.
 *
 * Stars are tried front to back (the reverse of paint order), so the star drawn on top wins; stars
 * not drawn (hidden, or not sown yet by the time-lapse) are skipped. Geometry comes from
 * constellationGeom and the radius as grown by then, the same the painter draws with.
 */
import type { LifeCamera, LifeHover, LifeViewport } from './lifeTypes'
import { axisHover, onCanvas } from './lifeView'
import type { ConstellationLayout } from './constellationLayout'
import type { ConstellationGeom } from './constellationGeometry'
import { grownRadius, starGrownShare } from './constellationPaint'

/** A star is hit this far beyond its core... */
const STAR_SLOP_PX = 3
/** ...and never closer in than this to its centre, however small it is. */
const MIN_STAR_HIT_PX = 5

/**
 * The hover at screen (sx, sy): a star not in notDrawn, else the axis's milestone or day (axisHover).
 * Off the canvas, or outside the life's days away from any marker, it is null.
 */
export function hitConstellation(
  layout: ConstellationLayout,
  g: ConstellationGeom,
  camera: LifeCamera,
  view: LifeViewport,
  sx: number,
  sy: number,
  notDrawn: ReadonlySet<string>,
  at: number | null,
): LifeHover {
  if (!onCanvas(view, sx, sy)) return null
  for (let i = layout.stars.length - 1; i >= 0; i--) {
    const star = layout.stars[i]
    if (notDrawn.has(star.key) || (at !== null && star.startDay > at)) continue
    const reach = Math.max(MIN_STAR_HIT_PX, grownRadius(g.r[i], starGrownShare(star, at)) + STAR_SLOP_PX)
    if (Math.hypot(sx - g.x[i], sy - g.y[i]) <= reach) return { kind: 'repo', key: star.key }
  }
  return axisHover(layout, camera, view, sx, sy)
}
