/**
 * Screen-space placement of branch-name labels for the map canvas.
 *
 * Once per frame, LabelPlacer decides which tip labels to show and where: it works through the
 * labels in priority order and tries eight spots around each node (right, left, the diagonals,
 * above, below), first with the wide text and then with a compact one; a label that fits nowhere
 * waits until hover, zoom or search reveals it. Hysteresis keeps it calm: a label keeps its spot
 * while that still fits, a new label appears only after its node has been still for ~130 ms, labels
 * fade in and out (and crossfade when they move), and only once the scene is fully at rest does
 * the strict-priority pass hand the best spots to the most important labels.
 *
 * Pure: no DOM, no React. Positions come in as screen-px typed arrays and text widths from the
 * caller, so it runs (and is tested) in node. Nothing allocates per frame: the grids and arrays are
 * reused and only get bigger.
 */

// ---------------- collision grid ----------------

/**
 * Uniform-grid index of axis-aligned boxes in screen px, rebuilt every frame. Each box is linked
 * into every cell it touches; queries de-duplicate with a per-query stamp. Boxes partly off the
 * canvas are clamped to the edge cells.
 */
export class RectGrid {
  cols = 0
  rows = 0
  private head = new Int32Array(0)
  private next = new Int32Array(512)
  private ref = new Int32Array(512)
  x0 = new Float32Array(128)
  y0 = new Float32Array(128)
  x1 = new Float32Array(128)
  y1 = new Float32Array(128)
  tag = new Int32Array(128)
  private stamp = new Int32Array(128)
  /** rect indices found by the last query() */
  found = new Int32Array(64)
  /** number of boxes inserted since the last reset */
  size = 0
  private entries = 0
  private queryStamp = 0

  constructor(readonly cell = 48) {}

  reset(width: number, height: number): void {
    this.cols = Math.max(1, Math.ceil(width / this.cell))
    this.rows = Math.max(1, Math.ceil(height / this.cell))
    const cells = this.cols * this.rows
    if (this.head.length < cells) this.head = new Int32Array(cells)
    this.head.fill(-1, 0, cells)
    this.size = 0
    this.entries = 0
  }

  /** Current capacity of the box arrays (doubles when full). */
  get capacity(): number {
    return this.x0.length
  }

  private expandRects(): void {
    const m = this.x0.length * 2
    const f = (a: Float32Array) => {
      const b = new Float32Array(m)
      b.set(a)
      return b
    }
    const i = (a: Int32Array) => {
      const b = new Int32Array(m)
      b.set(a)
      return b
    }
    this.x0 = f(this.x0)
    this.y0 = f(this.y0)
    this.x1 = f(this.x1)
    this.y1 = f(this.y1)
    this.tag = i(this.tag)
    this.stamp = new Int32Array(m)
  }

  private expandEntries(): void {
    const m = this.next.length * 2
    const a = new Int32Array(m)
    a.set(this.next)
    this.next = a
    const b = new Int32Array(m)
    b.set(this.ref)
    this.ref = b
  }

  private colOf(x: number): number {
    const c = Math.floor(x / this.cell)
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c
  }

  private rowOf(y: number): number {
    const r = Math.floor(y / this.cell)
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r
  }

  insert(x0: number, y0: number, x1: number, y1: number, tag: number): void {
    if (!(x0 <= x1 && y0 <= y1)) return // NaN or inverted
    if (this.size >= this.x0.length) this.expandRects()
    const r = this.size++
    this.x0[r] = x0
    this.y0[r] = y0
    this.x1[r] = x1
    this.y1[r] = y1
    this.tag[r] = tag
    const c0 = this.colOf(x0)
    const c1 = this.colOf(x1)
    const r0 = this.rowOf(y0)
    const r1 = this.rowOf(y1)
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (this.entries >= this.next.length) this.expandEntries()
        const c = row * this.cols + col
        const e = this.entries++
        this.ref[e] = r
        this.next[e] = this.head[c]
        this.head[c] = e
      }
    }
  }

  /**
   * Visits each distinct box (tag !== exclude) that strictly intersects the query box, calling
   * `hit(rect)`; stops early when hit returns true. Returns the number of boxes visited.
   */
  private scan(x0: number, y0: number, x1: number, y1: number, exclude: number, limit: number, collect: boolean): number {
    if (!(x0 <= x1 && y0 <= y1) || this.size === 0) return 0
    const c0 = this.colOf(x0)
    const c1 = this.colOf(x1)
    const r0 = this.rowOf(y0)
    const r1 = this.rowOf(y1)
    const s = ++this.queryStamp
    let n = 0
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (let e = this.head[row * this.cols + col]; e !== -1; e = this.next[e]) {
          const r = this.ref[e]
          if (this.stamp[r] === s) continue
          this.stamp[r] = s
          if (this.tag[r] === exclude) continue
          if (this.x0[r] < x1 && this.x1[r] > x0 && this.y0[r] < y1 && this.y1[r] > y0) {
            if (collect) {
              if (n >= this.found.length) {
                const b = new Int32Array(this.found.length * 2)
                b.set(this.found)
                this.found = b
              }
              this.found[n] = r
            }
            if (++n >= limit) return n
          }
        }
      }
    }
    return n
  }

  /** Number of distinct boxes (tag !== exclude) intersecting the query box, stopping at `limit`. */
  count(x0: number, y0: number, x1: number, y1: number, exclude = -1, limit = 1 << 30): number {
    return this.scan(x0, y0, x1, y1, exclude, limit, false)
  }

  /** Like count, but also stores the rect indices in `found[0..n)`. */
  query(x0: number, y0: number, x1: number, y1: number, exclude = -1): number {
    return this.scan(x0, y0, x1, y1, exclude, 1 << 30, true)
  }
}

// ---------------- placement ----------------

export const ANCHORS = ['R', 'L', 'UR', 'DR', 'UL', 'DL', 'T', 'B'] as const
export type AnchorName = (typeof ANCHORS)[number]
const NA = ANCHORS.length
const NEVER = 0x7fffffff

/** One label per tip node. */
export interface LabelSpec {
  /** index of the tip node in the frame arrays (graphData.nodes) */
  node: number
  /** widest first: [wide, compact?] */
  texts: string[]
  widths: number[]
  /** every name joined; what a variant of -1 (forced) resolves to in textOf */
  fullText: string
  fullWidth: number
  /** the node's branch names in label order, one row each on the hover plate */
  names: string[]
  nameWidths: number[]
}

export interface PlacerFrame {
  /** node centres in screen (CSS) px, index-aligned with the graph's nodes */
  sx: Float32Array
  sy: Float32Array
  /** node disc radius in screen px (the outer ring for tips) */
  sr: Float32Array
  /** camera-relative screen px per 60 Hz frame */
  speed: Float32Array
  nodeCount: number
  width: number
  height: number
  dtMs: number
  cameraMoving: boolean
  /**
   * false holds back hidden non-pinned labels (they are not searched), like a moving camera but
   * without resetting calm or the edge leniency. Used while a freshly loaded repo settles and
   * fits. Default true.
   */
  admit?: boolean
  /**
   * Drawn lines a label must not sit on (metro routes): flat [x0, y0, x1, y1] per segment in
   * screen px, lineCount segments. A label never settles across a line that does not touch its own
   * node (lineSrc / lineTgt: the segment's end nodes); a pinned label that has to is drawn on a
   * backing plate.
   */
  lineSegs?: Float32Array
  lineSrc?: Int32Array
  lineTgt?: Int32Array
  lineCount?: number
  /** half the drawn line width in screen px */
  lineHalfPx?: number
  /**
   * Other drawn marks no label may cover, like a line (metro '+N' run text): flat [x0, y0, x1, y1]
   * per box in screen px, boxCount boxes.
   */
  boxes?: Float32Array
  boxCount?: number
  /**
   * Nodes whose glyphs block labels the way tips do (metro stations other than plain commits):
   * 1 = blocks. The others are dots, which a label may cover at nodeHitCost.
   */
  hardNode?: Uint8Array
}

export type PlateRowKind = 'name' | 'neighbour' | 'more'

export interface PlateRow {
  kind: PlateRowKind
  text: string
  /** text width in px (without the neighbour dot indent) */
  width: number
  /** the hidden label this row names (kind 'neighbour'), else -1 */
  label: number
}

