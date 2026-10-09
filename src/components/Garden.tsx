import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d'
import type { Graph, GraphLink, GraphNode, ViewMode } from '../types'
import { useGardenStore } from '../store/useGardenStore'
import {
  ACCENT,
  CANVAS_BG,
  FALLBACK_COLOUR,
  LABEL_FONT,
  MONO_FONT,
  MUTED_COLOUR,
  ROOT_FILL,
  ROOT_RING,
  TEXT_COLOUR,
  assignLinkCurvature,
  buildBranchReach,
  buildNeighbourIndex,
  createTimeForce,
  hexToRgba,
  linkEndId,
  nodeRadius,
  selectedReach,
  shortSha,
  type TimeForce,
} from './gardenUtils'

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
  onNodeClick: (id: string) => void
  onBackgroundClick: () => void
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
}

interface ScaleCache {
  scale: number
  px: number
  labelFont: string
  shaFont: string
  badgeFont: string
  dash: number[]
}

const NO_DASH: number[] = []
const TWO_PI = Math.PI * 2
const DIM_ALPHA = 0.2
const FALLBACK_LINK = hexToRgba(FALLBACK_COLOUR, 0.35)
const FALLBACK_LINK_DIM = hexToRgba(FALLBACK_COLOUR, 0.07)
const HALO_FILL = 'rgba(167, 139, 250, 0.22)'
const HALO_RING = 'rgba(167, 139, 250, 0.7)'
const HOVER_RING = 'rgba(220, 221, 222, 0.45)'
const BADGE_BG = '#2a2a2a'
const BADGE_TEXT = '#b8b8b8'

