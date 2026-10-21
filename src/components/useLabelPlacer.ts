import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { GraphNode } from '../types'
import type { Theme } from '../theme/themes'
import { useGardenStore } from '../store/useGardenStore'
import {
  LABEL_FONT,
  bodyRadius,
  buildLabelSpecs,
  isDimmed,
  middleEllipsis,
  rankLabels,
  searchLabelTexts,
  type LabelMeta,
  type Measure,
} from './gardenUtils'
import { LabelPlacer, type LabelSpec } from './labelPlacement'

/** The parts of Garden's per-graph index the labels need. */
export interface LabelGraphIndex {
  graphData: { nodes: ReadonlyArray<GraphNode> }
  neighbours: ReadonlyMap<string, ReadonlySet<string>>
  tipLabelLower: ReadonlyMap<string, string>
}

export interface UseLabelPlacerArgs {
  index: LabelGraphIndex
  defaultBranch: string
  reachSet: ReadonlySet<string> | null
  /** trimmed, lower-cased search query ('' for none) */
  query: string
  selectedBranch: string | null
  inspectorNodeId: string | null
  /** node hovered on the canvas (force-graph's hover) */
  hoverRef: RefObject<string | null>
  /** node whose label the pointer is over; set by onPointerMove */
  labelHoverRef: RefObject<string | null>
  /** called when labelHoverRef changes, so Garden can redraw with the new dimming */
  onLabelHoverChange: () => void
  /**
   * active theme (label text, plates, halos, the dim alpha) and its branch palette (plate dots).
   * Only the drawing reads them: a theme switch redraws the labels where they are, it never
   * re-places or re-measures them (every theme uses the same fonts).
   */
  theme: Theme
  palette: Record<string, string>
  /**
   * Drawn radius of a node in graph units, when it is not the organic reach-based body (metro
   * stations). Omit for organic mode. A new function identity rebuilds the label specs.
   */
  radiusOf?: (node: GraphNode) => number
  /** Screen px a node's glyph reaches beyond radiusOf (metro commit beads). Default: the tip ring in organic mode, else 0. */
  ringPxOf?: (node: GraphNode) => number
  /**
   * Nodes whose glyphs block labels like tips do (metro stations other than plain commits). Omit for
   * organic mode. A new function identity rebuilds the label specs.
   */
  isHardNode?: (node: GraphNode) => boolean
  /** Drawn lines labels keep off (metro routes), in graph units; omit when none are drawn. */
  lines?: LabelLines
  /**
   * Marks drawn in this frame that labels keep off (metro '+N' run text), written by the frame's
   * pre-paint before paintLabels runs: flat [x0, y0, x1, y1] per box in graph units.
   */
  marks?: RefObject<LabelMarks>
  /** draw a background-coloured halo behind label text (metro mode: lines may still pass close) */
  halo?: boolean
}

/** Boxes for the label placer to keep clear of, in graph units, rewritten every frame. */
export interface LabelMarks {
  rects: Float32Array
  count: number
}

/** Line segments for the label placer, in graph units (see MetroView.segs). */
export interface LabelLines {
  /** flat [x0, y0, x1, y1] per segment */
  segs: Float64Array
  /** per segment: the indices (in index.graphData.nodes) of the two nodes its route joins */
  segSrc: Int32Array
  segTgt: Int32Array
  /** half the drawn line width in graph units */
  halfWidth: number
  /** and in screen px at least (lines have a minimum drawn width) */
  minHalfPx: number
}