/** The rounded plate a forced (hovered, inspected, dragged) label is drawn on. */
export interface Plate {
  rows: PlateRow[]
  /** natural size in px, before capping the width to the canvas */
  w: number
  h: number
  /** built with the hidden-neighbour rows (the hovered label was hidden) */
  explore: boolean
  /** hidden neighbours counted on the 'N more · zoom in' row (0 when there is none) */
  rest: number
}

export interface PlacerOptions {
  lineH: number
  padX: number
  gap: number
  edge: number
  /** a newcomer's box is inflated by this much against placed labels */
  newPad: number
  /** a label already showing is shrunk by this much (tolerance), against labels and the canvas edge */
  oldShrink: number
  showAfterMs: number
  fadeInMs: number
  fadeOutMs: number
  maskFadeMs: number
  /** cost per anchor, ANCHORS order */
  anchorCost: readonly number[]
  variantCost: number
  nodeHitCost: number
  /**
   * pinned last resort (pass 2) and the at-rest polish of a pinned label on a tip: each other tip
   * disc the box covers costs this, so covering a tip loses to anything that only covers dots
   */
  pinTipCost: number
  /** the same for a box that sits closer to another tip than to its own node */
  pinOwnerCost: number
  /** camera-relative screen px per 60 Hz frame above which a hidden label may not start appearing */
  admitMaxSpeed: number
  /** every tip slower than this (and a still camera) counts towards calm */
  calmSpeed: number
  /** any tip faster than this (or a moving camera) ends calm */
  calmExitSpeed: number
  /** consecutive slow frames needed for calm */
  calmEnterFrames: number
  /** a hidden label that found no spot waits this many frames (+ a per-label stagger) */
  retryFrames: number
  /** an optional move at rest (polish) needs a spot at least this much cheaper */
  polishMargin: number
  /** fading labels (and the old box of a crossfade) block newcomers */
  ghostsBlock: boolean
  /** while the camera moves a shown label may hang over the edge instead of flipping */
  edgeLenientWhileCamera: boolean
  /** the same while admission is held (a fresh load before its fit: the camera is not placed yet) */
  edgeLenientWhileHeld: boolean
  /**
   * when admission opens after a hold, labels shown during it (pinned ones, placed while the camera
   * was not placed yet) get one polish pass, so they move to a clearly cheaper anchor (by at least
   * polishMargin) together with the first reveal of the rest
   */
  reseatOnAdmit: boolean
  /** keep a shown label's spot while it still fits (false = re-place from scratch every frame) */
  sticky: boolean
  /** at rest a label covering a node may move once to a clean spot */
  calmPolish: boolean
  /**
   * at rest a label at a costly spot (anchorCost + variant * variantCost >= polishMargin: the
   * diagonals, T and B, and any compact form) may also move once to a spot at least polishMargin
   * cheaper, so the R/L sides win back what motion took and a compact label at R or L gets its wide
   * form back once that fits
   */
  polishByCost: boolean
  /** reject searched spots that sit closer to another node than to the label's own node */
  ownership: boolean
  /**
   * when no spot passes the ownership rule, accept one that only runs over unrelated commit dots
   * (each costs nodeHitCost) as long as no other tip sits closer than the label's own node
   */
  ownerDotFallback: boolean
  /** how far around a candidate box other nodes are looked up for the ownership rule */
  ownerQuery: number
  ownerTolerance: number
  platePadX: number
  /** indent of neighbour rows (the colour dot sits in it) */
  plateIndent: number
  /** tip names on a plate before '+N more' */
  plateMaxNames: number
  /** hidden neighbours listed on the hover plate */
  plateNeighbours: number
  /** screen distance from the hovered node within which hidden labels are listed */
  plateNeighbourPx: number
  /** a listed neighbour stays listed until it is this much further away (no flicker at the radius) */
  plateNeighbourSlackPx: number
  /** busy is forced off after this many calm frames without node or camera motion or input changes */
  watchdogFrames: number
  /** measures plate texts the specs do not carry ('+3 more', '4 more · zoom in') */
  measure: (text: string) => number
}

export const LABEL_PLACER_DEFAULTS: PlacerOptions = {
  lineH: 15,
  padX: 2,
  gap: 5,
  edge: 4,
  newPad: 5,
  oldShrink: 2,
  showAfterMs: 130,
  fadeInMs: 160,
  fadeOutMs: 120,
  maskFadeMs: 90,
  anchorCost: [0, 2, 6, 6, 7, 7, 9, 9],
  variantCost: 6,
  nodeHitCost: 8,
  pinTipCost: 40,
  pinOwnerCost: 16,
  admitMaxSpeed: 1,
  calmSpeed: 0.2,
  calmExitSpeed: 0.6,
  calmEnterFrames: 30,
  retryFrames: 3,
  polishMargin: 4,
  ghostsBlock: true,
  edgeLenientWhileCamera: true,
  edgeLenientWhileHeld: true,
  reseatOnAdmit: true,
  sticky: true,
  calmPolish: true,
  polishByCost: true,
  ownership: true,
  ownerDotFallback: true,
  ownerQuery: 24,
  ownerTolerance: 2,
  platePadX: 5,
  plateIndent: 10,
  plateMaxNames: 8,
  plateNeighbours: 5,
  plateNeighbourPx: 28,
  plateNeighbourSlackPx: 4,
  watchdogFrames: 180,
  measure: (text) => text.length * 6.5,
}

/**
 * Top-left of a w×h box at anchor `a` around a disc of radius sr centred at (sx, sy), with `gap`
 * px between the disc and the box. Writes [x, y] into out.
 */
export function anchorOrigin(a: number, sx: number, sy: number, sr: number, w: number, h: number, gap: number, out: Float32Array): void {
  const g = sr + gap
  const d = g * 0.75
  switch (a) {
    case 0:
      out[0] = sx + g
      out[1] = sy - h / 2
      break
    case 1:
      out[0] = sx - g - w
      out[1] = sy - h / 2
      break
    case 2:
      out[0] = sx + d
      out[1] = sy - d - h
      break
    case 3:
      out[0] = sx + d
      out[1] = sy + d
      break
    case 4:
      out[0] = sx - d - w
      out[1] = sy - d - h
      break
    case 5:
      out[0] = sx - d - w
      out[1] = sy + d
      break
    case 6:
      out[0] = sx - w / 2
      out[1] = sy - g - h
      break
    default:
      out[0] = sx - w / 2
      out[1] = sy + g
      break
  }
}

/**
 * Whether the segment (ax, ay)-(bx, by) runs through the box [x0, x1] x [y0, y1] (Liang-Barsky
 * clipping; a segment that only touches the box's edge or corner does not count).
 */
export function segmentCrossesBox(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = bx - ax
  const dy = by - ay
  let t0 = 0
  let t1 = 1
  for (let side = 0; side < 4; side++) {
    const p = side === 0 ? -dx : side === 1 ? dx : side === 2 ? -dy : dy
    const q = side === 0 ? ax - x0 : side === 1 ? x1 - ax : side === 2 ? ay - y0 : y1 - ay
    if (p === 0) {
      // parallel to this side: outside it (or on it) misses the open box
      if (q <= 0) return false
      continue
    }
    const t = q / p
    if (p < 0) {
      if (t > t0) t0 = t
    } else if (t < t1) t1 = t
    if (t0 >= t1) return false
  }
  return true
}

/** Distance from (px, py) to the nearest point of the box (0 inside). */
function rectDistance(x0: number, y0: number, x1: number, y1: number, px: number, py: number): number {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0
  const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0
  return Math.sqrt(dx * dx + dy * dy)
}

