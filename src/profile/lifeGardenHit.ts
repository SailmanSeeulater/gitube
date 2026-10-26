/**
 * What the pointer is over in the life garden: a plant (its stem or its head), a milestone marker on
 * the horizon, or a day anywhere else above or below it. Labels are hit before this, by the label
 * placer that drew them.
 *
 * Plants are tried front to back (the reverse of paint order), so the front row wins; hidden plants
 * are skipped, as they are not drawn. Geometry comes from plantGeom, the same the painter draws with.
 */
import { BLOOM_SCALE } from '../components/gardenPaint'
import { screenToWorldX } from './lifeCamera'
import { horizonY, pointAt } from './lifeGeometry'
import type { LifeCamera, LifeGardenLayout, LifeHover, LifeViewport, PlantGeom } from './lifeTypes'

/** Points sampled along a stem; the stem is hit within a capsule round the polyline through them... */
const STEM_SAMPLES = 8
/** ...this far beyond its half width, and never narrower than MIN_STEM_HIT_PX. */
const STEM_SLOP_PX = 3
const MIN_STEM_HIT_PX = 4
/** A head is hit this far beyond its flower's reach. */
const TIP_SLOP_PX = 3
/** A milestone marker is hit within this distance of its centre. */
const MILESTONE_HIT_PX = 6

/** The distance from (px, py) to the segment from (ax, ay) to (bx, by). */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const u = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy))
}

function hitsPlant(g: PlantGeom, sx: number, sy: number): boolean {
  if (Math.hypot(sx - g.x2, sy - g.y2) <= g.tipR * BLOOM_SCALE + TIP_SLOP_PX) return true
  const reach = Math.max(MIN_STEM_HIT_PX, g.width / 2 + STEM_SLOP_PX)
  let [ax, ay] = pointAt(g, 0)
  for (let i = 1; i < STEM_SAMPLES; i++) {
    const [bx, by] = pointAt(g, i / (STEM_SAMPLES - 1))
    if (segmentDistance(sx, sy, ax, ay, bx, by) <= reach) return true
    ax = bx
    ay = by
  }
  return false
}

/**
 * The hover at screen (sx, sy). geoms are layout.plants' geometries, index for index. Off the canvas,
 * or outside the life's days away from any marker, it is null.
 */
export function hitLifeGarden(
  layout: LifeGardenLayout,
  geoms: ReadonlyArray<PlantGeom>,
  camera: LifeCamera,
  view: LifeViewport,
  sx: number,
  sy: number,
  hidden: ReadonlySet<string>,
): LifeHover {
  if (!(sx >= 0 && sx <= view.width && sy >= 0 && sy <= view.height)) return null
  for (let i = layout.plants.length - 1; i >= 0; i--) {
    const plant = layout.plants[i]
    const g = geoms[i]
    if (g && !hidden.has(plant.key) && hitsPlant(g, sx, sy)) return { kind: 'repo', key: plant.key }
  }

  // the nearest marker, the earliest on a tie
  const y = horizonY(view)
  let marker: LifeGardenLayout['milestones'][number] | null = null
  let nearest = Infinity
  for (const m of layout.milestones) {
    const d = Math.hypot(sx - (camera.tx + m.x * camera.k), sy - y)
    if (d <= MILESTONE_HIT_PX && d < nearest) {
      marker = m
      nearest = d
    }
  }
  if (marker) return { kind: 'day', day: layout.startDay + Math.floor(marker.x), milestone: marker.index }

  const x = screenToWorldX(camera, sx)
  if (!(x >= 0 && x < layout.days)) return null
  return { kind: 'day', day: Math.min(layout.todayDay, layout.startDay + Math.floor(x)), milestone: null }
}