export default function Garden({ graph, viewMode, onNodeClick, onBackgroundClick }: GardenProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fgRef = useRef<GardenMethods | undefined>(undefined)
  const sizeRef = useRef({ width: 0, height: 0 })
  const [size, setSize] = useState({ width: 0, height: 0 })

  // Hover lives in a ref (paint reads it); hoverVersion only exists to hand the paint
  // callbacks a new identity so force-graph schedules a redraw after the engine has stopped.
  const hoverRef = useRef<string | null>(null)
  const [hoverVersion, setHoverVersion] = useState(0)

  const fittedRef = useRef(false)
  const prevNodesRef = useRef<Map<string, GardenNode>>(new Map())
  const timeForceRef = useRef<TimeForce | null>(null)
  const scaleCache = useRef<ScaleCache>({ scale: -1, px: 1, labelFont: '', shaFont: '', badgeFont: '', dash: [3, 2] })

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
    const nodes: GardenNode[] = graph.nodes.map((n) => {
      const copy: GardenNode = { ...n }
      const old = previous.get(n.id)
      if (old !== undefined && old.x !== undefined && old.y !== undefined) {
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
    }
  }, [graph])

  useEffect(() => {
    prevNodesRef.current = index.nodeById
    fittedRef.current = false
  }, [index])

  const ready = size.width > 0 && size.height > 0

  // ---- forces ----
  useEffect(() => {
    if (!ready) return
    const fg = fgRef.current
    if (!fg) return
    const charge = fg.d3Force('charge')
    if (charge && typeof charge.strength === 'function') charge.strength(viewMode === 'skeleton' ? -40 : -15)
    const link = fg.d3Force('link')
    if (link && typeof link.distance === 'function') link.distance(30)
    if (!timeForceRef.current) timeForceRef.current = createTimeForce(() => sizeRef.current.width, 0.03)
    fg.d3Force('time', timeForceRef.current)
    fg.d3ReheatSimulation()
  }, [index, viewMode, ready])

  // ---- paint ----
  // null = nothing to isolate: no selection, or the selected branch has no tip in this graph
  // (stale-filtered, or its tipSha is not among the fetched commits).
  const reachSet = selectedReach(index.reach, selectedBranch)
  const query = search.trim().toLowerCase()

  const syncScale = (globalScale: number): ScaleCache => {
    const c = scaleCache.current
    if (c.scale !== globalScale) {
      c.scale = globalScale
      c.px = 1 / globalScale
      c.labelFont = `${12 / globalScale}px ${LABEL_FONT}`
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
      const hovered = hoverRef.current

      let dim = false
      if (hovered !== null && hovered !== id) {
        const near = index.neighbours.get(hovered)
        if (near === undefined || !near.has(id)) dim = true
      }
      if (!dim && reachSet !== null && !reachSet.has(id)) dim = true

      const r = nodeRadius(node.reach)
      const colour = index.palette[node.owner] ?? FALLBACK_COLOUR
      const fill = node.isRoot && !node.isTip ? ROOT_FILL : colour
      const isHovered = hovered === id
      const isInspected = inspectorNodeId === id
      const label = index.tipLabel.get(id)
      const matches = query !== '' && label !== undefined && (index.tipLabelLower.get(id) ?? '').includes(query)
      const outer = r + (node.isTip ? 2 : 0)

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

      if (node.isTip) {
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

      if (node.isRoot) {
        ctx.setLineDash(c.dash)
        ctx.beginPath()
        ctx.arc(x, y, outer + (node.isTip ? 5 : 2.5) * px, 0, TWO_PI)
        ctx.strokeStyle = ROOT_RING
        ctx.lineWidth = 1.2 * px
        ctx.stroke()
        ctx.setLineDash(NO_DASH)
      }

      if (label !== undefined) {
        ctx.font = c.labelFont
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = TEXT_COLOUR
        ctx.fillText(label, x + outer + 6 * px, y)
      } else if (globalScale > 2.5 || isHovered || isInspected) {
        ctx.font = c.shaFont
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = MUTED_COLOUR
        ctx.fillText(shortSha(id), x + r + 5 * px, y)
      }

      ctx.globalAlpha = 1
    },
    // hoverVersion is intentionally a dependency: it forces a new callback identity on hover change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, reachSet, query, inspectorNodeId, hoverVersion],
  )

  const paintPointerArea = useCallback(
    (node: GardenNode, colour: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x
      const y = node.y
      if (x === undefined || y === undefined) return
      const px = 1 / globalScale
      const outer = nodeRadius(node.reach) + (node.isTip ? 2 : 0)
      ctx.fillStyle = colour
      ctx.beginPath()
      ctx.arc(x, y, outer + (node.isTip ? 3.25 : 1) * px, 0, TWO_PI)
      ctx.fill()
    },
    [],
  )

  const linkColor = useCallback(
    (link: GardenLink) => {
      const s = linkEndId(link.source)
      const t = linkEndId(link.target)
      const hovered = hoverRef.current
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
      const hovered = hoverRef.current
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
      const text = link.badge
      ctx.font = c.badgeFont
      const w = ctx.measureText(text).width + 8 * px
      const h = 13 * px

      ctx.globalAlpha = dim ? DIM_ALPHA : 1
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(mx - w / 2, my - h / 2, w, h, 3 * px)
      else ctx.rect(mx - w / 2, my - h / 2, w, h)
      ctx.fillStyle = BADGE_BG
      ctx.fill()
      ctx.strokeStyle = index.linkColour.get(link.owner) ?? FALLBACK_LINK
      ctx.lineWidth = px
      ctx.stroke()
      ctx.fillStyle = BADGE_TEXT
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, mx, my + 0.5 * px)
      ctx.globalAlpha = 1
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, reachSet, hoverVersion],
  )

  // ---- interaction ----
  const handleHover = useCallback((node: GardenNode | null) => {
    const id = node ? String(node.id) : null
    if (hoverRef.current !== id) {
      hoverRef.current = id
      setHoverVersion((v) => v + 1)
    }
  }, [])

  const handleNodeClick = useCallback(
    (node: GardenNode) => {
      onNodeClick(String(node.id))
    },
    [onNodeClick],
  )

  const handleBackgroundClick = useCallback(() => {
    onBackgroundClick()
  }, [onBackgroundClick])

  const handleDragEnd = useCallback((node: GardenNode) => {
    // release the node so the layout can settle it again (Obsidian behaviour)
    node.fx = undefined
    node.fy = undefined
  }, [])

  const handleEngineStop = useCallback(() => {
    if (fittedRef.current) return
    fittedRef.current = true
    fgRef.current?.zoomToFit(400, 40)
  }, [])

  return (
    <div ref={containerRef} className="h-full w-full">
      {ready && (
        <ForceGraph2D<GraphNode, GardenLinkFields>
          ref={fgRef}
          width={size.width}
          height={size.height}
          graphData={index.graphData}
          backgroundColor={CANVAS_BG}
          nodeId="id"
          nodeCanvasObjectMode="replace"
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintPointerArea}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkCurvature={linkCurvature}
          linkDirectionalArrowLength={0}
          linkCanvasObjectMode={linkMode}
          linkCanvasObject={paintLink}
          cooldownTicks={200}
          onNodeHover={handleHover}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          onNodeDragEnd={handleDragEnd}
          onEngineStop={handleEngineStop}
          enableNodeDrag
        />
      )}
    </div>
  )
}
