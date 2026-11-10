/**
 * The coral layout: the repo grown upward as a sea fan. The default branch is the stalk, rising
 * straight from the seabed; every other line forks off it (or off another line) to one side and
 * curves up and outward, older forks on the outside, newer ones closer in. A branch merged back is
 * a dashed bridge across the fan, and a merged branch whose ref is gone is a faint arm.
 *
 * It answers in metro's own terms (a MetroLayout: positions, one polyline route per link, station
 * kinds, stubs and run markers, in lane units), so the canvas draws it with the metro painter and
 * everything that rides on that (labels, pull request rings, the time-lapse, themes) comes along.
 *
 * How it is laid out:
 *  1. Growth tree. A commit grows from its first parent (the first link out of it, see
 *     graph/build), so the first-parent history is a tree; every other parent link is a merge.
 *  2. Lines. Each tip claims the commits of its owner along its first-parent history, up to where
 *     another tip's claim begins; a commit no tip claims belongs to an anonymous line (a merged
 *     branch that was since deleted). A line carries on through the child the same tip claimed;
 *     its other children fork off.
 *  3. The fan. Lines are rays from one centre under the seabed, a commit's distance along its ray
 *     being its depth in the tree. A line's forks are dealt to its two sides, the lighter side
 *     first, and ordered so that a fork that leaves lower sits further out.
 *  4. Arms. A fork leaves its parent at a fixed angle to it (the species' armSlope: an equiangular spiral in
 *     the fan) and keeps to that until it meets its own ray, which it then follows. Its first
 *     commit sits where it has reached the ray, so the arm is as long as the sweep needs: the
 *     lower a branch forks, the further it reaches, as on a real coral. Every sweep on one side
 *     is the same spiral started at a different height, and a lower one stays outside a higher
 *     one all the way, so tree links never cross.
 *  5. Room. Two neighbouring rays are kept a lane apart from the depth where both exist. The
 *     centre's distance under the seabed is the smallest that fits each side of the fan inside
 *     the species' fan angle: a repo whose branches all fork late gets a tall stalk with a crown, one that
 *     forks early a wide fan. Arms, angles and depths depend on each other, so they are settled
 *     over a few rounds and the depths are then made exact for the angles reached.
 *  6. The bend. Rays lean back towards the vertical as they rise (the species' bend), as coral arms reach for
 *     the light. The bend keeps the order of the rays at every height, so it adds no crossing.
 *
 * What makes one repo's coral its own, each from one fact about the repo and nothing random:
 *  - its species, from the primary language (graph/coralSpecies): how wide the fan opens, how
 *    steeply arms leave, how far they lean back up, how close they grow, how thick;
 *  - its taper, from the history each line carries: a line is as thick as the square root of the
 *    commits growing above it (a trunk's cross-section is the sum of its branches', as Leonardo
 *    noted of trees), so the base is heavy and the tips fine;
 *  - its living tips, from how long ago each branch last moved: an arm with a recent tip above it
 *    is in full colour and ends in a polyp; one that has been quiet for a year is bleached;
 *  - its sway, from the repo's name: each arm's spacing, reach and gentle side-to-side drift are
 *    hashed from owner/repo and the arm's first commit, so the same repo always grows the same
 *    coral and no two repos grow quite alike. The sway only ever widens a gap, so it costs no room.
 *
 * Pure: no DOM, no React. Deterministic for a given graph, repo name and clock.
 */
import type { Graph, GraphNode, RepoData } from '../types'
import { isSkeletonNode } from './collapse'
import { coralSpecies } from './coralSpecies'
import {
  skeletonRunColumns,
  type MetroBounds,
  type MetroLayout,
  type MetroOptions,
  type MetroPoint,
  type MetroRoute,
  type MetroRun,
  type MetroStationKind,
  type MetroStub,
} from './metro'

/** What the coral layout takes besides metro's options (none of which changes it). */
export interface CoralOptions extends MetroOptions {
  /** the clock branches' freshness is told by (ms since the epoch); the newest commit on the map when left out */
  now?: number
}

