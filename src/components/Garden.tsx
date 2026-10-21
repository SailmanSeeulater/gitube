import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d'
import type { Graph, GraphLink, GraphNode, ViewMode } from '../types'
import type { ContributorFocus } from '../graph/contributors'
import { clockAt, growth, stemGrowth, type Timeline } from '../graph/timeline'
import { partialPolyline, partialQuad, popScale } from './timelapseDraw'
import { DROOP, bloomOf, hash01, leafSpots, stemWidthPx } from './gardenLook'
import { BLOOM_SCALE, drawLeaf, drawMergeFlower, drawRoots, drawTip, gardenInk, leafColour } from './gardenPaint'
import type { MetroStationKind as MetroStation } from '../graph/metro'
import type { Theme } from '../theme/themes'
import { useGardenStore } from '../store/useGardenStore'
import {
  FIT_MAX_ZOOM,
  FIT_PAD,
  LABEL_FONT,
  MAX_PINNED_SEARCH_HITS,
  MONO_FONT,
  assignLinkCurvature,
  bodyRadius,
  buildBranchReach,
  buildLinkColours,
  buildNeighbourIndex,
  createCentringForce,
  createTimeForce,
  fitTransform,
  isDimmed,
  linkEndId,
  nodeRadius,
  selectedReach,
  shortSha,
  type LinkColours,
  type TimeForce,
} from './gardenUtils'
import { TIP_RING_PX, useLabelPlacer, type LabelLines, type LabelMarks } from './useLabelPlacer'
import {
  METRO_BADGE_MIN_PX,
  METRO_BEAD_RING_PX,
  METRO_LINE_WIDTH,
  METRO_MIN_LINE_PX,
  METRO_MIN_ZOOM,
  METRO_TWEEN_MS,
  easeInOutCubic,
  isLinkDimmed,
  metroBadgeFontPx,
  metroCommitGlyph,
  metroFitTransform,
  metroRevealTransform,
  metroRunMarker,
  metroStationRadius,
  strokeRunBars,
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
  /**
   * branch name -> colour in the active theme. Kept apart from the graph (graph.palette is not
   * read) so a theme switch recolours without rebuilding graphData or touching the layout.
   */
  palette: Record<string, string>
  /** active theme: every canvas colour, the dim alpha and the link alphas */
  theme: Theme
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
  /** The selected contributor's commits, links and labels to keep lit; null when nobody is selected. */
  focus?: ContributorFocus | null
  /** The time-lapse: only what has grown by its progress is drawn. null when it is off. */
  timelapse?: GardenTimelapse | null
  /** branch name -> thorn level (1..3) for branches far apart from the default one (see graph/weeds) */
  thorns?: ReadonlyMap<string, number> | null
  /**
   * The garden layout: organic physics with time running up the canvas instead of across, drawn as
   * plants (gardenLook / gardenPaint). Ignored while metro is set.
   */
  garden?: boolean
}

export interface GardenTimelapse {
  /** of exactly the graph passed in */
  timeline: Timeline
  /** 0..1, written by the controls every frame and read by every paint (no React render per frame) */
  progress: RefObject<number>
  /** 'owner/repo', in the corner of the canvas so a recording names its repo */
  title: string
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
  /** nodes that had no position in the previous graph (a metro tween starts them at their target) */
  freshIds: Set<string>
}

/** Colours for one theme and palette; paint reads these, so a theme switch is a redraw, never a rebuild. */
interface GardenColours {
  theme: Theme
  palette: Record<string, string>
  links: LinkColours
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
const FIT_MS = 400
/** metro mode: a search brings its hits into view once typing has paused this long */
const SEARCH_REVEAL_MS = 300
/** Root tendrils under cut-off history reach this far (graph units), plus a little per node size. */
const ROOT_LENGTH = 16
/** Leaves along a garden stem, in graph units. */
const LEAF_LENGTH = 7
const LEAF_WIDTH = 2.4
/** The garden layout draws '+N' run counts only from this zoom up (its leaves stand for them below). */
const GARDEN_BADGE_MIN_ZOOM = 1.6
/** The garden layout spreads time over this share of the canvas height. */
const GARDEN_HEIGHT_SHARE = 0.85
// time-lapse in metro mode: the camera pans when the growing edge leaves [MIN, MAX] of the view's
// width, putting it at FOLLOW_AT, in a glide of FOLLOW_MS
const FOLLOW_MIN = 0.1
const FOLLOW_MAX = 0.85
const FOLLOW_AT = 0.55
const FOLLOW_MS = 600
// fit early, once the layout has roughly settled (every tip slower than 1 px per frame after 20
// ticks), instead of after all 200 cooldown ticks; onEngineStop stays as the fallback
const EARLY_FIT_TICKS = 20
const EARLY_FIT_SPEED = 1
const TWO_PI = Math.PI * 2
// metro mode (its colours and line alphas come from the theme: stationRing, metro*Alpha, derived);
// the run marker bars' sizes live with strokeRunBars in metroView.ts

/**
 * A station's radius for the label placer in graph units: the glyph's, except a plain commit's bead,
 * whose size follows the zoom: half its line's width here, plus METRO_BEAD_RING_PX screen px.
 */
function labelStationRadius(kind: MetroStation | undefined, isTip: boolean): number {
  return kind === 'commit' && !isTip ? METRO_LINE_WIDTH / 2 : metroStationRadius(kind, isTip)
}

/** A '+N' run badge centred on (mx, my) in the theme's badge colours; px = 1 / globalScale. Leaves globalAlpha at 1. */
function drawBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  mx: number,
  my: number,
  px: number,
  font: string,
  ring: string,
  alpha: number,
  theme: Theme,
): void {
  ctx.font = font
  const w = ctx.measureText(text).width + 8 * px
  const h = 13 * px
  ctx.globalAlpha = alpha
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(mx - w / 2, my - h / 2, w, h, 3 * px)
  else ctx.rect(mx - w / 2, my - h / 2, w, h)
  ctx.fillStyle = theme.badgeBg
  ctx.fill()
  ctx.strokeStyle = ring
  ctx.lineWidth = px
  ctx.stroke()
  ctx.fillStyle = theme.badgeText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, mx, my + 0.5 * px)
  ctx.globalAlpha = 1
}

