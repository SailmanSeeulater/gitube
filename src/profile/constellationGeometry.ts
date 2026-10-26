/**
 * The constellation in screen px: every star of the layout under a camera, in a viewport. The
 * painter, the hit test and the label anchors all read a star through constellationGeom, so what is
 * hovered is what is drawn.
 *
 * x comes from the camera (zoom spreads stars apart along time and never stretches them) and y from
 * the viewport only: the plot runs from the viewport's top to STAR_FOOT_PX above the horizon, so no
 * star sits on the milestones. Radii are in px, whatever the zoom.
 */
import { horizonY } from './lifeGeometry'
import type { LifeCamera, LifeViewport } from './lifeTypes'
import type { ConstellationLayout, LifeStar } from './constellationLayout'

/** The room between the plot's foot and the horizon. */
export const STAR_FOOT_PX = 10
/** A core's radius: STAR_MIN_R for the lightest star, up to STAR_MAX_R for the heaviest... */
export const STAR_MIN_R = 2.2
export const STAR_MAX_R = 8
/** ...and SEEDLING_R for a seedling, which has no weight. */
export const SEEDLING_R = 1.6
/** How far a full glow (10k stars) reaches beyond the core. */
export const GLOW_PX = 12

/** Every star in screen px, index-aligned with layout.stars, and every band's edges. */
export interface ConstellationGeom {
  /** a star's centre */
  x: Float64Array
  y: Float64Array
  /** its core's radius, fully grown */
  r: Float64Array
  /** how far its glow reaches beyond the core, fully grown */
  glow: Float64Array
  /** a band's top and foot, index-aligned with layout.bands */
  bandTop: Float64Array
  bandFoot: Float64Array
}

/** The plot's height in px: from the viewport's top to STAR_FOOT_PX above the horizon, never negative. */
export function starPlotHeight(view: LifeViewport): number {
  return Math.max(0, horizonY(view) - STAR_FOOT_PX - view.top)
}

/** Screen y of a share of the plot (0 at its top, 1 at its foot). */
export function starPlotY(view: LifeViewport, y: number): number {
  return view.top + y * starPlotHeight(view)
}

/** A star's core radius, fully grown. */
export function starRadius(star: Pick<LifeStar, 'size' | 'seedling'>): number {
  return star.seedling ? SEEDLING_R : STAR_MIN_R + (STAR_MAX_R - STAR_MIN_R) * star.size
}

export function constellationGeom(layout: ConstellationLayout, camera: LifeCamera, view: LifeViewport): ConstellationGeom {
  const n = layout.stars.length
  const g: ConstellationGeom = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    r: new Float64Array(n),
    glow: new Float64Array(n),
    bandTop: new Float64Array(layout.bands.length),
    bandFoot: new Float64Array(layout.bands.length),
  }
  layout.stars.forEach((star, i) => {
    g.x[i] = camera.tx + star.x * camera.k
    g.y[i] = starPlotY(view, star.y)
    g.r[i] = starRadius(star)
    g.glow[i] = GLOW_PX * star.glow
  })
  layout.bands.forEach((band, i) => {
    g.bandTop[i] = starPlotY(view, band.y0)
    g.bandFoot[i] = starPlotY(view, band.y1)
  })
  return g
}