/** An arm runs at least this far along its own ray before its first commit, so the commit is clear of the sweep. */
const ARM_TAIL = 0.45
/** ...and up to this much further, by the arm's sway. */
const SWAY_TAIL = 0.9
/** A gap between two neighbouring arms is widened by up to this share, by the outer arm's sway. */
const SWAY_GAP = 0.6
/** An arm drifts this far to either side of its ray (lanes), over a wave SWAY_WAVE to twice that long, easing in over SWAY_EASE. */
const SWAY_DRIFT = 0.13
const SWAY_WAVE = 5
const SWAY_EASE = 3
/** A line's width, as a factor of the plain line: from a tip carrying one commit to the base carrying them all. */
export const TAPER_MIN = 0.65
export const TAPER_MAX = 2.3
/** A branch that moved within FRESH_DAYS is live (its tip a polyp); one quiet for BLEACH_DAYS is fully bleached. */
export const FRESH_DAYS = 30
export const BLEACH_DAYS = 365
const DAY_MS = 86_400_000
/** Rounds of settling arms, depths and angles against each other. */
const ROUNDS = 6
/** The centre is at least this far under the seabed, so the base is a stalk, not a point. */
const MIN_BASE = 3
const MAX_BASE = 4000
/** Depth a full view's plain commit adds (as metro's full view packs its columns). */
const FULL_STEP = 0.65
/** Length of the dashed lead-in under a root whose history is cut off. */
const STUB = 0.9
/** A run marker's '+N' sits this far beside its line. */
const RUN_TEXT_OFFSET = 0.5
/** Polyline pieces are about this long (lane units): short enough to read as a curve. */
const PIECE = 0.35

/** One line of the coral: a branch's own commits oldest first, or an anonymous arm. */
interface Line {
  nodes: number[]
  /** depth of the commit it forks from (the height its sweep leaves at); 0 for a line rooted in the seabed */
  start: number
  /** which commit of its parent line it forks from, counted from that line's first: how high it leaves, before any depth is known */
  forkAt: number
  /** the line it forks from, or -1 */
  parent: number
  /** forks dealt to each side, lowest first */
  left: number[]
  right: number[]
  /** lines in its subtree, itself included */
  weight: number
  /** its ray's angle from the vertical before the bend (radians, + to the right) */
  angle: number
  /** its sway, each 0..1 and hashed from the repo's name and the line's first commit: gap, reach, and the drift's phase and wave */
  sway: [gap: number, reach: number, phase: number, wave: number]
  /** how bleached it is, 0 (something on it or above it moved lately) to 1 (quiet for a year) */
  bleach: number
}

/** 32-bit FNV-1a of a string, as a fraction of 1: the sway's only source. */
function hash01(text: string): number {
  let h = 0x811c9dc5
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x100000000
}

/**
 * The coral layout of a graph. Metro's options are accepted and none changes it (so the app can
 * hand both engines the same call); `now` is the clock freshness is told by. `data` names the
 * default branch, whose line is the stalk, and the repo and its language, which the sway and the
 * species come from.
 */
export function coralLayout(
  graph: Graph,
  data: Pick<RepoData, 'defaultBranch'> & Partial<Pick<RepoData, 'owner' | 'repo' | 'language'>>,
  opts: CoralOptions = {},
): MetroLayout {
  // A coral does not grow down past its own seabed. An arm that leaves low and wide can dip under
  // it, so the fan is closed a little and grown again until none does (a few tries at most: a
  // narrower fan sets the centre deeper, which straightens every arm).
  let layout = grow(graph, data, opts, 1)
  for (let scale = FAN_CLOSE; scale > 0.4 && dips(layout); scale *= FAN_CLOSE) layout = grow(graph, data, opts, scale)
  return layout
}

/** Each try at keeping the coral above its seabed closes the fan to this share of the last. */
const FAN_CLOSE = 0.85
/** A dip shallower than this (lanes) is left alone: it is inside a station's own size. */
const DIP = 0.3