/** Spikes around a thorny tip. */
const THORN_SPIKES = 9

/** How far a tip's thorns reach beyond its ring, in screen px; 0 for no thorns. */
function thornLengthPx(level: number): number {
  return level > 0 ? 2.5 + 2.5 * level : 0
}

/**
 * Thorns around a tip far apart from the default branch: THORN_SPIKES triangles in the branch's
 * colour, based on a circle of radius base (graph units) and reaching thornLengthPx(level) further.
 */
function drawThorns(ctx: CanvasRenderingContext2D, x: number, y: number, base: number, level: number, px: number, colour: string): void {
  const reach = base + thornLengthPx(level) * px
  const half = (Math.PI / THORN_SPIKES) * 0.55
  ctx.beginPath()
  for (let i = 0; i < THORN_SPIKES; i++) {
    // turned off the axes so no spike points straight at a label or a lane
    const a = (i / THORN_SPIKES) * TWO_PI + 0.3
    ctx.moveTo(x + Math.cos(a - half) * base, y + Math.sin(a - half) * base)
    ctx.lineTo(x + Math.cos(a) * reach, y + Math.sin(a) * reach)
    ctx.lineTo(x + Math.cos(a + half) * base, y + Math.sin(a + half) * base)
    ctx.closePath()
  }
  ctx.fillStyle = colour
  ctx.fill()
}

/**
 * The time-lapse caption, drawn on the canvas so recordings carry it: the date the clock has reached
 * and the commits so far (top right), the repo (bottom right), and the progress along the bottom edge.
 */
function drawTimelapseHud(ctx: CanvasRenderingContext2D, timelapse: GardenTimelapse, theme: Theme): void {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
  const W = ctx.canvas.width / dpr
  const H = ctx.canvas.height / dpr
  const progress = Math.min(1, Math.max(0, timelapse.progress.current))
  const { time, commits } = clockAt(timelapse.timeline, progress)
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.globalAlpha = 1
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  const text = (s: string, x: number, y: number) => {
    ctx.strokeStyle = theme.derived.textHalo
    ctx.lineWidth = 4
    ctx.strokeText(s, x, y)
    ctx.fillText(s, x, y)
  }
  if (Number.isFinite(time)) {
    ctx.font = `600 22px ${LABEL_FONT}`
    ctx.fillStyle = theme.text
    text(new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), W - 18, 38)
  }
  ctx.font = `12px ${LABEL_FONT}`
  ctx.fillStyle = theme.muted
  text(`${commits} commit${commits === 1 ? '' : 's'}`, W - 18, 58)
  ctx.font = `11px ${LABEL_FONT}`
  text(`${timelapse.title} · repo-garden`, W - 14, H - 14)
  ctx.globalAlpha = 0.85
  ctx.fillStyle = theme.accent
  ctx.fillRect(0, H - 3, W * progress, 3)
  ctx.restore()
}