export class LabelPlacer {
  readonly n: number
  readonly o: PlacerOptions
  // ---- per-label state (index = label) ----
  readonly shown: Uint8Array
  readonly pendingMs: Float32Array
  readonly alpha: Float32Array
  readonly anchor: Int8Array
  /** -1 = forced (full text on a plate) */
  readonly variant: Int8Array
  readonly x0: Float32Array
  readonly y0: Float32Array
  readonly w: Float32Array
  readonly h: Float32Array
  /** shown but under a forced plate: keeps its spot, fades out */
  readonly masked: Uint8Array
  readonly forcedNow: Uint8Array
  /** changed anchor or text form this frame */
  readonly jumped: Uint8Array
  /** old box of a crossfade (follows the node) */
  readonly fromX0: Float32Array
  readonly fromY0: Float32Array
  readonly fromW: Float32Array
  readonly fromVariant: Int8Array
  readonly fromAlpha: Float32Array
  /** node more than a little outside the canvas (its label does not count as hidden) */
  readonly offscreen: Uint8Array
  /**
   * a pinned label sitting on another tip's disc, or nearer to another tip than to its own node
   * (nothing better was free): drawn on a backing plate with a leader line to its own node, so it
   * does not read as that tip's name
   */
  readonly leader: Uint8Array
  /** plates of forced labels, null otherwise */
  readonly plates: (Plate | null)[]
  /** fastest tip in the last frame (screen px per 60 Hz frame); Infinity before the first frame */
  maxTipSpeed = Infinity
  busy = true
  calm = false

  private fromAnchor: Int8Array
  private shownBeforeForce: Uint8Array
  private anchorBeforeForce: Int8Array
  private variantBeforeForce: Int8Array
  /**
   * the box a forced label had before it was forced, at the node's current position (holdW 0 =
   * none): reserved against newcomers, and still hit-tested when the plate sits at another anchor,
   * so the pointer that hovered the label keeps hitting it
   */
  private holdX0: Float32Array
  private holdY0: Float32Array
  private holdW: Float32Array
  /** the label was readable (hit-testable) when the force started */
  private holdHit: Uint8Array
  /** node centre and radius (screen px) of each forced label in the last frame */
  private forcedNodeX: Float32Array
  private forcedNodeY: Float32Array
  private forcedNodeR: Float32Array
  /**
   * frame before which a label is not searched again: a hidden label that found no spot, or (calm
   * only) a shown one whose optional polish found nothing better. NEVER (set only while calm and no
   * node drifts) waits for a state change and lasts only while the scene stays calm: it is cleared
   * when calm ends.
   */
  private retryAt: Int32Array
  private prevShown: Uint8Array
  private prevZero: Uint8Array
  private prevFromZero: Uint8Array
  private isPinned: Uint8Array
  /** pinned only for being recent: held back like everyone else while admit is false */
  private isSoftPin: Uint8Array
  private pinFailed: Uint8Array
  private isForced: Uint8Array
  private orderArr: Int32Array
  private proc: Int32Array
  private forced: number[] = []
  private explore = -1
  private calmRun = 0
  private wasCalm = false
  private frameNo = 0
  private lastChange = 0
  private quietFrames = 0
  /** no node moved this frame (none faster than 0.05 px per frame) and the camera is still */
  private still = false
  private wasStill = false
  private lastAdmit = true
  /** this frame opens admission after a hold (see reseatOnAdmit) */
  private reseatNow = false
  private frameBusy = false
  private labelGrid = new RectGrid(48)
  private ghostGrid = new RectGrid(48)
  private tipGrid = new RectGrid(48)
  private dotGrid = new RectGrid(48)
  /** line segments of the current frame (tag = segment index), see PlacerFrame.lineSegs */
  private lineGrid = new RectGrid(48)
  private lineSegs: Float32Array = new Float32Array(0)
  private lineSrc: Int32Array = new Int32Array(0)
  private lineTgt: Int32Array = new Int32Array(0)
  private lineHalf = 0
  /** PlacerFrame.boxes of the current frame */
  private boxGrid = new RectGrid(48)
  private isTipNode = new Uint8Array(0)
  private fx0: number[] = []
  private fy0: number[] = []
  private fx1: number[] = []
  private fy1: number[] = []
  private tmp = new Float32Array(2)
  private nbScratch: number[] = []

  /**
   * The labels as placed: the specs passed in, except for labels whose text forms a search replaced
   * (setVariantTexts); the caller's array is never changed.
   */
  readonly specs: readonly LabelSpec[]
  private specList: LabelSpec[]
  private baseSpecs: readonly LabelSpec[]
  /** labels whose text forms setTextOverrides replaced */
  private overridden = new Set<number>()

  constructor(specs: readonly LabelSpec[], opts: Partial<PlacerOptions> = {}) {
    const n = specs.length
    this.n = n
    this.baseSpecs = specs
    this.specList = specs.slice()
    this.specs = this.specList
    this.o = { ...LABEL_PLACER_DEFAULTS, ...opts }
    this.shown = new Uint8Array(n)
    this.pendingMs = new Float32Array(n)
    this.alpha = new Float32Array(n)
    this.anchor = new Int8Array(n).fill(-1)
    this.variant = new Int8Array(n)
    this.x0 = new Float32Array(n)
    this.y0 = new Float32Array(n)
    this.w = new Float32Array(n)
    this.h = new Float32Array(n).fill(this.o.lineH)
    this.masked = new Uint8Array(n)
    this.forcedNow = new Uint8Array(n)
    this.jumped = new Uint8Array(n)
    this.fromX0 = new Float32Array(n)
    this.fromY0 = new Float32Array(n)
    this.fromW = new Float32Array(n)
    this.fromVariant = new Int8Array(n)
    this.fromAlpha = new Float32Array(n)
    this.fromAnchor = new Int8Array(n).fill(-1)
    this.offscreen = new Uint8Array(n)
    this.leader = new Uint8Array(n)
    this.plates = new Array<Plate | null>(n).fill(null)
    this.shownBeforeForce = new Uint8Array(n)
    this.anchorBeforeForce = new Int8Array(n).fill(-1)
    this.variantBeforeForce = new Int8Array(n)
    this.holdX0 = new Float32Array(n)
    this.holdY0 = new Float32Array(n)
    this.holdW = new Float32Array(n)
    this.holdHit = new Uint8Array(n)
    this.forcedNodeX = new Float32Array(n)
    this.forcedNodeY = new Float32Array(n)
    this.forcedNodeR = new Float32Array(n)
    this.retryAt = new Int32Array(n)
    this.prevShown = new Uint8Array(n)
    this.prevZero = new Uint8Array(n).fill(1)
    this.prevFromZero = new Uint8Array(n).fill(1)
    this.isPinned = new Uint8Array(n)
    this.isSoftPin = new Uint8Array(n)
    this.pinFailed = new Uint8Array(n)
    this.isForced = new Uint8Array(n)
    this.orderArr = Int32Array.from({ length: n }, (_, i) => i)
    this.proc = new Int32Array(n)
  }

  /** Priority order (label indices, most important first). */
  get order(): Int32Array {
    return this.orderArr
  }

  /** Labels currently drawn on a plate, in setForced order. */
  get forcedLabels(): readonly number[] {
    return this.forced
  }

  /**
   * Priority order and the pinned labels (placed first, shown at once; they cover other tips only
   * when nothing else fits). An order of the wrong length falls back to label order.
   */
  setOrder(order: Int32Array, pinned: readonly number[], softPinned: readonly number[] = []): void {
    this.orderArr = order.length === this.n ? order.slice() : Int32Array.from({ length: this.n }, (_, i) => i)
    this.isPinned.fill(0)
    this.isSoftPin.fill(0)
    for (const i of pinned) if (i >= 0 && i < this.n) this.isPinned[i] = 1
    for (const i of softPinned) if (i >= 0 && i < this.n && this.isPinned[i]) this.isSoftPin[i] = 1
    this.retryAt.fill(0)
    this.quietFrames = 0
  }

  /**
   * Labels shown at once on a plate with their full names, over everything else: the hovered,
   * inspected and dragged tips. `explore` is the hovered one; when its label was hidden its plate
   * also lists the hidden labels around it.
   */
  setForced(forced: readonly number[], explore = -1): void {
    const next = forced.filter((i, k) => i >= 0 && i < this.n && forced.indexOf(i) === k)
    if (next.length === this.forced.length && next.every((v, k) => v === this.forced[k]) && explore === this.explore) return
    this.forced = next
    this.explore = explore
    this.retryAt.fill(0)
    this.quietFrames = 0
  }

  /**
   * The obstacles (PlacerFrame lines or hard nodes) changed without any node or label moving:
   * labels waiting for a state change search again, and a calm scene polishes again.
   */
  obstaclesChanged(): void {
    this.retryAt.fill(0)
    this.quietFrames = 0
  }