/** Whether any line of the coral runs below the lowest of its roots. */
function dips(layout: MetroLayout): boolean {
  let seabed = -Infinity
  for (const [id, kind] of layout.stations) {
    const p = kind === 'origin' ? layout.positions.get(id) : undefined
    if (p && p.y > seabed) seabed = p.y
  }
  if (!Number.isFinite(seabed)) return false
  // the merge bridges may sag: only what grows is held to it
  for (const route of layout.routes) if (route.kind !== 'cross') for (const p of route.points) if (p.y > seabed + DIP) return true
  return false
}

/** One growth of the coral, its fan opening to fanScale of its species' own. */
function grow(
  graph: Graph,
  data: Pick<RepoData, 'defaultBranch'> & Partial<Pick<RepoData, 'owner' | 'repo' | 'language'>>,
  opts: CoralOptions,
  fanScale: number,
): MetroLayout {
  const species = coralSpecies(data.language)
  const fanLimit = species.fan * fanScale
  const seed = `${data.owner ?? ''}/${data.repo ?? ''}`.toLowerCase()
  const nodes = graph.nodes
  const n = nodes.length
  const indexOf = new Map<string, number>()
  nodes.forEach((node, i) => indexOf.set(node.id, i))
  const full = nodes.some((node) => !isSkeletonNode(node))

  // ---- 1. the growth tree: a commit grows from its first parent
  const parent = new Int32Array(n).fill(-1)
  const parentLink = new Int32Array(n).fill(-1)
  /** links that are not growth: [link index, child, parent] */
  const merges: Array<[number, number, number]> = []
  graph.links.forEach((link, k) => {
    const child = indexOf.get(link.source)
    const par = indexOf.get(link.target)
    if (child === undefined || par === undefined || child === par) return
    if (parent[child] === -1) {
      parent[child] = par
      parentLink[child] = k
    } else merges.push([k, child, par])
  })
  const children: number[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) if (parent[i] !== -1) children[parent[i]].push(i)

  // parents before children (a link cannot point at its own descendant in a commit graph; anything
  // left unreached by a damaged one is cut loose and treated as a root)
  const order: number[] = []
  {
    const seen = new Uint8Array(n)
    const stack: number[] = []
    for (let i = 0; i < n; i++) if (parent[i] === -1) stack.push(i)
    for (let guard = 0; guard < 2; guard++) {
      while (stack.length > 0) {
        const i = stack.pop() as number
        if (seen[i]) continue
        seen[i] = 1
        order.push(i)
        for (const c of children[i]) stack.push(c)
      }
      for (let i = 0; i < n; i++) {
        if (seen[i]) continue
        children[parent[i]] = children[parent[i]].filter((c) => c !== i)
        parent[i] = -1
        parentLink[i] = -1
        stack.push(i)
      }
    }
  }
  /** what a commit's link to its parent adds to its depth by itself: a column, or more over hidden commits */
  const step = new Float64Array(n)
  for (let i = 0; i < n; i++) if (parent[i] !== -1) step[i] = full ? FULL_STEP : skeletonRunColumns(graph.links[parentLink[i]].collapsedCount)

  // ---- 2. lines: a tip claims its owner's commits along its first-parent history
  /** the tip (a node index) whose line a commit is on; -1 for a commit no tip claims */
  const claim = new Int32Array(n).fill(-1)
  {
    const tips = nodes.map((node, i) => (node.isTip ? i : -1)).filter((i) => i >= 0)
    // the default branch first, so its line is whole; the rest in the graph's own order
    tips.sort((a, b) => Number(nodes[b].tips.includes(data.defaultBranch)) - Number(nodes[a].tips.includes(data.defaultBranch)) || a - b)
    for (const tip of tips) {
      const owner = nodes[tip].owner
      for (let i = tip; i !== -1 && claim[i] === -1 && nodes[i].owner === owner; i = parent[i]) claim[i] = tip
    }
  }
  /** the child a commit's line carries on through (the one the same tip claimed, or neither is claimed), or -1 when the line ends there */
  const next = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    for (const c of children[i]) {
      if (claim[c] === claim[i]) {
        next[i] = c
        break
      }
    }
  }
  const lineOf = new Int32Array(n).fill(-1)
  /** a commit's place on its line, counted from the line's first */
  const placeOnLine = new Int32Array(n)
  const lines: Line[] = []
  for (const i of order) {
    if (lineOf[i] !== -1) continue
    const id = lines.length
    const p = parent[i]
    const key = `${seed} ${nodes[i].id}`
    const line: Line = {
      nodes: [],
      start: 0,
      forkAt: p === -1 ? -1 : placeOnLine[p],
      parent: p === -1 ? -1 : lineOf[p],
      left: [],
      right: [],
      weight: 1,
      angle: 0,
      sway: [hash01(`${key} gap`), hash01(`${key} reach`), hash01(`${key} phase`), hash01(`${key} wave`)],
      bleach: 0,
    }
    for (let j = i; j !== -1; j = next[j]) {
      lineOf[j] = id
      placeOnLine[j] = line.nodes.length
      line.nodes.push(j)
    }
    lines.push(line)
  }
  // `order` visits parents first, so a line's parent has a lower id: weights add up from the last line down
  for (let id = lines.length - 1; id >= 0; id--) if (lines[id].parent !== -1) lines[lines[id].parent].weight += lines[id].weight

  // ---- 3. the fan: forks dealt to the two sides, and the lines in order from left to right
  const forks: number[][] = lines.map(() => [])
  lines.forEach((line, id) => {
    if (line.parent !== -1) forks[line.parent].push(id)
  })
  for (const line of lines) line.weight = Math.max(1, line.weight)
  lines.forEach((line, id) => {
    // lowest first; at one height the heavier first, so it takes the lighter side
    const list = forks[id].sort((a, b) => lines[a].forkAt - lines[b].forkAt || lines[b].weight - lines[a].weight || a - b)
    let l = 0
    let r = 0
    for (const f of list) {
      if (r <= l) {
        line.right.push(f)
        r += lines[f].weight
      } else {
        line.left.push(f)
        l += lines[f].weight
      }
    }
  })
  // lines rooted in the seabed: the stalk (the default branch's) in the middle, the others dealt out like forks
  const stalk = (() => {
    const tip = nodes.findIndex((node) => node.tips.includes(data.defaultBranch))
    let i = tip >= 0 ? tip : order.length > 0 ? order[0] : -1
    while (i !== -1 && parent[i] !== -1) i = parent[i]
    return i === -1 ? -1 : lineOf[i]
  })()
  const seabedLeft: number[] = []
  const seabedRight: number[] = []
  {
    const others = lines.map((_, id) => id).filter((id) => lines[id].parent === -1 && id !== stalk)
    others.sort((a, b) => lines[b].weight - lines[a].weight || a - b)
    let l = 0
    let r = 0
    for (const id of others) {
      if (r <= l) {
        seabedRight.push(id)
        r += lines[id].weight
      } else {
        seabedLeft.push(id)
        l += lines[id].weight
      }
    }
  }
  /** left to right: a line's left forks (lowest outermost), the line, its right forks (highest innermost) */
  const fan: number[] = []
  const place = (id: number): void => {
    // iterative: a long chain of forks off forks must not overflow the stack
    const todo: Array<{ id: number; stage: 0 | 1 }> = [{ id, stage: 0 }]
    while (todo.length > 0) {
      const top = todo.pop() as { id: number; stage: 0 | 1 }
      const line = lines[top.id]
      if (top.stage === 1) {
        fan.push(top.id)
        continue
      }
      // pushed in reverse of the order they are placed in
      for (let k = line.right.length - 1; k >= 0; k--) todo.push({ id: line.right[k], stage: 0 })
      todo.push({ id: top.id, stage: 1 })
      for (let k = line.left.length - 1; k >= 0; k--) todo.push({ id: line.left[k], stage: 0 })
    }
  }
  // right forks are stored lowest first but placed highest (innermost) first
  for (const line of lines) line.right.reverse()
  for (let k = seabedLeft.length - 1; k >= 0; k--) place(seabedLeft[k])
  if (stalk !== -1) place(stalk)
  for (const id of seabedRight) place(id)

  /** where each line sits in the fan, counted from the left */
  const fanPos = new Int32Array(lines.length)
  fan.forEach((id, k) => {
    fanPos[id] = k
  })

  // ---- 4 and 5. arms and room, settled against each other
  const at = stalk === -1 ? 0 : fanPos[stalk]
  const depth = new Float64Array(n)
  /** the deepest commit's depth (at least 1), and the centre's distance under the seabed */
  let span = 1
  let base = MIN_BASE
  /** the ray's lean at depth d: 1 at the seabed, 1 - bend at the top */
  const lean = (d: number) => 1 - species.bend * Math.min(1, Math.max(0, d / span))
  /**
   * Depths for the angles and the base as they stand, parents first: along a line a commit adds its
   * step; the first commit of an arm sits where the arm's sweep has reached its ray, and a little on.
   */
  const deepen = (): void => {
    let deepest = 0
    for (const i of order) {
      const p = parent[i]
      if (p === -1) {
        depth[i] = 0
        continue
      }
      let add = step[i]
      if (lineOf[p] !== lineOf[i]) {
        const arm = lines[lineOf[i]]
        const turn = Math.abs(arm.angle - lines[lineOf[p]].angle)
        add = Math.max(add, (base + depth[p]) * (Math.exp(turn / species.armSlope) - 1) + ARM_TAIL + SWAY_TAIL * arm.sway[1])
      }
      depth[i] = depth[p] + add
      if (depth[i] > deepest) deepest = depth[i]
    }
    span = Math.max(1, deepest)
    for (const line of lines) {
      const from = parent[line.nodes[0]]
      line.start = from === -1 ? 0 : depth[from]
    }
  }
  /** the depths from which each neighbouring pair of rays both exist */
  const meet = new Float64Array(Math.max(0, fan.length - 1))
  const gaps = (under: number): Float64Array => {
    const out = new Float64Array(meet.length)
    const top = (under + span) * (1 - species.bend)
    // rays part as they rise, until the bend draws them together again: the closest they come is at
    // the depth they meet at, or at the top
    for (let k = 0; k < meet.length; k++) {
      // the sway widens a gap, by the arm on its outer side: never narrows one
      const outer = lines[fan[k < at ? k : k + 1]]
      out[k] = (species.spacing * (1 + SWAY_GAP * outer.sway[0])) / Math.max(1e-6, Math.min((under + meet[k]) * lean(meet[k]), top))
    }
    return out
  }
  const widest = (under: number): number => {
    const g = gaps(under)
    let left = 0
    let right = 0
    for (let k = 0; k < g.length; k++) {
      if (k < at) left += g[k]
      else right += g[k]
    }
    return Math.max(left, right)
  }
  /** Angles for the depths as they stand: the smallest base that fits each side inside the species' fan, and the rays a lane apart. */
  const spread = (): void => {
    for (let k = 0; k + 1 < fan.length; k++) meet[k] = Math.max(lines[fan[k]].start, lines[fan[k + 1]].start)
    base = MIN_BASE
    if (widest(base) > fanLimit) {
      let lo = MIN_BASE
      let hi = MIN_BASE * 2
      while (hi < MAX_BASE && widest(hi) > fanLimit) hi *= 2
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2
        if (widest(mid) > fanLimit) lo = mid
        else hi = mid
      }
      base = hi
    }
    const g = gaps(base)
    if (fan.length > 0) lines[fan[at]].angle = 0
    for (let k = at; k + 1 < fan.length; k++) lines[fan[k + 1]].angle = lines[fan[k]].angle + g[k]
    for (let k = at - 1; k >= 0; k--) lines[fan[k]].angle = lines[fan[k + 1]].angle - g[k]
  }
  for (let round = 0; round < ROUNDS; round++) {
    deepen()
    spread()
  }
  // exact for the angles reached: every arm's first commit is on its ray
  deepen()
  const maxDepth = span

  // ---- 6. the bend, and the way from a depth and an angle to the map (y grows downward, so up is -y)
  const point = (d: number, angle: number): MetroPoint => {
    const a = angle * lean(d)
    const r = base + d
    return { x: r * Math.sin(a), y: -r * Math.cos(a) }
  }
  /**
   * Where a line is at depth d: on its ray, drifting gently to either side of it (the same distance
   * in lanes at every height, eased in from where the line begins).
   */
  const swayed = (id: number, d: number): number => {
    const line = lines[id]
    const along = d - line.start
    if (along <= 0) return line.angle
    const wave = SWAY_WAVE * (1 + line.sway[3])
    const drift = SWAY_DRIFT * Math.min(1, along / SWAY_EASE) * Math.sin(2 * Math.PI * (line.sway[2] + along / wave))
    return line.angle + drift / (base + d)
  }
  const angleOf = (i: number) => swayed(lineOf[i], depth[i])

  const positions = new Map<string, MetroPoint>()
  for (let i = 0; i < n; i++) positions.set(nodes[i].id, point(depth[i], angleOf(i)))

  // ---- routes: one per link, from the parent to the child
  /** A curve through depth-and-angle space, from (d0, a0) to (d1, a1), eased by rise and turn. */
  const curve = (d0: number, a0: number, d1: number, a1: number, rise: (t: number) => number, turn: (t: number) => number): MetroPoint[] => {
    const reach = Math.abs(a1 - a0) * (base + Math.max(d0, d1)) + Math.abs(d1 - d0)
    const pieces = Math.min(64, Math.max(2, Math.ceil(reach / PIECE)))
    const pts: MetroPoint[] = []
    for (let k = 0; k <= pieces; k++) {
      const t = k / pieces
      pts.push(point(d0 + (d1 - d0) * rise(t), a0 + (a1 - a0) * turn(t)))
    }
    return pts
  }
  const smooth = (t: number) => t * t * (3 - 2 * t)
  /** Along one line, from depth d0 up to d1: the ray with its drift. */
  const along = (id: number, d0: number, d1: number): MetroPoint[] => {
    const pieces = Math.min(64, Math.max(1, Math.ceil(Math.abs(d1 - d0) / PIECE)))
    const pts: MetroPoint[] = []
    for (let k = 0; k <= pieces; k++) {
      const d = d0 + ((d1 - d0) * k) / pieces
      pts.push(point(d, swayed(id, d)))
    }
    return pts
  }
  /**
   * An arm: from its parent at (d0, a0) it turns at the species' armSlope towards its line's ray (an
   * equiangular spiral in the fan: the angle grows with the log of the distance from the centre),
   * meets the ray at depth `on`, and follows the line to its first commit at d1. The corner is rounded.
   */
  const arm = (d0: number, a0: number, d1: number, id: number): MetroPoint[] => {
    const ray = lines[id].angle
    const turn = Math.abs(ray - a0)
    const on = Math.min(d1, (base + d0) * Math.exp(turn / species.armSlope) - base)
    const sign = ray >= a0 ? 1 : -1
    const sweep = Math.min(40, Math.max(2, Math.ceil(((on - d0) * Math.hypot(1, species.armSlope)) / (2 * PIECE))))
    const pts: MetroPoint[] = []
    for (let k = 0; k <= sweep; k++) {
      const d = d0 + ((on - d0) * k) / sweep
      const a = k === sweep ? swayed(id, on) : a0 + sign * Math.min(turn, species.armSlope * Math.log((base + d) / (base + d0)))
      pts.push(point(d, a))
    }
    const tail = Math.max(1, Math.ceil((d1 - on) / (2 * PIECE)))
    for (let k = 1; k <= tail && d1 > on; k++) {
      const d = on + ((d1 - on) * k) / tail
      pts.push(point(d, swayed(id, d)))
    }
    return soften(pts)
  }

  // ---- taper: what each commit carries, itself and everything growing above it
  const carried = new Float64Array(n)
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]
    carried[i] += 1
    if (parent[i] !== -1) carried[parent[i]] += carried[i] + graph.links[parentLink[i]].collapsedCount
  }
  let whole = 1
  for (let i = 0; i < n; i++) if (parent[i] === -1 && carried[i] > whole) whole = carried[i]
  /** a link's width for the commits it carries: the square root of their share of the whole coral */
  const taper = (load: number) => species.girth * (TAPER_MIN + (TAPER_MAX - TAPER_MIN) * Math.sqrt(Math.min(1, load / whole)))

  // ---- living tips: how long ago each line, or anything above it, last moved
  const polyps = new Set<string>()
  const bleach = new Map<string, number>()
  {
    let newest = -Infinity
    const time = nodes.map((node) => Date.parse(node.commit.date))
    for (const t of time) if (Number.isFinite(t) && t > newest) newest = t
    const now = opts.now ?? newest
    const quiet = (t: number) => (Number.isFinite(t) && Number.isFinite(now) ? Math.min(1, Math.max(0, ((now - t) / DAY_MS - FRESH_DAYS) / (BLEACH_DAYS - FRESH_DAYS))) : 0)
    // a line's own newest commit is its last; lines are numbered parents first, so the freshest above folds down
    for (const line of lines) line.bleach = quiet(time[line.nodes[line.nodes.length - 1]])
    for (let id = lines.length - 1; id >= 0; id--) {
      const from = lines[id].parent
      if (from !== -1 && lines[id].bleach < lines[from].bleach) lines[from].bleach = lines[id].bleach
    }
    for (let i = 0; i < n; i++) {
      const line = lines[lineOf[i]]
      if (line.bleach > 0) bleach.set(nodes[i].id, line.bleach)
      // a tip that itself moved lately, at the end of a line a branch claims
      if (nodes[i].isTip && claim[i] !== -1 && quiet(time[i]) === 0 && Number.isFinite(time[i]) && (now - time[i]) / DAY_MS <= FRESH_DAYS) polyps.add(nodes[i].id)
    }
  }

  const routes: MetroRoute[] = []
  const interchange = new Uint8Array(n)
  for (let c = 0; c < n; c++) {
    const p = parent[c]
    if (p === -1) continue
    const k = parentLink[c]
    const link = graph.links[k]
    const onLine = lineOf[p] === lineOf[c]
    if (!onLine) interchange[p] = 1
    routes.push({
      linkIndex: k,
      source: link.source,
      target: link.target,
      points: onLine ? along(lineOf[c], depth[p], depth[c]) : arm(depth[p], angleOf(p), depth[c], lineOf[c]),
      kind: onLine ? 'line' : 'fork',
      lane: fanPos[lineOf[c]] - at,
      colorBranch: link.owner,
      // an arm no branch claims: a merged branch whose ref is gone
      muted: claim[c] === -1,
      dashed: false,
      hidden: link.collapsedCount,
      weight: taper(carried[c] + link.collapsedCount),
      bleach: lines[lineOf[c]].bleach,
    })
  }
  for (const [k, c, p] of merges) {
    const link = graph.links[k]
    interchange[c] = 1
    interchange[p] = 1
    routes.push({
      linkIndex: k,
      source: link.source,
      target: link.target,
      // a bridge across the fan, from the merged commit to the merge
      points: curve(depth[p], angleOf(p), depth[c], angleOf(c), smooth, smooth),
      kind: 'cross',
      lane: fanPos[lineOf[p]] - at,
      // a merge keeps the merged branch's colour, as on the metro map; faint, so the arms stay the picture
      colorBranch: nodes[p].owner,
      muted: true,
      dashed: true,
      hidden: link.collapsedCount,
    })
  }
  routes.sort((a, b) => a.linkIndex - b.linkIndex)

  // ---- stations
  const stations = new Map<string, MetroStationKind>()
  for (let i = 0; i < n; i++) stations.set(nodes[i].id, stationKind(nodes[i], parent[i] === -1, interchange[i] === 1, children[i].length === 0))

  // ---- stubs: a dashed lead-in under each root whose history is cut off
  const stubs: MetroStub[] = []
  for (let i = 0; i < n; i++) {
    if (!nodes[i].isRoot || parent[i] !== -1) continue
    stubs.push({ nodeId: nodes[i].id, colorBranch: nodes[i].owner, points: [point(depth[i] - STUB, angleOf(i)), point(depth[i], angleOf(i))] })
  }

  // ---- runs: where a link hides commits, marked halfway along it with the count beside the line
  const runs: MetroRun[] = []
  for (const route of routes) {
    if (route.hidden <= 0) continue
    const mid = middle(route.points)
    // beside the line, on the side away from the stalk
    const side = mid.x >= 0 ? 1 : -1
    const nx = -mid.dy
    const ny = mid.dx
    const out = (nx >= 0 ? 1 : -1) * side
    runs.push({
      linkIndex: route.linkIndex,
      hidden: route.hidden,
      x: mid.x,
      y: mid.y,
      room: 0,
      markerX: mid.x + nx * out * RUN_TEXT_OFFSET,
      markerY: mid.y + ny * out * RUN_TEXT_OFFSET,
    })
  }

  // ---- bounds
  const bounds: MetroBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  const widen = (p: MetroPoint) => {
    if (p.x < bounds.minX) bounds.minX = p.x
    if (p.x > bounds.maxX) bounds.maxX = p.x
    if (p.y < bounds.minY) bounds.minY = p.y
    if (p.y > bounds.maxY) bounds.maxY = p.y
  }
  for (const p of positions.values()) widen(p)
  for (const stub of stubs) widen(stub.points[0])
  if (!Number.isFinite(bounds.minX)) Object.assign(bounds, { minX: 0, maxX: 0, minY: 0, maxY: 0 })

  // every branch -> where its tip's line sits in the fan (0 the stalk, - left, + right)
  const lanes = new Map<string, number>()
  for (let i = 0; i < n; i++) for (const tip of nodes[i].tips) lanes.set(tip, fanPos[lineOf[i]] - at)

  return {
    positions,
    lanes,
    laneHints: new Map(lanes),
    routes,
    stations,
    labels: [],
    runs,
    stubs,
    segments: [],
    bounds,
    boundsWithLabels: { minX: bounds.minX - 1, maxX: bounds.maxX + 1, minY: bounds.minY - 1, maxY: bounds.maxY + 1 },
    laneCount: lines.length,
    railCount: 0,
    columns: Math.ceil(maxDepth) + 1,
    mode: full ? 'full' : 'skeleton',
    fit: 'whole',
    bleach,
    polyps,
  }
}

