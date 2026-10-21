import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d'
import type { Graph, GraphLink, GraphNode, ViewMode } from '../types'
import { useGardenStore } from '../store/useGardenStore'
import {
  ACCENT,
  CANVAS_BG,
  DIM_ALPHA,
  FALLBACK_COLOUR,
  LABEL_FONT,
  MONO_FONT,
  MUTED_COLOUR,
  ROOT_FILL,
  ROOT_RING,
  assignLinkCurvature,
  buildBranchReach,
  buildNeighbourIndex,
  createTimeForce,
  fitTransform,
  hexToRgba,
  isDimmed,
  linkEndId,
  nodeRadius,
  selectedReach,
  shortSha,
  type FitPadding,
  type TimeForce,
} from './gardenUtils'
import { useLabelPlacer } from './useLabelPlacer'
import {
  METRO_LINE_WIDTH,
  METRO_MIN_LANE_PX,
  METRO_MIN_LINE_PX,
  METRO_SCALE,
  METRO_TWEEN_MS,
  easeInOutCubic,
  isLinkDimmed,
  metroFitTransform,
  metroStationRadius,
  type MetroView,
} from './metroView'

/** Node object as react-force-graph sees it (GraphNode plus runtime x/y and a loose index signature). */
export type GardenNode = NodeObject<GraphNode>
/** Extra fields the garden attaches to each link once per graph. */
export type GardenLinkFields = Omit<GraphLink, 'source' | 'target'> & {
  source: string | GardenNode
  target: string | GardenNode
  /** '+N' label for collapsed runs, '' otherwise. Precomputed so paint never builds strings. */
  badge: string
  /** Bend for links that share both ends (see assignLinkCurvature); 0 for a lone link. */
  curvature: number
}
export type GardenLink = LinkObject<GraphNode, GardenLinkFields>
type GardenMethods = ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GardenLinkFields>>

export interface GardenProps {
  graph: Graph
  viewMode: ViewMode
  /** the repo's default branch: its tip label is always placed first */
  defaultBranch: string
  onNodeClick: (id: string) => void
  onBackgroundClick: () => void
  /**
   * Metro mode: the straight layout of this exact graph, scaled to graph units (see useMetroView).
   * null = organic mode (free force physics).
   */
  metro?: MetroView | null
}

interface GardenIndex {
  graphData: { nodes: GardenNode[]; links: GardenLink[] }
  nodeById: Map<string, GardenNode>
  /** node id -> 1-hop neighbour ids */
  neighbours: Map<string, Set<string>>
  /** branch name -> node ids reachable from its tip */
  reach: Map<string, Set<string>>
  /** tip node id -> 'branch-a, branch-b' */
  tipLabel: Map<string, string>
  tipLabelLower: Map<string, string>
  /** owner branch -> rgba link colour at 35% / 7% */
  linkColour: Map<string, string>
  linkColourDim: Map<string, string>
  palette: Record<string, string>
  /** nodes that had no position in the previous graph (a metro tween starts them at their target) */
  freshIds: Set<string>
}

interface ScaleCache {
  scale: number
  px: number
  shaFont: string
  badgeFont: string
  dash: number[]
}

const NO_DASH: number[] = []
// force-graph treats a string here as a node attribute name, so the mode must be a function.
const NODE_MODE_REPLACE = () => 'replace' as const
// fit-to-view padding in screen px; symmetric because labels flip to the left near the right edge
const FIT_PAD: FitPadding = { left: 96, right: 96, top: 72, bottom: 72 }
const FIT_MAX_ZOOM = 2.5
const FIT_MS = 400
// fit early, once the layout has roughly settled (every tip slower than 1 px per frame after 20
// ticks), instead of after all 200 cooldown ticks; onEngineStop stays as the fallback
const EARLY_FIT_TICKS = 20
const EARLY_FIT_SPEED = 1
const TWO_PI = Math.PI * 2
const FALLBACK_LINK = hexToRgba(FALLBACK_COLOUR, 0.35)
const FALLBACK_LINK_DIM = hexToRgba(FALLBACK_COLOUR, 0.07)
const HALO_FILL = 'rgba(167, 139, 250, 0.22)'
const HALO_RING = 'rgba(167, 139, 250, 0.7)'
const HOVER_RING = 'rgba(220, 221, 222, 0.45)'
const BADGE_BG = '#2a2a2a'
const BADGE_TEXT = '#b8b8b8'
// metro mode
const STATION_WHITE = '#e8e8e8'
const METRO_ALPHA = 0.9
const METRO_MUTED_ALPHA = 0.45
const METRO_DIM_ALPHA = 0.1
const METRO_MIN_ZOOM = METRO_MIN_LANE_PX / METRO_SCALE

