/**
 * The life lines in screen px: each track's y in the plot, and the widths and radii every line is
 * drawn with, from the viewport alone. The painter, the labels and the hit test all read the same
 * geometry, so what is hovered is what is drawn.
 *
 * Tracks are spread over the plot (a tall block of them packs tighter) and centred in it. Line
 * widths follow the track pitch, never the zoom: a zoom moves lines apart along x and never makes
 * them thicker. An active part is drawn at one of three widths, by its weight.
 *
 * Where a station is drawn is decided here too (stationMark), as the hit test must agree: on its own
 * day on its line, or, where its disc would cover its line's start marker (a first or top repo is
 * dated at its root), as a ring round that marker, which keeps the marker's dot in view.
 */
import { horizonY } from './lifeGeometry'
import type { LifeCamera, LifeViewport } from './lifeTypes'
import type { LifeLine, LifeLinesLayout, LineStation } from './lifeLinesLayout'

/** Room kept between the lowest track and the horizon. */
export const LINES_FOOT_PX = 10
/** Tracks are never further apart than this. */
export const LINES_MAX_PITCH = 16
/**
 * The least pitch the layout's packing keeps on the canvas host's usual frame for a profile of
 * hundreds of repos (its tests check 300 to 500): any closer, thick and thin look alike. A plot too
 * short for the tracks still packs them tighter rather than spill past it, and the hit test then
 * reaches across as many tracks as a line's slop spans.
 */
export const LINES_MIN_PITCH = 4
/** A full active line's width, as a share of the pitch, kept between these. */
const BASE_SHARE = 0.72
const MIN_BASE_PX = 1.25
const MAX_BASE_PX = 7
/** The thinnest active part draws at ACTIVE_FLOOR + ACTIVE_RANGE / 3 of the full width. */
const ACTIVE_FLOOR = 0.55
const ACTIVE_RANGE = 0.45
/** A dormant part, against the full width, and never thinner than MIN_DORMANT_PX. */
const DORMANT_SHARE = 0.22
const MIN_DORMANT_PX = 0.75
/** A start marker's radius: this share of the full width plus STATION_PAD_PX, between STATION_MIN and STATION_MAX. */
const STATION_SHARE = 0.6
const STATION_PAD_PX = 1.5
const STATION_MIN_PX = 2
const STATION_MAX_PX = 5
/** The ring of a start marker and of a station. */
export const MARKER_RING_PX = 1.5
/** A station's disc: this much larger than a start marker, and never smaller than STATION_DISC_MIN_PX. */
const STATION_GROW_PX = 1
const STATION_DISC_MIN_PX = 3
/** A hovered station draws this much larger. */
const STATION_HOVER_PX = 2

export interface LinesGeom {
  /** the camera it was made under: screen x = camera.tx + world x * camera.k */
  camera: LifeCamera
  /** each track's centre line, by track */
  trackY: Float32Array
  /** px from one track to the next */
  pitch: number
  /** an active part's width at each weight level: light, medium, heavy */
  activePx: readonly [number, number, number]
  dormantPx: number
  /** the start marker's radius; a station is drawn a little larger */
  stationR: number
}

/** An active part's weight level: 0 up to a third, 1 up to two thirds, 2 above. */
export function weightLevel(weight: number): 0 | 1 | 2 {
  return weight > 2 / 3 ? 2 : weight > 1 / 3 ? 1 : 0
}

/** The plot's top and bottom, where the tracks go. */
export function linesPlot(view: LifeViewport): { top: number; bottom: number } {
  const top = view.top
  return { top, bottom: Math.max(top, horizonY(view) - LINES_FOOT_PX) }
}

export function linesGeom(layout: Pick<LifeLinesLayout, 'tracks'>, camera: LifeCamera, view: LifeViewport): LinesGeom {
  const { top, bottom } = linesPlot(view)
  const plotH = bottom - top
  const tracks = Math.max(1, layout.tracks)
  const pitch = Math.min(LINES_MAX_PITCH, plotH / tracks)
  const first = top + (plotH - pitch * tracks) / 2 + pitch / 2
  const trackY = new Float32Array(layout.tracks)
  for (let t = 0; t < layout.tracks; t++) trackY[t] = first + t * pitch
  const base = Math.min(MAX_BASE_PX, Math.max(MIN_BASE_PX, pitch * BASE_SHARE))
  const width = (level: number) => base * (ACTIVE_FLOOR + ACTIVE_RANGE * level)
  return {
    camera,
    trackY,
    pitch,
    activePx: [width(1 / 3), width(2 / 3), width(1)],
    dormantPx: Math.max(MIN_DORMANT_PX, base * DORMANT_SHARE),
    stationR: Math.min(STATION_MAX_PX, Math.max(STATION_MIN_PX, base * STATION_SHARE + STATION_PAD_PX)),
  }
}

// ---------- the time-lapse: what of a line is drawn by its day (paint, hit and labels agree) ----------

/** World x the line is drawn to by the time-lapse's day: its drawn end, or the day reached. */
export function drawnTo(line: Pick<LifeLine, 'end'>, startDay: number, at: number | null): number {
  return at === null ? line.end : Math.min(line.end, at - startDay)
}

/** Whether the time-lapse has reached the line (any of it is drawn). */
export function isReached(line: Pick<LifeLine, 'startDay'>, at: number | null): boolean {
  return at === null || line.startDay <= at
}

/** Whether the time-lapse has reached the line's root, where its start marker is drawn. */
export function rooted(line: Pick<LifeLine, 'rootDay'>, at: number | null): boolean {
  return at === null || at >= line.rootDay
}

/** Whether the time-lapse has reached a station's day. */
export function stationReached(x: number, startDay: number, at: number | null): boolean {
  return at === null || at - startDay >= Math.floor(x)
}

// ---------- stations: a disc on the line, or a ring round its start marker ----------

/** A station's disc's radius, larger while hovered. */
export function stationRadius(g: Pick<LinesGeom, 'stationR'>, hovered = false): number {
  return Math.max(STATION_DISC_MIN_PX, g.stationR + STATION_GROW_PX) + (hovered ? STATION_HOVER_PX : 0)
}

/** The radius of a station's ring round a start marker: just clear of the marker's own ring. */
export function stationRingRadius(g: Pick<LinesGeom, 'stationR'>, hovered = false): number {
  return g.stationR + MARKER_RING_PX + (hovered ? STATION_HOVER_PX : 0)
}

/**
 * Where a station is drawn, in screen px: a ring round its line's start marker (once rooted) when its
 * disc would cover the marker's dot, else a disc on its own day. The painter and the hit test both
 * read it.
 */
export function stationMark(
  line: Pick<LifeLine, 'x' | 'rootDay' | 'track'>,
  station: Pick<LineStation, 'x'>,
  g: LinesGeom,
  at: number | null,
): { x: number; y: number; ring: boolean } {
  const { k, tx } = g.camera
  const x = tx + station.x * k
  const root = tx + line.x * k
  const y = g.trackY[line.track] ?? Number.NaN
  if (rooted(line, at) && Math.abs(x - root) < g.stationR + stationRadius(g)) return { x: root, y, ring: true }
  return { x, y, ring: false }
}