/** What a commit is on the coral, in metro's station kinds. */
function stationKind(node: GraphNode, rooted: boolean, interchange: boolean, ends: boolean): MetroStationKind {
  if (rooted) return 'origin'
  if (interchange) return 'interchange'
  if (!isSkeletonNode(node)) return 'commit'
  return ends ? 'terminus' : 'stop'
}

/** Two rounds of corner cutting (Chaikin), keeping both ends: a polyline's one sharp turn becomes a curve. */
function soften(points: MetroPoint[]): MetroPoint[] {
  let pts = points
  for (let round = 0; round < 2 && pts.length > 2; round++) {
    const out: MetroPoint[] = [pts[0]]
    for (let k = 0; k + 1 < pts.length; k++) {
      const p = pts[k]
      const q = pts[k + 1]
      out.push({ x: p.x + (q.x - p.x) * 0.25, y: p.y + (q.y - p.y) * 0.25 }, { x: p.x + (q.x - p.x) * 0.75, y: p.y + (q.y - p.y) * 0.75 })
    }
    out.push(pts[pts.length - 1])
    pts = out
  }
  return pts
}

/** The point halfway along a polyline, and the unit direction of the piece it is on. */
function middle(points: readonly MetroPoint[]): { x: number; y: number; dx: number; dy: number } {
  let total = 0
  for (let k = 1; k < points.length; k++) total += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y)
  let left = total / 2
  for (let k = 1; k < points.length; k++) {
    const dx = points[k].x - points[k - 1].x
    const dy = points[k].y - points[k - 1].y
    const len = Math.hypot(dx, dy)
    if (len <= 0) continue
    if (left <= len) return { x: points[k - 1].x + (dx * left) / len, y: points[k - 1].y + (dy * left) / len, dx: dx / len, dy: dy / len }
    left -= len
  }
  const p = points[0] ?? { x: 0, y: 0 }
  return { x: p.x, y: p.y, dx: 0, dy: -1 }
}
