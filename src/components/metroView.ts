/**
 * Pure helpers for Garden's metro ("straight") mode: turn a MetroLayout (lane units) into what the
 * canvas draws (graph units, centred on the origin), and the camera, tween and dimming rules that
 * go with it. No DOM, no React (strokeRunBars only draws on the canvas context it is handed).
 */
import { linkKey } from '../graph/contributors'
import type { MetroLayout, MetroOptions, MetroStationKind } from '../graph/metro'
import type { ThemeDerived } from '../theme/themes'
import type { ViewMode } from '../types'
import type { FitBbox, FitPadding } from './gardenUtils'

/** Graph units per lane (the layout's unit). Lines, stations and diagonals all scale with it. */
export const METRO_SCALE = 28
/** Node tween between the organic and metro positions (and between metro layouts). */
export const METRO_TWEEN_MS = 450
/**
 * Fit-to-view never zooms out further than this many screen px between lanes (unless the map's
 * height needs it); the user pans instead. ~24 px between lanes keeps the 12 px branch names
 * readable between the lines and the '+N' run markers drawn.
 */
export const METRO_MIN_LANE_PX = 24
/** The fit's zoom floor that METRO_MIN_LANE_PX gives. */
export const METRO_MIN_ZOOM = METRO_MIN_LANE_PX / METRO_SCALE
/** Line width in graph units, and the thinnest it is drawn on screen. */
export const METRO_LINE_WIDTH = 3.5
export const METRO_MIN_LINE_PX = 1.5

/**
 * Layout options per view: full view packs its columns tighter (plain commits are only dots). The
 * layout's own labels are skipped: the label placer puts the names on screen (see useLabelPlacer).
 */