export default function Garden({
  graph,
  palette,
  theme,
  viewMode,
  defaultBranch,
  onNodeClick,
  onBackgroundClick,
  metro = null,
  focus = null,
  timelapse = null,
  thorns = null,
  garden: gardenProp = false,
}: GardenProps) {
  const garden = gardenProp && metro === null
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
  /** after a switch between organic and garden: fit when the physics stops, not early (the layout is still turning) */
  const lateFitRef = useRef(false)
  const tickCountRef = useRef(0)
  const prevNodesRef = useRef<Map<string, GardenNode>>(new Map())
  const timeForceRef = useRef<TimeForce | null>(null)
  const timeAxisRef = useRef<'x' | 'y'>('x')
  const scaleCache = useRef<ScaleCache>({ scale: -1, px: 1, shaFont: '', badgeFont: '', dash: [3, 2] })
  const metroOn = metro !== null
  const metroRef = useRef<MetroView | null>(metro)
  metroRef.current = metro
  /** '+N' run text drawn in this frame (graph units), for the label placer; see paintMetro */
  const markBoxesRef = useRef<LabelMarks>({ rects: new Float32Array(64), count: 0 })
  /** true while nodes tween between layouts: links are drawn straight, and every frame is redrawn */
  const tweenRef = useRef(false)
  const [tweening, setTweening] = useState(false)
  /**
   * The index whose freshIds are used up: by its first metro tween, or at once when it was built in
   * organic mode (the physics places its new nodes, so a later switch to metro tweens them all).
   */
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

    return {
      graphData: { nodes, links },
      nodeById,
      neighbours: buildNeighbourIndex(graph.links),
      reach: buildBranchReach(graph.nodes, graph.links),
      tipLabel,
      tipLabelLower,
      freshIds,
    }
  }, [graph])

  // ---- colours, keyed on the theme and its palette only. The paint callbacks depend on them, so a
  // theme switch hands force-graph new callbacks, which it answers with one redraw: graphData,
  // the simulation and the label placer are untouched. ----
  const colours = useMemo<GardenColours>(() => ({ theme, palette, links: buildLinkColours(palette, theme) }), [theme, palette])

  useEffect(() => {
    prevNodesRef.current = index.nodeById
    fittedRef.current = false
    tickCountRef.current = 0
    // built in organic mode: the physics places every node, so a later switch to metro tweens them
    // all from where they are (read from the ref: metroOn as a dependency would reset the fit on
    // every toggle). Declared before the metro effect, so it runs first in the same commit.
    if (!metroRef.current) lastTweenIndexRef.current = index
  }, [index])

  const ready = size.width > 0 && size.height > 0

  // ---- forces (organic and garden; metro mode pins every node, see the tween below) ----
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
    // organic spreads time across (older left); the garden grows it upward (older at the bottom).
    // Switching between them re-fits once the physics has turned the layout.
    const axis = garden ? 'y' : 'x'
    if (!timeForceRef.current || timeAxisRef.current !== axis) {
      if (timeForceRef.current) {
        fittedRef.current = false
        tickCountRef.current = 0
        lateFitRef.current = true
      }
      timeForceRef.current = garden
        ? createTimeForce(() => sizeRef.current.height * GARDEN_HEIGHT_SHARE, 0.05, 'y')
        : createTimeForce(() => sizeRef.current.width, 0.03)
      timeAxisRef.current = axis
    }
    const charge = fg.d3Force('charge')
    if (charge && typeof charge.strength === 'function') charge.strength(viewMode === 'skeleton' ? -40 : -15)
    const link = fg.d3Force('link')
    if (link && typeof link.distance === 'function') link.distance(30)
    fg.d3Force('time', timeForceRef.current)
    // the garden grows up, not wide: a weak pull towards the centre line
    fg.d3Force('upright', garden ? createCentringForce(0.02) : null)
    fg.d3ReheatSimulation()
  }, [index, viewMode, ready, metroOn, garden])

  // ---- paint ----
  // null = nothing to isolate: no selection, or the selected branch has no tip in this graph
  // (stale-filtered, or its tipSha is not among the fetched commits). A selected contributor
  // (never set together with a branch) isolates their commits instead; their links come from
  // focus.links (see isLinkDimmed), and the tips of the branches they worked on keep their labels.
  const branchReach = selectedReach(index.reach, selectedBranch)
  const reachSet = focus ? focus.nodes : branchReach
  const litLinks = focus ? focus.links : null
  const labelReach = focus ? focus.labels : branchReach
  const query = search.trim().toLowerCase()

  const bumpHover = useCallback(() => setHoverVersion((v) => v + 1), [])

  // ---- the garden layout's look ----
  // One clock per graph, so a tip never blooms or wilts while it is on screen; during a time-lapse
  // the clock is the date it has reached, so flowers open while their branch is busy and wilt as
  // the replay moves on. Read per paint, worked out once per progress value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadedAt = useMemo(() => Date.now(), [index])
  const bloomClockRef = useRef({ progress: Number.NaN, time: 0 })
  const gardenNow = useCallback((): number => {
    if (!timelapse) return loadedAt
    const memo = bloomClockRef.current
    const progress = timelapse.progress.current
    if (memo.progress !== progress) {
      const { time } = clockAt(timelapse.timeline, progress)
      memo.progress = progress
      memo.time = Number.isFinite(time) ? time : loadedAt
    }
    return memo.time
  }, [timelapse, loadedAt])
  const ink = useMemo(() => gardenInk(theme), [theme])
  // leaves are a branch colour turned green; blended once per colour and theme
  const leafOf = useMemo(() => {
    const cache = new Map<string, string>()
    return (colour: string): string => {
      let leaf = cache.get(colour)
      if (leaf === undefined) {
        try {
          leaf = leafColour(colour, ink)
        } catch {
          leaf = colour // not a hex colour: leave it as it is
        }
        cache.set(colour, leaf)
      }
      return leaf
    }
  }, [ink])

  // labels keep clear of the station glyphs in metro mode, which are not reach-sized, and of a
  // garden tip's petals
  const labelRadius = useMemo(() => {
    if (metro) return (node: GraphNode) => labelStationRadius(metro.stations.get(node.id), node.isTip)
    if (garden) return (node: GraphNode) => (node.isTip ? bodyRadius(node) * BLOOM_SCALE : bodyRadius(node))
    return undefined
  }, [metro, garden])
  // thorns: the highest level among the branches whose tip a node is (0 for none)
  const thornOf = useCallback(
    (node: GraphNode): number => {
      if (!thorns || !node.isTip) return 0
      let level = 0
      for (const tip of node.tips) level = Math.max(level, thorns.get(tip) ?? 0)
      return level
    },
    [thorns],
  )
  // labels keep clear of bead rings in metro mode, and of thorns in every layout
  const labelRing = useMemo(() => {
    const thornPx = (node: GraphNode) => thornLengthPx(thornOf(node))
    if (metro) return (node: GraphNode) => (metro.stations.get(node.id) === 'commit' && !node.isTip ? METRO_BEAD_RING_PX : 0) + thornPx(node)
    if (!thorns || thorns.size === 0) return undefined
    // garden: petals are in labelRadius already, so only thorns; organic: the default tip ring too
    if (garden) return thornPx
    return (node: GraphNode) => (node.isTip ? TIP_RING_PX : 0) + thornPx(node)
  }, [metro, garden, thorns, thornOf])
  // ... and off the station rings (plain commit dots stay coverable) and the lines: the routes as
  // drawn once the tween has ended (during it, links are drawn straight)
  const labelHard = useMemo(() => (metro ? (node: GraphNode) => metro.stations.get(node.id) !== 'commit' : undefined), [metro])
  const labelLines = useMemo<LabelLines | undefined>(
    () =>
      metro && !tweening
        ? { segs: metro.segs, segSrc: metro.segSrc, segTgt: metro.segTgt, halfWidth: METRO_LINE_WIDTH / 2, minHalfPx: METRO_MIN_LINE_PX / 2 }
        : undefined,
    [metro, tweening],
  )
  // ---- time-lapse: how far each node and stem has grown at timelapse.progress (read per paint) ----
  /** 0 = not there yet, 1 = fully grown; always 1 with the time-lapse off */
  const nodeGrowth = useCallback(
    (id: string): number => (timelapse ? growth(timelapse.timeline.nodeAt.get(id) ?? 0, timelapse.progress.current) : 1),
    [timelapse],
  )
  const stemShown = useCallback(
    (source: string, target: string): number => (timelapse ? stemGrowth(timelapse.timeline, source, target, timelapse.progress.current) : 1),
    [timelapse],
  )
  const labelHidden = useMemo(() => (timelapse ? (id: string) => nodeGrowth(id) <= 0 : undefined), [timelapse, nodeGrowth])

  const { paintLabels, onPointerMove, onPointerLeave, clickTest, labelsBusy, maxTipSpeed, setDragNode, fitStarted } = useLabelPlacer({
    index,
    defaultBranch,
    reachSet: labelReach,
    query,
    selectedBranch,
    inspectorNodeId,
    hoverRef,
    labelHoverRef,
    onLabelHoverChange: bumpHover,
    theme,
    palette,
    radiusOf: labelRadius,
    ringPxOf: labelRing,
    isHardNode: labelHard,
    lines: labelLines,
    marks: metroOn ? markBoxesRef : undefined,
    halo: metroOn,
    isHidden: labelHidden,
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
      const id = node.id
      // time-lapse: nothing until it has appeared, then a quick pop to full size
      const grown = nodeGrowth(id)
      if (grown <= 0) return
      const pop = grown < 1 ? popScale(grown) : 1
      if (pop !== 1) {
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(pop, pop)
        ctx.translate(-x, -y)
      }
      const c = syncScale(globalScale)
      const px = c.px
      const hovered = hoverRef.current ?? labelHoverRef.current
      const dim = isDimmed(id, hovered, index.neighbours, reachSet)
      const th = colours.theme

      const kind = metro ? metro.stations.get(id) : undefined
      // a plain commit in metro full view is a bead sized to its line and its neighbours
      const bead = metro && kind === 'commit' && !node.isTip ? metroCommitGlyph(px, metro.commitGap.get(id)) : null
      const r = bead ? bead.r : metro ? metroStationRadius(kind, node.isTip) : nodeRadius(node.reach)
      const colour = colours.palette[node.owner] ?? th.fallback
      const fill = node.isRoot && !node.isTip ? th.rootFill : colour
      const isHovered = hovered === id
      const isInspected = inspectorNodeId === id
      const isLabelled = index.tipLabel.has(id)
      const matches = query !== '' && isLabelled && (index.tipLabelLower.get(id) ?? '').includes(query)
      const outer = metro ? r : r + (node.isTip ? 2 : 0)
      // how far the drawn node reaches: a garden tip's petals spread past its body
      const reach = garden && node.isTip ? outer * BLOOM_SCALE : outer

      // a growing node fades in over the first half of its pop
      const alpha = (dim ? th.dimAlpha : 1) * Math.min(1, grown * 2)
      ctx.globalAlpha = alpha

      if (matches) {
        ctx.beginPath()
        ctx.arc(x, y, reach + 7 * px, 0, TWO_PI)
        ctx.fillStyle = th.derived.searchHaloFill
        ctx.fill()
        ctx.strokeStyle = th.derived.searchHaloRing
        ctx.lineWidth = 1 * px
        ctx.stroke()
      }
      if (isInspected || isHovered) {
        ctx.beginPath()
        ctx.arc(x, y, reach + 4.5 * px, 0, TWO_PI)
        ctx.strokeStyle = isInspected ? th.derived.inspectedRing : th.derived.hoverRing
        ctx.lineWidth = 1.2 * px
        ctx.stroke()
      }

      // the garden: history cut off here grows roots, under everything else
      if (garden && node.isRoot) {
        ctx.globalAlpha = alpha * 0.8
        drawRoots(ctx, x, y, ROOT_LENGTH + r * 1.5, hash01(id), 1.3 * px, ink.root)
        ctx.globalAlpha = alpha
      }

      // a tip far apart from the default branch grows thorns, from just outside its ring (or petals)
      const thorn = thornOf(node)
      if (thorn > 0) drawThorns(ctx, x, y, metro ? r + px : garden ? reach : outer + 2.5 * px, thorn, px, colour)

      if (garden) {
        // tips bloom, bud or wilt by age; merges flower; forks are knots on the stem; a root
        // without a tip is a seed; plain commits (full view) are leaves on the stem
        const turn = hash01(id)
        if (node.isTip) drawTip(ctx, x, y, outer, bloomOf(node.commit.date, gardenNow()), turn, colour, ink)
        else if (node.isMerge) drawMergeFlower(ctx, x, y, r * 1.2, turn, colour, ink)
        else if (node.isFork || node.isRoot) {
          ctx.beginPath()
          ctx.arc(x, y, r * 0.9, 0, TWO_PI)
          ctx.fillStyle = node.isRoot ? ink.root : colour
          ctx.fill()
        } else drawLeaf(ctx, x, y, turn * TWO_PI, r * 3, r * 1.1, leafOf(colour))
      } else if (metro) {
        // station glyphs: tips in branch colour outlined in the station colour, interchanges as
        // station-colour rings, origins hollow (their dashed stub is drawn with the lines), plain
        // commits as beads (a ring in the line's colour, wider than the line, around a
        // canvas-coloured core), stops as dots. The station colour contrasts hard with the canvas:
        // near-white on the dark themes, the text colour on the light ones.
        const ring = Math.max(1.5, 1.2 * px)
        ctx.beginPath()
        ctx.arc(x, y, r, 0, TWO_PI)
        if (node.isTip) {
          ctx.fillStyle = colour
          ctx.fill()
          ctx.strokeStyle = th.stationRing
          ctx.lineWidth = ring
          ctx.stroke()
        } else if (kind === 'interchange') {
          ctx.fillStyle = th.stationRing
          ctx.fill()
          ctx.beginPath()
          ctx.arc(x, y, r * 0.5, 0, TWO_PI)
          ctx.fillStyle = th.derived.stationCore
          ctx.fill()
        } else if (kind === 'origin') {
          ctx.fillStyle = th.derived.stationCore
          ctx.fill()
          ctx.strokeStyle = colour
          ctx.lineWidth = ring
          ctx.stroke()
        } else if (bead) {
          ctx.fillStyle = colour
          ctx.fill()
          ctx.beginPath()
          ctx.arc(x, y, bead.core, 0, TWO_PI)
          ctx.fillStyle = th.derived.stationCore
          ctx.fill()
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
        ctx.fillStyle = th.derived.forkNodeFill
        ctx.fill()
        ctx.strokeStyle = node.isRoot ? th.rootRing : colour
        ctx.lineWidth = 1.5 * px
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, TWO_PI)
        ctx.fillStyle = fill
        ctx.fill()
      }

      if (node.isRoot && !metro && !garden) {
        ctx.setLineDash(c.dash)
        ctx.beginPath()
        ctx.arc(x, y, outer + (node.isTip ? 5 : 2.5) * px, 0, TWO_PI)
        ctx.strokeStyle = th.rootRing
        ctx.lineWidth = 1.2 * px
        ctx.stroke()
        ctx.setLineDash(NO_DASH)
      }

      // Tip names are placed and drawn by the label placer (paintLabels); only SHAs are drawn here.
      if (!isLabelled && (globalScale > 2.5 || isHovered || isInspected)) {
        ctx.font = c.shaFont
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = th.muted
        ctx.fillText(shortSha(id), x + r + 5 * px, y)
      }

      ctx.globalAlpha = 1
      if (pop !== 1) ctx.restore()
    },
    // hoverVersion is intentionally a dependency: it forces a new callback identity on hover change.
    // tweening too: the frame after a metro tween must be redrawn with the routes (see paintMetro).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, colours, reachSet, query, inspectorNodeId, hoverVersion, metro, tweening, nodeGrowth, thornOf, garden, gardenNow, ink, leafOf],
  )

  const paintPointerArea = useCallback(
    (node: GardenNode, colour: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x
      const y = node.y
      if (x === undefined || y === undefined) return
      // nothing to hover or click before it has grown
      if (nodeGrowth(node.id) <= 0) return
      const px = 1 / globalScale
      const body = nodeRadius(node.reach) + (node.isTip ? 2 : 0)
      // a garden tip is hit across its petals
      const outer = metro ? metroStationRadius(metro.stations.get(node.id), node.isTip, px) : garden && node.isTip ? body * BLOOM_SCALE : body
      ctx.fillStyle = colour
      ctx.beginPath()
      ctx.arc(x, y, outer + (node.isTip ? 3.25 : 1) * px, 0, TWO_PI)
      ctx.fill()
    },
    [metro, nodeGrowth, garden],
  )

  const linkColor = useCallback(
    (link: GardenLink) => {
      const s = linkEndId(link.source)
      const t = linkEndId(link.target)
      const hovered = hoverRef.current ?? labelHoverRef.current
      return isLinkDimmed(s, t, hovered, reachSet, litLinks)
        ? (colours.links.dim.get(link.owner) ?? colours.theme.derived.fallbackLinkDim)
        : (colours.links.full.get(link.owner) ?? colours.theme.derived.fallbackLink)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colours, reachSet, litLinks, hoverVersion],
  )

  const linkWidth = useCallback((link: GardenLink) => (link.collapsedCount > 0 ? 2 : 1), [])
  const linkCurvature = useCallback((link: GardenLink) => link.curvature, [])
  const linkMode = useCallback((link: GardenLink) => (link.collapsedCount > 0 ? 'after' : undefined), [])

  const paintLink = useCallback(
    (link: GardenLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      // '+N' badges are screen-sized, so only hide them when zoomed far out and they would pile up.
      // in the garden the leaves stand for hidden commits, so the counts wait until zoomed in
      if (globalScale < (garden ? GARDEN_BADGE_MIN_ZOOM : 0.7) || link.collapsedCount <= 0) return
      const s = link.source
      const t = link.target
      if (typeof s !== 'object' || typeof t !== 'object') return
      if (s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) return
      const sid = linkEndId(s)
      const tid = linkEndId(t)
      const hovered = hoverRef.current ?? labelHoverRef.current
      const dim = isLinkDimmed(sid, tid, hovered, reachSet, litLinks)

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
      const th = colours.theme
      const ring = colours.links.full.get(link.owner) ?? th.derived.fallbackLink
      drawBadge(ctx, link.badge, mx, my, px, c.badgeFont, ring, dim ? th.dimAlpha : 1, th)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colours, reachSet, litLinks, hoverVersion, garden],
  )

  /**
   * Time-lapse links replace force-graph's own stroke: a stem growing from the parent towards the
   * child along the same curve (force-graph's __controlPoints, computed just before custom paints),
   * with its '+N' badge once it is whole.
   */
  const paintStem = useCallback(
    (link: GardenLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const s = link.source
      const t = link.target
      if (typeof s !== 'object' || typeof t !== 'object') return
      if (s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) return
      const f = stemShown(linkEndId(s), linkEndId(t))
      if (f <= 0) return
      ctx.strokeStyle = linkColor(link)
      ctx.lineWidth = linkWidth(link) / globalScale
      ctx.beginPath()
      ctx.moveTo(t.x, t.y)
      const cp = (link as { __controlPoints?: number[] | null }).__controlPoints
      if (cp && cp.length === 2) {
        const [qx, qy, ex, ey] = partialQuad(t.x, t.y, cp[0], cp[1], s.x, s.y, f)
        ctx.quadraticCurveTo(qx, qy, ex, ey)
      } else {
        ctx.lineTo(t.x + (s.x - t.x) * f, t.y + (s.y - t.y) * f)
      }
      ctx.stroke()
      if (f >= 1) paintLink(link, ctx, globalScale)
    },
    [stemShown, linkColor, linkWidth, paintLink],
  )
  /**
   * Garden links are stems, drawn here in place of force-graph's line: a gentle per-link bend so no
   * stem is ruler-straight, a sag into a wilted tip, thicker where more branches share the stem, and
   * a leaf for each commit a skeleton stem hides. Grows with the time-lapse like paintStem.
   */
  const paintGardenStem = useCallback(
    (link: GardenLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const s = link.source
      const t = link.target
      if (typeof s !== 'object' || typeof t !== 'object') return
      if (s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) return
      const sid = linkEndId(s)
      const tid = linkEndId(t)
      const f = stemShown(sid, tid)
      if (f <= 0) return
      const dx = s.x - t.x
      const dy = s.y - t.y
      const len = Math.hypot(dx, dy)
      if (!(len > 0)) return
      const cp = (link as { __controlPoints?: number[] | null }).__controlPoints
      let cx = cp && cp.length === 2 ? cp[0] : (s.x + t.x) / 2
      let cy = cp && cp.length === 2 ? cp[1] : (s.y + t.y) / 2
      const bend = (hash01(sid + tid) - 0.5) * 0.25 * len
      cx += (-dy / len) * bend
      cy += (dx / len) * bend
      if (s.isTip && bloomOf(s.commit.date, gardenNow()) === 'wilted') cy += DROOP * len

      ctx.strokeStyle = linkColor(link)
      ctx.lineWidth = stemWidthPx(s.reach) / globalScale
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(t.x, t.y)
      const [qx, qy, ex, ey] = partialQuad(t.x, t.y, cx, cy, s.x, s.y, f)
      ctx.quadraticCurveTo(qx, qy, ex, ey)
      ctx.stroke()

      if (link.collapsedCount > 0) {
        const hovered = hoverRef.current ?? labelHoverRef.current
        const th = colours.theme
        ctx.globalAlpha = isLinkDimmed(sid, tid, hovered, reachSet, litLinks) ? th.dimAlpha : 0.9
        const leaf = leafOf(colours.palette[link.owner] ?? th.fallback)
        for (const spot of leafSpots(link.collapsedCount)) {
          const u = spot.t
          if (u > f) break
          // the point and direction of the curve at u (parent t -> control -> child s)
          const a = (1 - u) * (1 - u)
          const b = 2 * (1 - u) * u
          const c = u * u
          const px = a * t.x + b * cx + c * s.x
          const py = a * t.y + b * cy + c * s.y
          const tx = 2 * (1 - u) * (cx - t.x) + 2 * u * (s.x - cx)
          const ty = 2 * (1 - u) * (cy - t.y) + 2 * u * (s.y - cy)
          drawLeaf(ctx, px, py, Math.atan2(ty, tx) + spot.side * 0.95, LEAF_LENGTH, LEAF_WIDTH, leaf)
        }
        ctx.globalAlpha = 1
      }
      if (f >= 1) paintLink(link, ctx, globalScale)
    },
    // hoverVersion: leaves dim with the hover like the stem's colour does
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stemShown, linkColor, paintLink, gardenNow, leafOf, colours, reachSet, litLinks, hoverVersion],
  )
  const stemMode = useCallback(() => 'replace' as const, [])
  // ungrown links are left out of force-graph's hit canvas too, so they cannot be clicked
  const linkVisible = useMemo(
    () => (timelapse ? (link: GardenLink) => !metroOn && stemShown(linkEndId(link.source), linkEndId(link.target)) > 0 : !metroOn),
    [timelapse, metroOn, stemShown],
  )

  /**
   * Metro mode draws every link itself, before the nodes (onRenderFramePre), so it controls the
   * order: muted and dashed routes first, lane changes next, plain lane runs on top. While the nodes
   * tween, links are drawn straight between their current positions instead of along the routes.
   * Redraws ride on paintNode's identity, which changes with every input read here.
   */
  const paintMetro = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      markBoxesRef.current.count = 0
      if (!metro) return
      const c = syncScale(globalScale)
      const px = c.px
      const hovered = hoverRef.current ?? labelHoverRef.current
      const width = Math.max(METRO_LINE_WIDTH, METRO_MIN_LINE_PX * px)
      const th = colours.theme
      const palette = colours.palette
      ctx.save()
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      if (tweenRef.current) {
        ctx.lineWidth = width * 0.7
        for (const link of index.graphData.links) {
          const s = typeof link.source === 'object' ? link.source : index.nodeById.get(String(link.source))
          const t = typeof link.target === 'object' ? link.target : index.nodeById.get(String(link.target))
          if (!s || !t || s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) continue
          const f = stemShown(String(s.id), String(t.id))
          if (f <= 0) continue
          const dim = isLinkDimmed(String(s.id), String(t.id), hovered, reachSet, litLinks)
          ctx.globalAlpha = dim ? th.metroDimAlpha : th.metroMutedAlpha
          ctx.strokeStyle = palette[link.owner] ?? th.fallback
          ctx.beginPath()
          ctx.moveTo(t.x, t.y)
          ctx.lineTo(t.x + (s.x - t.x) * f, t.y + (s.y - t.y) * f)
          ctx.stroke()
        }
        ctx.restore()
        return
      }
      // truncated history: a dashed lead-in before each root
      ctx.setLineDash([4, 4])
      ctx.lineWidth = Math.max(1.2, px)
      for (const stub of metro.stubs) {
        const grown = nodeGrowth(stub.nodeId)
        if (grown <= 0) continue
        const dim = (hovered !== null && hovered !== stub.nodeId) || (reachSet !== null && !reachSet.has(stub.nodeId))
        ctx.globalAlpha = (dim ? th.metroDimAlpha : th.metroStubAlpha) * grown
        ctx.strokeStyle = palette[stub.colorBranch] ?? th.fallback
        ctx.beginPath()
        ctx.moveTo(stub.x0, stub.y0)
        ctx.lineTo(stub.x1, stub.y1)
        ctx.stroke()
      }
      ctx.setLineDash(NO_DASH)
      let dashed = false
      for (const r of metro.routes) {
        // the time-lapse grows each route from its parent end (pts run parent to child)
        const f = stemShown(r.source, r.target)
        if (f <= 0) continue
        const dim = isLinkDimmed(r.source, r.target, hovered, reachSet, litLinks)
        ctx.globalAlpha = dim ? th.metroDimAlpha : r.muted ? th.metroMutedAlpha : th.metroLineAlpha
        ctx.strokeStyle = palette[r.colorBranch] ?? th.fallback
        ctx.lineWidth = r.muted || r.dashed ? width * 0.65 : width
        if (r.dashed !== dashed) {
          dashed = r.dashed
          ctx.setLineDash(dashed ? [Math.max(5, 4 * px), Math.max(4, 3 * px)] : NO_DASH)
        }
        const pts = f >= 1 ? r.pts : partialPolyline(r.pts, f)
        ctx.beginPath()
        ctx.moveTo(pts[0], pts[1])
        for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1])
        ctx.stroke()
      }
      ctx.setLineDash(NO_DASH)
      // run markers (hidden commits): a break on the line at every zoom, a canvas-coloured
      // (textHalo) cut across the whole route under two short runMark bars (strokeRunBars), and
      // the '+N' in the spot beside the line the layout kept free, once it is readable
      // (metroRunMarker). The text boxes go to the label placer, which keeps names off them.
      const marks = markBoxesRef.current
      if (metro.badges.length > 0) {
        for (const b of metro.badges) {
          // run markers wait for their route to finish growing
          if (stemShown(b.source, b.target) < 1) continue
          ctx.globalAlpha = isLinkDimmed(b.source, b.target, hovered, reachSet, litLinks) ? th.metroDimAlpha : 1
          strokeRunBars(ctx, b, px, width, th)
        }
        const fontPx = metroBadgeFontPx(globalScale)
        if (fontPx >= METRO_BADGE_MIN_PX) {
          ctx.font = `${fontPx * px}px ${LABEL_FONT}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.lineJoin = 'round'
          const halfH = (fontPx / 2 + 1) * px
          for (const b of metro.badges) {
            if (b.textY === null || metroRunMarker(b, globalScale) !== 'badge' || stemShown(b.source, b.target) < 1) continue
            ctx.globalAlpha = isLinkDimmed(b.source, b.target, hovered, reachSet, litLinks) ? th.dimAlpha : 1
            ctx.strokeStyle = th.derived.textHalo
            ctx.lineWidth = 2.5 * px
            ctx.strokeText(b.text, b.x, b.textY)
            ctx.fillStyle = th.derived.runMark
            ctx.fillText(b.text, b.x, b.textY)
            const halfW = ctx.measureText(b.text).width / 2 + px
            if (marks.rects.length < 4 * (marks.count + 1)) {
              const grown = new Float32Array(Math.max(64, marks.rects.length * 2))
              grown.set(marks.rects)
              marks.rects = grown
            }
            const q = 4 * marks.count++
            marks.rects[q] = b.x - halfW
            marks.rects[q + 1] = b.textY - halfH
            marks.rects[q + 2] = b.x + halfW
            marks.rects[q + 3] = b.textY + halfH
          }
        }
      }
      ctx.restore()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metro, index, colours, reachSet, litLinks, hoverVersion, stemShown, nodeGrowth],
  )

  // Time-lapse frames paint their own background (the canvas is otherwise transparent over a CSS
  // colour), so a recording of the canvas is not black; metro lines go on top of it.
  const paintPre = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (timelapse) {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.fillStyle = colours.theme.canvas
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
        ctx.restore()
      }
      if (metroOn) paintMetro(ctx, globalScale)
    },
    [timelapse, colours, metroOn, paintMetro],
  )

  const paintPost = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      paintLabels(ctx, globalScale)
      if (timelapse) drawTimelapseHud(ctx, timelapse, colours.theme)
    },
    [paintLabels, timelapse, colours],
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
    if (!fittedRef.current && !lateFitRef.current && tickCountRef.current > EARLY_FIT_TICKS && maxTipSpeed() < EARLY_FIT_SPEED) runFit()
  }, [maxTipSpeed, runFit])

  const handleEngineStop = useCallback(() => {
    lateFitRef.current = false
    runFit()
  }, [runFit])

  // ---- metro mode: pin every node to its station, tweening from where it is now ----
  useEffect(() => {
    if (!ready || !metro) return
    const fg = fgRef.current
    const nodes = index.graphData.nodes
    const n = nodes.length
    // a node new to a graph built in metro mode (a branch just shown, a fresh repo) starts at its
    // station; one the physics placed (an index built in organic mode) tweens from there
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

  // ---- time-lapse in metro mode: the camera keeps up with the growing edge ----
  // A long map opens at a readable zoom with its old lines off-screen, which is exactly where a
  // time-lapse starts. The camera holds still and glides in steps: when the newest growth leaves the
  // middle stretch of the view, it pans to put it just past the centre, never past either end of
  // the map (the zoom is left alone). Holding still matters: labels only appear while the camera rests.
  useEffect(() => {
    if (!timelapse || !metro || !ready) return
    let raf = 0
    let busyUntil = 0
    let first = true
    const follow = (now: number) => {
      raf = requestAnimationFrame(follow)
      const fg = fgRef.current
      if (!fg || tweenRef.current || now < busyUntil) return
      let front = -Infinity
      for (const node of index.graphData.nodes) {
        if (nodeGrowth(node.id) <= 0) continue
        const t = metro.targets.get(node.id)
        if (t && t.x > front) front = t.x
      }
      if (!Number.isFinite(front)) return
      const k = fg.zoom()
      const viewW = sizeRef.current.width / k
      const at = fg.centerAt()
      const across = (front - (at.x - viewW / 2)) / viewW
      if (!first && across > FOLLOW_MIN && across < FOLLOW_MAX) return
      const [x0, x1] = metro.bbox.x
      const pad = FIT_PAD.left / k
      const lo = x0 - pad + viewW / 2
      const hi = x1 + pad - viewW / 2
      const goal = lo >= hi ? (x0 + x1) / 2 : Math.min(hi, Math.max(lo, front - (FOLLOW_AT - 0.5) * viewW))
      if (Math.abs(goal - at.x) * k < 2) return
      const ms = first ? 0 : FOLLOW_MS
      first = false
      fg.centerAt(goal, at.y, ms)
      busyUntil = now + ms + 60
    }
    raf = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(raf)
  }, [timelapse, metro, ready, index, nodeGrowth])

  // ---- metro mode: bring a selected branch or contributor, or the search hits, into view ----
  // A long map opens right-aligned at a readable zoom, so its older lines start off-screen; a
  // selection or a search there would only dim or halo things nobody can see. Runs on selection and
  // search changes only, so it never fights the layout fit above; a search waits for typing to pause
  // and moves only for as many hits as get pinned labels.
  useEffect(() => {
    const selected = selectedBranch !== null || focus !== null
    if (!ready || !metroRef.current || (!selected && query === '')) return
    const reveal = () => {
      const fg = fgRef.current
      const m = metroRef.current
      if (!fg || !m || tweenRef.current) return
      // the stations' final positions, not where a tween has them now
      const primary: { x: number; y: number }[] = []
      const context: { x: number; y: number }[] = []
      if (selectedBranch !== null) {
        for (const node of index.graphData.nodes) {
          const t = m.targets.get(node.id)
          if (!t) continue
          if (node.tips.includes(selectedBranch)) primary.push(t)
          else if (node.owner === selectedBranch) context.push(t)
        }
      } else if (focus !== null) {
        // their newest shown commit for sure, the rest while the zoom allows
        let newest: { x: number; y: number } | null = null
        let newestDate = ''
        for (const node of index.graphData.nodes) {
          const t = focus.nodes.has(node.id) ? m.targets.get(node.id) : undefined
          if (!t) continue
          context.push(t)
          if (newest === null || node.commit.date > newestDate) {
            newest = t
            newestDate = node.commit.date
          }
        }
        if (newest === null) return
        primary.push(newest)
      } else {
        for (const [id, label] of index.tipLabelLower) {
          const t = label.includes(query) ? m.targets.get(id) : undefined
          if (t) primary.push(t)
        }
        if (primary.length > MAX_PINNED_SEARCH_HITS) return
      }
      const centre = fg.centerAt()
      const t = metroRevealTransform(primary, context, { k: fg.zoom(), cx: centre.x, cy: centre.y }, sizeRef.current, FIT_PAD, METRO_MIN_ZOOM)
      if (!t) return
      fg.centerAt(t.cx, t.cy, FIT_MS)
      fg.zoom(t.k, FIT_MS)
    }
    if (selected) {
      reveal()
      return
    }
    const timer = setTimeout(reveal, SEARCH_REVEAL_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranch, focus, query])

  return (
    <div ref={containerRef} className="h-full w-full" onPointerLeave={handlePointerLeave} onPointerMove={onPointerMove}>
      {ready && (
        <ForceGraph2D<GraphNode, GardenLinkFields>
          ref={fgRef}
          width={size.width}
          height={size.height}
          graphData={index.graphData}
          backgroundColor={theme.canvas}
          nodeId="id"
          nodeCanvasObjectMode={NODE_MODE_REPLACE}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintPointerArea}
          linkVisibility={linkVisible}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkCurvature={linkCurvature}
          linkDirectionalArrowLength={0}
          linkCanvasObjectMode={timelapse || garden ? stemMode : linkMode}
          linkCanvasObject={garden ? paintGardenStem : timelapse ? paintStem : paintLink}
          cooldownTicks={metroOn ? 0 : 200}
          onNodeHover={handleHover}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          onLinkClick={handleLinkClick}
          onNodeDrag={handleNodeDrag}
          onNodeDragEnd={handleDragEnd}
          onEngineTick={handleEngineTick}
          onEngineStop={handleEngineStop}
          onRenderFramePre={metroOn || timelapse ? paintPre : undefined}
          onRenderFramePost={paintPost}
          autoPauseRedraw={!labelsBusy && !tweening && !timelapse}
          enableNodeDrag={!metroOn}
        />
      )}
    </div>
  )
}