export interface LabelPlacerApi {
  /** onRenderFramePost: places and draws the labels over the frame force-graph just painted */
  paintLabels: (ctx: CanvasRenderingContext2D, globalScale: number) => void
  /** container pointermove: hit-tests labels and plates */
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  /** container pointerleave: forgets the pointer, so labels moving under its last spot are not hovered */
  onPointerLeave: () => void
  /** node id of the label or plate at (x, y) in canvas px, null for none */
  hitTest: (x: number, y: number) => string | null
  /** node id a click at (x, y) selects: hitTest, but a hover-plate row naming another tip selects that tip */
  clickTest: (x: number, y: number) => string | null
  /** true while labels still need frames (mirror into autoPauseRedraw={!labelsBusy}) */
  labelsBusy: boolean
  /** fastest tip in the last frame, screen px per 60 Hz frame (Infinity before the first frame) */
  maxTipSpeed: () => number
  /** onNodeDrag / onNodeDragEnd: the dragged node's label is forced onto a plate */
  setDragNode: (id: string | null) => void
  /** the fit-to-view tween started (duration ms); ends the first-load admission hold after it */
  fitStarted: (durationMs: number) => void
}

const LABEL_CSS_FONT = `12px ${LABEL_FONT}`
const PLATE_RADIUS = 4
/** backing plate of a pinned label drawn over another tip (see drawLeader) */
const LEADER_PLATE_RADIUS = 3
const DOT_RADIUS = 3
/** ring drawn around tips beyond their body (paintNode's outer + 2.5 px) */
const TIP_RING_PX = 2.5
/** safety cap on the first-load admission hold (no fit ever started, or the layout never calms) */
const MAX_HOLD_MS = 8000
/** width of the background-coloured halo stroked behind label text (UseLabelPlacerArgs.halo) */
const HALO_PX = 3

// ---- text measurement: one offscreen canvas, cached widths, cleared when fonts finish loading ----
let measureCtx: CanvasRenderingContext2D | null | undefined
const widthCache = new Map<string, number>()

export const measureLabel: Measure = (text) => {
  const hit = widthCache.get(text)
  if (hit !== undefined) return hit
  if (measureCtx === undefined) {
    measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  }
  let w: number
  if (measureCtx) {
    measureCtx.font = LABEL_CSS_FONT
    w = measureCtx.measureText(text).width
  } else w = text.length * 6.5
  widthCache.set(text, w)
  return w
}

interface LabelIndex {
  specs: LabelSpec[]
  meta: LabelMeta[]
  labelOfNode: Map<string, number>
  /** per node: body radius in graph units and the extra screen px of a tip's ring */
  baseR: Float32Array
  ringPx: Float32Array
  /** per node: 1 when its glyph blocks labels like a tip (PlacerFrame.hardNode); undefined for none */
  hardNode: Uint8Array | undefined
}

interface PlacerState {
  placer: LabelPlacer
  meta: LabelMeta[]
  /** no previous placer shared a tip with this one: a freshly loaded repo */
  fresh: boolean
  createdAt: number
  /**
   * A fresh repo holds hidden non-pinned labels back (admit = false) until its fit tween has ended
   * and the layout has come to rest, so the names appear once, in their final spots, instead of
   * being placed during the fit and shuffled while the layout still spreads out. A rebuild, whose
   * surviving labels were inherited, is never held.
   */
  held: boolean
  /** end of the fit tween (performance.now ms); Infinity until the fit starts */
  holdUntil: number
}

interface FrameBuffers {
  nodes: ReadonlyArray<GraphNode> | null
  sx: Float32Array
  sy: Float32Array
  sr: Float32Array
  speed: Float32Array
  prevX: Float64Array
  prevY: Float64Array
  prevOk: Uint8Array
  /** projected line segments and marks (screen px), see PlacerFrame.lineSegs and boxes */
  lineXY: Float32Array
  markXY: Float32Array
  lastTime: number
  a: number
  d: number
  e: number
  f: number
}

/**
 * Backing plate and leader line of a pinned label that sits on (or nearer to) another tip: the
 * plate hides the covered disc behind the text, and a faint line runs from the box to the label's
 * own node, so the name does not read as the covered tip's. Leaves fillStyle at the text colour.
 */