  /**
   * Replaces label i's text forms (widest first), for a search that wants the match visible. The
   * label keeps its spot while that still fits at the new width (the sticky check runs on the next
   * update), else it searches again; a crossfade in flight is dropped, since its old box would show
   * the new text.
   */
  setVariantTexts(i: number, texts: readonly string[], widths: readonly number[]): void {
    if (i < 0 || i >= this.n || texts.length === 0 || texts.length !== widths.length) return
    this.specList[i] = { ...this.specList[i], texts: texts.slice(), widths: widths.slice() }
    const last = texts.length - 1
    if (this.variant[i] > last) this.variant[i] = last
    if (this.variantBeforeForce[i] > last) this.variantBeforeForce[i] = last
    if (this.fromVariant[i] > last) this.fromVariant[i] = last
    this.fromAlpha[i] = 0
    this.retryAt[i] = 0
    this.quietFrames = 0
  }

  /**
   * The text forms a search gives its hits (label index -> forms); labels overridden before and
   * missing here get their own forms back.
   */
  setTextOverrides(overrides: ReadonlyMap<number, { texts: readonly string[]; widths: readonly number[] }>): void {
    for (const i of this.overridden) {
      if (overrides.has(i)) continue
      this.setVariantTexts(i, this.baseSpecs[i].texts, this.baseSpecs[i].widths)
    }
    this.overridden.clear()
    for (const [i, forms] of overrides) {
      if (i < 0 || i >= this.n) continue
      const cur = this.specList[i]
      const same = cur.texts.length === forms.texts.length && cur.texts.every((t, k) => t === forms.texts[k])
      if (!same) this.setVariantTexts(i, forms.texts, forms.widths)
      this.overridden.add(i)
    }
  }

  /** Text currently drawn for label i (the joined names while forced). */
  textOf(i: number): string {
    const v = this.variant[i]
    const sp = this.specs[i]
    return v < 0 || v >= sp.texts.length ? sp.fullText : sp.texts[v]
  }

  /** Text of a given variant of label i (-1 = full). */
  variantText(i: number, v: number): string {
    const sp = this.specs[i]
    return v < 0 || v >= sp.texts.length ? sp.fullText : sp.texts[v]
  }

  /**
   * Copies shown, anchor, variant, alpha and pending state from the placer of the previous graph,
   * so labels that survive a rebuild (view toggle, hidden branch) keep their spot instead of fading
   * out and back in. prevIndexOf maps a label here to the previous placer's label (-1 for none).
   * Returns how many labels were matched.
   */
  inheritFrom(prev: LabelPlacer, prevIndexOf: (i: number) => number): number {
    let matched = 0
    for (let i = 0; i < this.n; i++) {
      const p = prevIndexOf(i)
      if (p < 0 || p >= prev.n) continue
      matched++
      const forced = prev.forcedNow[p] === 1
      const shown = forced ? prev.shownBeforeForce[p] : prev.shown[p]
      const a = forced ? prev.anchorBeforeForce[p] : prev.anchor[p]
      let v = forced ? prev.variantBeforeForce[p] : prev.variant[p]
      if (v < 0 || v >= this.specs[i].widths.length) v = 0
      this.shown[i] = shown
      this.anchor[i] = a
      this.variant[i] = v
      this.alpha[i] = shown ? (forced ? 1 : prev.alpha[p]) : 0
      this.pendingMs[i] = shown ? 0 : prev.pendingMs[p]
      this.prevShown[i] = shown
      this.prevZero[i] = this.alpha[i] === 0 ? 1 : 0
    }
    this.quietFrames = 0
    return matched
  }

  /**
   * Labels whose names are not readable right now although their node is on the canvas (hidden,
   * still pending, or forced from hidden).
   */
  hiddenCount(): number {
    let c = 0
    for (let i = 0; i < this.n; i++) {
      if (this.offscreen[i]) continue
      const shown = this.forcedNow[i] ? this.shownBeforeForce[i] : this.shown[i]
      if (!shown) c++
    }
    return c
  }

  /**
   * Label under the point (screen px): forced plates first (with the hovered label's bridge from its
   * node to its plate), then the boxes forced labels had before their plate moved to another anchor
   * (so the label the pointer hovered stays hit), then readable labels. -1 for none.
   */
  hitTest(x: number, y: number): number {
    for (const i of this.forced) if (this.onPlate(i, x, y)) return i
    // (the plates first, so another plate drawn over a pre-plate box wins)
    for (const i of this.forced) if (this.onForced(i, x, y)) return i
    for (let q = 0; q < this.n; q++) {
      const i = this.orderArr[q]
      if (!this.shown[i] || this.forcedNow[i] || this.masked[i] || this.alpha[i] < 0.5) continue
      if (x >= this.x0[i] && x <= this.x0[i] + this.w[i] && y >= this.y0[i] && y <= this.y0[i] + this.h[i]) return i
    }
    return -1
  }

  /**
   * The point is on forced label i's plate, or (the hovered label only) on the bridge between its
   * node and its plate: a disc reaching from the node across the gap to the plate's near edge, so a
   * pointer moving slowly from the node to the plate never lands on nothing and drops the hover.
   */
  private onPlate(i: number, x: number, y: number): boolean {
    if (!this.forcedNow[i]) return false
    if (x >= this.x0[i] && x <= this.x0[i] + this.w[i] && y >= this.y0[i] && y <= this.y0[i] + this.h[i]) return true
    const r = this.forcedNodeR[i]
    if (i !== this.explore || r < 0) return false
    const reach = Math.hypot(r + this.o.gap, this.o.lineH / 2) + 1
    return Math.hypot(x - this.forcedNodeX[i], y - this.forcedNodeY[i]) <= reach
  }

  /** onPlate, or on the box forced label i had before its plate moved to another anchor. */
  private onForced(i: number, x: number, y: number): boolean {
    if (this.onPlate(i, x, y)) return true
    const hw = this.holdW[i]
    return this.forcedNow[i] === 1 && this.holdHit[i] === 1 && hw > 0 && x >= this.holdX0[i] && x <= this.holdX0[i] + hw && y >= this.holdY0[i] && y <= this.holdY0[i] + this.o.lineH
  }

  /**
   * What a click at the point selects: like hitTest, except that a click on a plate row naming
   * another (hidden) tip selects that tip. Hover keeps using hitTest, so the plate stays put.
   */
  clickTest(x: number, y: number): number {
    const i = this.hitTest(x, y)
    if (i < 0 || !this.forcedNow[i]) return i
    const plate = this.plates[i]
    if (plate === null || !(x >= this.x0[i] && x <= this.x0[i] + this.w[i] && y >= this.y0[i] && y <= this.y0[i] + this.h[i])) return i
    const row = plate.rows[Math.floor((y - this.y0[i]) / this.o.lineH)]
    return row !== undefined && row.kind === 'neighbour' && row.label >= 0 ? row.label : i
  }

  /**
   * Hover hit test that keeps the label already hovered (`current`, -1 for none) while the point is
   * still on its plate or its pre-plate box, so a re-test after motion under a still pointer does
   * not switch between overlapping labels; otherwise hitTest.
   */
  hoverTest(x: number, y: number, current: number): number {
    if (current >= 0 && current < this.n && this.onForced(current, x, y)) return current
    return this.hitTest(x, y)
  }

  private hitsForced(x0: number, y0: number, x1: number, y1: number): boolean {
    for (let f = 0; f < this.fx0.length; f++) {
      if (this.fx0[f] < x1 && this.fx1[f] > x0 && this.fy0[f] < y1 && this.fy1[f] > y0) return true
    }
    return false
  }

