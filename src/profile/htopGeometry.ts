/**
 * The htop view in screen px: the header strip of years at the plot's top, the rows under it from
 * the top down, the PID gutter at the canvas's left, and the meters' ticks, all from the viewport
 * alone. The painter, the labels and the hit test read the same geometry, so what is hovered is what
 * is drawn.
 *
 * Rows are at most HTOP_MAX_PITCH apart and pack tighter when there are more than fit (one per repo,
 * never two on a row), down to a fraction of a pixel; then the brackets and most gutter numbers go
 * and the meters are solid, and the hit test still reaches HTOP_MIN_HIT_PX either side of the pointer.
 * Ticks sit on a grid of HTOP_CELL_PX screen px that pans with the camera, so a zoom adds ticks and
 * never widens them, as a terminal's character cells.
 */
import { horizonY } from './lifeGeometry'
import type { LifeCamera, LifeViewport } from './lifeTypes'
import type { HtopLayout, HtopRow } from './htopLayout'

/** The PID gutter's width at the canvas's left (inside the fitted camera's side margin). */
export const HTOP_GUTTER_PX = 26
/** The header strip of years at the plot's top. */
export const HTOP_HEADER_PX = 16
/** Room kept between the last row and the horizon. */
export const HTOP_FOOT_PX = 8
/** Rows are never further apart than this. */
export const HTOP_MAX_PITCH = 14
/** At this pitch and above a row has its brackets, gaps between its ticks and its own PID. */
export const HTOP_DETAIL_PITCH = 7
/** A tick's cell, and the tick in it. */
export const HTOP_CELL_PX = 3
export const HTOP_TICK_PX = 2
/** A row is hit within this many px of its middle at least, however tight the rows pack. */
export const HTOP_MIN_HIT_PX = 3
/** A meter is hit this far beyond its ends (its brackets). */
export const HTOP_X_SLOP_PX = 4
/** A tick's height as a share of the pitch, and its most. */
const TICK_SHARE = 0.72
const MAX_TICK_PX = 10
/** Gutter numbers no closer than this. */
const PID_MIN_GAP_PX = 10

export interface HtopGeom {
  /** the camera it was made under: screen x = camera.tx + world x * camera.k */
  camera: LifeCamera
  /** the header strip's top and the first row's top */
  headerTop: number
  top: number
  /** where the rows end: the plot's bottom */
  bottom: number
  /** px from one row to the next */
  pitch: number
  rows: number
  /** a tick's height */
  tickPx: number
  /** brackets, tick gaps and every row's PID */
  detail: boolean
  /** a PID on every this many rows */
  pidEvery: number
}

export function htopGeom(layout: Pick<HtopLayout, 'rows'>, camera: LifeCamera, view: LifeViewport): HtopGeom {
  const headerTop = view.top
  const top = headerTop + HTOP_HEADER_PX
  const bottom = Math.max(top, horizonY(view) - HTOP_FOOT_PX)
  const rows = layout.rows.length
  const pitch = Math.min(HTOP_MAX_PITCH, (bottom - top) / Math.max(1, rows))
  return {
    camera,
    headerTop,
    top,
    bottom,
    pitch,
    rows,
    tickPx: Math.max(Math.min(1, pitch), Math.min(MAX_TICK_PX, pitch * TICK_SHARE)),
    detail: pitch >= HTOP_DETAIL_PITCH,
    pidEvery: pitch > 0 ? Math.max(1, Math.ceil(PID_MIN_GAP_PX / pitch)) : 1,
  }
}

/** A row's middle. */
export function rowY(g: Pick<HtopGeom, 'top' | 'pitch'>, row: number): number {
  return g.top + (row + 0.5) * g.pitch
}

// ---------- the time-lapse: what of a meter is drawn by its day (paint, hit and labels agree) ----------

/** World x the meter is filled to by the time-lapse's day: its end, or the day reached. */
export function htopDrawnTo(row: Pick<HtopRow, 'x1'>, startDay: number, at: number | null): number {
  return at === null ? row.x1 : Math.min(row.x1, at - startDay)
}

/** Whether the time-lapse has sown the row (any of it is drawn). */
export function htopSown(row: Pick<HtopRow, 'startDay'>, at: number | null): boolean {
  return at === null || row.startDay <= at
}
