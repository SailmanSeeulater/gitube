/**
 * Metro-map ("straight") layout for the branch DAG: lanes by lifetime, git-graph style, drawn
 * like a tube map.
 *
 * Pure and deterministic: Graph + RepoData in, pinned positions and octilinear link routes out.
 * No DOM, no React, no clock, no randomness; every sort has an index or code-point tie-break.
 * Units are abstract: 1 = the distance between two adjacent lanes. The app scales them.
 *
 * Pipeline (O(n log n) overall, n = nodes + links):
 *   0. Skeleton. The lane work always runs on the skeleton (tips, forks, merges, roots: the
 *      collapse.ts rule), whichever view the graph is in. In 'full' view the plain commits are
 *      threaded back onto the skeleton link they sit on at the end, so a branch gets the same lane
 *      in both views and switching views only slides stations sideways.
 *   1. Order. Topological sort of the stations, parents first, ties by (commit date, sha).
 *   2. Chains. Each visible branch, in build.ts ownership order (default first, then aheadBy,
 *      then name), claims its first-parent run of stations from its tip, which reproduces
 *      ownership pass 1. When the default branch is hidden, the tip whose first-parent history
 *      carries most of the old default branch is claimed first as the "spine", so the old trunk
 *      stays on one line. Stations left over (merged branches whose ref is gone) form muted
 *      "merged" chains. A non-first-parent skeleton link that hides commits (a deleted merged
 *      branch) becomes a station-less muted "side" chain on a lane of its own, where its commits
 *      sit in full view.
 *   3. Link kinds. line (along one lane), fork (bends next to the parent, runs on the child's
 *      lane), merge (runs on the parent's lane, bends next to the child), side (out to a side
 *      chain's lane and back) and cross (both ends mid-line, e.g. a sync merge of main into a
 *      live branch; draw dashed).
 *   4. Lanes. Interval colouring in a mode-independent rank space (a link hiding k commits spans
 *      laneRun(k) columns). Lane 0 is the trunk. Chains in start order take the free lane with the
 *      least weighted distance to the lanes they link to; a branch forked off another branch's tip
 *      continues on its lane. A refinement pass then re-seats chains placed before their partners.
 *      opts.prevLanes seats every line on its previous lane first when that lane is still free.
 *      A cross link rides one end's line when that stretch is quiet, else a half-lane rail, else a
 *      lane of its own.
 *   5. Columns and X. The walk is replayed: a station shares the current column unless a parent
 *      (or the previous user of a lane it starts on) is already there. X[c] = max(X[c-1] + colGap,
 *      X[parent column] + the room its link needs): the run room (1-2 columns in skeleton view,
 *      sqrt-compressed in full view), the lane change and the fan offset.
 *   6. Routes. Horizontal along lanes, 45 degree diagonals between them. Lane changes of up to
 *      maxDiagonalLanes get room for a single diagonal; longer ones get one too when the room is
 *      already there, else chamfer + vertical + chamfer. Several lane changes leaving (or entering)
 *      one station on the same side are fanned so they run side by side instead of on top of each
 *      other. Every lane change is checked against the stations it passes and moved if it would
 *      run through one.
 *   7. Full view. Plain commits are spaced evenly along their link's horizontal carrier, avoiding
 *      the spots where other routes cross that lane, and the polyline is cut at them, so every
 *      graph link gets its own route piece.
 *   8. Stations, stubs, labels (greedy, trunk then newest first: after a terminus, beside the line,
 *      or at 45 degrees; clear of stations, labels and, where possible, lines; long names get a
 *      middle ellipsis), run markers, bounds.
 *
 * Integration: call metroLayout with the exact Graph being displayed (same view mode and hidden
 * branches) and the RepoData. Link ends may be sha strings or the node objects react-force-graph
 * swaps in. Look routes up by route.linkIndex (equal to the link's index in graph.links); never by
 * source>target, because a skeleton can hold two links between the same pair.
 */
import type { Graph, GraphNode, RepoData } from '../types'
import { isSkeletonNode } from './collapse'

// ---------------------------------------------------------------- public types

export interface MetroPoint {
  x: number
  y: number
}

/**
 * line: along one lane. fork: leaves the parent's lane right after the parent, runs on the
 * child's lane. merge: runs on the parent's lane, joins the child's lane just before the child.
 * side: a deleted merged branch's own lane (out from the parent, back into the child).
 * cross: both ends mid-line (a sync merge); rides a half-lane rail between lanes.
 */
export type MetroRouteKind = 'line' | 'fork' | 'merge' | 'side' | 'cross'

/**
 * interchange: a lane change starts or ends here (white ring). terminus: the newest commit of a
 * branch line that ends here. origin: the first commit of a line with no parent on the map.
 * stop: any other skeleton station. commit: a plain commit (full view only).
 */
export type MetroStationKind = 'interchange' | 'terminus' | 'origin' | 'stop' | 'commit'

export interface MetroOptions {
  /** Minimum distance between consecutive columns. Default 1 (one lane). Try 0.6-0.7 for 'full'. */
  colGap?: number
  /**
   * Lane changes of up to this many lanes always get a single 45 degree diagonal (columns make
   * room for it). Longer ones get a diagonal only where the room already exists, else chamfer +
   * vertical + chamfer. Default 3.
   */
  maxDiagonalLanes?: number
  /** Chamfer size of a chamfer + vertical + chamfer lane change. Default 0.5, at most colGap / 2. */
  corner?: number
  /** Offset between lane changes fanned out of (or into) one station on one side. Default 0.25. */
  fan?: number
  /** Extra empty columns kept after a lane's last use before another line may reuse it. Default 0. */
  reuseGapColumns?: number
  /** Let cross links ride half-lane rails between lanes. Default true. */
  rails?: boolean
  /**
   * Lanes from a previous layout (pass `layout.laneHints`, or `layout.lanes`). Every line whose
   * previous lane is still free takes it before the others are placed, so hiding or showing a
   * branch or changing a filter moves few other lines. Lanes are then not renumbered, so a hidden
   * line may leave an empty lane behind.
   */
  prevLanes?: ReadonlyMap<string, number>
  /**
   * How much closer (weighted lane distance to the lines it links to) another lane must be before
   * the refinement pass moves a line off its previous lane (a fork off the trunk weighs 4 per
   * lane). Default 8.
   */
  laneHintSlack?: number
  /**
   * Room, in columns, given to a link that hides `hidden` commits. Default: skeleton view 1 / 1.5
   * (any run) / 2 (64+); full view laneRun(hidden) = 1 or max(2, ceil(0.9 * sqrt(hidden))).
   */
  runColumns?: (hidden: number) => number
  /** Label length cap in characters; longer names get a middle ellipsis. Default 30. */
  maxLabelChars?: number
  /** A label is never shortened below this many characters. Default 10. */
  minLabelChars?: number
  /** Label font size in lane units, for label boxes. Default 0.375. */
  labelFontSize?: number
  /** Estimated glyph width in lane units when labelWidth is not given. Default 0.2125. */
  charWidth?: number
  /** Width of a label text in lane units (e.g. from ctx.measureText). Default: charWidth per char. */
  labelWidth?: (text: string) => number
}

export interface MetroRoute {
  /** Index of the link in graph.links. routes[k].linkIndex === k for every valid graph. */
  linkIndex: number
  /** child id (GraphLink.source) */
  source: string
  /** parent id (GraphLink.target) */
  target: string
  /** Octilinear polyline from the PARENT (older, left) to the CHILD (newer, right); x never decreases. */
  points: MetroPoint[]
  kind: MetroRouteKind
  /** Track carrying the horizontal run: a lane, or n + 0.5 for the rail between lanes n and n + 1. */
  lane: number
  /** Branch whose palette colour the route is drawn in. A merge keeps the merged branch's colour. */
  colorBranch: string
  /** A merged branch whose ref is gone (side and merged chains): draw at about 50% alpha, thinner, first. */
  muted: boolean
  /** Draw dashed (cross links). */
  dashed: boolean
  /** collapsedCount of the link (skeleton view), 0 in full view. */
  hidden: number
}

export interface MetroLabel {
  nodeId: string
  /** Every branch whose tip is this commit, primary first (for tooltips). */
  branches: string[]
  /** Text to draw: the primary name shortened in the middle, plus " +N" for N more tips. */
  text: string
  /** Station centre. */
  x: number
  y: number
  /**
   * end: along the lane right of a terminus. side: horizontal beside the line, away from the
   * trunk. diagonal: at 45 degrees (angle -45 rising, 45 falling).
   */
  placement: 'end' | 'side' | 'diagonal'
  /** Text baseline start and rotation in degrees (canvas: translate(tx, ty), rotate, fillText at 0,0). */
  tx: number
  ty: number
  angle: number
  /** Width of `text` along the baseline (lane units). */
  width: number
  /** No spot was free of other labels and stations; drawn anyway. */
  crowded: boolean
}

export interface MetroRun {
  /** Skeleton link whose hidden commits this marks. */
  linkIndex: number
  hidden: number
  /** Midpoint of the link's horizontal carrier. */
  x: number
  y: number
  /** Length of that carrier. */
  room: number
  /** Vertical centre for a "+N" marker beside the line, or null when there is no free spot. */
  markerY: number | null
}

export interface MetroStub {
  nodeId: string
  colorBranch: string
  /** Dashed lead-in before a truncated root: [left end, station]. */
  points: [MetroPoint, MetroPoint]
}

export interface MetroSegment {
  /** branch: a visible branch's own stations; merged: a deleted branch's stations; side: a deleted branch's run; bridge: a cross link on its own track. */
  kind: 'branch' | 'merged' | 'side' | 'bridge'
  branch: string | null
  colorBranch: string
  lane: number
  /** x extent of the lane reservation. */
  x0: number
  x1: number
  /** Station ids, oldest first (empty for side and bridge). */
  nodes: string[]
}

export interface MetroBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface MetroLayout {
  /** Every node of the graph. */
  positions: Map<string, MetroPoint>
  /** Every visible branch -> the lane its tip sits on (0 = trunk, + below, - above). */
  lanes: Map<string, number>
  /** lanes plus the anonymous lines (keys start with '~'); pass this back as opts.prevLanes. */
  laneHints: Map<string, number>
  /** One route per valid graph link, sorted by linkIndex. */
  routes: MetroRoute[]
  stations: Map<string, MetroStationKind>
  labels: MetroLabel[]
  /** Skeleton view: links hiding commits, with a spot for a "+N" marker. Empty in full view. */
  runs: MetroRun[]
  stubs: MetroStub[]
  segments: MetroSegment[]
  bounds: MetroBounds
  /** bounds grown by the label boxes and run markers, for fit-to-view. */
  boundsWithLabels: MetroBounds
  /** Distinct lanes with a line on them. */
  laneCount: number
  /** Distinct rails used. */
  railCount: number
  columns: number
  /** 'full' when the graph holds plain commits (threaded onto skeleton links), else 'skeleton'. */
  mode: 'skeleton' | 'full'
}

// ---------------------------------------------------------------- label names