  /**
   * Lines (PlacerFrame.lineSegs) running through the box w x h at (bx, by), shrunk by 1 px and
   * widened by half the line width, that do not touch node j (the label's own), plus the marks
   * (PlacerFrame.boxes) it overlaps; stops at limit.
   */
  private obstacleHits(bx: number, by: number, w: number, h: number, j: number, limit = 1 << 30): number {
    let hits = this.boxGrid.size === 0 ? 0 : this.boxGrid.count(bx + 1, by + 1, bx + w - 1, by + h - 1, -1, limit)
    const grid = this.lineGrid
    if (hits >= limit || grid.size === 0) return hits
    const n = grid.query(bx + 1, by + 1, bx + w - 1, by + h - 1)
    if (n === 0) return hits
    const hw = this.lineHalf
    const x0 = bx + 1 - hw
    const y0 = by + 1 - hw
    const x1 = bx + w - 1 + hw
    const y1 = by + h - 1 + hw
    const segs = this.lineSegs
    for (let k = 0; k < n; k++) {
      const s = grid.tag[grid.found[k]]
      if (this.lineSrc[s] === j || this.lineTgt[s] === j) continue
      if (!segmentCrossesBox(segs[4 * s], segs[4 * s + 1], segs[4 * s + 2], segs[4 * s + 3], x0, y0, x1, y1)) continue
      if (++hits >= limit) break
    }
    return hits
  }

  /**
   * True when some other node disc (tips, and dots too when includeDots) sits closer to the box
   * than the label's own node does, beyond the tolerance.
   */
  private violatesOwnership(bx: number, by: number, w: number, h: number, x: number, y: number, r: number, j: number, includeDots: boolean): boolean {
    const o = this.o
    const dOwn = rectDistance(bx, by, bx + w, by + h, x, y) - r
    const limit = dOwn - o.ownerTolerance
    const q = o.ownerQuery
    for (let g = 0; g < (includeDots ? 2 : 1); g++) {
      const grid = g === 0 ? this.tipGrid : this.dotGrid
      const n = grid.query(bx - q, by - q, bx + w + q, by + h + q, j)
      for (let k = 0; k < n; k++) {
        const e = grid.found[k]
        const cx = (grid.x0[e] + grid.x1[e]) / 2
        const cy = (grid.y0[e] + grid.y1[e]) / 2
        const rr = (grid.x1[e] - grid.x0[e]) / 2
        if (rectDistance(bx, by, bx + w, by + h, cx, cy) - rr < limit) return true
      }
    }
    return false
  }

  /**
   * The hidden labels around label i, in rank order, for its explore plate: up to plateNeighbours
   * into `out`, returning how many more there are. A label listed on `prev` stays listed until it is
   * more than plateNeighbourPx + plateNeighbourSlackPx away (or shown, or off the canvas).
   */
  private hiddenNeighbours(i: number, f: PlacerFrame, prev: Plate | null, out: number[]): number {
    const o = this.o
    out.length = 0
    const j = this.specs[i].node
    const x = f.sx[j]
    const y = f.sy[j]
    const r2 = o.plateNeighbourPx * o.plateNeighbourPx
    const rk2 = (o.plateNeighbourPx + o.plateNeighbourSlackPx) ** 2
    let rest = 0
    for (let q = 0; q < this.n; q++) {
      const k = this.orderArr[q]
      if (k === i || this.offscreen[k]) continue
      if (this.forcedNow[k] ? this.shownBeforeForce[k] : this.shown[k]) continue
      const kj = this.specs[k].node
      const dx = f.sx[kj] - x
      const dy = f.sy[kj] - y
      let kept = false
      if (prev !== null) {
        for (const row of prev.rows) {
          if (row.label === k) {
            kept = true
            break
          }
        }
      }
      if (!(dx * dx + dy * dy <= (kept ? rk2 : r2))) continue
      if (out.length < o.plateNeighbours) out.push(k)
      else rest++
    }
    return rest
  }

  /** The explore plate of label i no longer lists the hidden labels around it (zoom, motion, reveals). */
  private plateStale(i: number, plate: Plate, f: PlacerFrame): boolean {
    const nb = this.nbScratch
    const rest = this.hiddenNeighbours(i, f, plate, nb)
    if (rest !== plate.rest) return true
    let m = 0
    for (const row of plate.rows) {
      if (row.kind !== 'neighbour') continue
      if (m >= nb.length || row.label !== nb[m]) return true
      m++
    }
    return m !== nb.length
  }

  private buildPlate(i: number, explore: boolean, f: PlacerFrame, prev: Plate | null = null): Plate {
    const o = this.o
    const sp = this.specs[i]
    const rows: PlateRow[] = []
    const names = Math.min(sp.names.length, o.plateMaxNames)
    for (let r = 0; r < names; r++) rows.push({ kind: 'name', text: sp.names[r], width: sp.nameWidths[r], label: -1 })
    if (sp.names.length > names) {
      const text = `+${sp.names.length - names} more`
      rows.push({ kind: 'more', text, width: o.measure(text), label: -1 })
    }
    let rest = 0
    if (explore) {
      const nb = this.nbScratch
      rest = this.hiddenNeighbours(i, f, prev, nb)
      for (const k of nb) rows.push({ kind: 'neighbour', text: this.specs[k].fullText, width: this.specs[k].fullWidth, label: k })
      if (rest > 0) {
        const text = `${rest} more · zoom in`
        rows.push({ kind: 'more', text, width: o.measure(text), label: -1 })
      }
    }
    let wMax = 0
    for (const row of rows) wMax = Math.max(wMax, row.width + (row.kind === 'neighbour' ? o.plateIndent : 0))
    return { rows, w: wMax + 2 * o.platePadX, h: rows.length * o.lineH, explore, rest }
  }