/** A '+N' run badge centred on (mx, my); px = 1 / globalScale. Leaves globalAlpha at 1. */
function drawBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  mx: number,
  my: number,
  px: number,
  font: string,
  ring: string,
  alpha: number,
): void {
  ctx.font = font
  const w = ctx.measureText(text).width + 8 * px
  const h = 13 * px
  ctx.globalAlpha = alpha
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(mx - w / 2, my - h / 2, w, h, 3 * px)
  else ctx.rect(mx - w / 2, my - h / 2, w, h)
  ctx.fillStyle = BADGE_BG
  ctx.fill()
  ctx.strokeStyle = ring
  ctx.lineWidth = px
  ctx.stroke()
  ctx.fillStyle = BADGE_TEXT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, mx, my + 0.5 * px)
  ctx.globalAlpha = 1
}

export default function Garden({ graph, viewMode, defaultBranch, onNodeClick, onBackgroundClick, metro = null }: GardenProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fgRef = useRef<GardenMethods | undefined>(undefined)
  const sizeRef = useRef({ width: 0, height: 0 })
  const [size, setSize] = useState({ width: 0, height: 0 })

  // Hover lives in a ref (paint reads it); hoverVersion only exists to hand the paint
  // callbacks a new identity so force-graph schedules a redraw after the engine has stopped.
  const hoverRef = useRef<string | null>(null)
  // A label under the pointer hovers its node too. Kept apart from hoverRef because force-graph
  // reports onNodeHover(null) whenever the pointer is off a node, which would wipe it; a node hit
  // wins over a label hit (hoverRef ?? labelHoverRef).
  const labelHoverRef = useRef<string | null>(null)
  const [hoverVersion, setHoverVersion] = useState(0)

  const fittedRef = useRef(false)
  const tickCountRef = useRef(0)
  const prevNodesRef = useRef<Map<string, GardenNode>>(new Map())
  const timeForceRef = useRef<TimeForce | null>(null)
  const scaleCache = useRef<ScaleCache>({ scale: -1, px: 1, shaFont: '', badgeFont: '', dash: [3, 2] })
  const metroOn = metro !== null
  const metroRef = useRef<MetroView | null>(metro)
  metroRef.current = metro
  /** true while nodes tween between layouts: links are drawn straight, and every frame is redrawn */
  const tweenRef = useRef(false)
  const [tweening, setTweening] = useState(false)
  const lastTweenIndexRef = useRef<GardenIndex | null>(null)
  const wasMetroRef = useRef(metroOn)

  const selectedBranch = useGardenStore((s) => s.selectedBranch)
  const search = useGardenStore((s) => s.search)
  const inspectorNodeId = useGardenStore((s) => s.inspectorNodeId)

  // ---- size to container ----
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const width = Math.max(0, Math.round(el.clientWidth))
      const height = Math.max(0, Math.round(el.clientHeight))
      sizeRef.current.width = width
      sizeRef.current.height = height
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    }
    measure()
    const observer = new ResizeObserver(() => measure())
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ---- graph data + per-graph indexes (keyed only on the graph identity) ----
  const index = useMemo<GardenIndex>(() => {
    const previous = prevNodesRef.current
    const freshIds = new Set<string>()
    const nodes: GardenNode[] = graph.nodes.map((n) => {
      const copy: GardenNode = { ...n }
      const old = previous.get(n.id)
      if (old === undefined || old.x === undefined || old.y === undefined) freshIds.add(n.id)
      else {
        // keep the previous layout for nodes that survive a rebuild so toggles do not reshuffle everything
        copy.x = old.x
        copy.y = old.y
        copy.vx = 0
        copy.vy = 0
      }
      return copy
    })
    const curvatures = assignLinkCurvature(graph.links)
    const links: GardenLink[] = graph.links.map((l, i) => ({
      ...l,
      badge: l.collapsedCount > 0 ? `+${l.collapsedCount}` : '',
      curvature: curvatures[i],
    }))
    const nodeById = new Map<string, GardenNode>()
    for (const n of nodes) nodeById.set(n.id, n)

    const tipLabel = new Map<string, string>()
    const tipLabelLower = new Map<string, string>()
    for (const n of nodes) {
      if (n.tips.length > 0) {
        const label = n.tips.join(', ')
        tipLabel.set(n.id, label)
        tipLabelLower.set(n.id, label.toLowerCase())
      }
    }

    const linkColour = new Map<string, string>()
    const linkColourDim = new Map<string, string>()
    for (const [branch, hex] of Object.entries(graph.palette)) {
      linkColour.set(branch, hexToRgba(hex, 0.35))
      linkColourDim.set(branch, hexToRgba(hex, 0.07))
    }

    return {
      graphData: { nodes, links },
      nodeById,
      neighbours: buildNeighbourIndex(graph.links),
      reach: buildBranchReach(graph.nodes, graph.links),
      tipLabel,
      tipLabelLower,
      linkColour,
      linkColourDim,
      palette: graph.palette,
      freshIds,
    }
  }, [graph])

  useEffect(() => {
    prevNodesRef.current = index.nodeById
    fittedRef.current = false
    tickCountRef.current = 0
  }, [index])

  const ready = size.width > 0 && size.height > 0

  // ---- forces (organic mode; metro mode pins every node, see the tween below) ----
  useEffect(() => {
    if (!ready) return
    const fg = fgRef.current
    if (!fg) return
    if (metroOn) {
      wasMetroRef.current = true
      return
    }
    // back from metro: unpin, and fit again once the physics has relaxed the straight map
    if (wasMetroRef.current) {
      wasMetroRef.current = false
      for (const node of index.graphData.nodes) {
        node.fx = undefined
        node.fy = undefined
      }
      fittedRef.current = false
      tickCountRef.current = 0
    }
    const charge = fg.d3Force('charge')
    if (charge && typeof charge.strength === 'function') charge.strength(viewMode === 'skeleton' ? -40 : -15)
    const link = fg.d3Force('link')
    if (link && typeof link.distance === 'function') link.distance(30)
    if (!timeForceRef.current) timeForceRef.current = createTimeForce(() => sizeRef.current.width, 0.03)
    fg.d3Force('time', timeForceRef.current)
    fg.d3ReheatSimulation()
  }, [index, viewMode, ready, metroOn])

  // ---- paint ----
  // null = nothing to isolate: no selection, or the selected branch has no tip in this graph
  // (stale-filtered, or its tipSha is not among the fetched commits).
  const reachSet = selectedReach(index.reach, selectedBranch)
  const query = search.trim().toLowerCase()

  const bumpHover = useCallback(() => setHoverVersion((v) => v + 1), [])
  // labels keep clear of the station glyphs in metro mode, which are not reach-sized
  const labelRadius = useMemo(
    () => (metro ? (node: GraphNode) => metroStationRadius(metro.stations.get(node.id), node.isTip) : undefined),
    [metro],
  )
  const { paintLabels, onPointerMove, onPointerLeave, clickTest, labelsBusy, maxTipSpeed, setDragNode, fitStarted } = useLabelPlacer({
    index,
    defaultBranch,
    reachSet,
    query,
    selectedBranch,
    inspectorNodeId,
    hoverRef,
    labelHoverRef,
    onLabelHoverChange: bumpHover,
    radiusOf: labelRadius,
  })

  const syncScale = (globalScale: number): ScaleCache => {
    const c = scaleCache.current
    if (c.scale !== globalScale) {
      c.scale = globalScale
      c.px = 1 / globalScale
      c.shaFont = `${10.5 / globalScale}px ${MONO_FONT}`
      c.badgeFont = `${10 / globalScale}px ${LABEL_FONT}`
      c.dash[0] = 3 / globalScale
      c.dash[1] = 2 / globalScale
    }
    return c
  }

  const paintNode = useCallback(
    (node: GardenNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x
      const y = node.y
      if (x === undefined || y === undefined) return
      const c = syncScale(globalScale)
      const px = c.px
      const id = node.id
      const hovered = hoverRef.current ?? labelHoverRef.current
      const dim = isDimmed(id, hovered, index.neighbours, reachSet)

      const kind = metro ? metro.stations.get(id) : undefined
      const r = metro ? metroStationRadius(kind, node.isTip) : nodeRadius(node.reach)
      const colour = index.palette[node.owner] ?? FALLBACK_COLOUR
      const fill = node.isRoot && !node.isTip ? ROOT_FILL : colour
      const isHovered = hovered === id
      const isInspected = inspectorNodeId === id
      const isLabelled = index.tipLabel.has(id)
      const matches = query !== '' && isLabelled && (index.tipLabelLower.get(id) ?? '').includes(query)
      const outer = metro ? r : r + (node.isTip ? 2 : 0)

      ctx.globalAlpha = dim ? DIM_ALPHA : 1

      if (matches) {
        ctx.beginPath()
        ctx.arc(x, y, outer + 7 * px, 0, TWO_PI)
        ctx.fillStyle = HALO_FILL
        ctx.fill()
        ctx.strokeStyle = HALO_RING
        ctx.lineWidth = 1 * px
        ctx.stroke()
      }
      if (isInspected || isHovered) {
        ctx.beginPath()
        ctx.arc(x, y, outer + 4.5 * px, 0, TWO_PI)
        ctx.strokeStyle = isInspected ? ACCENT : HOVER_RING
        ctx.lineWidth = 1.2 * px
        ctx.stroke()
      }

      if (metro) {
        // station glyphs: tips in branch colour with a white outline, interchanges as white rings,
        // origins hollow (their dashed stub is drawn with the lines), stops and commits as dots
        const ring = Math.max(1.5, 1.2 * px)
        ctx.beginPath()
        ctx.arc(x, y, r, 0, TWO_PI)
        if (node.isTip) {
          ctx.fillStyle = colour
          ctx.fill()
          ctx.strokeStyle = STATION_WHITE
          ctx.lineWidth = ring
          ctx.stroke()
        } else if (kind === 'interchange') {
          ctx.fillStyle = STATION_WHITE
          ctx.fill()
          ctx.beginPath()
          ctx.arc(x, y, r * 0.5, 0, TWO_PI)
          ctx.fillStyle = CANVAS_BG
          ctx.fill()
        } else if (kind === 'origin') {
          ctx.fillStyle = CANVAS_BG
          ctx.fill()
          ctx.strokeStyle = colour
          ctx.lineWidth = ring
          ctx.stroke()
        } else {
          ctx.fillStyle = colour
          ctx.fill()
        }
      } else if (node.isTip) {
        ctx.beginPath()
        ctx.arc(x, y, outer, 0, TWO_PI)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.beginPath()
        ctx.arc(x, y, outer + 2.5 * px, 0, TWO_PI)
        ctx.strokeStyle = colour
        ctx.lineWidth = 1.5 * px
        ctx.stroke()
      } else if (node.isMerge) {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, TWO_PI)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.beginPath()
        ctx.arc(x, y, r + 2.5 * px, 0, TWO_PI)
        ctx.strokeStyle = colour
        ctx.lineWidth = 0.8 * px
        ctx.stroke()
      } else if (node.isFork) {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, TWO_PI)
        ctx.fillStyle = CANVAS_BG
        ctx.fill()
        ctx.strokeStyle = node.isRoot ? ROOT_RING : colour
        ctx.lineWidth = 1.5 * px
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, TWO_PI)
        ctx.fillStyle = fill
        ctx.fill()
      }

      if (node.isRoot && !metro) {
        ctx.setLineDash(c.dash)
        ctx.beginPath()
        ctx.arc(x, y, outer + (node.isTip ? 5 : 2.5) * px, 0, TWO_PI)
        ctx.strokeStyle = ROOT_RING
        ctx.lineWidth = 1.2 * px
        ctx.stroke()
        ctx.setLineDash(NO_DASH)
      }

      // Tip names are placed and drawn by the label placer (paintLabels); only SHAs are drawn here.
      if (!isLabelled && (globalScale > 2.5 || isHovered || isInspected)) {
        ctx.font = c.shaFont
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = MUTED_COLOUR
        ctx.fillText(shortSha(id), x + r + 5 * px, y)
      }

      ctx.globalAlpha = 1
    },
    // hoverVersion is intentionally a dependency: it forces a new callback identity on hover change.
    // tweening too: the frame after a metro tween must be redrawn with the routes (see paintMetro).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, reachSet, query, inspectorNodeId, hoverVersion, metro, tweening],
  )

  const paintPointerArea = useCallback(
    (node: GardenNode, colour: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x
      const y = node.y
      if (x === undefined || y === undefined) return
      const px = 1 / globalScale
      const outer = metro ? metroStationRadius(metro.stations.get(node.id), node.isTip) : nodeRadius(node.reach) + (node.isTip ? 2 : 0)
      ctx.fillStyle = colour
      ctx.beginPath()
      ctx.arc(x, y, outer + (node.isTip ? 3.25 : 1) * px, 0, TWO_PI)
      ctx.fill()
    },
    [metro],
  )

  const linkColor = useCallback(
    (link: GardenLink) => {
      const s = linkEndId(link.source)
      const t = linkEndId(link.target)
      const hovered = hoverRef.current ?? labelHoverRef.current
      let dim = false
      if (hovered !== null && s !== hovered && t !== hovered) dim = true
      if (!dim && reachSet !== null && !(reachSet.has(s) && reachSet.has(t))) dim = true
      return dim
        ? (index.linkColourDim.get(link.owner) ?? FALLBACK_LINK_DIM)
        : (index.linkColour.get(link.owner) ?? FALLBACK_LINK)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, reachSet, hoverVersion],
  )

  const linkWidth = useCallback((link: GardenLink) => (link.collapsedCount > 0 ? 2 : 1), [])
  const linkCurvature = useCallback((link: GardenLink) => link.curvature, [])
  const linkMode = useCallback((link: GardenLink) => (link.collapsedCount > 0 ? 'after' : undefined), [])

  const paintLink = useCallback(
    (link: GardenLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      // '+N' badges are screen-sized, so only hide them when zoomed far out and they would pile up.
      if (globalScale < 0.7 || link.collapsedCount <= 0) return
      const s = link.source
      const t = link.target
      if (typeof s !== 'object' || typeof t !== 'object') return
      if (s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) return
      const sid = linkEndId(s)
      const tid = linkEndId(t)
      const hovered = hoverRef.current ?? labelHoverRef.current
      let dim = false
      if (hovered !== null && sid !== hovered && tid !== hovered) dim = true
      if (!dim && reachSet !== null && !(reachSet.has(sid) && reachSet.has(tid))) dim = true

      const c = syncScale(globalScale)
      const px = c.px
      // Put the badge on the drawn curve, not the chord: force-graph's control point is
      // mid + curvature * (dy, -dx), and a quadratic Bezier at t = 0.5 lies halfway between
      // the chord midpoint and that control point. Parallel links then get separate badges.
      let mx = (s.x + t.x) / 2
      let my = (s.y + t.y) / 2
      if (link.curvature !== 0) {
        mx += 0.5 * link.curvature * (t.y - s.y)
        my -= 0.5 * link.curvature * (t.x - s.x)
      }
      drawBadge(ctx, link.badge, mx, my, px, c.badgeFont, index.linkColour.get(link.owner) ?? FALLBACK_LINK, dim ? DIM_ALPHA : 1)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, reachSet, hoverVersion],
  )

  /**
   * Metro mode draws every link itself, before the nodes (onRenderFramePre), so it controls the
   * order: muted and dashed routes first, lane changes next, plain lane runs on top. While the nodes
   * tween, links are drawn straight between their current positions instead of along the routes.
   * Redraws ride on paintNode's identity, which changes with every input read here.
   */
  const paintMetro = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (!metro) return
      const c = syncScale(globalScale)
      const px = c.px
      const hovered = hoverRef.current ?? labelHoverRef.current
      const width = Math.max(METRO_LINE_WIDTH, METRO_MIN_LINE_PX * px)
      const palette = index.palette
      ctx.save()
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      if (tweenRef.current) {
        ctx.lineWidth = width * 0.7
        for (const link of index.graphData.links) {
          const s = typeof link.source === 'object' ? link.source : index.nodeById.get(String(link.source))
          const t = typeof link.target === 'object' ? link.target : index.nodeById.get(String(link.target))
          if (!s || !t || s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) continue
          const dim = isLinkDimmed(String(s.id), String(t.id), hovered, reachSet)
          ctx.globalAlpha = dim ? METRO_DIM_ALPHA : METRO_MUTED_ALPHA
          ctx.strokeStyle = palette[link.owner] ?? FALLBACK_COLOUR
          ctx.beginPath()
          ctx.moveTo(t.x, t.y)
          ctx.lineTo(s.x, s.y)
          ctx.stroke()
        }
        ctx.restore()
        return
      }
      // truncated history: a dashed lead-in before each root
      ctx.setLineDash([4, 4])
      ctx.lineWidth = Math.max(1.2, px)
      for (const stub of metro.stubs) {
        const dim = (hovered !== null && hovered !== stub.nodeId) || (reachSet !== null && !reachSet.has(stub.nodeId))
        ctx.globalAlpha = dim ? METRO_DIM_ALPHA : 0.6
        ctx.strokeStyle = palette[stub.colorBranch] ?? FALLBACK_COLOUR
        ctx.beginPath()
        ctx.moveTo(stub.x0, stub.y0)
        ctx.lineTo(stub.x1, stub.y1)
        ctx.stroke()
      }
      ctx.setLineDash(NO_DASH)
      let dashed = false
      for (const r of metro.routes) {
        const dim = isLinkDimmed(r.source, r.target, hovered, reachSet)
        ctx.globalAlpha = dim ? METRO_DIM_ALPHA : r.muted ? METRO_MUTED_ALPHA : METRO_ALPHA
        ctx.strokeStyle = palette[r.colorBranch] ?? FALLBACK_COLOUR
        ctx.lineWidth = r.muted || r.dashed ? width * 0.65 : width
        if (r.dashed !== dashed) {
          dashed = r.dashed
          ctx.setLineDash(dashed ? [Math.max(5, 4 * px), Math.max(4, 3 * px)] : NO_DASH)
        }
        const pts = r.pts
        ctx.beginPath()
        ctx.moveTo(pts[0], pts[1])
        for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1])
        ctx.stroke()
      }
      ctx.setLineDash(NO_DASH)
      // run markers (+N hidden commits), screen-sized like organic mode's, hidden when zoomed far out
      if (globalScale >= 0.7) {
        for (const b of metro.badges) {
          const dim = isLinkDimmed(b.source, b.target, hovered, reachSet)
          const owner = index.nodeById.get(b.source)?.owner ?? ''
          drawBadge(ctx, b.text, b.x, b.y, px, c.badgeFont, index.linkColour.get(owner) ?? FALLBACK_LINK, dim ? DIM_ALPHA : 1)
        }
      }
      ctx.restore()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metro, index, reachSet, hoverVersion],
  )

  // ---- interaction ----
  const handleHover = useCallback((node: GardenNode | null) => {
    const id = node ? String(node.id) : null
    if (hoverRef.current !== id) {
      hoverRef.current = id
      setHoverVersion((v) => v + 1)
    }
  }, [])
  // force-graph only reports hover changes while the pointer is over the canvas, so leaving it
  // (onto the panel, say) would otherwise keep the last node hovered and the graph dimmed.
  const handlePointerLeave = useCallback(() => {
    onPointerLeave()
    if (labelHoverRef.current !== null) {
      labelHoverRef.current = null
      setHoverVersion((v) => v + 1)
    }
    handleHover(null)
  }, [handleHover, onPointerLeave])

  const handleNodeClick = useCallback(
    (node: GardenNode) => {
      onNodeClick(String(node.id))
    },
    [onNodeClick],
  )

  // A click on a label (or a hover plate) selects its node, and a plate row naming another hidden
  // tip selects that tip; force-graph sees it as background.
  const handleBackgroundClick = useCallback(
    (event?: MouseEvent) => {
      const el = containerRef.current
      if (event && el) {
        const rect = el.getBoundingClientRect()
        const id = clickTest(event.clientX - rect.left, event.clientY - rect.top)
        if (id !== null) {
          onNodeClick(id)
          return
        }
      }
      onBackgroundClick()
    },
    [clickTest, onNodeClick, onBackgroundClick],
  )

  // Links have no click action of their own, so treat a click on one as a background click.
  // Links are on force-graph's hit canvas (linkWidth + linkHoverPrecision), so without this a
  // click on a label crossed by a link never reaches the label hit test.
  const handleLinkClick = useCallback((_link: GardenLink, event: MouseEvent) => handleBackgroundClick(event), [handleBackgroundClick])

  // the dragged node's label rides along on a plate
  const handleNodeDrag = useCallback((node: GardenNode) => setDragNode(String(node.id)), [setDragNode])

  const handleDragEnd = useCallback(
    (node: GardenNode) => {
      // release the node so the layout can settle it again (Obsidian behaviour)
      node.fx = undefined
      node.fy = undefined
      setDragNode(null)
    },
    [setDragNode],
  )

  /**
   * Fit the layout into view once per graph. Hand-rolled instead of zoomToFit so the zoom is
   * capped (a four-node repo should not become four giant discs); see fitTransform. Labels of a
   * freshly loaded repo are held back until the tween ends, so they appear once, in place.
   */
  const runFit = useCallback(() => {
    // metro mode fits the straight map itself when its tween starts
    if (fittedRef.current || metroRef.current) return
    fittedRef.current = true
    const fg = fgRef.current
    const { width, height } = sizeRef.current
    const bbox = fg && width > 0 && height > 0 ? fg.getGraphBbox() : null
    if (!fg || !bbox) {
      fitStarted(0)
      return
    }
    const { k, cx, cy } = fitTransform(bbox, { width, height }, FIT_PAD, FIT_MAX_ZOOM)
    fg.centerAt(cx, cy, FIT_MS)
    fg.zoom(k, FIT_MS)
    fitStarted(FIT_MS)
  }, [fitStarted])

  const handleEngineTick = useCallback(() => {
    tickCountRef.current += 1
    if (!fittedRef.current && tickCountRef.current > EARLY_FIT_TICKS && maxTipSpeed() < EARLY_FIT_SPEED) runFit()
  }, [maxTipSpeed, runFit])

  const handleEngineStop = useCallback(() => runFit(), [runFit])

  // ---- metro mode: pin every node to its station, tweening from where it is now ----
  useEffect(() => {
    if (!ready || !metro) return
    const fg = fgRef.current
    const nodes = index.graphData.nodes
    const n = nodes.length
    // a node new to this graph (a branch just shown, a fresh repo) starts at its station
    const firstForIndex = lastTweenIndexRef.current !== index
    lastTweenIndexRef.current = index
    const sx = new Float64Array(n)
    const sy = new Float64Array(n)
    const tx = new Float64Array(n)
    const ty = new Float64Array(n)
    let moving = false
    for (let i = 0; i < n; i++) {
      const node = nodes[i]
      const target = metro.targets.get(node.id)
      const fresh = (firstForIndex && index.freshIds.has(node.id)) || node.x === undefined || node.y === undefined
      tx[i] = target ? target.x : (node.x ?? 0)
      ty[i] = target ? target.y : (node.y ?? 0)
      sx[i] = fresh ? tx[i] : (node.x as number)
      sy[i] = fresh ? ty[i] : (node.y as number)
      if (Math.abs(sx[i] - tx[i]) > 0.01 || Math.abs(sy[i] - ty[i]) > 0.01) moving = true
    }

    // camera: fit the straight map now, so it and the nodes arrive together
    const { width, height } = sizeRef.current
    if (fg && width > 0 && height > 0 && metro.targets.size > 0) {
      const { k, cx, cy } = metroFitTransform(metro.bbox, { width, height }, FIT_PAD, FIT_MAX_ZOOM, METRO_MIN_ZOOM)
      fg.centerAt(cx, cy, FIT_MS)
      fg.zoom(k, FIT_MS)
    }
    fittedRef.current = true
    fitStarted(Math.max(FIT_MS, moving ? METRO_TWEEN_MS : 0))

    const duration = moving ? METRO_TWEEN_MS : 0
    const t0 = performance.now()
    let raf = 0
    const step = () => {
      const elapsed = performance.now() - t0
      const u = duration > 0 ? easeInOutCubic(elapsed / duration) : 1
      for (let i = 0; i < n; i++) {
        const node = nodes[i]
        const x = sx[i] + (tx[i] - sx[i]) * u
        const y = sy[i] + (ty[i] - sy[i]) * u
        node.x = x
        node.y = y
        node.fx = x
        node.fy = y
        node.vx = 0
        node.vy = 0
      }
      if (elapsed < duration) raf = requestAnimationFrame(step)
      else if (tweenRef.current) {
        tweenRef.current = false
        setTweening(false)
      }
    }
    if (duration > 0) {
      tweenRef.current = true
      setTweening(true)
    }
    step()
    return () => {
      cancelAnimationFrame(raf)
      if (tweenRef.current) {
        tweenRef.current = false
        setTweening(false)
      }
    }
  }, [index, metro, ready, fitStarted])

  return (
    <div ref={containerRef} className="h-full w-full" onPointerLeave={handlePointerLeave} onPointerMove={onPointerMove}>
      {ready && (
        <ForceGraph2D<GraphNode, GardenLinkFields>
          ref={fgRef}
          width={size.width}
          height={size.height}
          graphData={index.graphData}
          backgroundColor={CANVAS_BG}
          nodeId="id"
          nodeCanvasObjectMode={NODE_MODE_REPLACE}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintPointerArea}
          linkVisibility={!metroOn}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkCurvature={linkCurvature}
          linkDirectionalArrowLength={0}
          linkCanvasObjectMode={linkMode}
          linkCanvasObject={paintLink}
          cooldownTicks={metroOn ? 0 : 200}
          onNodeHover={handleHover}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          onLinkClick={handleLinkClick}
          onNodeDrag={handleNodeDrag}
          onNodeDragEnd={handleDragEnd}
          onEngineTick={handleEngineTick}
          onEngineStop={handleEngineStop}
          onRenderFramePre={metroOn ? paintMetro : undefined}
          onRenderFramePost={paintLabels}
          autoPauseRedraw={!labelsBusy && !tweening}
          enableNodeDrag={!metroOn}
        />
      )}
    </div>
  )
}