/** Middle-ellipsis shortening that keeps a "prefix/" namespace and the distinctive tail. */
export function shortBranchName(name: string, max = 30): string {
  if (name.length <= max) return name
  if (max <= 1) return '…'
  const slash = name.indexOf('/')
  // keep the whole "prefix/" only while it leaves most of the room for the distinctive tail
  const keepHead = slash > 0 && max - 2 - slash >= Math.max(6, slash + 1) ? slash + 1 : Math.ceil((max - 1) * 0.55)
  const tail = Math.max(1, max - 1 - keepHead)
  return name.slice(0, Math.min(keepHead, max - 2)) + '…' + name.slice(name.length - tail)
}

/** shortBranchName for every name, lengthened where two names would shorten to the same text. */
export function uniqueShortNames(names: readonly string[], max = 30): Map<string, string> {
  const out = new Map<string, string>()
  const groups = new Map<string, string[]>()
  for (const name of new Set(names)) {
    const s = shortBranchName(name, max)
    out.set(name, s)
    const g = groups.get(s)
    if (g) g.push(name)
    else groups.set(s, [name])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    for (let m = max + 2; m <= max + 60; m += 2) {
      const tries = group.map((name) => shortBranchName(name, m))
      if (new Set(tries).size === tries.length) {
        group.forEach((name, i) => out.set(name, tries[i]))
        break
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- run lengths

/** Skeleton view: a run of hidden commits is a symbol, not a distance. */
export function skeletonRunColumns(hidden: number): number {
  return hidden <= 0 ? 1 : hidden < 64 ? 1.5 : 2
}

/** Full view and lane assignment: the plain commits are drawn, so give them sqrt room. */
export function laneRunColumns(hidden: number): number {
  return hidden <= 0 ? 1 : Math.max(2, Math.ceil(0.9 * Math.sqrt(hidden)))
}

// ---------------------------------------------------------------- helpers

const EPS = 1e-9

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** force-graph replaces link.source/target with node objects once it ingests the data. */
function endId(end: unknown): string {
  if (typeof end === 'string') return end
  if (end && typeof end === 'object' && 'id' in end) return String((end as { id: unknown }).id)
  return String(end)
}

/** Binary min-heap of ints ordered by a key array. */
class IntHeap {
  private a: number[] = []
  constructor(private readonly key: Int32Array) {}
  get size(): number {
    return this.a.length
  }
  push(v: number): void {
    const a = this.a
    const k = this.key
    let i = a.length
    a.push(v)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[a[p]] <= k[v]) break
      a[i] = a[p]
      i = p
    }
    a[i] = v
  }
  pop(): number {
    const a = this.a
    const k = this.key
    const top = a[0]
    const last = a.pop() as number
    const len = a.length
    if (len > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= len) break
        const r = l + 1
        const c = r < len && k[a[r]] < k[a[l]] ? r : l
        if (k[a[c]] >= k[last]) break
        a[i] = a[c]
        i = c
      }
      a[i] = last
    }
    return top
  }
}

interface Interval {
  s: number
  e: number
  owner: number
}

/**
 * Track occupancy in rank columns: per track (key 2 * lane for a lane, 2 * r + 1 for the rail
 * between lanes r and r + 1) a list of non-overlapping half-open intervals [s, e), sorted by start.
 */
class Tracks {
  private m = new Map<number, Interval[]>()
  private lastBefore(l: Interval[], e: number): number {
    let lo = 0
    let hi = l.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (l[mid].s < e) lo = mid + 1
      else hi = mid
    }
    return lo - 1
  }
  free(key: number, s: number, e: number): boolean {
    const l = this.m.get(key)
    if (!l || l.length === 0) return true
    const k = this.lastBefore(l, e)
    return k < 0 || l[k].e <= s
  }
  add(key: number, s: number, e: number, owner: number): void {
    let l = this.m.get(key)
    if (!l) {
      l = []
      this.m.set(key, l)
    }
    const k = this.lastBefore(l, s + 1e-9)
    l.splice(k + 1, 0, { s, e, owner })
  }
  /** Owner of the interval that starts last on the track, or -1. */
  lastOwner(key: number): number {
    const l = this.m.get(key)
    return l && l.length > 0 ? l[l.length - 1].owner : -1
  }
  trimLast(key: number, e: number): void {
    const l = this.m.get(key)
    if (l && l.length > 0) l[l.length - 1].e = e
  }
  remove(key: number, owner: number): void {
    const l = this.m.get(key)
    if (!l) return
    const k = l.findIndex((it) => it.owner === owner)
    if (k >= 0) l.splice(k, 1)
  }
  keys(): number[] {
    return [...this.m.keys()].filter((k) => (this.m.get(k) as Interval[]).length > 0)
  }
  clear(): void {
    this.m.clear()
  }
}

interface Chain {
  kind: 'branch' | 'merged' | 'side'
  branch: string | null
  colorBranch: string
  /** Claimed first as the trunk because the default branch is hidden: colour by node owner. */
  spine: boolean
  /** Station indices, oldest first (empty for a side chain). */
  nodes: number[]
  /** First parent of the oldest station (or the side link's parent), -1 if none. */
  baseNode: number
  base: number
  depth: number
  /** Station whose column starts the lane interval, and columns of stub room before it. */
  startNode: number
  startShift: number
  /** Station whose column ends the interval (the newest station, or the merge commit). */
  endNode: number
  start: number
  end: number
  stretched: boolean
  /** Another chain continues on this lane right after this chain's newest station. */
  continued: boolean
  /** This chain continues its base's lane. */
  continues: boolean
  lane: number
  /** Columns kept free after the end before the next line on the lane (0 when continued). */
  reserveGap: number
  key: string
}

interface LaneUser {
  lane: number
  start: number
  startNode: number
  startShift: number
  endNode: number
  reserveGap: number
  order: number
}

// ---------------------------------------------------------------- main