function drawLeader(
  ctx: CanvasRenderingContext2D,
  placer: LabelPlacer,
  i: number,
  buf: FrameBuffers,
  alpha: number,
  theme: Theme,
): void {
  const x0 = placer.x0[i]
  const y0 = placer.y0[i]
  const w = placer.w[i]
  const h = placer.h[i]
  ctx.globalAlpha = alpha
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x0, y0, w, h, LEADER_PLATE_RADIUS)
  else ctx.rect(x0, y0, w, h)
  ctx.fillStyle = theme.derived.labelPlateFill
  ctx.fill()
  const j = placer.specs[i].node
  const cx = buf.sx[j]
  const cy = buf.sy[j]
  const cr = buf.sr[j]
  // from the box point nearest the node to the node's disc edge
  const px = Math.min(Math.max(cx, x0), x0 + w)
  const py = Math.min(Math.max(cy, y0), y0 + h)
  const dx = px - cx
  const dy = py - cy
  const d = Math.hypot(dx, dy)
  if (Number.isFinite(d) && d > cr + 0.5) {
    ctx.globalAlpha = alpha * 0.6
    ctx.beginPath()
    ctx.moveTo(px, py)
    ctx.lineTo(cx + (dx / d) * cr, cy + (dy / d) * cr)
    ctx.strokeStyle = theme.text
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.fillStyle = theme.text
}

const allocBuffers = (n: number): FrameBuffers => ({
  nodes: null,
  sx: new Float32Array(n),
  sy: new Float32Array(n),
  sr: new Float32Array(n),
  speed: new Float32Array(n),
  prevX: new Float64Array(n),
  prevY: new Float64Array(n),
  prevOk: new Uint8Array(n),
  lineXY: new Float32Array(0),
  markXY: new Float32Array(0),
  lastTime: -1,
  a: NaN,
  d: NaN,
  e: NaN,
  f: NaN,
})

/**
 * Owns the branch labels: specs and ranking per graph, the LabelPlacer (inheriting placements
 * across rebuilds by tip node id), the per-frame projection into screen px, drawing in
 * onRenderFramePost, label hover/hit-testing, and the busy mirror that keeps force-graph
 * redrawing only while labels still change.
 */