  update(f: PlacerFrame): void {
    const o = this.o
    const W = f.width
    const H = f.height
    const lineH = o.lineH
    const edge = o.edge
    const tmp = this.tmp
    const dt = Math.min(Math.max(Number.isFinite(f.dtMs) ? f.dtMs : 0, 0), 64)
    const admit = f.admit !== false
    const n = this.n

    // ---- 0. grids of node discs and lines, motion, calm
    this.labelGrid.reset(W, H)
    this.ghostGrid.reset(W, H)
    this.tipGrid.reset(W, H)
    this.dotGrid.reset(W, H)
    this.lineGrid.reset(W, H)
    this.boxGrid.reset(W, H)
    if (this.isTipNode.length < f.nodeCount) {
      this.isTipNode = new Uint8Array(f.nodeCount)
      for (const sp of this.specs) if (sp.node < f.nodeCount) this.isTipNode[sp.node] = 1
    }
    const hard = f.hardNode
    let maxAny = 0
    for (let j = 0; j < f.nodeCount; j++) {
      const s = f.speed[j]
      if (s > maxAny) maxAny = s
      const x = f.sx[j]
      const y = f.sy[j]
      const r = f.sr[j]
      if (!(x > -r && x < W + r && y > -r && y < H + r)) continue
      // tips, and the station glyphs of hardNode, block labels; other nodes are coverable dots
      if (this.isTipNode[j] || (hard !== undefined && hard[j] === 1)) this.tipGrid.insert(x - r, y - r, x + r, y + r, j)
      else this.dotGrid.insert(x - r, y - r, x + r, y + r, j)
    }
    const lineSegs = f.lineSegs
    const lineSrc = f.lineSrc
    const lineTgt = f.lineTgt
    if (lineSegs !== undefined && lineSrc !== undefined && lineTgt !== undefined) {
      const count = Math.min(f.lineCount ?? 0, lineSegs.length >> 2, lineSrc.length, lineTgt.length)
      const hw = Math.max(0, f.lineHalfPx ?? 0)
      this.lineSegs = lineSegs
      this.lineSrc = lineSrc
      this.lineTgt = lineTgt
      this.lineHalf = hw
      for (let s = 0; s < count; s++) {
        const ax = lineSegs[4 * s]
        const ay = lineSegs[4 * s + 1]
        const bx = lineSegs[4 * s + 2]
        const by = lineSegs[4 * s + 3]
        const x0 = Math.min(ax, bx) - hw
        const x1 = Math.max(ax, bx) + hw
        const y0 = Math.min(ay, by) - hw
        const y1 = Math.max(ay, by) + hw
        // pieces off the canvas would only crowd its edge cells (NaN fails this too)
        if (!(x1 > 0 && x0 < W && y1 > 0 && y0 < H)) continue
        this.lineGrid.insert(x0, y0, x1, y1, s)
      }
    }
    const boxes = f.boxes
    if (boxes !== undefined) {
      const count = Math.min(f.boxCount ?? 0, boxes.length >> 2)
      for (let b = 0; b < count; b++) {
        const x0 = boxes[4 * b]
        const y0 = boxes[4 * b + 1]
        const x1 = boxes[4 * b + 2]
        const y1 = boxes[4 * b + 3]
        if (x1 > 0 && x0 < W && y1 > 0 && y0 < H) this.boxGrid.insert(x0, y0, x1, y1, b)
      }
    }
    let maxTip = 0
    for (let i = 0; i < n; i++) {
      const s = f.speed[this.specs[i].node]
      if (s > maxTip) maxTip = s
    }
    this.maxTipSpeed = maxTip
    if (f.cameraMoving || maxTip > o.calmExitSpeed) this.calmRun = 0
    else if (maxTip < o.calmSpeed) this.calmRun++
    const calm = this.calmRun >= o.calmEnterFrames
    this.calm = calm
    this.frameNo++
    this.still = !f.cameraMoving && maxAny <= 0.05
    if (!this.still || admit !== this.lastAdmit) this.quietFrames = 0
    else this.quietFrames++
    this.reseatNow = o.reseatOnAdmit && admit && !this.lastAdmit
    this.lastAdmit = admit
    if (calm && !this.wasCalm) this.retryAt.fill(0)
    // a camera move or node motion (ending calm, or slow drift starting in a calm scene) may free
    // spots: labels that failed while calm and still ("wait for a state change") go back to the
    // normal few-frame backoff
    else if ((!calm && this.wasCalm) || (!this.still && this.wasStill)) for (let i = 0; i < n; i++) if (this.retryAt[i] === NEVER) this.retryAt[i] = 0
    this.wasCalm = calm
    this.wasStill = this.still
    this.frameBusy = f.cameraMoving

    // ---- 1. forced labels: full names on a plate, shown at once, never hidden, kept on-canvas
    this.isForced.fill(0)
    this.fx0.length = 0
    this.fy0.length = 0
    this.fx1.length = 0
    this.fy1.length = 0
    for (const i of this.forced) {
      if (this.isForced[i]) continue
      this.isForced[i] = 1
      const sp = this.specs[i]
      const j = sp.node
      const x = f.sx[j]
      const y = f.sy[j]
      const r = f.sr[j]
      if (!this.forcedNow[i]) {
        this.shownBeforeForce[i] = this.shown[i]
        this.anchorBeforeForce[i] = this.anchor[i]
        this.variantBeforeForce[i] = this.variant[i]
        this.holdHit[i] = this.shown[i] && !this.masked[i] && this.alpha[i] >= 0.5 ? 1 : 0
        this.forcedNow[i] = 1
        this.plates[i] = null
      }
      if (!(Number.isFinite(x) && Number.isFinite(y))) {
        this.holdW[i] = 0
        this.forcedNodeR[i] = -1
        continue
      }
      this.forcedNodeX[i] = x
      this.forcedNodeY[i] = y
      this.forcedNodeR[i] = r
      // the label's own box from before the force, following the node
      const av = this.variantBeforeForce[i]
      const aa = this.anchorBeforeForce[i]
      if (this.shownBeforeForce[i] && aa >= 0 && av >= 0 && av < sp.widths.length) {
        const lw = sp.widths[av] + 2 * o.padX
        anchorOrigin(aa, x, y, r, lw, lineH, o.gap, tmp)
        this.holdX0[i] = tmp[0]
        this.holdY0[i] = tmp[1]
        this.holdW[i] = lw
      } else this.holdW[i] = 0
      const explore = i === this.explore && this.shownBeforeForce[i] === 0
      let plate = this.plates[i]
      if (plate === null || plate.explore !== explore) plate = this.plates[i] = this.buildPlate(i, explore, f)
      // the neighbour rows follow zoom, motion and reveals; rebuilt only when the list changes
      else if (explore && this.plateStale(i, plate, f)) plate = this.plates[i] = this.buildPlate(i, true, f, plate)
      const w = Math.max(1, Math.min(plate.w, W - 2 * edge))
      const h = plate.h
      let best = -1
      let bx = 0
      let by = 0
      const first = this.shown[i] && this.anchor[i] >= 0 ? this.anchor[i] : 0
      for (let k = -1; k < NA && best < 0; k++) {
        const a = k < 0 ? first : k
        this.forcedOrigin(a, x, y, r, w, h)
        if (tmp[0] < edge || tmp[1] < edge || tmp[0] + w > W - edge || tmp[1] + h > H - edge) continue
        if (this.hitsForced(tmp[0], tmp[1], tmp[0] + w, tmp[1] + h)) continue
        best = a
        bx = tmp[0]
        by = tmp[1]
      }
      if (best < 0) {
        best = x > W / 2 ? 1 : 0
        this.forcedOrigin(best, x, y, r, w, h)
        bx = Math.min(Math.max(tmp[0], edge), W - edge - w)
        by = Math.min(Math.max(tmp[1], edge), H - edge - h)
      }
      this.jumped[i] = this.shown[i] && best !== this.anchor[i] ? 1 : 0
      this.anchor[i] = best
      this.variant[i] = -1
      this.x0[i] = bx
      this.y0[i] = by
      this.w[i] = w
      this.h[i] = h
      this.shown[i] = 1
      this.pendingMs[i] = 0
      this.masked[i] = 0
      this.alpha[i] = 1
      this.fromAlpha[i] = 0
      this.offscreen[i] = 0
      this.leader[i] = 0
      this.fx0.push(bx)
      this.fy0.push(by)
      this.fx1.push(bx + w)
      this.fy1.push(by + h)
    }
    // labels that stopped being forced go back to exactly how they were before
    for (let i = 0; i < n; i++) {
      if (this.forcedNow[i] && !this.isForced[i]) {
        this.forcedNow[i] = 0
        this.plates[i] = null
        this.holdW[i] = 0
        this.holdHit[i] = 0
        this.anchor[i] = this.anchorBeforeForce[i]
        this.variant[i] = this.variantBeforeForce[i]
        this.h[i] = lineH
        this.masked[i] = 0
        if (!this.shownBeforeForce[i]) {
          this.shown[i] = 0
          this.alpha[i] = 0
          this.pendingMs[i] = 0
        }
      }
    }

    // ---- 2. ghosts: labels fading out, old boxes of crossfades, and the normal spot of a forced
    // label that was showing (reserved so a newcomer cannot take it during a hover)
    if (o.ghostsBlock) {
      for (let i = 0; i < n; i++) {
        const sp = this.specs[i]
        const j = sp.node
        const x = f.sx[j]
        const y = f.sy[j]
        const r = f.sr[j]
        if (!(Number.isFinite(x) && Number.isFinite(y))) continue
        if (this.forcedNow[i]) {
          const hw = this.holdW[i]
          if (hw > 0) this.ghostGrid.insert(this.holdX0[i], this.holdY0[i], this.holdX0[i] + hw, this.holdY0[i] + lineH, i)
          continue
        }
        if (!this.shown[i] && this.alpha[i] > 0 && this.anchor[i] >= 0) {
          const v = this.variant[i]
          if (v >= 0 && v < sp.widths.length) {
            const w = sp.widths[v] + 2 * o.padX
            anchorOrigin(this.anchor[i], x, y, r, w, lineH, o.gap, tmp)
            this.ghostGrid.insert(tmp[0], tmp[1], tmp[0] + w, tmp[1] + lineH, i)
          }
        }
        if (this.fromAlpha[i] > 0) this.placeFromBox(i, f)
      }
    }

    // ---- 3. pinned labels first, in priority order; a pinned label that fits nowhere falls back
    // to normal placement below
    this.pinFailed.fill(0)
    for (let q = 0; q < n; q++) {
      const i = this.orderArr[q]
      if (this.isForced[i] || !this.pinnedNow(i, admit)) continue
      if (!this.place(i, f, true, calm, admit, dt)) this.pinFailed[i] = 1
    }

    // ---- 4. everyone else: strict priority when calm, labels already showing first otherwise
    let k = 0
    const normal = (i: number) => !this.isForced[i] && (!this.pinnedNow(i, admit) || this.pinFailed[i] === 1)
    if (calm) {
      for (let q = 0; q < n; q++) {
        const i = this.orderArr[q]
        if (normal(i)) this.proc[k++] = i
      }
    } else {
      for (let q = 0; q < n; q++) {
        const i = this.orderArr[q]
        if (normal(i) && (this.shown[i] || this.pendingMs[i] > 0)) this.proc[k++] = i
      }
      for (let q = 0; q < n; q++) {
        const i = this.orderArr[q]
        if (normal(i) && !this.shown[i] && !(this.pendingMs[i] > 0)) this.proc[k++] = i
      }
    }
    for (let q = 0; q < k; q++) this.place(this.proc[q], f, false, calm, admit, dt)

    // ---- 5. crossfades: the old box follows its node while it fades
    for (let i = 0; i < n; i++) {
      if (this.fromAlpha[i] <= 0) continue
      this.fromAlpha[i] = Math.max(0, this.fromAlpha[i] - dt / o.fadeOutMs)
      if (this.fromAlpha[i] > 0) {
        this.frameBusy = true
        if (!o.ghostsBlock) this.placeFromBox(i, f)
      }
    }

    // ---- 6. busy: keep frames coming while anything is pending, fading, held back or not yet calm
    // Anything that can free or take space counts as a change: a label showing or hiding, fading to
    // or from zero, moving, or the old box of a crossfade finally disappearing. In a calm scene,
    // hidden labels search again only after such a change.
    let busy = this.frameBusy
    let changed = false
    for (let i = 0; i < n; i++) {
      const zero = this.alpha[i] === 0 ? 1 : 0
      const fromZero = this.fromAlpha[i] > 0 ? 0 : 1
      if (this.shown[i] !== this.prevShown[i] || zero !== this.prevZero[i] || fromZero !== this.prevFromZero[i] || this.jumped[i] === 1) {
        changed = true
        this.prevShown[i] = this.shown[i]
        this.prevZero[i] = zero
        this.prevFromZero[i] = fromZero
      }
    }
    if (changed) {
      this.lastChange = this.frameNo
      if (calm) this.retryAt.fill(0)
    }
    if (o.retryFrames > 0 && this.frameNo - this.lastChange <= 2 * o.retryFrames + 1) busy = true
    if (this.calmRun < o.calmEnterFrames) busy = true
    // watchdog: never keep redrawing a calm scene that has not moved or changed input for a while
    if (busy && calm && this.quietFrames >= o.watchdogFrames) busy = false
    this.busy = busy
  }