export function metroOptionsFor(viewMode: ViewMode, prevLanes?: ReadonlyMap<string, number>): MetroOptions {
  return { colGap: viewMode === 'full' ? 0.65 : 1, labels: false, ...(prevLanes ? { prevLanes } : {}) }
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

/** A skeleton link that hides commits ('+N'), in graph units. */
export interface MetroBadge {
  linkIndex: number
  source: string
  target: string
  /** a point on the drawn line where the run is marked (the middle of its horizontal carrier) */
  x: number
  y: number
  /** unit direction of the line there (the marker's bars cross it) */
  dx: number
  dy: number
  /**
   * centre height of the '+N' text: the free spot beside the line the layout reserved for it, clear
   * of stations and other markers; null when there is none (the carrier is too short, or both sides
   * are taken), and only the bars on the line are drawn
   */
  textY: number | null
  /** length of the horizontal carrier the run sits on (0: none) */
  room: number
  hidden: number
  text: string
}

/**
 * Font size of '+N' run text in lane units. The layout reserves 0.3 (0.8 x its label font) beside
 * the line, and keeps stations w/2 + 0.2 lane away from its middle; 0.38 stays inside that margin
 * for counts up to four digits and reads better (9 px at the 24 px lane floor).
 */
export const METRO_BADGE_FONT = 0.38
/** ... drawn at most this big on screen, and not at all below METRO_BADGE_MIN_PX (only the bars are). */
export const METRO_BADGE_MAX_PX = 10
export const METRO_BADGE_MIN_PX = 6.5

/** Screen font size of '+N' run text at zoom k: sized with the map, as the layout reserved it, capped. */
export function metroBadgeFontPx(k: number): number {
  return Math.min(METRO_BADGE_MAX_PX, METRO_BADGE_FONT * METRO_SCALE * k)
}

/**
 * How a collapsed run is marked at zoom k. Every run gets a break on its line ('tick': two short
 * bars across it); 'badge' adds its '+N' in the spot beside the line, when the layout found one
 * and the text is large enough to read. Never nothing: the bars stay at any zoom.
 */
export function metroRunMarker(b: Pick<MetroBadge, 'textY'>, k: number): 'badge' | 'tick' {
  return b.textY !== null && metroBadgeFontPx(k) >= METRO_BADGE_MIN_PX ? 'badge' : 'tick'
}

/** run marker bars: half their length across the line, and the gap between the two, in screen px */
export const RUN_BAR_HALF_PX = 3.5
export const RUN_BAR_GAP_PX = 3.5
/** width in screen px of each run bar (in runMark) */
export const RUN_BAR_PX = 1.5
/**
 * width in screen px of the canvas-coloured (textHalo) stroke under each run bar: 1 px either side
 * of the 1.5 px bar. With the 3.5 px gap the two halos meet, so together they cut a clean break
 * across the route
 */
export const RUN_BAR_HALO_PX = 3.5
/** run bars stick out this many screen px past each edge of the route, at any zoom */
export const RUN_BAR_OVERHANG_PX = 1

/** What strokeRunBars needs of a canvas context. */
export type RunBarContext = Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'strokeStyle' | 'lineWidth' | 'lineCap'>

/**
 * A run marker's break on its route (see metroRunMarker): two bars across the line at (b.x, b.y),
 * RUN_BAR_GAP_PX apart, stroked first in the canvas colour (textHalo, RUN_BAR_HALO_PX wide; the
 * two halos meet and cut the route) and then in runMark on top. The bars are at least as long as
 * the route is wide, plus RUN_BAR_OVERHANG_PX either side, so the break crosses the whole line at
 * any zoom; zoomed out they are 2 x RUN_BAR_HALF_PX. px = 1 / zoom; width is the route's width in
 * graph units. Leaves globalAlpha to the caller and lineCap at 'butt'.
 */
export function strokeRunBars(
  ctx: RunBarContext,
  b: Pick<MetroBadge, 'x' | 'y' | 'dx' | 'dy'>,
  px: number,
  width: number,
  theme: { derived: Pick<ThemeDerived, 'textHalo' | 'runMark'> },
): void {
  // at least as long as the line is wide, so the break crosses the whole route even when zoomed in
  const half = Math.max(RUN_BAR_HALF_PX * px, width / 2 + RUN_BAR_OVERHANG_PX * px)
  const gap = RUN_BAR_GAP_PX * px
  ctx.lineCap = 'butt'
  ctx.beginPath()
  for (const side of [-0.5, 0.5]) {
    const cx = b.x + b.dx * gap * side
    const cy = b.y + b.dy * gap * side
    ctx.moveTo(cx + b.dy * half, cy - b.dx * half)
    ctx.lineTo(cx - b.dy * half, cy + b.dx * half)
  }
  ctx.strokeStyle = theme.derived.textHalo // canvas: cuts the route under the bars
  ctx.lineWidth = RUN_BAR_HALO_PX * px
  ctx.stroke()
  ctx.strokeStyle = theme.derived.runMark
  ctx.lineWidth = RUN_BAR_PX * px
  ctx.stroke()
}

/** Point halfway along a polyline (flat x, y pairs) and the unit direction of the piece it is on. */
function polylineMiddle(pts: Float64Array): { x: number; y: number; dx: number; dy: number } {
  let total = 0
  for (let k = 2; k + 1 < pts.length; k += 2) total += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1])
  let left = total / 2
  for (let k = 2; k + 1 < pts.length; k += 2) {
    const dx = pts[k] - pts[k - 2]
    const dy = pts[k + 1] - pts[k - 1]
    const len = Math.hypot(dx, dy)
    if (len <= 0) continue
    if (left <= len) return { x: pts[k - 2] + (dx * left) / len, y: pts[k - 1] + (dy * left) / len, dx: dx / len, dy: dy / len }
    left -= len
  }
  return { x: pts[0] ?? 0, y: pts[1] ?? 0, dx: 1, dy: 0 }
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
  /**
   * Every straight piece of every route (muted and dashed too; not the stubs), flat [x0, y0, x1, y1]
   * in graph units: what the label placer keeps names off.
   */
  segs: Float64Array
  /** per piece: index of its route's source / target node in the node list passed in (-1: unknown) */
  segSrc: Int32Array
  segTgt: Int32Array
  /** plain commit (full view) -> distance to the nearest other station on its lane, graph units */
  commitGap: Map<string, number>
  /** bbox of the stations and stubs in graph units, for fit-to-view */
  bbox: { x: [number, number]; y: [number, number] }
}

export function routeLayer(route: { muted: boolean; dashed: boolean; kind: string }): 0 | 1 | 2 {
  if (route.muted || route.dashed) return 0
  return route.kind === 'line' ? 2 : 1
}

/**
 * Scale the layout to graph units and centre it on the origin. `nodes` is the node list the canvas
 * and the label placer index (graph.nodes); route pieces refer to their end nodes by that index.
 */