export function useLabelPlacer(args: UseLabelPlacerArgs): LabelPlacerApi {
  const {
    index,
    defaultBranch,
    reachSet,
    query,
    selectedBranch,
    inspectorNodeId,
    hoverRef,
    labelHoverRef,
    onLabelHoverChange,
    theme,
    palette,
    radiusOf,
    ringPxOf,
    isHardNode,
    lines,
    marks,
    halo,
  } = args

  // ---- specs, rebuilt per graph and when web fonts finish loading (widths change) ----
  const [fontVersion, setFontVersion] = useState(0)
  /** plate rows shortened to the plate's width, keyed by width and text */
  const plateTextCache = useRef(new Map<string, string>())
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (!fonts || typeof fonts.addEventListener !== 'function') return
    const onDone = () => {
      widthCache.clear()
      plateTextCache.current.clear()
      setFontVersion((v) => v + 1)
    }
    fonts.addEventListener('loadingdone', onDone)
    return () => fonts.removeEventListener('loadingdone', onDone)
  }, [])

  const labelIndex = useMemo<LabelIndex>(() => {
    const nodes = index.graphData.nodes
    const { specs, meta } = buildLabelSpecs(nodes, defaultBranch, measureLabel)
    const labelOfNode = new Map<string, number>()
    meta.forEach((m, i) => labelOfNode.set(m.nodeId, i))
    const baseR = new Float32Array(nodes.length)
    const ringPx = new Float32Array(nodes.length)
    const hardNode = isHardNode ? new Uint8Array(nodes.length) : undefined
    nodes.forEach((node, j) => {
      baseR[j] = radiusOf ? radiusOf(node) : bodyRadius(node)
      ringPx[j] = ringPxOf ? ringPxOf(node) : !radiusOf && node.isTip ? TIP_RING_PX : 0
      if (hardNode && isHardNode?.(node)) hardNode[j] = 1
    })
    return { specs, meta, labelOfNode, baseR, ringPx, hardNode }
    // fontVersion is a dependency on purpose: new widths after a font load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, defaultBranch, fontVersion, radiusOf, ringPxOf, isHardNode])

  // ---- the placer, inheriting from the previous graph's placer by tip node id ----
  const prevPlacerRef = useRef<PlacerState | null>(null)
  const placerState = useMemo<PlacerState>(() => {
    const placer = new LabelPlacer(labelIndex.specs, { measure: measureLabel })
    const prev = prevPlacerRef.current
    let matched = 0
    if (prev) {
      const prevIndex = new Map<string, number>()
      prev.meta.forEach((m, i) => prevIndex.set(m.nodeId, i))
      matched = placer.inheritFrom(prev.placer, (i) => prevIndex.get(labelIndex.meta[i].nodeId) ?? -1)
    }
    const fresh = matched === 0
    return { placer, meta: labelIndex.meta, fresh, createdAt: performance.now(), held: fresh, holdUntil: Infinity }
  }, [labelIndex])
  useEffect(() => {
    prevPlacerRef.current = placerState
  }, [placerState])

  // ---- ranking: recomputed on selection, search and graph changes, never per frame; a search
  // that pins its hits also gives them text forms that show the match ----
  const ranking = useMemo(() => {
    const hits = new Set<number>()
    let selectedTip = -1
    labelIndex.meta.forEach((m, i) => {
      if (query !== '' && (index.tipLabelLower.get(m.nodeId) ?? '').includes(query)) hits.add(i)
      if (selectedBranch !== null && m.tips.includes(selectedBranch)) selectedTip = i
    })
    const overrides = searchLabelTexts(labelIndex.specs, hits, query, measureLabel)
    return { ...rankLabels(labelIndex.meta, { reach: reachSet, searchHits: hits, selectedTip }), overrides }
  }, [labelIndex, index, reachSet, query, selectedBranch])

  // ---- first-load admission hold: hidden labels wait until the fit tween has ended and the
  // layout is at rest (see PlacerState.held) ----
  const fitStarted = useCallback(
    (durationMs: number) => {
      if (placerState.held && placerState.holdUntil === Infinity) placerState.holdUntil = performance.now() + Math.max(0, durationMs)
    },
    [placerState],
  )

  // ---- forced labels (hover, inspector, drag), synced lazily from refs on the next frame ----
  const dragRef = useRef<string | null>(null)
  const inspectorRef = useRef(inspectorNodeId)
  inspectorRef.current = inspectorNodeId
  const appliedRef = useRef<{ placer: LabelPlacer | null; ranking: unknown; hover: number; inspect: number; drag: number; lines: LabelLines | undefined }>({
    placer: null,
    ranking: null,
    hover: -2,
    inspect: -2,
    drag: -2,
    lines: undefined,
  })
  const setDragNode = useCallback((id: string | null) => {
    dragRef.current = id
  }, [])

  // ---- label hover: tested on pointer moves, and again on frames where labels move under a still
  // pointer (wheel zoom, layout motion, a rebuild) ----
  /** last pointer position in canvas px while it hovers (no button, no drag); null otherwise */
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const hoverHit = useCallback(
    (x: number, y: number): string | null => {
      const current = labelHoverRef.current !== null ? (labelIndex.labelOfNode.get(labelHoverRef.current) ?? -1) : -1
      const i = placerState.placer.hoverTest(x, y, current)
      return i >= 0 ? placerState.meta[i].nodeId : null
    },
    [placerState, labelIndex, labelHoverRef],
  )
  // a rebuild that drops the hovered label's node must not leave that id hovered: isDimmed would
  // dim everything (its node is gone from the neighbour index). Runs before force-graph paints.
  useLayoutEffect(() => {
    const id = labelHoverRef.current
    if (id !== null && !labelIndex.labelOfNode.has(id)) {
      labelHoverRef.current = null
      onLabelHoverChange()
    }
  }, [labelIndex, labelHoverRef, onLabelHoverChange])

  // ---- busy mirror: React state only on transitions ----
  const [labelsBusy, setLabelsBusy] = useState(true)
  const busyRef = useRef(true)
  const setHiddenLabels = useGardenStore((s) => s.setHiddenLabels)
  useEffect(() => () => setHiddenLabels(0), [setHiddenLabels])

  const buffersRef = useRef<FrameBuffers>(allocBuffers(0))

  const paintLabels = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const { placer, meta } = placerState
      const nodes = index.graphData.nodes
      const N = nodes.length
      let buf = buffersRef.current
      if (buf.sx.length < N) {
        buf = allocBuffers(Math.max(N, buf.sx.length * 2))
        buffersRef.current = buf
      }
      const sameNodes = buf.nodes === nodes
      buf.nodes = nodes

      // projection: force-graph leaves the dpr x zoom transform on the context
      const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
      const t = ctx.getTransform()
      const k = t.a / dpr
      if (!(k > 0) || !Number.isFinite(k)) return
      const tx = t.e / dpr
      const ty = t.f / dpr
      const now = performance.now()
      const dt = buf.lastTime < 0 ? 1000 / 60 : Math.min(Math.max(now - buf.lastTime, 0), 64)
      buf.lastTime = now
      const cameraMoving = sameNodes && (t.a !== buf.a || t.d !== buf.d || t.e !== buf.e || t.f !== buf.f)
      buf.a = t.a
      buf.d = t.d
      buf.e = t.e
      buf.f = t.f
      const norm = (1000 / 60) / Math.max(dt, 1)
      const { baseR, ringPx } = labelIndex
      for (let j = 0; j < N; j++) {
        const node = nodes[j]
        const x = node.x
        const y = node.y
        if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
          buf.sx[j] = NaN
          buf.sy[j] = NaN
          buf.sr[j] = 0
          buf.speed[j] = 0
          buf.prevOk[j] = 0
          continue
        }
        buf.sx[j] = x * k + tx
        buf.sy[j] = y * k + ty
        buf.sr[j] = (baseR[j] ?? 2) * k + (ringPx[j] ?? 0)
        buf.speed[j] = sameNodes && buf.prevOk[j] ? Math.hypot(x - buf.prevX[j], y - buf.prevY[j]) * k * norm : 0
        buf.prevX[j] = x
        buf.prevY[j] = y
        buf.prevOk[j] = 1
      }
      // lines, with the same projection
      let lineCount = 0
      let lineHalfPx = 0
      if (lines !== undefined) {
        const segs = lines.segs
        if (buf.lineXY.length < segs.length) buf.lineXY = new Float32Array(Math.max(segs.length, buf.lineXY.length * 2))
        const xy = buf.lineXY
        for (let q = 0; q + 3 < segs.length; q += 4) {
          xy[q] = segs[q] * k + tx
          xy[q + 1] = segs[q + 1] * k + ty
          xy[q + 2] = segs[q + 2] * k + tx
          xy[q + 3] = segs[q + 3] * k + ty
        }
        lineCount = segs.length >> 2
        lineHalfPx = Math.max(lines.minHalfPx, lines.halfWidth * k)
      }
      let markCount = 0
      const markSrc = marks?.current
      if (markSrc && markSrc.count > 0) {
        markCount = Math.min(markSrc.count, markSrc.rects.length >> 2)
        if (buf.markXY.length < 4 * markCount) buf.markXY = new Float32Array(Math.max(4 * markCount, buf.markXY.length * 2))
        const xy = buf.markXY
        const r = markSrc.rects
        for (let q = 0; q < 4 * markCount; q += 4) {
          xy[q] = r[q] * k + tx
          xy[q + 1] = r[q + 1] * k + ty
          xy[q + 2] = r[q + 2] * k + tx
          xy[q + 3] = r[q + 3] * k + ty
        }
      }

      // inputs that changed since the last frame
      const applied = appliedRef.current
      const placerChanged = applied.placer !== placer
      if (applied.placer !== placer || applied.ranking !== ranking) {
        // (a new placer starts with its own forms, so only this ranking's overrides apply)
        placer.setTextOverrides(ranking.overrides)
        placer.setOrder(ranking.order, ranking.pinned, ranking.softPinned)
        applied.ranking = ranking
      }
      const hovered = hoverRef.current ?? labelHoverRef.current
      const hoverLabel = hovered !== null ? (labelIndex.labelOfNode.get(hovered) ?? -1) : -1
      const inspectLabel = inspectorRef.current !== null ? (labelIndex.labelOfNode.get(inspectorRef.current) ?? -1) : -1
      const dragLabel = dragRef.current !== null ? (labelIndex.labelOfNode.get(dragRef.current) ?? -1) : -1
      if (applied.placer !== placer || applied.hover !== hoverLabel || applied.inspect !== inspectLabel || applied.drag !== dragLabel) {
        const forced: number[] = []
        if (hoverLabel >= 0) forced.push(hoverLabel)
        if (inspectLabel >= 0) forced.push(inspectLabel)
        if (dragLabel >= 0) forced.push(dragLabel)
        placer.setForced(forced, hoverLabel)
        applied.hover = hoverLabel
        applied.inspect = inspectLabel
        applied.drag = dragLabel
      }
      // new lines on a still scene (a metro tween ended): labels waiting for a change look again
      if (!placerChanged && applied.lines !== lines) placer.obstaclesChanged()
      applied.lines = lines
      applied.placer = placer

      if (placerState.held && ((now >= placerState.holdUntil && placer.calm) || now - placerState.createdAt > MAX_HOLD_MS)) {
        placerState.held = false
      }
      const admit = !placerState.held
      const W = ctx.canvas.width / dpr
      const H = ctx.canvas.height / dpr
      placer.update({
        sx: buf.sx,
        sy: buf.sy,
        sr: buf.sr,
        speed: buf.speed,
        nodeCount: N,
        width: W,
        height: H,
        dtMs: dt,
        cameraMoving,
        admit,
        lineSegs: lineCount > 0 ? buf.lineXY : undefined,
        lineSrc: lines?.segSrc,
        lineTgt: lines?.segTgt,
        lineCount,
        lineHalfPx,
        boxes: markCount > 0 ? buf.markXY : undefined,
        boxCount: markCount,
        hardNode: labelIndex.hardNode,
      })

      // labels moved under a still pointer: hover follows (picked up on the next frame)
      const pointer = pointerRef.current
      if (pointer !== null && dragRef.current === null && (cameraMoving || placer.maxTipSpeed > 0 || placer.busy || placerChanged)) {
        const id = hoverHit(pointer.x, pointer.y)
        if (id !== labelHoverRef.current) {
          labelHoverRef.current = id
          onLabelHoverChange()
        }
      }

      // ---- draw: least important first so the important ones end up on top ----
      const o = placer.o
      const order = placer.order
      const n = placer.n
      const lineMid = o.lineH / 2
      ctx.save()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.font = LABEL_CSS_FONT
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = theme.text
      ctx.lineJoin = 'round'
      // the halo is stroked under each text, so a line passing close to it never runs into the
      // letters (set each time: drawLeader strokes its leader line in between)
      const text = (s: string, x: number, y: number) => {
        if (halo) {
          ctx.strokeStyle = theme.canvas
          ctx.lineWidth = HALO_PX
          ctx.strokeText(s, x, y)
        }
        ctx.fillText(s, x, y)
      }
      for (let q = n - 1; q >= 0; q--) {
        const i = order[q]
        if (placer.forcedNow[i]) continue
        const fade = placer.alpha[i]
        const ghost = placer.fromAlpha[i]
        if (fade <= 0.01 && ghost <= 0.01) continue
        const dim = isDimmed(meta[i].nodeId, hovered, index.neighbours, reachSet) ? theme.dimAlpha : 1
        if (ghost > 0.01) {
          ctx.globalAlpha = ghost * dim
          text(placer.variantText(i, placer.fromVariant[i]), placer.fromX0[i] + o.padX, placer.fromY0[i] + lineMid)
        }
        if (fade > 0.01) {
          if (placer.leader[i]) drawLeader(ctx, placer, i, buf, fade * dim, theme)
          ctx.globalAlpha = fade * dim
          text(placer.textOf(i), placer.x0[i] + o.padX, placer.y0[i] + lineMid)
        }
      }
      ctx.globalAlpha = 1
      for (const i of placer.forcedLabels) {
        const plate = placer.plates[i]
        if (!placer.forcedNow[i] || plate === null) continue
        const x0 = placer.x0[i]
        const y0 = placer.y0[i]
        const w = placer.w[i]
        const h = placer.h[i]
        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x0, y0, w, h, PLATE_RADIUS)
        else ctx.rect(x0, y0, w, h)
        ctx.fillStyle = theme.derived.labelPlateFill
        ctx.fill()
        ctx.strokeStyle = theme.derived.labelPlateRing
        ctx.lineWidth = 1
        ctx.stroke()
        const inner = w - 2 * o.platePadX
        plate.rows.forEach((row, r) => {
          const cy = y0 + r * o.lineH + lineMid
          let tx0 = x0 + o.platePadX
          let room = inner
          if (row.kind === 'neighbour') {
            const owner = row.label >= 0 ? nodes[placer.specs[row.label].node]?.owner : undefined
            ctx.beginPath()
            ctx.arc(tx0 + DOT_RADIUS, cy, DOT_RADIUS, 0, Math.PI * 2)
            ctx.fillStyle = (owner !== undefined ? palette[owner] : undefined) ?? theme.fallback
            ctx.fill()
            tx0 += o.plateIndent
            room -= o.plateIndent
          }
          let text = row.text
          if (row.width > room + 0.5) {
            const key = `${Math.round(room)}\u0000${text}`
            let short = plateTextCache.current.get(key)
            if (short === undefined) {
              short = middleEllipsis(text, room, measureLabel)
              plateTextCache.current.set(key, short)
            }
            text = short
          }
          ctx.fillStyle = row.kind === 'more' ? theme.muted : theme.text
          ctx.fillText(text, tx0, cy)
        })
      }
      ctx.restore()

      // ---- busy mirror and the hidden-names hint, on transitions only ----
      if (placer.busy !== busyRef.current) {
        busyRef.current = placer.busy
        setLabelsBusy(placer.busy)
        if (!placer.busy) {
          const hidden = placer.hiddenCount()
          if (useGardenStore.getState().hiddenLabels !== hidden) setHiddenLabels(hidden)
        }
      }
    },
    [
      placerState,
      index,
      labelIndex,
      ranking,
      reachSet,
      hoverRef,
      labelHoverRef,
      setHiddenLabels,
      hoverHit,
      onLabelHoverChange,
      theme,
      palette,
      lines,
      marks,
      halo,
    ],
  )

  // a new placer needs frames even if the last one had gone quiet
  useEffect(() => {
    busyRef.current = true
    setLabelsBusy(true)
  }, [placerState, ranking])

  const hitTest = useCallback(
    (x: number, y: number): string | null => {
      const i = placerState.placer.hitTest(x, y)
      return i >= 0 ? placerState.meta[i].nodeId : null
    },
    [placerState],
  )

  const clickTest = useCallback(
    (x: number, y: number): string | null => {
      const i = placerState.placer.clickTest(x, y)
      return i >= 0 ? placerState.meta[i].nodeId : null
    },
    [placerState],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      let id: string | null = null
      // no label hover while panning or dragging a node
      if (event.buttons === 0 && dragRef.current === null) {
        const rect = event.currentTarget.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        pointerRef.current = { x, y }
        id = hoverHit(x, y)
      } else pointerRef.current = null
      if (labelHoverRef.current !== id) {
        labelHoverRef.current = id
        onLabelHoverChange()
      }
    },
    [hoverHit, labelHoverRef, onLabelHoverChange],
  )

  const onPointerLeave = useCallback(() => {
    pointerRef.current = null
  }, [])

  const maxTipSpeed = useCallback(() => placerState.placer.maxTipSpeed, [placerState])

  return { paintLabels, onPointerMove, onPointerLeave, hitTest, clickTest, labelsBusy, maxTipSpeed, setDragNode, fitStarted }
}