  private pinnedNow(i: number, admit: boolean): boolean {
    return this.isPinned[i] === 1 && (admit || this.isSoftPin[i] === 0)
  }

  /** Origin of a forced plate: R and L keep the first row centred on the node. */
  private forcedOrigin(a: number, x: number, y: number, r: number, w: number, h: number): void {
    const tmp = this.tmp
    anchorOrigin(a, x, y, r, w, h, this.o.gap, tmp)
    if (a <= 1) tmp[1] = y - this.o.lineH / 2
  }

  /** Recomputes the old box of a crossfade at the node's current position (and blocks newcomers with it). */
  private placeFromBox(i: number, f: PlacerFrame): void {
    const o = this.o
    const sp = this.specs[i]
    const a = this.fromAnchor[i]
    const v = this.fromVariant[i]
    if (a < 0 || v < 0 || v >= sp.widths.length) {
      this.fromAlpha[i] = 0
      return
    }
    const j = sp.node
    const w = sp.widths[v] + 2 * o.padX
    anchorOrigin(a, f.sx[j], f.sy[j], f.sr[j], w, o.lineH, o.gap, this.tmp)
    this.fromX0[i] = this.tmp[0]
    this.fromY0[i] = this.tmp[1]
    this.fromW[i] = w
    if (o.ghostsBlock) this.ghostGrid.insert(this.tmp[0], this.tmp[1], this.tmp[0] + w, this.tmp[1] + o.lineH, i)
  }