export function metroLayout(graph: Graph, data: RepoData, opts: MetroOptions = {}): MetroLayout {
  const colGap = opts.colGap !== undefined && opts.colGap > 0 ? opts.colGap : 1
  const maxDiag = Math.max(0, opts.maxDiagonalLanes ?? 3)
  const corner = Math.max(0.05, Math.min(opts.corner ?? 0.5, colGap / 2))
  const fanStep = Math.max(0, opts.fan ?? 0.25)
  const fanSpan = 0.5 * colGap
  const reuseGap = Math.max(0, Math.round(opts.reuseGapColumns ?? 0))
  const useRails = opts.rails ?? true
  const prevLanes = opts.prevLanes
  const hintSlack = opts.laneHintSlack ?? 8
  const maxLabelChars = Math.max(4, Math.round(opts.maxLabelChars ?? 30))
  const minLabelChars = Math.max(3, Math.min(maxLabelChars, Math.round(opts.minLabelChars ?? 10)))
  const fontSize = opts.labelFontSize ?? 0.375
  const charWidth = opts.charWidth ?? 0.2125
  const measure = opts.labelWidth ?? ((text: string) => text.length * charWidth)

  const nodes: GraphNode[] = graph.nodes
  const n = nodes.length
  const index = new Map<string, number>()
  for (let i = 0; i < n; i += 1) if (!index.has(nodes[i].id)) index.set(nodes[i].id, i)

  // ---- links, with ends normalised to ids. A child's links come in git parent order.
  const links = graph.links
  const LN = links.length
  const linkC = new Int32Array(LN).fill(-1)
  const linkP = new Int32Array(LN).fill(-1)
  const linkHidden = new Int32Array(LN)
  const linkSrc: string[] = new Array<string>(LN)
  const linkTgt: string[] = new Array<string>(LN)
  const parentLinks: number[][] = Array.from({ length: n }, () => [])
  const childCount = new Int32Array(n)
  for (let k = 0; k < LN; k += 1) {
    const s = endId(links[k].source)
    const t = endId(links[k].target)
    linkSrc[k] = s
    linkTgt[k] = t
    const cc = links[k].collapsedCount
    linkHidden[k] = Number.isFinite(cc) && cc > 0 ? Math.floor(cc) : 0
    const c = index.get(s)
    const p = index.get(t)
    if (c === undefined || p === undefined || c === p) continue
    linkC[k] = c
    linkP[k] = p
    parentLinks[c].push(k)
    childCount[p] += 1
  }

  // ---- 0. skeleton: the collapse.ts rule; a skeleton graph maps onto itself
  const keep = new Uint8Array(n)
  let plainCount = 0
  for (let i = 0; i < n; i += 1) {
    if (isSkeletonNode(nodes[i]) || parentLinks[i].length !== 1 || childCount[i] !== 1) keep[i] = 1
    else plainCount += 1
  }
  const fullMode = plainCount > 0
  const runColumns = opts.runColumns ?? (fullMode ? laneRunColumns : skeletonRunColumns)
  const runRoom = (k: number): number => colGap * Math.max(1, runColumns(k))
  /** Horizontal room a link keeps for its hidden commits (dots or a "+N" marker) beside its lane change. */
  const carrierRoom = (k: number): number => (k > 0 ? Math.max(0, runRoom(k) - colGap) : 0)

  // skeleton links: child station, parent station, hidden commits, the graph links they stand
  // for (child -> parent) and the plain commits in between (child side first)
  const slC: number[] = []
  const slP: number[] = []
  const slK: number[] = []
  const slVia: number[][] = []
  const slPlain: number[][] = []
  const slOrd: number[] = []
  const sParents: number[][] = Array.from({ length: n }, () => [])
  const sChildren: number[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i += 1) {
    if (!keep[i]) continue
    for (const l of parentLinks[i]) {
      let t = linkP[l]
      let hidden = linkHidden[l]
      const via = [l]
      const plain: number[] = []
      let guard = 0
      while (!keep[t] && guard <= n) {
        plain.push(t)
        const next = parentLinks[t][0]
        hidden += 1 + linkHidden[next]
        via.push(next)
        t = linkP[next]
        guard += 1
      }
      if (!keep[t]) continue // a cycle of plain commits: impossible in git history
      const s = slC.length
      slC.push(i)
      slP.push(t)
      slK.push(hidden)
      slVia.push(via)
      slPlain.push(plain)
      slOrd.push(sParents[i].length)
      sParents[i].push(s)
      sChildren[t].push(s)
    }
  }
  const SL = slC.length

  // The git first parent's skeleton link, or -1 when the first parent was never fetched (the
  // commit then starts a line, as in build.ts' ownership pass 1). Only a child's FIRST link can
  // be it, so the second link of a duplicate pair never is.
  const sFirst = new Int32Array(n).fill(-1)
  const stationList: number[] = []
  for (let i = 0; i < n; i += 1) {
    if (!keep[i]) continue
    stationList.push(i)
    const gp = nodes[i].commit.parents
    if (sParents[i].length > 0 && gp.length > 0 && Object.hasOwn(data.commits, gp[0])) sFirst[i] = sParents[i][0]
  }
  const fpOf = (i: number): number => (sFirst[i] >= 0 ? slP[sFirst[i]] : -1)

  // ---- 1. topological order of stations, parents first, ties by (date, sha)
  const byDate = stationList
    .slice()
    .sort((a, b) => cmp(nodes[a].commit.date, nodes[b].commit.date) || cmp(nodes[a].id, nodes[b].id) || a - b)
  const dateRank = new Int32Array(n)
  for (let r = 0; r < byDate.length; r += 1) dateRank[byDate[r]] = r
  const pending = new Int32Array(n)
  const heap = new IntHeap(dateRank)
  for (const i of stationList) {
    pending[i] = sParents[i].length
    if (pending[i] === 0) heap.push(i)
  }
  const topo: number[] = []
  while (heap.size > 0) {
    const i = heap.pop()
    topo.push(i)
    for (const s of sChildren[i]) {
      const c = slC[s]
      pending[c] -= 1
      if (pending[c] === 0) heap.push(c)
    }
  }
  if (topo.length < stationList.length) {
    // git cannot produce a cycle, but never drop a node: append the rest in date order
    const seen = new Uint8Array(n)
    for (const i of topo) seen[i] = 1
    for (const i of byDate) if (!seen[i]) topo.push(i)
  }
  const topoPos = new Int32Array(n).fill(-1)
  for (let k = 0; k < topo.length; k += 1) topoPos[topo[k]] = k

  // ---- 2. chains
  const branchInfo = new Map(data.branches.map((b) => [b.name, b] as const))
  const isDefault = (name: string): boolean => name === data.defaultBranch || branchInfo.get(name)?.isDefault === true
  const tipNode = new Map<string, number>()
  for (const i of stationList) for (const name of nodes[i].tips) if (!tipNode.has(name)) tipNode.set(name, i)
  const claimOrder = [...tipNode.keys()].sort((a, b) => {
    const da = isDefault(a) ? 0 : 1
    const db = isDefault(b) ? 0 : 1
    if (da !== db) return da - db
    return (branchInfo.get(a)?.aheadBy ?? 0) - (branchInfo.get(b)?.aheadBy ?? 0) || cmp(a, b)
  })
  const claimRank = new Map(claimOrder.map((name, k) => [name, k] as const))

  const chainOf = new Int32Array(n).fill(-1)
  const chains: Chain[] = []
  const hasStub = (i: number): boolean =>
    nodes[i].isRoot && nodes[i].commit.parents.length > 0 && sParents[i].length === 0
  const claim = (from: number, kind: 'branch' | 'merged', branch: string | null, color: string, spine: boolean): void => {
    const id = chains.length
    const run: number[] = []
    let cur = from
    while (cur >= 0 && chainOf[cur] < 0) {
      chainOf[cur] = id
      run.push(cur)
      cur = fpOf(cur)
    }
    run.reverse()
    const oldest = run[0]
    const newest = run[run.length - 1]
    const baseNode = fpOf(oldest)
    chains.push({
      kind,
      branch,
      colorBranch: color,
      spine,
      nodes: run,
      baseNode,
      base: -1,
      depth: 0,
      startNode: baseNode >= 0 ? baseNode : oldest,
      startShift: baseNode < 0 && hasStub(oldest) ? 1 : 0,
      endNode: newest,
      start: 0,
      end: 0,
      stretched: false,
      continued: false,
      continues: false,
      lane: 0,
      reserveGap: 1 + reuseGap,
      key: branch ?? `~m:${nodes[newest].id}`,
    })
  }

  // Spine: with the default branch hidden, the tip whose first-parent history carries most of the
  // hidden default branch's own first-parent line becomes the trunk, whoever owns its commits, so
  // the old trunk stays on one line. Ties (or no known default tip): the longest first-parent
  // history, then the newest tip, then the name. Counted in commits, so both views agree.
  let spineName: string | null = null
  if (tipNode.size > 0 && !claimOrder.some(isDefault)) {
    const oldTrunk = new Set<string>()
    {
      const tipSha = data.branches.find((b) => isDefault(b.name))?.tipSha
      let sha = tipSha !== undefined && Object.hasOwn(data.commits, tipSha) ? tipSha : undefined
      while (sha !== undefined && !oldTrunk.has(sha)) {
        oldTrunk.add(sha)
        const parent: string | undefined = data.commits[sha].parents[0]
        sha = parent !== undefined && Object.hasOwn(data.commits, parent) ? parent : undefined
      }
    }
    const fpLen = new Float64Array(n) // commits on the first-parent history; 0 = not computed
    const fpOld = new Float64Array(n) // of which on the old trunk
    const stack: number[] = []
    for (const tip of tipNode.values()) {
      let cur = tip
      while (cur >= 0 && fpLen[cur] === 0) {
        stack.push(cur)
        cur = fpOf(cur)
      }
      while (stack.length > 0) {
        const i = stack.pop() as number
        const s = sFirst[i]
        const p = s >= 0 ? slP[s] : -1
        const onOld = oldTrunk.has(nodes[i].id)
        fpLen[i] = 1 + (s >= 0 ? slK[s] + fpLen[p] : 0)
        fpOld[i] = (onOld ? 1 : 0) + (s >= 0 ? (onOld && oldTrunk.has(nodes[p].id) ? slK[s] : 0) + fpOld[p] : 0)
      }
    }
    for (const name of [...tipNode.keys()].sort(cmp)) {
      const i = tipNode.get(name) as number
      if (spineName === null) {
        spineName = name
        continue
      }
      const b = tipNode.get(spineName) as number
      if (
        fpOld[i] > fpOld[b] ||
        (fpOld[i] === fpOld[b] && (fpLen[i] > fpLen[b] || (fpLen[i] === fpLen[b] && topoPos[i] > topoPos[b])))
      )
        spineName = name
    }
    const tip = tipNode.get(spineName as string) as number
    claim(tip, 'branch', spineName, spineName as string, true)
  }
  for (const name of claimOrder) {
    const tip = tipNode.get(name) as number
    if (chainOf[tip] < 0) claim(tip, 'branch', name, name, false) // else: a stale tip on another line
  }
  for (let k = topo.length - 1; k >= 0; k -= 1) {
    const i = topo[k]
    if (chainOf[i] < 0) claim(i, 'merged', null, nodes[i].owner, false)
  }
  // side chains: a non-first-parent link that hides commits is a deleted merged branch
  const slSide = new Int32Array(SL).fill(-1)
  for (let s = 0; s < SL; s += 1) {
    if (slK[s] === 0 || sFirst[slC[s]] === s) continue
    slSide[s] = chains.length
    chains.push({
      kind: 'side',
      branch: null,
      colorBranch: nodes[slC[s]].owner,
      spine: false,
      nodes: [],
      baseNode: slP[s],
      base: -1,
      depth: 0,
      startNode: slP[s],
      startShift: 0,
      endNode: slC[s],
      start: 0,
      end: 0,
      stretched: false,
      continued: false,
      continues: false,
      lane: 0,
      reserveGap: 1 + reuseGap,
      key: `~s:${nodes[slC[s]].id}>${nodes[slP[s]].id}#${slOrd[s]}`,
    })
  }
  for (const ch of chains) if (ch.baseNode >= 0) ch.base = chainOf[ch.baseNode]
  {
    // depth: following bases strictly goes back in time, so this terminates
    const done = new Uint8Array(chains.length)
    for (let id = 0; id < chains.length; id += 1) {
      const path: number[] = []
      let cur = id
      while (cur >= 0 && !done[cur]) {
        done[cur] = 1
        path.push(cur)
        cur = chains[cur].base
      }
      let d = cur >= 0 ? chains[cur].depth : -1
      for (let k = path.length - 1; k >= 0; k -= 1) {
        d += 1
        chains[path[k]].depth = d
      }
    }
  }
  const trunk = chains.length > 0 ? 0 : -1
  const newestOf = (ch: Chain): number => ch.nodes[ch.nodes.length - 1]
  /** Colour of a chain's line at station i: the spine follows the app's per-commit ownership. */
  const colorAt = (chainId: number, i: number): string =>
    chains[chainId].spine ? nodes[i].owner || chains[chainId].colorBranch : chains[chainId].colorBranch

  // ---- 3. link kinds
  const slKind: MetroRouteKind[] = new Array<MetroRouteKind>(SL)
  for (let s = 0; s < SL; s += 1) {
    if (slSide[s] >= 0) {
      slKind[s] = 'side'
      continue
    }
    const c = slC[s]
    const p = slP[s]
    const cc = chainOf[c]
    const pc = chainOf[p]
    const isFirst = sFirst[c] === s
    if (cc === pc) slKind[s] = isFirst ? 'line' : 'cross'
    else if (isFirst) slKind[s] = 'fork'
    else if (newestOf(chains[pc]) === p) slKind[s] = 'merge'
    // a line whose first commit lost its first parent (truncated) starts from its other parents
    else if (chains[cc].nodes[0] === c && sFirst[c] < 0) slKind[s] = 'fork'
    else slKind[s] = 'cross'
  }

  // ---- 4a. rank columns (mode independent: every view of the same data gets the same lanes)
  const laneCol = new Int32Array(n)
  {
    let current = 0
    for (const i of topo) {
      let c = current
      for (const s of sParents[i]) {
        const len = slSide[s] >= 0 ? Math.max(3, laneRunColumns(slK[s])) : laneRunColumns(slK[s])
        if (laneCol[slP[s]] + len > c) c = laneCol[slP[s]] + len
      }
      laneCol[i] = c
      current = c
    }
  }
  for (const ch of chains) {
    ch.start = laneCol[ch.startNode] - ch.startShift
    ch.end = laneCol[ch.endNode]
  }
  for (let s = 0; s < SL; s += 1) {
    const c = slC[s]
    const p = slP[s]
    if (slKind[s] === 'merge') {
      const pc = chains[chainOf[p]]
      if (laneCol[c] > pc.end) {
        pc.end = laneCol[c]
        pc.endNode = c
        pc.stretched = true
      }
    } else if (slKind[s] === 'fork' && sFirst[c] !== s) {
      const cc = chains[chainOf[c]]
      if (laneCol[p] < cc.start) {
        cc.start = laneCol[p]
        cc.startNode = p
        cc.startShift = 0
      }
    }
  }

  // ---- 4b. lanes: interval colouring in start order
  const tracks = new Tracks()
  const sideLoad = { pos: 0, neg: 0 }
  let minLane = 0
  let maxLane = 0
  const occupy = (lane: number, s: number, e: number, owner: number): void => {
    tracks.add(2 * lane, s, e, owner)
    if (lane > 0) sideLoad.pos += e - s
    else if (lane < 0) sideLoad.neg += e - s
    if (lane < minLane) minLane = lane
    if (lane > maxLane) maxLane = lane
  }
  /**
   * Free lane with the least weighted distance to the already placed lanes it links to, then
   * nearest the trunk, then on the lighter side.
   */
  const pickLane = (anchors: ReadonlyArray<readonly [number, number]>, s: number, e: number): number => {
    let best = 0
    let k0 = 0
    let k1 = 0
    let k2 = 0
    let found = false
    for (let cand = minLane - 1; cand <= maxLane + 1; cand += 1) {
      if (cand === 0 || !tracks.free(2 * cand, s, e)) continue
      const load = cand > 0 ? sideLoad.pos : sideLoad.neg
      const other = cand > 0 ? sideLoad.neg : sideLoad.pos
      let a0 = 0
      for (const [lane, w] of anchors) a0 += w * Math.abs(cand - lane)
      const a1 = Math.abs(cand)
      const a2 = load < other ? 0 : load > other ? 2 : cand > 0 ? 0 : 1
      if (!found || a0 < k0 || (a0 === k0 && (a1 < k1 || (a1 === k1 && a2 < k2)))) {
        found = true
        best = cand
        k0 = a0
        k1 = a1
        k2 = a2
      }
    }
    return best
  }
  const hintFor = (key: string): number | undefined => {
    const h = prevLanes?.get(key)
    return h !== undefined && Number.isInteger(h) && h !== 0 ? h : undefined
  }

  // chains linked to each chain, with weights: the fork base counts most
  const linked: Array<Map<number, number>> = chains.map(() => new Map<number, number>())
  const link2 = (a: number, b: number, w: number): void => {
    if (a === b) return
    linked[a].set(b, (linked[a].get(b) ?? 0) + w)
  }
  for (let s = 0; s < SL; s += 1) {
    const cc = chainOf[slC[s]]
    const pc = chainOf[slP[s]]
    const side = slSide[s]
    if (side >= 0) {
      link2(side, pc, 3)
      link2(side, cc, 1)
      link2(pc, side, 1)
      link2(cc, side, 1)
      continue
    }
    if (cc === pc) continue
    link2(cc, pc, chains[cc].baseNode === slP[s] ? 3 : 1)
    link2(pc, cc, 1)
  }
  const placed = new Uint8Array(chains.length)
  const chainOrder = chains
    .map((_, id) => id)
    .sort((a, b) => {
      if ((a === trunk) !== (b === trunk)) return a === trunk ? -1 : 1
      const ca = chains[a]
      const cb = chains[b]
      return ca.start - cb.start || ca.depth - cb.depth || cb.end - cb.start - (ca.end - ca.start) || a - b
    })
  /** Continuation: forked off the base's newest station, and the base's lane ends right there. */
  const tryContinue = (id: number): boolean => {
    const ch = chains[id]
    if (ch.base < 0 || !placed[ch.base]) return false
    const base = chains[ch.base]
    const reserveEnd = ch.end + ch.reserveGap
    if (
      base.lane === 0 ||
      base.kind === 'side' ||
      newestOf(base) !== ch.baseNode ||
      base.stretched ||
      base.continued ||
      tracks.lastOwner(2 * base.lane) !== ch.base ||
      !tracks.free(2 * base.lane, base.end + base.reserveGap, reserveEnd)
    )
      return false
    tracks.trimLast(2 * base.lane, ch.start)
    base.continued = true
    base.reserveGap = 0
    ch.continues = true
    ch.lane = base.lane
    occupy(ch.lane, ch.start, reserveEnd, id)
    placed[id] = 1
    return true
  }
  if (trunk >= 0) {
    placed[trunk] = 1
    chains[trunk].lane = 0
    tracks.add(0, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, trunk)
  }
  // With hints, every line whose previous lane is still free takes it first, so one line that has
  // to move cannot push the next one off its lane, and that one the next, and so on.
  if (prevLanes) {
    for (const id of chainOrder) {
      if (id === trunk || tryContinue(id)) continue
      const ch = chains[id]
      const hint = hintFor(ch.key)
      if (hint === undefined || !tracks.free(2 * hint, ch.start, ch.end + ch.reserveGap)) continue
      ch.lane = hint
      occupy(hint, ch.start, ch.end + ch.reserveGap, id)
      placed[id] = 1
    }
  }
  for (const id of chainOrder) {
    if (placed[id] || tryContinue(id)) continue
    const ch = chains[id]
    const anchors: Array<[number, number]> = []
    for (const [other, w] of linked[id]) if (placed[other]) anchors.push([chains[other].lane, w])
    ch.lane = pickLane(anchors, ch.start, ch.end + ch.reserveGap)
    occupy(ch.lane, ch.start, ch.end + ch.reserveGap, id)
    placed[id] = 1
  }

  // ---- 4c. refinement: a chain placed before the lines it links to (a merged root, say) may sit
  // far from them. Re-seat each chain on the free lane with the least symmetric weighted distance
  // to every line it links to; only strict improvements move, so the rounds converge.
  {
    const sym: Array<Map<number, number>> = chains.map(() => new Map<number, number>())
    for (let a = 0; a < chains.length; a += 1)
      for (const [b, w] of linked[a]) {
        sym[a].set(b, (sym[a].get(b) ?? 0) + w)
        sym[b].set(a, (sym[b].get(a) ?? 0) + w)
      }
    for (let round = 0; round < 3; round += 1) {
      let moved = false
      for (const id of chainOrder) {
        if (id === trunk || chains[id].continued || chains[id].continues) continue
        const ch = chains[id]
        if (sym[id].size === 0) continue
        const hint = hintFor(ch.key)
        const cost = (lane: number): number => {
          let c = 0
          for (const [o, w] of sym[id]) c += w * Math.abs(lane - chains[o].lane)
          if (hint !== undefined && lane !== hint) c += hintSlack + 1e-6
          return c
        }
        const e = ch.end + ch.reserveGap
        tracks.remove(2 * ch.lane, id)
        let best = ch.lane
        let bestCost = cost(ch.lane)
        for (let cand = minLane - 1; cand <= maxLane + 1; cand += 1) {
          if (cand === 0 || cand === ch.lane || !tracks.free(2 * cand, ch.start, e)) continue
          const c = cost(cand)
          if (c < bestCost - 1e-9) {
            bestCost = c
            best = cand
          }
        }
        if (best !== ch.lane) moved = true
        ch.lane = best
        tracks.add(2 * best, ch.start, e, id)
        if (best < minLane) minLane = best
        if (best > maxLane) maxLane = best
      }
      if (!moved) break
    }
    // Close lanes emptied by the moves (not when following hints: there a gap keeps the
    // neighbours where the viewer last saw them), then rebuild the occupancy.
    const used = new Set<number>([0])
    for (const ch of chains) used.add(ch.lane)
    const remap = new Map<number, number>([[0, 0]])
    if (prevLanes) for (const l of used) remap.set(l, l)
    else {
      ;[...used].filter((l) => l < 0).sort((a, b) => b - a).forEach((l, k) => remap.set(l, -(k + 1)))
      ;[...used].filter((l) => l > 0).sort((a, b) => a - b).forEach((l, k) => remap.set(l, k + 1))
    }
    for (const ch of chains) ch.lane = remap.get(ch.lane) as number
    tracks.clear()
    sideLoad.pos = 0
    sideLoad.neg = 0
    minLane = 0
    maxLane = 0
    for (let id = 0; id < chains.length; id += 1) {
      const ch = chains[id]
      if (id === trunk) tracks.add(0, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, id)
      else occupy(ch.lane, ch.start, ch.end + ch.reserveGap, id)
    }
  }
  const laneOf = (i: number): number => (chainOf[i] >= 0 ? chains[chainOf[i]].lane : 0)

  // ---- 4d. cross links. When one end's line has no station (and no hidden commits) between the
  // two ends, the link rides that line and only its lane change shows: along the parent's line,
  // then into the child ("ride parent"), or out of the parent, then along the child's line ("ride
  // child"). Otherwise it takes a free rail between (or beside) its lanes, else a lane of its own.
  // Rails are reserved in walk order, so two links can share a rail exactly when the first one
  // reaches its child before the second leaves its parent.
  const slTrack = new Float64Array(SL) // lane, or n + 0.5 for a rail; for side links the side lane
  const crossLinks: number[] = [] // cross links that need a rail or a lane of their own
  const nextOnChain = new Int32Array(n).fill(-1)
  const prevOnChain = new Int32Array(n).fill(-1)
  for (const ch of chains)
    for (let k = 0; k + 1 < ch.nodes.length; k += 1) {
      nextOnChain[ch.nodes[k]] = ch.nodes[k + 1]
      prevOnChain[ch.nodes[k + 1]] = ch.nodes[k]
    }
  for (let s = 0; s < SL; s += 1) {
    if (slSide[s] >= 0) slTrack[s] = chains[slSide[s]].lane
    if (slKind[s] !== 'cross') continue
    const p = slP[s]
    const c = slC[s]
    const lp = laneOf(p)
    const lc = laneOf(c)
    if (lp !== lc && chainOf[p] !== chainOf[c]) {
      const q = nextOnChain[p]
      const r = prevOnChain[c]
      if (q >= 0 && topoPos[q] > topoPos[c] && sFirst[q] >= 0 && slK[sFirst[q]] === 0) {
        slTrack[s] = lp // ride the parent's line
        continue
      }
      if (r >= 0 && topoPos[r] < topoPos[p] && sFirst[c] >= 0 && slK[sFirst[c]] === 0) {
        slTrack[s] = lc // ride the child's line
        continue
      }
    }
    crossLinks.push(s)
  }
  crossLinks.sort((a, b) => topoPos[slP[a]] - topoPos[slP[b]] || topoPos[slC[a]] - topoPos[slC[b]] || a - b)
  const users: LaneUser[] = []
  for (const s of crossLinks) {
    const a = laneOf(slP[s])
    const b = laneOf(slC[s])
    const start = laneCol[slP[s]]
    const end = laneCol[slC[s]]
    const ts = topoPos[slP[s]]
    const te = topoPos[slC[s]]
    let done = false
    if (useRails) {
      const rails: number[] = []
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      if (lo !== hi) {
        const between: number[] = []
        for (let r = lo; r < hi; r += 1) between.push(r)
        between.sort((r1, r2) => Math.abs(r1 + 0.5 - a) - Math.abs(r2 + 0.5 - a) || r1 - r2)
        rails.push(...between, lo - 1, hi)
      } else {
        // same lane: the rail on the outer side first (away from the trunk)
        const outer = a > 0 ? a : a < 0 ? a - 1 : sideLoad.pos <= sideLoad.neg ? 0 : -1
        rails.push(outer, outer === a ? a - 1 : a)
      }
      for (const r of rails) {
        if (tracks.free(2 * r + 1, ts, te)) {
          tracks.add(2 * r + 1, ts, te, chains.length + s)
          slTrack[s] = r + 0.5
          done = true
          break
        }
      }
    }
    if (!done) {
      const lane = pickLane([[a, 1], [b, 1]], start, end + 1 + reuseGap)
      occupy(lane, start, end + 1 + reuseGap, chains.length + s)
      slTrack[s] = lane
      users.push({ lane, start, startNode: slP[s], startShift: 0, endNode: slC[s], reserveGap: 1 + reuseGap, order: chains.length + s })
    }
  }

  // ---- 5a. final columns: the same walk; a lane's next user starts after its previous user
  for (let id = 0; id < chains.length; id += 1) {
    if (id === trunk) continue
    const ch = chains[id]
    users.push({ lane: ch.lane, start: ch.start, startNode: ch.startNode, startShift: ch.startShift, endNode: ch.endNode, reserveGap: ch.reserveGap, order: id })
  }
  const anchored = new Map<number, Array<[number, number]>>() // start station -> [prev end station, min columns]
  {
    const byLane = new Map<number, LaneUser[]>()
    for (const u of users) {
      const list = byLane.get(u.lane)
      if (list) list.push(u)
      else byLane.set(u.lane, [u])
    }
    for (const list of byLane.values()) {
      list.sort((a, b) => a.start - b.start || a.order - b.order)
      for (let k = 1; k < list.length; k += 1) {
        const prev = list[k - 1]
        const u = list[k]
        const d = prev.reserveGap + u.startShift
        if (prev.endNode === u.startNode && d === 0) continue
        const arr = anchored.get(u.startNode)
        if (arr) arr.push([prev.endNode, d])
        else anchored.set(u.startNode, [[prev.endNode, d]])
      }
    }
  }
  const col = new Int32Array(n)
  const colDone = new Uint8Array(n)
  let columns = 0
  {
    let current = 0
    for (const i of topo) {
      let c = current
      for (const s of sParents[i]) if (col[slP[s]] + 1 > c) c = col[slP[s]] + 1
      for (const [e, d] of anchored.get(i) ?? []) if (e !== i && colDone[e] && col[e] + d > c) c = col[e] + d
      col[i] = c
      colDone[i] = 1
      current = c
    }
    columns = topo.length > 0 ? current + 1 : 0
  }

  // ---- 5b. lane-change geometry plan: fans and lengths
  const dyOut = new Float64Array(SL) // lane change at the parent
  const dyIn = new Float64Array(SL) // lane change at the child
  for (let s = 0; s < SL; s += 1) {
    const lp = laneOf(slP[s])
    const lc = laneOf(slC[s])
    const kd = slKind[s]
    if (kd === 'fork') dyOut[s] = lc - lp
    else if (kd === 'merge') dyIn[s] = lc - lp
    else if (kd === 'side' || kd === 'cross') {
      dyOut[s] = slTrack[s] - lp
      dyIn[s] = lc - slTrack[s]
    }
  }
  const fanOut = new Float64Array(SL)
  const fanIn = new Float64Array(SL)
  {
    const groups = new Map<string, number[]>()
    const add = (key: string, s: number): void => {
      const g = groups.get(key)
      if (g) g.push(s)
      else groups.set(key, [s])
    }
    for (let s = 0; s < SL; s += 1) {
      if (Math.abs(dyOut[s]) > EPS) add(`o${slP[s]}${dyOut[s] > 0 ? '+' : '-'}`, s)
      if (Math.abs(dyIn[s]) > EPS) add(`i${slC[s]}${dyIn[s] > 0 ? '+' : '-'}`, s)
    }
    for (const [key, list] of groups) {
      if (list.length < 2) continue
      const out = key[0] === 'o'
      const dy = out ? dyOut : dyIn
      list.sort((a, b) => Math.abs(dy[b]) - Math.abs(dy[a]) || a - b) // farthest first
      const step = Math.min(fanStep, fanSpan / (list.length - 1))
      list.forEach((s, k) => {
        if (out) fanOut[s] = k * step
        else fanIn[s] = k * step
      })
    }
  }
  /** Planned x length of a lane change: a diagonal up to maxDiag lanes, else a chamfered drop. */
  const planLen = (d: number): number => (d < EPS ? 0 : d <= maxDiag + EPS ? d : 2 * Math.min(corner, d / 2))

  // ---- 5c. X positions
  const needsAt: Array<Array<[number, number]>> = Array.from({ length: columns }, () => [])
  for (let s = 0; s < SL; s += 1) {
    const k = slK[s]
    const kd = slKind[s]
    let need = runRoom(k)
    if (kd === 'fork' && Math.abs(dyOut[s]) > EPS) {
      need = Math.max(need, fanOut[s] + planLen(Math.abs(dyOut[s])) + carrierRoom(k))
    } else if (kd === 'merge' && Math.abs(dyIn[s]) > EPS) {
      need = Math.max(need, fanIn[s] + planLen(Math.abs(dyIn[s])) + carrierRoom(k))
    } else if (kd === 'side') {
      const mid = Math.max(carrierRoom(k), 0.5 * colGap)
      need = Math.max(need, fanOut[s] + planLen(Math.abs(dyOut[s])) + mid + planLen(Math.abs(dyIn[s])) + fanIn[s])
    } else if (kd === 'cross') {
      need = Math.max(colGap, fanOut[s] + planLen(Math.abs(dyOut[s])) + planLen(Math.abs(dyIn[s])) + fanIn[s])
    }
    needsAt[col[slC[s]]].push([col[slP[s]], need])
  }
  const X = new Float64Array(columns)
  for (let t = 0; t < columns; t += 1) {
    let x = t === 0 ? 0 : X[t - 1] + colGap
    for (const [a, need] of needsAt[t]) if (X[a] + need > x) x = X[a] + need
    X[t] = x
  }

  // ---- positions of stations
  const px = new Float64Array(n)
  const py = new Float64Array(n)
  const hasPos = new Uint8Array(n)
  for (const i of stationList) {
    px[i] = X[col[i]]
    py[i] = laneOf(i)
    hasPos[i] = 1
  }
  // stations per lane, sorted by x, for "does this segment run through a station" checks
  const laneStations = new Map<number, number[]>()
  for (const i of stationList) {
    const list = laneStations.get(py[i])
    if (list) list.push(i)
    else laneStations.set(py[i], [i])
  }
  for (const list of laneStations.values()) list.sort((a, b) => px[a] - px[b] || a - b)
  const firstAtOrAfter = (list: number[], x: number): number => {
    let lo = 0
    let hi = list.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (px[list[mid]] < x) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  /** Any station other than skipA/skipB within tol of x on lane y? */
  const stationNear = (y: number, x: number, tol: number, skipA: number, skipB: number): boolean => {
    const list = laneStations.get(y)
    if (!list) return false
    for (let k = firstAtOrAfter(list, x - tol); k < list.length && px[list[k]] < x + tol; k += 1) {
      const i = list[k]
      if (i !== skipA && i !== skipB) return true
    }
    return false
  }
  const segmentHits = (a: MetroPoint, b: MetroPoint, skipA: number, skipB: number): boolean => {
    if (Math.abs(a.y - b.y) < EPS) {
      if (!Number.isInteger(a.y) || Math.abs(b.x - a.x) < EPS) return false
      const lo = Math.min(a.x, b.x)
      const hi = Math.max(a.x, b.x)
      return stationNear(a.y, (lo + hi) / 2, (hi - lo) / 2 + 0.15, skipA, skipB)
    }
    const vertical = Math.abs(a.x - b.x) < EPS
    const tol = vertical ? 0.2 : 0.25
    const lo = Math.min(a.y, b.y)
    const hi = Math.max(a.y, b.y)
    for (let lane = Math.ceil(lo - EPS); lane <= hi + EPS; lane += 1) {
      const x = a.x + ((lane - a.y) / (b.y - a.y)) * (b.x - a.x)
      if (stationNear(lane, x, tol, skipA, skipB)) return true
    }
    return false
  }
  const polyHits = (pts: MetroPoint[], skipA: number, skipB: number): boolean => {
    for (let k = 0; k + 1 < pts.length; k += 1) if (segmentHits(pts[k], pts[k + 1], skipA, skipB)) return true
    return false
  }

  // ---- 6. routes (one per skeleton link)
  /**
   * Lane change from (x0, y0) to y1 heading right, ending at or before xEnd: the polyline from
   * (x0, y0) to the point where it reaches y1. Prefers a single diagonal, then a chamfered drop,
   * then either shifted right a little, whichever runs through no station.
   */
  const leave = (x0: number, y0: number, y1: number, xEnd: number, skipA: number, skipB: number): MetroPoint[] => {
    const d = Math.abs(y1 - y0)
    if (d < EPS) return [{ x: x0, y: y0 }]
    const sg = Math.sign(y1 - y0)
    const c = Math.min(corner, d / 2)
    const diag = (x: number): MetroPoint[] => [{ x: x0, y: y0 }, { x, y: y0 }, { x: x + d, y: y1 }]
    const drop = (x: number): MetroPoint[] => [
      { x: x0, y: y0 },
      { x, y: y0 },
      { x: x + c, y: y0 + sg * c },
      { x: x + c, y: y1 - sg * c },
      { x: x + 2 * c, y: y1 },
    ]
    const cands: MetroPoint[][] = []
    for (const shift of [0, 0.25, 0.5, 0.75]) {
      const x = x0 + shift * colGap
      if (x + d <= xEnd + 1e-6) cands.push(diag(x))
      if (x + 2 * c <= xEnd + 1e-6) cands.push(drop(x))
    }
    for (const pts of cands) if (!polyHits(pts, skipA, skipB)) return pts
    if (cands.length > 0) return cands[0]
    const cc = Math.max(0, Math.min(c, (xEnd - x0) / 2))
    return [{ x: x0, y: y0 }, { x: x0 + cc, y: y0 + sg * cc }, { x: x0 + cc, y: y1 - sg * cc }, { x: x0 + 2 * cc, y: y1 }]
  }
  /** Mirror of leave: lane change from y0 arriving at (x1, y1), starting at or after xStart. */
  const arrive = (x1: number, y0: number, y1: number, xStart: number, skipA: number, skipB: number): MetroPoint[] => {
    const d = Math.abs(y1 - y0)
    if (d < EPS) return [{ x: x1, y: y1 }]
    const sg = Math.sign(y1 - y0)
    const c = Math.min(corner, d / 2)
    const diag = (x: number): MetroPoint[] => [{ x: x - d, y: y0 }, { x, y: y1 }, { x: x1, y: y1 }]
    const drop = (x: number): MetroPoint[] => [
      { x: x - 2 * c, y: y0 },
      { x: x - c, y: y0 + sg * c },
      { x: x - c, y: y1 - sg * c },
      { x, y: y1 },
      { x: x1, y: y1 },
    ]
    const cands: MetroPoint[][] = []
    for (const shift of [0, 0.25, 0.5, 0.75]) {
      const x = x1 - shift * colGap
      if (x - d >= xStart - 1e-6) cands.push(diag(x))
      if (x - 2 * c >= xStart - 1e-6) cands.push(drop(x))
    }
    for (const pts of cands) if (!polyHits(pts, skipA, skipB)) return pts
    if (cands.length > 0) return cands[0]
    const cc = Math.max(0, Math.min(c, (x1 - xStart) / 2))
    return [{ x: x1 - 2 * cc, y: y0 }, { x: x1 - cc, y: y0 + sg * cc }, { x: x1 - cc, y: y1 - sg * cc }, { x: x1, y: y1 }]
  }
  const simplify = (pts: MetroPoint[]): MetroPoint[] => {
    const out: MetroPoint[] = []
    for (const q of pts) {
      const last = out[out.length - 1]
      if (last && Math.abs(last.x - q.x) < 1e-7 && Math.abs(last.y - q.y) < 1e-7) continue
      if (out.length >= 2) {
        const a = out[out.length - 2]
        const b = out[out.length - 1]
        const cross = (b.x - a.x) * (q.y - b.y) - (b.y - a.y) * (q.x - b.x)
        const dot = (b.x - a.x) * (q.x - b.x) + (b.y - a.y) * (q.y - b.y)
        if (Math.abs(cross) < 1e-7 && dot > 0) {
          out[out.length - 1] = q
          continue
        }
      }
      out.push(q)
    }
    return out
  }

  const slPts: MetroPoint[][] = new Array<MetroPoint[]>(SL)
  const slCarrier = new Int32Array(SL).fill(-1) // index of the horizontal segment holding the run
  const slOutKind: MetroRouteKind[] = new Array<MetroRouteKind>(SL)
  const interchange = new Uint8Array(n)
  for (let s = 0; s < SL; s += 1) {
    const c = slC[s]
    const p = slP[s]
    const P: MetroPoint = { x: px[p], y: py[p] }
    const C: MetroPoint = { x: px[c], y: py[c] }
    const k = slK[s]
    let kd = slKind[s]
    let pts: MetroPoint[]
    if ((kd === 'fork' && Math.abs(dyOut[s]) < EPS) || (kd === 'merge' && Math.abs(dyIn[s]) < EPS) || kd === 'line') {
      kd = 'line'
      pts = [P, C]
    } else if (kd === 'fork') {
      pts = simplify([P, ...leave(P.x + fanOut[s], P.y, C.y, C.x - carrierRoom(k), p, c), C])
    } else if (kd === 'merge') {
      pts = simplify([P, ...arrive(C.x - fanIn[s], P.y, C.y, P.x + carrierRoom(k), p, c), C])
    } else {
      const ty = slTrack[s]
      const mid = kd === 'side' ? Math.max(carrierRoom(k), 0.5 * colGap) : 0
      const xEndOut = C.x - fanIn[s] - planLen(Math.abs(dyIn[s])) - mid
      const out = leave(P.x + fanOut[s], P.y, ty, xEndOut, p, c)
      const outEnd = out[out.length - 1].x
      const inn = arrive(C.x - fanIn[s], ty, C.y, outEnd + mid, p, c)
      pts = simplify([P, ...out, ...inn, C])
    }
    slPts[s] = pts
    slOutKind[s] = kd
    // interchanges: where a line changes lanes (a fork at its parent, a merge at its child)
    if (kd === 'fork' || ((kd === 'side' || kd === 'cross') && Math.abs(dyOut[s]) > EPS)) interchange[p] = 1
    if (kd === 'merge' || ((kd === 'side' || kd === 'cross') && Math.abs(dyIn[s]) > EPS)) interchange[c] = 1
    // carrier: the horizontal segment on the line's own track
    const carrierY = kd === 'fork' ? C.y : kd === 'merge' ? P.y : kd === 'line' ? P.y : slTrack[s]
    let best = -1
    let bestLen = -1
    for (let j = 0; j + 1 < pts.length; j += 1) {
      if (Math.abs(pts[j].y - carrierY) > EPS || Math.abs(pts[j + 1].y - carrierY) > EPS) continue
      const len = pts[j + 1].x - pts[j].x
      if (len > bestLen + EPS) {
        bestLen = len
        best = j
      }
    }
    if (best < 0 && slPlain[s].length > 0) {
      // no horizontal on its own track (a custom runColumns left no room): the longest segment
      for (let j = 0; j + 1 < pts.length; j += 1) {
        const len = Math.hypot(pts[j + 1].x - pts[j].x, pts[j + 1].y - pts[j].y)
        if (len > bestLen + EPS) {
          bestLen = len
          best = j
        }
      }
    }
    slCarrier[s] = best
  }

  // ---- 7. full view: thread the plain commits onto their carriers, avoiding other routes
  const stationKind = new Map<string, MetroStationKind>()
  const routeOf: Array<MetroRoute | undefined> = new Array<MetroRoute | undefined>(LN)
  /** The station whose line a link is drawn as: the child's for lines and forks, else the parent's. */
  const slOwnerNode = (s: number): number => (slOutKind[s] === 'line' || slOutKind[s] === 'fork' ? slC[s] : slP[s])
  const slColor = (s: number): string => {
    if (slSide[s] >= 0) return chains[slSide[s]].colorBranch
    const i = slOwnerNode(s)
    return colorAt(chainOf[i], i)
  }
  const slMuted = (s: number): boolean => slSide[s] >= 0 || chains[chainOf[slOwnerNode(s)]].kind === 'merged'
  // Spots on each lane where other routes run or cross: plain commits keep clear of them. A
  // link's own carrier is not a block (no other link's carrier can overlap it: lanes are
  // reserved), so blocks are short, sorted by start and scanned from a binary search.
  const blockLo = new Map<number, number[]>()
  const blockHi = new Map<number, number[]>()
  const blockOwner = new Map<number, number[]>()
  const blockMaxLen = new Map<number, number>()
  if (fullMode) {
    const raw = new Map<number, Array<[number, number, number]>>()
    const block = (lane: number, lo: number, hi: number, s: number): void => {
      const list = raw.get(lane)
      if (list) list.push([lo, hi, s])
      else raw.set(lane, [[lo, hi, s]])
    }
    for (let s = 0; s < SL; s += 1) {
      const pts = slPts[s]
      for (let j = 0; j + 1 < pts.length; j += 1) {
        const a = pts[j]
        const b = pts[j + 1]
        if (Math.abs(a.y - b.y) < EPS) {
          if (j !== slCarrier[s] && Number.isInteger(a.y)) block(a.y, Math.min(a.x, b.x) - 0.05, Math.max(a.x, b.x) + 0.05, s)
          continue
        }
        const tol = Math.abs(a.x - b.x) < EPS ? 0.2 : 0.25
        const lo = Math.min(a.y, b.y)
        const hi = Math.max(a.y, b.y)
        for (let lane = Math.ceil(lo - EPS); lane <= hi + EPS; lane += 1) {
          const x = a.x + ((lane - a.y) / (b.y - a.y)) * (b.x - a.x)
          block(lane, x - tol, x + tol, s)
        }
      }
    }
    for (const [lane, list] of raw) {
      list.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2])
      blockLo.set(lane, list.map((it) => it[0]))
      blockHi.set(lane, list.map((it) => it[1]))
      blockOwner.set(lane, list.map((it) => it[2]))
      let maxLen = 0
      for (const it of list) maxLen = Math.max(maxLen, it[1] - it[0])
      blockMaxLen.set(lane, maxLen)
    }
  }
  // ---- 7b. one route per graph link: cut each skeleton route at its plain commits
  for (let s = 0; s < SL; s += 1) {
    const pts = slPts[s]
    const plain = slPlain[s]
    const via = slVia[s]
    const kd = slOutKind[s]
    const muted = slMuted(s)
    const dashed = slKind[s] === 'cross'
    const color = slColor(s)
    const track = kd === 'fork' ? py[slC[s]] : kd === 'line' || kd === 'merge' ? py[slP[s]] : slTrack[s]
    if (plain.length === 0) {
      const l = via[0]
      routeOf[l] = {
        linkIndex: l,
        source: linkSrc[l],
        target: linkTgt[l],
        points: pts,
        kind: kd,
        lane: track,
        colorBranch: color,
        muted,
        dashed,
        hidden: linkHidden[l],
      }
      continue
    }
    const seg = slCarrier[s]
    const a = pts[seg]
    const b = pts[seg + 1]
    const y = a.y
    const kCount = plain.length
    // free stretches of the carrier: one merge pass over the blocks that overlap it
    const margin = Math.min(0.15, Math.abs(b.x - a.x) / (2 * (kCount + 1)))
    const x0 = Math.min(a.x, b.x) + margin
    const x1 = Math.max(a.x, b.x) - margin
    let free: Array<[number, number]> = []
    {
      const los = blockLo.get(y)
      const his = blockHi.get(y) as number[]
      const owners = blockOwner.get(y) as number[]
      let cursor = x0
      if (los && Math.abs(a.y - b.y) < EPS) {
        const from = x0 - (blockMaxLen.get(y) ?? 0)
        let lo = 0
        let hi = los.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (los[mid] < from) lo = mid + 1
          else hi = mid
        }
        for (let k = lo; k < los.length && los[k] < x1; k += 1) {
          if (owners[k] === s || his[k] <= cursor) continue
          if (los[k] > cursor) free.push([cursor, los[k]])
          cursor = his[k]
        }
      }
      if (cursor < x1) free.push([cursor, x1])
    }
    let total = 0
    for (const [f0, f1] of free) total += f1 - f0
    if (total < 0.02 * (kCount + 1)) {
      free = [[x0, x1]]
      total = Math.max(0, x1 - x0)
    }
    // plain[kCount - 1] is nearest the parent, i.e. leftmost
    const cuts: MetroPoint[] = []
    if (Math.abs(a.y - b.y) < EPS) {
      let fi = 0
      let acc = 0
      for (let j = 1; j <= kCount; j += 1) {
        const target = (total * j) / (kCount + 1)
        while (fi < free.length - 1 && acc + (free[fi][1] - free[fi][0]) < target) {
          acc += free[fi][1] - free[fi][0]
          fi += 1
        }
        cuts.push({ x: free[fi][0] + (target - acc), y })
      }
    } else {
      // no horizontal carrier (only with a custom runColumns): spread them along the segment
      for (let j = 1; j <= kCount; j += 1) {
        const f = j / (kCount + 1)
        cuts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
      }
    }
    for (let j = 0; j < kCount; j += 1) {
      const i = plain[kCount - 1 - j]
      px[i] = cuts[j].x
      py[i] = cuts[j].y
      hasPos[i] = 1
      stationKind.set(nodes[i].id, 'commit')
    }
    // cut the polyline at the commits; piece j joins left node j and right node j + 1
    const pieces: MetroPoint[][] = []
    let currentPiece: MetroPoint[] = [pts[0]]
    for (let j = 0; j + 1 < pts.length; j += 1) {
      if (j === seg) {
        for (const q of cuts) {
          currentPiece.push(q)
          pieces.push(currentPiece)
          currentPiece = [q]
        }
      }
      currentPiece.push(pts[j + 1])
    }
    pieces.push(currentPiece)
    // left to right: piece 0 is parent -> plain[k-1] (graph link via[k]); piece k is plain[0] -> child (via[0])
    for (let j = 0; j < pieces.length; j += 1) {
      const l = via[kCount - j]
      const piece = simplify(pieces[j])
      let horizontal = true
      for (let q = 0; q + 1 < piece.length; q += 1) if (Math.abs(piece[q].y - piece[q + 1].y) > EPS) horizontal = false
      const childNode = j === pieces.length - 1 ? slC[s] : plain[kCount - 1 - j]
      routeOf[l] = {
        linkIndex: l,
        source: linkSrc[l],
        target: linkTgt[l],
        points: piece,
        kind: horizontal ? 'line' : kd,
        lane: track,
        colorBranch: kd === 'line' && chains[chainOf[slC[s]]].spine ? nodes[childNode].owner || color : color,
        muted,
        dashed,
        hidden: linkHidden[l],
      }
    }
  }
  // any node not placed yet (only possible for malformed input): put it where it does no harm
  for (let i = 0; i < n; i += 1) {
    if (hasPos[i]) continue
    px[i] = 0
    py[i] = 0
    hasPos[i] = 1
  }

  // ---- 8a. stations and stubs
  const stubs: MetroStub[] = []
  for (const ch of chains) {
    for (let k = 0; k < ch.nodes.length; k += 1) {
      const i = ch.nodes[k]
      let kind: MetroStationKind = 'stop'
      if (interchange[i]) kind = 'interchange'
      else if (k === ch.nodes.length - 1 && nodes[i].tips.length > 0 && !ch.stretched && !ch.continued) kind = 'terminus'
      else if (k === 0 && ch.baseNode < 0 && nodes[i].isRoot) kind = 'origin'
      stationKind.set(nodes[i].id, kind)
    }
    if (ch.startShift > 0 && ch.nodes.length > 0) {
      const i = ch.nodes[0]
      stubs.push({ nodeId: nodes[i].id, colorBranch: colorAt(chainOf[i], i), points: [{ x: px[i] - colGap, y: py[i] }, { x: px[i], y: py[i] }] })
    }
  }
  for (let i = 0; i < n; i += 1) if (!stationKind.has(nodes[i].id)) stationKind.set(nodes[i].id, keep[i] ? 'stop' : 'commit')

  const positions = new Map<string, MetroPoint>()
  for (let i = 0; i < n; i += 1) positions.set(nodes[i].id, { x: px[i], y: py[i] })

  const routes: MetroRoute[] = []
  for (let l = 0; l < LN; l += 1) {
    const r = routeOf[l]
    if (r) routes.push(r)
  }

  // ---- 8b. labels: trunk first, then newest first; along the lane after a terminus, else beside
  // the line (away from the trunk first), else at 45 degrees. Each candidate is cut short at the
  // first station or earlier label it would hit, and preferably at the first line too; the text is
  // then shortened in the middle to fit.
  type Box = OrientedBox
  const placedBoxes = new BoxIndex() // label boxes
  const markerBoxes = new BoxIndex() // run marker boxes
  const shortNames = uniqueShortNames(
    data.branches.map((b) => b.name).concat(claimOrder),
    maxLabelChars,
  )
  // the next line to start on each lane after a chain (bounds an end label)
  const nextStartX = new Float64Array(chains.length).fill(Number.POSITIVE_INFINITY)
  {
    const byLane = new Map<number, LaneUser[]>()
    for (const u of users) {
      const list = byLane.get(u.lane)
      if (list) list.push(u)
      else byLane.set(u.lane, [u])
    }
    for (const list of byLane.values()) {
      list.sort((a, b) => a.start - b.start || a.order - b.order)
      for (let k = 0; k + 1 < list.length; k += 1) {
        const u = list[k]
        if (u.order >= chains.length) continue
        const v = list[k + 1]
        nextStartX[u.order] = px[v.startNode] - v.startShift * colGap
      }
    }
  }
  const labels = placeLabels()

  function placeLabels(): MetroLabel[] {
    const f = fontSize
    const labelled: number[] = []
    for (const i of stationList) if (nodes[i].tips.length > 0) labelled.push(i)
    const nextLabelledX = new Map<number, number>()
    {
      const byLane = new Map<number, number[]>()
      for (const i of labelled) {
        const list = byLane.get(py[i])
        if (list) list.push(i)
        else byLane.set(py[i], [i])
      }
      for (const list of byLane.values()) {
        list.sort((a, b) => px[a] - px[b] || a - b)
        for (let k = 0; k < list.length; k += 1)
          nextLabelledX.set(list[k], k + 1 < list.length ? px[list[k + 1]] : Number.POSITIVE_INFINITY)
      }
    }
    // obstacles: stations (x-sorted), labels placed so far, and line segments (x-bucketed)
    const byX = Array.from({ length: n }, (_, i) => i).sort((a, b) => px[a] - px[b] || a - b)
    const sortedX = Float64Array.from(byX, (i) => px[i])
    const firstX = (x: number): number => {
      let lo = 0
      let hi = n
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (sortedX[mid] < x) lo = mid + 1
        else hi = mid
      }
      return lo
    }
    const radius = (i: number): number => (!keep[i] ? 0.08 : nodes[i].isTip ? 0.27 : interchange[i] ? 0.23 : 0.15)
    const segA: MetroPoint[] = []
    const segB: MetroPoint[] = []
    const BUCKET = 2
    const buckets = new Map<number, number[]>()
    for (let s = 0; s < SL; s += 1) {
      const pts = slPts[s]
      for (let j = 0; j + 1 < pts.length; j += 1) {
        const id = segA.length
        segA.push(pts[j])
        segB.push(pts[j + 1])
        for (let b = Math.floor(Math.min(pts[j].x, pts[j + 1].x) / BUCKET); b <= Math.floor(Math.max(pts[j].x, pts[j + 1].x) / BUCKET); b += 1) {
          const list = buckets.get(b)
          if (list) list.push(id)
          else buckets.set(b, [id])
        }
      }
    }
    const segStamp = new Int32Array(segA.length)
    let stamp = 0
    const textBox = (tx: number, ty: number, angle: number, len: number): Box => {
      const r = (angle * Math.PI) / 180
      const ux = Math.cos(r)
      const uy = Math.sin(r)
      // baseline at v = 0; ascent to -0.75f, descent to +0.25f
      return { cx: tx + (ux * len) / 2 + uy * 0.25 * f, cy: ty + (uy * len) / 2 - ux * 0.25 * f, ux, uy, hw: len / 2, hh: 0.5 * f }
    }
    // scratch for clipping a box against the text's band (a quad cut by two lines: <= 6 corners)
    const bufT = new Float64Array(8)
    const bufV = new Float64Array(8)
    const tmpT = new Float64Array(8)
    const tmpV = new Float64Array(8)
    const clip = (inT: Float64Array, inV: Float64Array, m: number, outT: Float64Array, outV: Float64Array, bound: number, below: boolean): number => {
      let k2 = 0
      for (let k = 0; k < m; k += 1) {
        const at = inT[k]
        const av = inV[k]
        const bt = inT[(k + 1) % m]
        const bv = inV[(k + 1) % m]
        const ina = below ? av <= bound : av >= bound
        const inb = below ? bv <= bound : bv >= bound
        if (ina) {
          outT[k2] = at
          outV[k2] = av
          k2 += 1
        }
        if (ina !== inb) {
          const r = (bound - av) / (bv - av)
          outT[k2] = at + r * (bt - at)
          outV[k2] = bound
          k2 += 1
        }
      }
      return k2
    }
    /**
     * Where along the baseline (from tx, ty, direction ux, uy) the box o first enters the text's
     * band, or +Infinity when it never does (or lies wholly behind the start).
     */
    const cutAt = (tx: number, ty: number, ux: number, uy: number, o: Box): number => {
      // text coordinates: t along the baseline, v "up" (n = (uy, -ux)); the band is v in [-0.25f, 0.75f]
      for (let k = 0; k < 4; k += 1) {
        const sx = k === 1 || k === 2 ? 1 : -1
        const sy = k >= 2 ? 1 : -1
        const x = o.cx + sx * o.hw * o.ux - sy * o.hh * o.uy
        const y = o.cy + sx * o.hw * o.uy + sy * o.hh * o.ux
        bufT[k] = (x - tx) * ux + (y - ty) * uy
        bufV[k] = (x - tx) * uy - (y - ty) * ux
      }
      let m = clip(bufT, bufV, 4, tmpT, tmpV, 0.75 * f, true)
      if (m === 0) return Number.POSITIVE_INFINITY
      m = clip(tmpT, tmpV, m, bufT, bufV, -0.25 * f, false)
      if (m === 0) return Number.POSITIVE_INFINITY
      let tMin = Number.POSITIVE_INFINITY
      let tMax = Number.NEGATIVE_INFINITY
      for (let k = 0; k < m; k += 1) {
        if (bufT[k] < tMin) tMin = bufT[k]
        if (bufT[k] > tMax) tMax = bufT[k]
      }
      return tMax < 0 ? Number.POSITIVE_INFINITY : Math.max(0, tMin - 0.08)
    }
    const lineHalf = 0.1
    // results of fit(): room before the first station or label, and before the first line too
    let fitPlain = 0
    let fitClear = 0
    /** Longest length (<= len) along the baseline before the text runs into an obstacle. */
    const fit = (tx: number, ty: number, angle: number, len: number, self: number): void => {
      fitPlain = 0
      fitClear = 0
      if (!(len > 0)) return
      const box = textBox(tx, ty, angle, len)
      const ux = box.ux
      const uy = box.uy
      const bx = halfX(box)
      const by = halfY(box)
      let best = len
      /** Cut the text at the obstacle when their bounding boxes, and then the boxes, overlap. */
      const consider = (o: Box): void => {
        if (Math.abs(o.cx - box.cx) > bx + halfX(o) || Math.abs(o.cy - box.cy) > by + halfY(o)) return
        if (!boxesOverlap(box, o)) return
        best = Math.min(best, cutAt(tx, ty, ux, uy, o))
      }
      const ext = bx + 0.35
      for (let k = firstX(box.cx - ext); k < n && sortedX[k] <= box.cx + ext; k += 1) {
        const i = byX[k]
        if (i === self) continue
        const r = radius(i)
        if (Math.abs(py[i] - box.cy) > by + r) continue
        consider({ cx: px[i], cy: py[i], ux: 1, uy: 0, hw: r, hh: r })
      }
      placedBoxes.near(box.cx - bx, box.cx + bx, consider)
      markerBoxes.near(box.cx - bx, box.cx + bx, consider)
      fitPlain = best
      if (best > 0) {
        stamp += 1
        for (let b = Math.floor((box.cx - ext) / BUCKET); b <= Math.floor((box.cx + ext) / BUCKET); b += 1) {
          for (const id of buckets.get(b) ?? []) {
            if (segStamp[id] === stamp) continue
            segStamp[id] = stamp
            let a = segA[id]
            let c = segB[id]
            if (Math.max(a.y, c.y) < box.cy - by - lineHalf || Math.min(a.y, c.y) > box.cy + by + lineHalf) continue
            if (Math.max(a.x, c.x) < box.cx - bx - lineHalf || Math.min(a.x, c.x) > box.cx + bx + lineHalf) continue
            const dx = c.x - a.x
            const dy = c.y - a.y
            const L = Math.hypot(dx, dy)
            if (L < EPS) continue
            // a line leaving the label's own station only counts beyond the station symbol
            const trim = 0.35
            const atA = Math.abs(a.x - px[self]) < 1e-6 && Math.abs(a.y - py[self]) < 1e-6
            const atC = Math.abs(c.x - px[self]) < 1e-6 && Math.abs(c.y - py[self]) < 1e-6
            if (atA || atC) {
              if (L <= trim) continue
              if (atA) a = { x: a.x + (dx / L) * trim, y: a.y + (dy / L) * trim }
              else c = { x: c.x - (dx / L) * trim, y: c.y - (dy / L) * trim }
            }
            const len2 = Math.hypot(c.x - a.x, c.y - a.y)
            const o: Box = { cx: (a.x + c.x) / 2, cy: (a.y + c.y) / 2, ux: (c.x - a.x) / len2, uy: (c.y - a.y) / len2, hw: len2 / 2 + lineHalf, hh: lineHalf }
            consider(o)
            if (best <= 0) return
          }
        }
      }
      fitClear = best
    }
    const order = labelled.slice().sort((a, b) => {
      const ta = chainOf[a] === trunk ? 0 : 1
      const tb = chainOf[b] === trunk ? 0 : 1
      return ta - tb || px[b] - px[a] || Math.abs(py[a]) - Math.abs(py[b]) || a - b
    })
    interface Cand {
      placement: MetroLabel['placement']
      tx: number
      ty: number
      angle: number
      room: number
    }
    const result: MetroLabel[] = []
    for (const i of order) {
      const chId = chainOf[i]
      const ch = chains[chId]
      const side = ch.lane > 0 ? 1 : -1
      const isEnd = newestOf(ch) === i && !ch.stretched && !ch.continued
      const tipR = 0.27
      const tips = nodes[i].tips
      const byClaim = (a: string, b: string): number => (claimRank.get(a) ?? 0) - (claimRank.get(b) ?? 0) || cmp(a, b)
      const primary =
        ch.branch !== null && newestOf(ch) === i && tips.includes(ch.branch)
          ? ch.branch
          : tips.find(isDefault) ?? tips.slice().sort(byClaim)[0]
      const others = tips.filter((b) => b !== primary).sort(byClaim)
      const suffix = others.length > 0 ? ` +${others.length}` : ''
      const fullText = (shortNames.get(primary) ?? shortBranchName(primary, maxLabelChars)) + suffix
      const textFor = (chars: number): string => {
        const t = shortBranchName(primary, Math.max(3, chars - suffix.length)) + suffix
        return t.length < fullText.length ? t : fullText
      }
      /** The longest middle-shortened text (never below minLabelChars) that fits in len. */
      const textWithin = (len: number): string => {
        for (let m = fullText.length; m >= minLabelChars; m -= 1) {
          const t = textFor(m)
          if (measure(t) <= len + 1e-6) return t
        }
        return textFor(minLabelChars)
      }
      const w = measure(fullText)
      const minW = Math.min(w, measure(textFor(minLabelChars)))
      // a label shortened only to stay clear of lines must still read well
      const minCleanW = Math.min(w, measure(textFor(Math.max(minLabelChars, 20))))
      const sideCand = (sgn: number, room: number): Cand => ({
        placement: 'side',
        tx: px[i] - 0.125,
        ty: sgn > 0 ? py[i] + 0.33 + 0.75 * f : py[i] - 0.33,
        angle: 0,
        room,
      })
      const cands: Cand[] = []
      if (isEnd) {
        const nx = nextStartX[chId]
        const room = Number.isFinite(nx) ? nx - px[i] - tipR - 0.125 - 0.5 * colGap : Number.POSITIVE_INFINITY
        cands.push({ placement: 'end', tx: px[i] + tipR + 0.125, ty: py[i] + 0.35 * f, angle: 0, room })
      }
      const sideRoom = (nextLabelledX.get(i) ?? Number.POSITIVE_INFINITY) - px[i] - 0.25
      cands.push(sideCand(side, sideRoom))
      cands.push(sideCand(-side, sideRoom))
      for (const sgn of [side, -side]) {
        cands.push({
          placement: 'diagonal',
          tx: px[i] + (sgn > 0 ? 0.125 : 0.21),
          ty: py[i] + (sgn > 0 ? 0.29 : -0.21),
          angle: sgn > 0 ? 45 : -45,
          room: Number.POSITIVE_INFINITY,
        })
      }
      // 1. the whole name, clear of stations, labels and lines; 2. the longest clear shortened
      // name; 3. and 4. the same, allowing thin lines to cross the text (its halo keeps it
      // readable); 5. the outward diagonal, flagged crowded.
      let chosen: Cand | null = null
      let text = fullText
      let crowded = false
      const plainLen: number[] = []
      const clearLen: number[] = []
      for (const c of cands) {
        fit(c.tx, c.ty, c.angle, Math.min(w, c.room), i)
        plainLen.push(fitPlain)
        clearLen.push(fitClear)
        if (fitClear >= w - 1e-6) {
          chosen = c
          break
        }
      }
      for (const [lens, floor] of [[clearLen, minCleanW], [plainLen, minW]] as const) {
        if (chosen) break
        let best = -1
        for (let k = 0; k < lens.length; k += 1) {
          if (lens[k] >= w - 1e-6) {
            best = k
            break
          }
          if (best < 0 || lens[k] > lens[best] + 1e-6) best = k
        }
        if (best >= 0 && lens[best] >= floor - 1e-6) {
          chosen = cands[best]
          if (lens[best] < w - 1e-6) text = textWithin(lens[best])
        }
      }
      if (!chosen) {
        chosen = cands.find((c) => c.placement === 'diagonal' && c.angle === (side > 0 ? 45 : -45)) as Cand
        text = textFor(minLabelChars)
        crowded = true
      }
      const width = measure(text)
      placedBoxes.add(textBox(chosen.tx, chosen.ty, chosen.angle, width))
      result.push({
        nodeId: nodes[i].id,
        branches: [primary, ...others],
        text,
        x: px[i],
        y: py[i],
        placement: chosen.placement,
        tx: chosen.tx,
        ty: chosen.ty,
        angle: chosen.angle,
        width,
        crowded,
      })
    }
    return result
  }

  // ---- 8c. run markers (skeleton view): "+N" beside the carrier, where no label or station is
  const runs: MetroRun[] = []
  for (let s = 0; s < SL; s += 1) {
    const l = slVia[s][0]
    if (slVia[s].length !== 1 || linkHidden[l] === 0) continue
    const pts = slPts[s]
    const seg = slCarrier[s]
    const horizontal = seg >= 0 && Math.abs(pts[seg].y - pts[seg + 1].y) < EPS
    // without a horizontal carrier the run is reported at the route's middle, with no marker spot
    const a = horizontal ? pts[seg] : pts[0]
    const b = horizontal ? pts[seg + 1] : pts[pts.length - 1]
    const room = horizontal ? b.x - a.x : 0
    const x = (a.x + b.x) / 2
    const y = (a.y + b.y) / 2
    const w = measure(`+${linkHidden[l]}`) * 0.8 + 0.1
    let markerY: number | null = null
    if (horizontal && room >= w + 0.1) {
      const away = y > 0 ? 1 : -1
      for (const sgn of [away, -away]) {
        const my = y + sgn * 0.32
        const box: Box = { cx: x, cy: my, ux: 1, uy: 0, hw: w / 2, hh: 0.14 }
        let clash = false
        const test = (o: Box): void => {
          if (clash || Math.abs(o.cy - box.cy) > halfY(o) + box.hh || Math.abs(o.cx - box.cx) > halfX(o) + box.hw) return
          if (boxesOverlap(o, box)) clash = true
        }
        placedBoxes.near(x - box.hw, x + box.hw, test)
        markerBoxes.near(x - box.hw, x + box.hw, test)
        if (!clash && stationNear(Math.round(my), x, w / 2 + 0.2, -1, -1) && Math.abs(Math.round(my) - my) < 0.35) clash = true
        if (!clash) {
          markerY = my
          markerBoxes.add(box)
          break
        }
      }
    }
    runs.push({ linkIndex: l, hidden: linkHidden[l], x, y, room, markerY })
  }

  // ---- 8d. bounds, lanes, segments
  let minX = 0
  let maxX = 0
  let minY = 0
  let maxY = 0
  if (n > 0) {
    minX = minY = Number.POSITIVE_INFINITY
    maxX = maxY = Number.NEGATIVE_INFINITY
    const take = (x: number, y: number): void => {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    for (let i = 0; i < n; i += 1) take(px[i], py[i])
    for (const r of routes) for (const q of r.points) take(q.x, q.y)
    for (const st of stubs) take(st.points[0].x, st.points[0].y)
  }
  const bounds: MetroBounds = { minX, maxX, minY, maxY }
  const lb: MetroBounds = { ...bounds }
  const grow = (x: number, y: number): void => {
    if (x < lb.minX) lb.minX = x
    if (x > lb.maxX) lb.maxX = x
    if (y < lb.minY) lb.minY = y
    if (y > lb.maxY) lb.maxY = y
  }
  for (const label of labels) {
    const r = (label.angle * Math.PI) / 180
    const ux = Math.cos(r)
    const uy = Math.sin(r)
    for (const [t, v] of [[0, -0.75 * fontSize], [0, 0.25 * fontSize], [label.width, -0.75 * fontSize], [label.width, 0.25 * fontSize]])
      grow(label.tx + ux * t - uy * v, label.ty + uy * t + ux * v)
  }
  for (const b of markerBoxes.all) {
    grow(b.cx - b.hw, b.cy - b.hh)
    grow(b.cx + b.hw, b.cy + b.hh)
  }

  const lanes = new Map<string, number>()
  for (const name of claimOrder) lanes.set(name, laneOf(tipNode.get(name) as number))
  const laneHints = new Map<string, number>(lanes)
  for (const ch of chains) if (ch.kind !== 'branch') laneHints.set(ch.key, ch.lane)

  const segments: MetroSegment[] = chains.map((ch, id) => ({
    kind: ch.kind,
    branch: ch.branch,
    colorBranch: ch.colorBranch,
    lane: ch.lane,
    x0: id === trunk ? bounds.minX : px[ch.startNode] - ch.startShift * colGap,
    x1: id === trunk ? bounds.maxX : px[ch.endNode],
    nodes: ch.nodes.map((i) => nodes[i].id),
  }))
  for (const s of crossLinks) {
    segments.push({
      kind: 'bridge',
      branch: null,
      colorBranch: slColor(s),
      lane: slTrack[s],
      x0: px[slP[s]],
      x1: px[slC[s]],
      nodes: [],
    })
  }
  const keys = tracks.keys()
  return {
    positions,
    lanes,
    laneHints,
    routes,
    stations: stationKind,
    labels,
    runs,
    stubs,
    segments,
    bounds,
    boundsWithLabels: lb,
    laneCount: keys.filter((k) => k % 2 === 0).length,
    railCount: keys.filter((k) => Math.abs(k % 2) === 1).length,
    columns,
    mode: fullMode ? 'full' : 'skeleton',
  }
}

