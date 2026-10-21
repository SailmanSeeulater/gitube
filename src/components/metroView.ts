/**
 * Pure helpers for Garden's metro ("straight") mode: turn a MetroLayout (lane units) into what the
 * canvas draws (graph units, centred on the origin), and the camera, tween and dimming rules that
 * go with it. No DOM, no React.
 */
import type { MetroLayout, MetroOptions, MetroStationKind } from '../graph/metro'
import type { ViewMode } from '../types'
import type { FitBbox, FitPadding } from './gardenUtils'

/** Graph units per lane (the layout's unit). Lines, stations and diagonals all scale with it. */
export const METRO_SCALE = 28
/** Node tween between the organic and metro positions (and between metro layouts). */
export const METRO_TWEEN_MS = 450
/** Fit-to-view never zooms out further than this many screen px between lanes; the user pans instead. */
export const METRO_MIN_LANE_PX = 12
/** Line width in graph units, and the thinnest it is drawn on screen. */
export const METRO_LINE_WIDTH = 3.5
export const METRO_MIN_LINE_PX = 1.5

/** Layout options per view: full view packs its columns tighter (plain commits are only dots). */
export function metroOptionsFor(viewMode: ViewMode, prevLanes?: ReadonlyMap<string, number>): MetroOptions {
  return { colGap: viewMode === 'full' ? 0.65 : 1, ...(prevLanes ? { prevLanes } : {}) }
}

/**
 * Lane memory across layouts: the previous hints with the newest layout's laid over them. A branch
 * that is hidden and shown again still finds its old lane in the hints (taken when it is free).
 */
export function mergeLaneHints(
  prev: ReadonlyMap<string, number> | null | undefined,
  next: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map(prev ?? [])
  for (const [k, v] of next) out.set(k, v)
  return out
}

export interface MetroDrawRoute {
  linkIndex: number
  /** child id */
  source: string
  /** parent id */
  target: string
  /** flat x, y pairs in graph units */
  pts: Float64Array
  colorBranch: string
  muted: boolean
  dashed: boolean
  /** 0: muted and dashed (drawn first), 1: lane changes, 2: plain lines (drawn last, on top) */
  layer: 0 | 1 | 2
}

export interface MetroBadge {
  linkIndex: number
  source: string
  target: string
  x: number
  y: number
  text: string
}

export interface MetroStubLine {
  nodeId: string
  x0: number
  y0: number
  x1: number
  y1: number
  colorBranch: string
}

export interface MetroView {
  /** node id -> pinned position in graph units */
  targets: Map<string, { x: number; y: number }>
  stations: Map<string, MetroStationKind>
  /** in draw order (layer, then linkIndex) */
  routes: MetroDrawRoute[]
  badges: MetroBadge[]
  stubs: MetroStubLine[]
  /** bbox of the stations and stubs in graph units, for fit-to-view */
  bbox: { x: [number, number]; y: [number, number] }
}

export function routeLayer(route: { muted: boolean; dashed: boolean; kind: string }): 0 | 1 | 2 {
  if (route.muted || route.dashed) return 0
  return route.kind === 'line' ? 2 : 1
}

/** Scale the layout to graph units and centre it on the origin. */
export function buildMetroView(layout: MetroLayout, scale: number = METRO_SCALE): MetroView {
  const b = layout.bounds
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const X = (x: number) => (x - cx) * scale
  const Y = (y: number) => (y - cy) * scale

  const targets = new Map<string, { x: number; y: number }>()
  for (const [id, p] of layout.positions) targets.set(id, { x: X(p.x), y: Y(p.y) })

  const routes: MetroDrawRoute[] = layout.routes.map((r) => {
    const pts = new Float64Array(r.points.length * 2)
    r.points.forEach((p, k) => {
      pts[2 * k] = X(p.x)
      pts[2 * k + 1] = Y(p.y)
    })
    return {
      linkIndex: r.linkIndex,
      source: r.source,
      target: r.target,
      pts,
      colorBranch: r.colorBranch,
      muted: r.muted,
      dashed: r.dashed,
      layer: routeLayer(r),
    }
  })
  routes.sort((a, c) => a.layer - c.layer || a.linkIndex - c.linkIndex)

  const badges: MetroBadge[] = []
  for (const run of layout.runs) {
    const r = layout.routes[run.linkIndex]
    if (!r || run.hidden <= 0) continue
    badges.push({ linkIndex: run.linkIndex, source: r.source, target: r.target, x: X(run.x), y: Y(run.y), text: `+${run.hidden}` })
  }

  const stubs: MetroStubLine[] = layout.stubs.map((s) => ({
    nodeId: s.nodeId,
    x0: X(s.points[0].x),
    y0: Y(s.points[0].y),
    x1: X(s.points[1].x),
    y1: Y(s.points[1].y),
    colorBranch: s.colorBranch,
  }))

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const grow = (x: number, y: number) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (const p of targets.values()) grow(p.x, p.y)
  for (const s of stubs) grow(s.x0, s.y0)
  const bbox: MetroView['bbox'] = Number.isFinite(minX) ? { x: [minX, maxX], y: [minY, maxY] } : { x: [0, 0], y: [0, 0] }

  return { targets, stations: layout.stations, routes, badges, stubs, bbox }
}

/** Outer radius of a station glyph in graph units (also the label placer's node radius). */
export function metroStationRadius(kind: MetroStationKind | undefined, isTip: boolean): number {
  if (isTip) return 6
  switch (kind) {
    case 'interchange':
      return 5
    case 'origin':
      return 4
    case 'commit':
      return 2
    default:
      return 3.5
  }
}

/**
 * Camera for a metro map. Like fitTransform, but a long map is not shrunk until its lanes are a few
 * px apart: the zoom never drops below minZoom (unless the map's height needs it), and a map wider
 * than the view is right-aligned so the newest history is what shows; the user pans left for the rest.
 */
export function metroFitTransform(
  bbox: FitBbox,
  size: { width: number; height: number },
  pad: FitPadding,
  maxZoom: number,
  minZoom: number,
): { k: number; cx: number; cy: number } {
  const x0 = bbox.x[0]
  const x1 = bbox.x[1]
  const y0 = bbox.y[0]
  const y1 = bbox.y[1]
  const bw = Math.max(x1 - x0, 1)
  const bh = Math.max(y1 - y0, 1)
  const availW = Math.max(size.width - pad.left - pad.right, 50)
  const availH = Math.max(size.height - pad.top - pad.bottom, 50)
  const kH = Math.min(availH / bh, maxZoom)
  const kFit = Math.min(availW / bw, kH)
  const k = Math.max(kFit, Math.min(minZoom, kH))
  const cy = (y0 + y1) / 2 - (pad.top - pad.bottom) / (2 * k)
  const cx = bw * k <= availW + 1e-9 ? (x0 + x1) / 2 - (pad.left - pad.right) / (2 * k) : x1 - (size.width / 2 - pad.right) / k
  return { k, cx, cy }
}

/** Smooth start and stop for the node tween, t in [0, 1]. */
export function easeInOutCubic(t: number): number {
  const u = Math.min(Math.max(t, 0), 1)
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
}

/** The link half of the dim rule (see isDimmed): dimmed unless it touches the hovered node and lies inside the selected reach. */
export function isLinkDimmed(source: string, target: string, hovered: string | null, reach: ReadonlySet<string> | null): boolean {
  if (hovered !== null && source !== hovered && target !== hovered) return true
  return reach !== null && !(reach.has(source) && reach.has(target))
}