  /**
   * Places one label. Returns false only for a pinned label that found no spot, in which case
   * nothing was changed and the caller falls back to normal placement.
   */
  private place(i: number, f: PlacerFrame, pinned: boolean, calm: boolean, admit: boolean, dt: number): boolean {
    const o = this.o
    const h = o.lineH
    const W = f.width
    const H = f.height
    const edge = o.edge
    const tmp = this.tmp
    const sp = this.specs[i]
    const j = sp.node
    const x = f.sx[j]
    const y = f.sy[j]
    const r = f.sr[j]

    // a node well outside the canvas drops its label at once
    if (!(x >= -40 && x <= W + 40 && y >= -40 && y <= H + 40)) {
      this.shown[i] = 0
      this.pendingMs[i] = 0
      this.alpha[i] = 0
      this.masked[i] = 0
      this.fromAlpha[i] = 0
      this.jumped[i] = 0
      this.offscreen[i] = 1
      this.leader[i] = 0
      return true
    }
    this.offscreen[i] = x < 0 || x > W || y < 0 || y > H ? 1 : 0

    const wasShown = this.shown[i] === 1
    const incumbent = wasShown || this.pendingMs[i] > 0
    const prevA = this.anchor[i]
    const prevV = this.variant[i]
    let bestA = -1
    let bestV = 0
    let bestX = 0
    let bestY = 0
    let bestW = 0
    let bestCost = Infinity
    let masked = false
    let polish = false
    // a pinned label re-searching off a tip keeps its current spot when the search finds nothing
    // (the strict edge test can reject a spot the sticky check accepted with its tolerance)
    let keepA = -1
    let keepV = 0
    let keepX = 0
    let keepY = 0
    let keepW = 0

    // (a) sticky: keep the current spot while it is still legal (with tolerance, nodes ignored)
    if (o.sticky && incumbent && prevA >= 0 && prevV >= 0 && prevV < sp.widths.length) {
      const w = sp.widths[prevV] + 2 * o.padX
      anchorOrigin(prevA, x, y, r, w, h, o.gap, tmp)
      const bx = tmp[0]
      const by = tmp[1]
      const s = o.oldShrink
      const lenient = wasShown && (f.cameraMoving || (o.edgeLenientWhileHeld && f.admit === false)) && o.edgeLenientWhileCamera
      // the same tolerance at the canvas edge: a label drifting outward by a px or two stays put
      const e = edge - s
      const inside = !(bx < e || by < e || bx + w > W - e || by + h > H - e)
      if ((lenient || inside) && this.labelGrid.count(bx + s, by + s, bx + w - s, by + h - s, -1, 1) === 0) {
        bestA = prevA
        bestV = prevV
        bestX = bx
        bestY = by
        bestW = w
        bestCost = 0
        masked = wasShown && this.hitsForced(bx + s, by + s, bx + w - s, by + h - s)
        if (!wasShown && masked) {
          // a pending label under a plate waits
          bestA = -1
          masked = false
        } else if (((calm && o.calmPolish && this.frameNo >= this.retryAt[i]) || this.reseatNow) && !masked) {
          // at rest a label on another node may move once to a clean spot; when admission opens
          // after a hold, a label shown during it (placed before the camera was) may also move to a
          // clearly cheaper anchor. Pinned labels too: they cover tips only when nothing else fits,
          // and keep their spot when the search finds nothing
          // a spot across another line (or on a mark) counts like one on a tip: the label must move
          // or, if it is not pinned and nothing is free, hide (it settled there while things moved:
          // a metro tween)
          const tipHits = this.tipGrid.count(bx, by, bx + w, by + h, j, 1)
          if (tipHits > 0 || this.obstacleHits(bx, by, w, h, j, 1) > 0) {
            polish = true
            bestA = -1
            bestCost = Infinity
            if (pinned) {
              keepA = prevA
              keepV = prevV
              keepX = bx
              keepY = by
              keepW = w
              // costed like pass 2, and only a clearly cheaper spot wins (any tip- and line-free one does)
              const tips = this.tipGrid.count(bx, by, bx + w, by + h, j) + this.obstacleHits(bx, by, w, h, j)
              const dots = this.dotGrid.count(bx, by, bx + w, by + h, j)
              const owner = this.violatesOwnership(bx, by, w, h, x, y, r, j, false) ? o.pinOwnerCost : 0
              bestCost = o.anchorCost[prevA] + prevV * o.variantCost + o.pinTipCost * tips + o.nodeHitCost * dots + owner - o.polishMargin
            }
          } else {
            const dotHits = this.dotGrid.count(bx, by, bx + w, by + h, j)
            const cost = o.anchorCost[prevA] + prevV * o.variantCost + o.nodeHitCost * dotHits
            if (dotHits > 0 || this.reseatNow || (o.polishByCost && o.anchorCost[prevA] + prevV * o.variantCost >= o.polishMargin)) {
              polish = true
              bestCost = cost - o.polishMargin
            }
          }
        }
      }
    }

    // (b) search: hidden labels may only start while their node and the camera are still
    const backoff = !incumbent && o.retryFrames > 0 && this.frameNo < this.retryAt[i]
    const mayAdmit = pinned || wasShown || (!backoff && admit && !f.cameraMoving && f.speed[j] <= o.admitMaxSpeed)
    if (bestA < 0 && !mayAdmit && !backoff) this.frameBusy = true
    const searched = (bestA < 0 && mayAdmit) || polish
    if (searched) {
      // a label that may stay where it is (an optional polish move, or a pinned label that keeps its
      // spot on a tip when nothing better is free) only moves to a spot that does not overlap any
      // label; one that must move keeps the incumbent tolerance; newcomers keep a gap
      const optional = polish && (bestA >= 0 || keepA >= 0)
      const pad = optional ? 0 : incumbent ? -o.oldShrink : o.newPad
      // pass 0: no other tip covered and no other node (tip or dot) closer to the box than its own
      // pass 1: (ownerDotFallback) may run over unrelated commit dots, at nodeHitCost each, but still
      //         no other tip closer than its own
      // pass 2: pinned only: may cover other tips or sit nearer to one than to its own node, at
      //         pinTipCost per covered tip and pinOwnerCost, so that loses to covering dots
      // lines and marks (PlacerFrame.lineSegs, boxes) block like tips: passes 0 and 1 never cross
      // one, pass 2 pays pinTipCost per line crossed or mark covered
      // a pass runs only when the ones before it found nothing
      for (let pass = 0; pass < 3; pass++) {
        if (pass > 0 && bestA >= 0) break
        if (pass === 1 && !(o.ownership && o.ownerDotFallback)) continue
        if (pass === 2 && !pinned) continue
        const tipsHard = pass < 2
        const owner = pass === 2 || !o.ownership ? 0 : pass === 0 ? 2 : 1
        for (let v = 0; v < sp.widths.length; v++) {
          const w = sp.widths[v] + 2 * o.padX
          for (let a = 0; a < NA; a++) {
            anchorOrigin(a, x, y, r, w, h, o.gap, tmp)
            const bx = tmp[0]
            const by = tmp[1]
            if (bx < edge || by < edge || bx + w > W - edge || by + h > H - edge) continue
            const base = o.anchorCost[a] + v * o.variantCost
            if (base >= bestCost) continue
            const x0 = bx - pad
            const y0 = by - pad
            const x1 = bx + w + pad
            const y1 = by + h + pad
            if (this.labelGrid.count(x0, y0, x1, y1, -1, 1) > 0) continue
            if (this.hitsForced(x0, y0, x1, y1)) continue
            // ghosts (fading labels, a hovered label's reserved spot) block newcomers and optional
            // moves; a label that must move may take them
            if ((!incumbent || optional) && this.ghostGrid.count(x0, y0, x1, y1, i, 1) > 0) continue
            const tipHits = this.tipGrid.count(bx, by, bx + w, by + h, j)
            if (tipHits > 0 && tipsHard) continue
            const blocked = this.obstacleHits(bx, by, w, h, j, tipsHard ? 1 : 1 << 30)
            if (blocked > 0 && tipsHard) continue
            if (owner > 0 && this.violatesOwnership(bx, by, w, h, x, y, r, j, owner === 2)) continue
            const dots = this.dotGrid.count(bx, by, bx + w, by + h, j)
            const cost =
              pass === 2
                ? base +
                  o.nodeHitCost * dots +
                  o.pinTipCost * (tipHits + blocked) +
                  (this.violatesOwnership(bx, by, w, h, x, y, r, j, false) ? o.pinOwnerCost : 0)
                : base + o.nodeHitCost * (tipHits + dots)
            if (cost < bestCost) {
              bestCost = cost
              bestA = a
              bestV = v
              bestX = bx
              bestY = by
              bestW = w
            }
            if (cost === base && a === 0) break
          }
          if (bestA >= 0 && bestCost < (v + 1) * o.variantCost) break
        }
      }
    }

    if (bestA < 0 && keepA >= 0) {
      bestA = keepA
      bestV = keepV
      bestX = keepX
      bestY = keepY
      bestW = keepW
    }
    if (bestA < 0 && pinned) return false
    // an optional polish that found nothing better is not tried again in a calm, still scene until
    // some label changes state (the same rule as for hidden labels); while nodes still drift it
    // retries after the usual backoff, since the drift can open a better spot
    if (polish && calm && bestA === prevA && bestV === prevV) this.retryAt[i] = this.still ? NEVER : this.frameNo + o.retryFrames + (i % o.retryFrames)

    this.jumped[i] = 0
    if (bestA >= 0) {
      if (wasShown && (bestA !== prevA || bestV !== prevV)) {
        this.jumped[i] = 1
        // crossfade: the old box fades out where it was while the label fades in at its new spot
        if (this.alpha[i] > 0.01 && prevA >= 0 && prevV >= 0) {
          this.fromAnchor[i] = prevA
          this.fromVariant[i] = prevV
          this.fromAlpha[i] = this.alpha[i]
          this.placeFromBox(i, f)
          this.alpha[i] = 0
        }
      }
      this.anchor[i] = bestA
      this.variant[i] = bestV
      this.x0[i] = bestX
      this.y0[i] = bestY
      this.w[i] = bestW
      this.h[i] = h
      this.labelGrid.insert(bestX, bestY, bestX + bestW, bestY + h, i)
      this.masked[i] = masked ? 1 : 0
      // only pinned labels may end up on (or nearer to) another tip, or across a line; checked
      // every frame, so a sticky spot a tip or a line drifts under is flagged too
      this.leader[i] =
        pinned &&
        (this.tipGrid.count(bestX, bestY, bestX + bestW, bestY + h, j, 1) > 0 ||
          this.obstacleHits(bestX, bestY, bestW, h, j, 1) > 0 ||
          this.violatesOwnership(bestX, bestY, bestW, h, x, y, r, j, false))
          ? 1
          : 0
      if (!wasShown) {
        this.pendingMs[i] += dt
        this.frameBusy = true
        if (this.pendingMs[i] >= o.showAfterMs || pinned) {
          this.shown[i] = 1
          this.pendingMs[i] = 0
        }
      }
    } else {
      // in a calm, still scene nothing can free a spot until some label changes state, so wait for
      // that (or for calm to end: camera or node motion clears NEVER again)
      if (searched && !incumbent && o.retryFrames > 0) {
        this.retryAt[i] = calm && this.still ? NEVER : this.frameNo + o.retryFrames + (i % o.retryFrames)
      }
      this.pendingMs[i] = 0
      this.shown[i] = 0
      this.masked[i] = 0
      this.leader[i] = 0
      if (this.alpha[i] > 0 && prevA >= 0 && prevV >= 0 && prevV < sp.widths.length) {
        // fade out at the last spot, following the node
        const w = sp.widths[prevV] + 2 * o.padX
        anchorOrigin(prevA, x, y, r, w, h, o.gap, tmp)
        this.x0[i] = tmp[0]
        this.y0[i] = tmp[1]
        this.w[i] = w
        this.h[i] = h
        if (o.ghostsBlock && wasShown) this.ghostGrid.insert(tmp[0], tmp[1], tmp[0] + w, tmp[1] + h, i)
      }
    }

    const target = this.shown[i] && !this.masked[i] ? 1 : 0
    if (target === 1) this.alpha[i] = Math.min(1, this.alpha[i] + dt / o.fadeInMs)
    else this.alpha[i] = Math.max(0, this.alpha[i] - dt / (this.masked[i] ? o.maskFadeMs : o.fadeOutMs))
    if (this.alpha[i] > 0 && this.alpha[i] < 1) this.frameBusy = true
    return true
  }
}