/** An oriented box: centre, unit direction of its long axis, half width and half height. */
interface OrientedBox {
  cx: number
  cy: number
  ux: number
  uy: number
  hw: number
  hh: number
}

function separatedOn(a: OrientedBox, b: OrientedBox, ax: number, ay: number): boolean {
  const ra = a.hw * Math.abs(a.ux * ax + a.uy * ay) + a.hh * Math.abs(-a.uy * ax + a.ux * ay)
  const rb = b.hw * Math.abs(b.ux * ax + b.uy * ay) + b.hh * Math.abs(-b.uy * ax + b.ux * ay)
  return Math.abs((b.cx - a.cx) * ax + (b.cy - a.cy) * ay) > ra + rb
}

/** Separating-axis test for two oriented boxes. */
function boxesOverlap(a: OrientedBox, b: OrientedBox): boolean {
  return (
    !separatedOn(a, b, a.ux, a.uy) &&
    !separatedOn(a, b, -a.uy, a.ux) &&
    !separatedOn(a, b, b.ux, b.uy) &&
    !separatedOn(a, b, -b.uy, b.ux)
  )
}

/** Half extents of an oriented box's axis-aligned bounding box. */
function halfX(o: OrientedBox): number {
  return Math.abs(o.ux) * o.hw + Math.abs(o.uy) * o.hh
}
function halfY(o: OrientedBox): number {
  return Math.abs(o.uy) * o.hw + Math.abs(o.ux) * o.hh
}

/** Placed boxes bucketed by x, so overlap queries only look at their neighbourhood. */
class BoxIndex {
  readonly all: OrientedBox[] = []
  private buckets = new Map<number, OrientedBox[]>()
  private maxHalf = 0
  constructor(private readonly width = 4) {}
  add(o: OrientedBox): void {
    this.all.push(o)
    const h = halfX(o)
    if (h > this.maxHalf) this.maxHalf = h
    const b = Math.floor(o.cx / this.width)
    const list = this.buckets.get(b)
    if (list) list.push(o)
    else this.buckets.set(b, [o])
  }
  /** Calls fn for every box whose centre lies within reach of [x0, x1] (a superset of the overlaps). */
  near(x0: number, x1: number, fn: (o: OrientedBox) => void): void {
    const lo = Math.floor((x0 - this.maxHalf) / this.width)
    const hi = Math.floor((x1 + this.maxHalf) / this.width)
    for (let b = lo; b <= hi; b += 1) {
      const list = this.buckets.get(b)
      if (list) for (const o of list) fn(o)
    }
  }
}
