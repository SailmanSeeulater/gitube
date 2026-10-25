/**
 * The life garden's camera: zoom and pan along the time axis only (screenX = tx + worldX * k, world x
 * in days), so plants spread apart as you zoom in and never stretch. The whole life fits at first; k
 * stays between that fit and LIFE_MAX_K, and pans stop at the life's ends. A life too short to fill
 * the plot even at LIFE_MAX_K (an account a few weeks old) is drawn at LIFE_MAX_K, centred, and the
 * camera stays put.
 *
 * Pure: the canvas host keeps the camera and calls these on input, on a change of size and on focus
 * requests.
 */
import type { LifeCamera, LifeViewport } from './lifeTypes'

/** The closest zoom, in px per day. */
export const LIFE_MAX_K = 24

/** The plot's width: between the margins, at least 1 px. */
function plotWidth(view: LifeViewport): number {
  return Math.max(1, view.width - 2 * view.side)
}

/** The widest zoom: the whole life across the plot, or LIFE_MAX_K for a life too short to fill it. */
function fitK(days: number, view: LifeViewport): number {
  return Math.min(LIFE_MAX_K, plotWidth(view) / Math.max(1, days))
}

/** The whole life, fitted to the plot (or centred at LIFE_MAX_K if it cannot fill it). */
export function fitLifeCamera(days: number, view: LifeViewport): LifeCamera {
  return clampLifeCamera({ k: fitK(days, view), tx: view.side }, days, view)
}

/**
 * k within [fit, LIFE_MAX_K], and tx so the life covers the plot: no gap at either end, or, when the
 * life is narrower than the plot, centred in it.
 */
export function clampLifeCamera(c: LifeCamera, days: number, view: LifeViewport): LifeCamera {
  const n = Math.max(1, days)
  const kMin = fitK(n, view)
  const k = Math.min(LIFE_MAX_K, Math.max(kMin, Number.isFinite(c.k) ? c.k : kMin))
  const plot = plotWidth(view)
  const span = n * k
  if (span <= plot) return { k, tx: view.side + (plot - span) / 2 }
  const tx = Number.isFinite(c.tx) ? c.tx : view.side
  return { k, tx: Math.min(view.side, Math.max(view.side + plot - span, tx)) }
}

/** Zoom by factor around screen x atX: the day under it stays under it, unless a clamp moves it. */
export function zoomLifeCamera(c: LifeCamera, factor: number, atX: number, days: number, view: LifeViewport): LifeCamera {
  const n = Math.max(1, days)
  const k = Math.min(LIFE_MAX_K, Math.max(fitK(n, view), c.k * factor))
  const world = screenToWorldX(c, atX)
  return clampLifeCamera({ k, tx: atX - world * k }, n, view)
}

/** Pan by dx screen px. */
export function panLifeCamera(c: LifeCamera, dx: number, days: number, view: LifeViewport): LifeCamera {
  return clampLifeCamera({ k: c.k, tx: c.tx + dx }, days, view)
}

/**
 * The same stretch of days across a resized plot: k scales with the plot's width and the day in
 * the middle stays in the middle. A fitted camera stays fitted.
 */
export function resizeLifeCamera(c: LifeCamera, from: LifeViewport, to: LifeViewport, days: number): LifeCamera {
  const centre = screenToWorldX(c, from.width / 2)
  const k = c.k * (plotWidth(to) / plotWidth(from))
  return clampLifeCamera({ k, tx: to.width / 2 - centre * k }, days, to)
}

/** Brings world x into view: unchanged if it already is (inside a small margin), else centred on it. */
export function revealLifeCamera(c: LifeCamera, worldX: number, days: number, view: LifeViewport): LifeCamera {
  const margin = Math.min(40, plotWidth(view) / 10)
  const sx = c.tx + worldX * c.k
  if (sx >= view.side + margin && sx <= view.width - view.side - margin) return clampLifeCamera(c, days, view)
  return clampLifeCamera({ k: c.k, tx: view.width / 2 - worldX * c.k }, days, view)
}

/** The world x (days since the life's start) under screen x. */
export function screenToWorldX(c: LifeCamera, sx: number): number {
  return (sx - c.tx) / c.k
}