export function buildMetroView(layout: MetroLayout, nodes: ReadonlyArray<{ id: string }> = [], scale: number = METRO_SCALE): MetroView {
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

  const nodeIndex = new Map<string, number>()
  nodes.forEach((node, j) => nodeIndex.set(node.id, j))
  let pieces = 0
  for (const r of routes) pieces += Math.max(0, r.pts.length / 2 - 1)
  const segs = new Float64Array(pieces * 4)
  const segSrc = new Int32Array(pieces)
  const segTgt = new Int32Array(pieces)
  let m = 0
  for (const r of routes) {
    const src = nodeIndex.get(r.source) ?? -1
    const tgt = nodeIndex.get(r.target) ?? -1
    const p = r.pts
    for (let k = 2; k + 1 < p.length; k += 2) {
      if (p[k] === p[k - 2] && p[k + 1] === p[k - 1]) continue
      segs[4 * m] = p[k - 2]
      segs[4 * m + 1] = p[k - 1]
      segs[4 * m + 2] = p[k]
      segs[4 * m + 3] = p[k + 1]
      segSrc[m] = src
      segTgt[m] = tgt
      m++
    }
  }

  const routeOf = new Map<number, MetroDrawRoute>()
  for (const r of routes) routeOf.set(r.linkIndex, r)
  const badges: MetroBadge[] = []
  for (const run of layout.runs) {
    const r = routeOf.get(run.linkIndex)
    if (!r || run.hidden <= 0) continue
    // on the horizontal carrier, beside the text's spot, when the text has one or the carrier is a
    // lane long; else halfway along the drawn route, clear of the stations at its ends (a short
    // carrier's middle sits half under them, and without a carrier the run's point is the middle
    // of its chord, which may be off the line)
    const onCarrier = run.room > 0 && (run.markerY !== null || run.room >= 1)
    const at = onCarrier ? { x: X(run.x), y: Y(run.y), dx: 1, dy: 0 } : polylineMiddle(r.pts)
    badges.push({
      linkIndex: run.linkIndex,
      source: r.source,
      target: r.target,
      ...at,
      textY: run.markerY === null ? null : Y(run.markerY),
      room: run.room * scale,
      hidden: run.hidden,
      text: `+${run.hidden}`,
    })
  }

  // how close each plain commit's neighbours on its lane are (dense runs shrink their beads)
  const commitGap = new Map<string, number>()
  {
    const byLane = new Map<number, Array<{ id: string; x: number }>>()
    for (const [id, p] of targets) {
      const lane = Math.round(p.y * 1000)
      const list = byLane.get(lane)
      if (list) list.push({ id, x: p.x })
      else byLane.set(lane, [{ id, x: p.x }])
    }
    for (const list of byLane.values()) {
      list.sort((a, c) => a.x - c.x)
      list.forEach((st, k) => {
        if (layout.stations.get(st.id) !== 'commit') return
        const left = k > 0 ? st.x - list[k - 1].x : Infinity
        const right = k + 1 < list.length ? list[k + 1].x - st.x : Infinity
        const gap = Math.min(left, right)
        if (Number.isFinite(gap)) commitGap.set(st.id, gap)
      })
    }
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

  return {
    targets,
    stations: layout.stations,
    routes,
    badges,
    stubs,
    segs: segs.subarray(0, 4 * m),
    segSrc: segSrc.subarray(0, m),
    segTgt: segTgt.subarray(0, m),
    commitGap,
    bbox,
  }
}

/**
 * Outer radius of a station glyph in graph units (also the label placer's node radius); px =
 * 1 / zoom. A plain commit is a bead sized to its line (see metroCommitGlyph); with px 0 its
 * smallest size.
 */
export function metroStationRadius(kind: MetroStationKind | undefined, isTip: boolean, px = 0): number {
  if (isTip) return 6
  switch (kind) {
    case 'interchange':
      return 5
    case 'origin':
      return 4
    case 'commit':
      return metroCommitGlyph(px).r
    default:
      return 3.5
  }
}

/** Ring of a plain-commit bead in screen px: how far it reaches past its line on each side. */
export const METRO_BEAD_RING_PX = 1.25

/**
 * A plain commit (full view) as a bead on its line: a disc in the line's colour, r, around a
 * background-coloured core, so it stands out from a line of the same colour and reaches
 * METRO_BEAD_RING_PX past it on each side at every zoom. When the nearest station on its lane is
 * closer than two beads (gap, graph units), the bead shrinks to 0.45 gap so neighbours stay apart,
 * as long as that leaves 2 px on screen; denser runs read as a beaded band until zoomed in.
 */
export function metroCommitGlyph(px: number, gap?: number): { r: number; core: number } {
  const lineHalf = 0.5 * Math.max(METRO_LINE_WIDTH, METRO_MIN_LINE_PX * px)
  let r = Math.max(2, lineHalf + METRO_BEAD_RING_PX * px)
  if (gap !== undefined && gap > 0) {
    const cap = 0.45 * gap
    if (cap < r && cap >= 2 * px) r = cap
  }
  return { r, core: Math.max(0.5 * r, r - METRO_BEAD_RING_PX * px) }
}

/**
 * Camera for a metro map. Like fitTransform, but a long map is not shrunk until its lanes crowd
 * its names: the zoom never drops below minZoom (METRO_MIN_LANE_PX, ~24 px between lanes, unless
 * the map's height needs less), and a map wider than the view is right-aligned so the newest
 * history is what shows; the user pans left for the rest.
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

/**
 * Camera move that brings points into the padded view of a metro map, or null when they are all in
 * it already. A long map opens right-aligned with its old lines off-screen, so selecting one (or
 * searching for one) must go and show it. The move pans, and zooms out only as far as the points
 * need, never in. `primary` points (a selected tip, the search hits) are always brought in;
 * `context` points (the selected branch's own line) too while that keeps the zoom at least
 * min(current zoom, minZoom), else they are left out.
 */
export function metroRevealTransform(
  primary: ReadonlyArray<{ x: number; y: number }>,
  context: ReadonlyArray<{ x: number; y: number }>,
  cam: { k: number; cx: number; cy: number },
  size: { width: number; height: number },
  pad: FitPadding,
  minZoom: number,
): { k: number; cx: number; cy: number } | null {
  if (primary.length === 0 || !(cam.k > 0)) return null
  const vx0 = cam.cx - (size.width / 2 - pad.left) / cam.k
  const vx1 = cam.cx + (size.width / 2 - pad.right) / cam.k
  const vy0 = cam.cy - (size.height / 2 - pad.top) / cam.k
  const vy1 = cam.cy + (size.height / 2 - pad.bottom) / cam.k
  const inView = (pts: ReadonlyArray<{ x: number; y: number }>) => pts.every((p) => p.x >= vx0 && p.x <= vx1 && p.y >= vy0 && p.y <= vy1)
  const availW = Math.max(size.width - pad.left - pad.right, 50)
  const availH = Math.max(size.height - pad.top - pad.bottom, 50)
  const frame = (pts: ReadonlyArray<{ x: number; y: number }>) => {
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const p of pts) {
      x0 = Math.min(x0, p.x)
      x1 = Math.max(x1, p.x)
      y0 = Math.min(y0, p.y)
      y1 = Math.max(y1, p.y)
    }
    const k = Math.min(cam.k, availW / Math.max(x1 - x0, 1), availH / Math.max(y1 - y0, 1))
    return { k, cx: (x0 + x1) / 2 - (pad.left - pad.right) / (2 * k), cy: (y0 + y1) / 2 - (pad.top - pad.bottom) / (2 * k) }
  }
  if (context.length > 0) {
    const all = primary.concat(context)
    if (inView(all)) return null
    const t = frame(all)
    if (t.k >= Math.min(cam.k, minZoom) - 1e-9) return t
  }
  return inView(primary) ? null : frame(primary)
}

/** Smooth start and stop for the node tween, t in [0, 1]. */
export function easeInOutCubic(t: number): number {
  const u = Math.min(Math.max(t, 0), 1)
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
}

/**
 * The link half of the dim rule (see isDimmed): dimmed unless it touches the hovered node and lies
 * inside the selected reach. With lit (a selected contributor's ContributorFocus.links, by linkKey)
 * the link must be in it instead: a person's commits do not form a closed reach the way a branch's do.
 */
export function isLinkDimmed(
  source: string,
  target: string,
  hovered: string | null,
  reach: ReadonlySet<string> | null,
  lit: ReadonlySet<string> | null = null,
): boolean {
  if (hovered !== null && source !== hovered && target !== hovered) return true
  if (lit !== null) return !lit.has(linkKey(source, target))
  return reach !== null && !(reach.has(source) && reach.has(target))
}
