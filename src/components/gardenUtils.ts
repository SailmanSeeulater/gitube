/**
 * Pure helpers for the garden UI (no React, no DOM) so they can be unit-tested in node.
 */
import type { Branch, FetchStage, GraphNode } from '../types'
import type { LabelSpec } from './labelPlacement'

export const CANVAS_BG = '#1e1e1e'
export const TEXT_COLOUR = '#dcddde'
export const MUTED_COLOUR = '#999999'
export const ACCENT = '#a78bfa'
export const ROOT_FILL = '#5a5a5a'
export const ROOT_RING = '#8a8a8a'
export const FALLBACK_COLOUR = '#8b8b8b'
export const LABEL_FONT = 'Inter, ui-sans-serif, system-ui, sans-serif'
export const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
/** Opacity of nodes, links and labels outside the hovered neighbourhood or the selected reach. */
export const DIM_ALPHA = 0.2

const DAY_MS = 86_400_000

export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value
}

/** Base circle radius: clamp(2 + sqrt(reach) * 1.2, 2, 9). */
export function nodeRadius(reach: number): number {
  const r = Number.isFinite(reach) && reach > 0 ? reach : 0
  return clamp(2 + Math.sqrt(r) * 1.2, 2, 9)
}

/** Radius of the filled body including the +2 tip bump. */
export function bodyRadius(node: Pick<GraphNode, 'reach' | 'isTip'>): number {
  return nodeRadius(node.reach) + (node.isTip ? 2 : 0)
}

/** '#rgb' | '#rrggbb' | '#rrggbbaa' -> 'rgba(r, g, b, a)'. Non-hex input is returned unchanged. */
export function hexToRgba(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{3,8})$/i.exec(hex.trim())
  if (!match) return hex
  let h = match[1]
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 && h.length !== 8) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`
}

export type LinkEnd = string | number | { id?: string | number } | null | undefined

/** react-force-graph swaps link.source/target from ids to node objects at runtime; this reads the id either way. */
export function linkEndId(end: LinkEnd): string {
  if (end === null || end === undefined) return ''
  if (typeof end === 'object') return end.id === undefined ? '' : String(end.id)
  return String(end)
}

export interface LinkLike {
  source: LinkEnd
  target: LinkEnd
}

/** node id -> set of 1-hop neighbour ids (undirected). */
export function buildNeighbourIndex(links: ReadonlyArray<LinkLike>): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  const add = (a: string, b: string) => {
    let set = index.get(a)
    if (!set) {
      set = new Set<string>()
      index.set(a, set)
    }
    set.add(b)
  }
  for (const link of links) {
    const s = linkEndId(link.source)
    const t = linkEndId(link.target)
    if (!s || !t) continue
    add(s, t)
    add(t, s)
  }
  return index
}

/**
 * Curvature per link (index-aligned with `links`) so parallel links, same child and same
 * parent, fan out instead of being drawn on one segment. That happens in skeleton mode when a
 * merge's parents all collapse to the same fork point (a merged side branch whose ref was
 * deleted). The k-th of n links sharing an ordered (source, target) pair gets
 * 0.25 * (k - (n - 1) / 2), symmetric around straight; a lone link gets 0 and stays straight.
 * Links are child -> parent in a DAG, so the key is ordered.
 */
export function assignLinkCurvature(links: ReadonlyArray<LinkLike>): number[] {
  const counts = new Map<string, number>()
  const keys = links.map((link) => {
    const key = `${linkEndId(link.source)}\0${linkEndId(link.target)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
    return key
  })
  const seen = new Map<string, number>()
  return keys.map((key) => {
    const count = counts.get(key) ?? 1
    const k = seen.get(key) ?? 0
    seen.set(key, k + 1)
    return count === 1 ? 0 : 0.25 * (k - (count - 1) / 2)
  })
}

/**
 * branch name -> set of node ids reachable from that branch's tip by walking links child -> parent.
 * Branches whose tip is not in the node list get no entry.
 */
export function buildBranchReach(
  nodes: ReadonlyArray<Pick<GraphNode, 'id' | 'tips'>>,
  links: ReadonlyArray<LinkLike>,
): Map<string, Set<string>> {
  const parents = new Map<string, string[]>()
  for (const link of links) {
    const s = linkEndId(link.source)
    const t = linkEndId(link.target)
    if (!s || !t) continue
    let list = parents.get(s)
    if (!list) {
      list = []
      parents.set(s, list)
    }
    list.push(t)
  }
  const reach = new Map<string, Set<string>>()
  for (const node of nodes) {
    if (node.tips.length === 0) continue
    const visited = new Set<string>([node.id])
    const stack: string[] = [node.id]
    while (stack.length > 0) {
      const current = stack.pop() as string
      const ps = parents.get(current)
      if (!ps) continue
      for (const p of ps) {
        if (!visited.has(p)) {
          visited.add(p)
          stack.push(p)
        }
      }
    }
    for (const tip of node.tips) reach.set(tip, visited)
  }
  return reach
}

/**
 * The node ids to keep lit for the selected branch, or null when nothing should be isolated.
 * A selection with no reach entry (the branch was hidden by the stale filter, or its tip is
 * not in the graph) means "nothing to isolate", never "isolate nothing": falling back to an
 * empty set would dim the entire canvas.
 */
export function selectedReach(
  reach: ReadonlyMap<string, ReadonlySet<string>>,
  selected: string | null,
): ReadonlySet<string> | null {
  if (selected === null) return null
  return reach.get(selected) ?? null
}

/**
 * The one dim rule shared by nodes, links' ends and labels: a node is dimmed when something is
 * hovered and it is neither that node nor one of its 1-hop neighbours, or when a branch is
 * selected and the node is outside its reach.
 */
export function isDimmed(
  id: string,
  hovered: string | null,
  neighbours: ReadonlyMap<string, ReadonlySet<string>>,
  reach: ReadonlySet<string> | null,
): boolean {
  if (hovered !== null && hovered !== id) {
    const near = neighbours.get(hovered)
    if (near === undefined || !near.has(id)) return true
  }
  return reach !== null && !reach.has(id)
}

// ---------- fit to view ----------

export interface FitPadding {
  left: number
  right: number
  top: number
  bottom: number
}

export interface FitBbox {
  x: readonly [number, number] | readonly number[]
  y: readonly [number, number] | readonly number[]
}

/** Garden's fit-to-view padding in screen px; symmetric because labels flip to the left near the right edge. */
export const FIT_PAD: FitPadding = { left: 96, right: 96, top: 72, bottom: 72 }
/** Fit-to-view never zooms in further than this. */
export const FIT_MAX_ZOOM = 2.5

/**
 * Camera (zoom k, graph-space centre cx/cy) that fits a graph bbox into the padded canvas, with the
 * zoom capped at maxZoom so a four-node repo does not become four giant discs. The centre is
 * shifted so the padded area, not the raw canvas, is what the bbox fills. A zero-size bbox (one
 * node) is treated as 1 graph unit wide so k stays finite (and then hits the cap).
 */
export function fitTransform(
  bbox: FitBbox,
  size: { width: number; height: number },
  pad: FitPadding,
  maxZoom: number,
): { k: number; cx: number; cy: number } {
  const x0 = bbox.x[0]
  const x1 = bbox.x[1]
  const y0 = bbox.y[0]
  const y1 = bbox.y[1]
  const bw = Math.max(x1 - x0, 1)
  const bh = Math.max(y1 - y0, 1)
  const availW = Math.max(size.width - pad.left - pad.right, 50)
  const availH = Math.max(size.height - pad.top - pad.bottom, 50)
  const k = Math.min(availW / bw, availH / bh, maxZoom)
  const cx = (x0 + x1) / 2 - (pad.left - pad.right) / (2 * k)
  const cy = (y0 + y1) / 2 - (pad.top - pad.bottom) / (2 * k)
  return { k, cx, cy }
}

export const STALE_OPTIONS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 0, label: 'all' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
]

export function isStale(tipDate: string, staleDays: number, now: number = Date.now()): boolean {
  if (staleDays <= 0) return false
  const t = Date.parse(tipDate)
  if (!Number.isFinite(t)) return false
  return now - t > staleDays * DAY_MS
}

/** Names of non-default branches whose tip is older than staleDays. Empty when staleDays is 0. */
export function staleBranchNames(branches: ReadonlyArray<Branch>, staleDays: number, now: number = Date.now()): string[] {
  if (staleDays <= 0) return []
  const out: string[] = []
  for (const b of branches) {
    if (!b.isDefault && isStale(b.tipDate, staleDays, now)) out.push(b.name)
  }
  return out
}

/** '3d ago' style relative time. Empty string for unparsable input. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const seconds = Math.floor((now - t) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${Math.max(1, years)}y ago`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Parses an ISO date or an epoch-seconds string (GitHub's x-ratelimit-reset header). NaN when invalid. */
export function parseWhen(value: string | null | undefined): number {
  if (!value) return NaN
  const trimmed = value.trim()
  if (/^\d{9,11}$/.test(trimmed)) return Number(trimmed) * 1000
  if (/^\d{12,}$/.test(trimmed)) return Number(trimmed)
  return Date.parse(trimmed)
}

/** Local 'HH:MM', or '' when the input is missing/invalid. */
export function formatClock(value: string | null | undefined): string {
  const t = parseWhen(value)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Local 'YYYY-MM-DD HH:MM', or '' when invalid. */
export function formatDateTime(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

export function stageLabel(stage: FetchStage): string {
  switch (stage) {
    case 'repo':
      return 'reading repo'
    case 'branches':
      return 'listing branches'
    case 'compare':
      return 'comparing branches'
    case 'trunk':
      return 'walking trunk'
    case 'done':
      return 'done'
  }
}

// ---------- time force ----------

export interface TimeForceNode {
  x?: number
  vx?: number
  commit: { date: string }
}

/** A d3-style force: callable with alpha, with initialize(nodes) and a strength setter. */
export type TimeForce = {
  (alpha: number): void
  initialize: (nodes: ReadonlyArray<TimeForceNode>) => void
  strength: (value: number) => TimeForce
}

/**
 * Weak horizontal force mapping commit date -> x over [-width/2, width/2] (older left).
 * Uses date rank rather than raw timestamps so a long-tail history does not squash recent
 * commits into one column. Mirrors d3's forceX: vx += (targetX - x) * strength * alpha.
 */
export function createTimeForce(getWidth: () => number, initialStrength: number = 0.03): TimeForce {
  let nodes: ReadonlyArray<TimeForceNode> = []
  let fractions = new Float64Array(0)
  let strength = initialStrength

  const force = ((alpha: number) => {
    const width = getWidth()
    if (!(width > 0)) return
    const count = Math.min(nodes.length, fractions.length)
    const k = strength * alpha
    for (let i = 0; i < count; i++) {
      const node = nodes[i]
      const x = node.x
      if (x === undefined || Number.isNaN(x)) continue
      const targetX = (fractions[i] - 0.5) * width
      node.vx = (node.vx ?? 0) + (targetX - x) * k
    }
  }) as TimeForce

  force.initialize = (next) => {
    nodes = next
    fractions = new Float64Array(next.length)
    if (next.length === 0) return
    const times = new Float64Array(next.length)
    const order: number[] = []
    for (let i = 0; i < next.length; i++) {
      const t = Date.parse(next[i].commit.date)
      times[i] = t
      if (Number.isFinite(t)) order.push(i)
      else fractions[i] = 0.5
    }
    order.sort((a, b) => times[a] - times[b])
    const denom = order.length - 1
    for (let rank = 0; rank < order.length; rank++) {
      fractions[order[rank]] = denom <= 0 ? 0.5 : rank / denom
    }
  }

  force.strength = (value) => {
    strength = value
    return force
  }

  return force
}

// ---------- branch labels ----------

/** Text width in screen px at the label font (canvas measureText in the app, a fake in tests). */
export type Measure = (text: string) => number

/** Widest a placed label may be (the wide form). */
export const LABEL_MAX_W = 220
/** Widest the compact fallback form may be. */
export const LABEL_COMPACT_W = 130
/** A compact form is only kept when it is at least this much narrower than the wide one. */
export const LABEL_COMPACT_MIN_SAVING = 8

const ELLIPSIS = '…'
const SEPARATORS = '-_/.'
/** How far (in characters) an ellipsis cut may move to land on a separator. */
const SNAP_CHARS = 4

function isSeparator(ch: string | undefined): boolean {
  return ch !== undefined && ch.length === 1 && SEPARATORS.includes(ch)
}

/** Character distance from the cut point `cut` (between text[cut - 1] and text[cut]) to the separator at s. */
function cutDistance(cut: number, s: number): number {
  return Math.min(Math.abs(cut - s), Math.abs(cut - (s + 1)))
}

/** Head ends (exclusive) whose last kept character is a separator within SNAP_CHARS of the cut h0. */
function headSnaps(text: string, h0: number, out: number[]): void {
  out.length = 0
  for (let s = Math.max(1, h0 - SNAP_CHARS - 1); s <= Math.min(text.length - 2, h0 + SNAP_CHARS); s++) {
    if (isSeparator(text[s]) && cutDistance(h0, s) <= SNAP_CHARS) out.push(s + 1)
  }
}

/** Tail starts on a separator within SNAP_CHARS of the cut t0 that leave a character after it. */
function tailSnaps(text: string, t0: number, out: number[]): void {
  out.length = 0
  for (let s = Math.max(1, t0 - SNAP_CHARS - 1); s <= Math.min(text.length - 2, t0 + SNAP_CHARS); s++) {
    if (isSeparator(text[s]) && cutDistance(t0, s) <= SNAP_CHARS) out.push(s)
  }
}

/**
 * Shared core of middleEllipsis and endEllipsis. The longest plain character cut that fits gives
 * the ideal cut points; each one then moves to a separator within ±SNAP_CHARS when there is one, so
 * a cut lands between words, and the kept part shrinks further while every snapped form is too
 * wide. A side with no separator near keeps its character cut. headFrac >= 1 keeps no tail.
 */
function ellipsize(text: string, maxW: number, measure: Measure, headFrac: number): string {
  if (measure(text) <= maxW) return text
  const n = text.length
  if (n <= 1) return text
  const endOnly = headFrac >= 1
  const cutsOf = (keep: number): [number, number] => {
    if (endOnly) return [Math.max(1, keep), n]
    let head = Math.max(1, Math.ceil(keep * headFrac))
    let tail = keep - head
    if (tail < 1 && keep >= 2) {
      tail = 1
      head = keep - 1
    }
    return [head, n - Math.max(0, tail)]
  }
  const make = (h: number, t: number) => text.slice(0, h) + ELLIPSIS + text.slice(t)
  // 1. the longest plain character cut that fits
  let lo = 1
  let hi = n - 1
  let keepMax = 0
  while (lo <= hi) {
    const keep = (lo + hi) >> 1
    const [h, t] = cutsOf(keep)
    if (measure(make(h, t)) <= maxW) {
      keepMax = keep
      lo = keep + 1
    } else hi = keep - 1
  }
  if (keepMax === 0) return text.slice(0, 1) + ELLIPSIS
  // 2. cut points on separators near the ideal ones: most characters kept wins, then the closest
  const heads: number[] = []
  const tails: number[] = []
  // (a middle ellipsis never gives up its last character for a snap: it stops at two kept)
  for (let keep = keepMax; keep >= (endOnly ? 1 : Math.min(2, keepMax)); keep--) {
    const [h0, t0] = cutsOf(keep)
    headSnaps(text, h0, heads)
    if (heads.length === 0) heads.push(h0)
    if (t0 >= n) {
      tails.length = 0
      tails.push(n)
    } else {
      tailSnaps(text, t0, tails)
      if (tails.length === 0) tails.push(t0)
    }
    let best: string | null = null
    let bestKept = -1
    let bestDist = Infinity
    for (const p of heads) {
      for (const q of tails) {
        if (q <= p) continue
        const kept = p + (n - q)
        const dist = Math.abs(p - h0) + Math.abs(q - t0)
        if (kept < bestKept || (kept === bestKept && dist >= bestDist)) continue
        const cand = make(p, q)
        if (measure(cand) > maxW) continue
        best = cand
        bestKept = kept
        bestDist = dist
      }
    }
    if (best !== null) return best
  }
  const [h, t] = cutsOf(keepMax)
  return make(h, t)
}

/**
 * Shortens text to at most maxW by cutting out its middle ('fix/app-…-subdomain'). The kept part
 * is head-weighted (headFrac of the kept characters, 0.6 by default), and each cut point moves to
 * a separator ('-', '_', '/', '.') within ±4 characters, keeping the separator, so a cut lands
 * between words rather than inside one ('fix/…-subdomain', never '…ubdomain'); with no separator
 * near, that side is cut between characters. Returns the text unchanged when it fits, and keeps
 * the first and last characters whenever at least two characters fit.
 */
export function middleEllipsis(text: string, maxW: number, measure: Measure, headFrac = 0.6): string {
  return ellipsize(text, maxW, measure, Math.min(Math.max(headFrac, 0), 0.99))
}

/** Like middleEllipsis but keeps only the start ('dependabot/github_…'), snapped the same way. */
export function endEllipsis(text: string, maxW: number, measure: Measure): string {
  return ellipsize(text, maxW, measure, 1)
}

/** Characters of the original text a shortened form keeps (every '…' is one inserted character). */
function keptChars(s: string): number {
  let n = s.length
  for (const ch of s) if (ch === ELLIPSIS) n--
  return n
}

/**
 * How many ends of the parts a shortened form of text cut out fall inside a word (not next to a
 * separator or the end of the text). The kept parts are a prefix, the middles in order, a suffix.
 */
function midWordCuts(text: string, short: string): number {
  const parts = short.split(ELLIPSIS)
  const n = text.length
  let cursor = 0
  let bad = 0
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]
    const pos = k === 0 ? 0 : k === parts.length - 1 ? n - part.length : text.indexOf(part, cursor)
    if (pos < 0) return Infinity
    if (k > 0) {
      // the cut-out part [cursor, pos)
      if (!(cursor === 0 || isSeparator(text[cursor - 1]) || isSeparator(text[cursor]))) bad++
      if (!(pos === n || isSeparator(text[pos]) || isSeparator(text[pos - 1]))) bad++
    }
    cursor = pos + part.length
  }
  return bad
}

/**
 * Shortens text to at most maxW without cutting into text[start, end) (a search match). It tries a
 * middle cut wholly after the match and one wholly before it, snapped to separators as in
 * middleEllipsis, and a window around the match ('…-stacktrace-with-v8', '…-skip-tags-…') grown
 * towards the end of the name first (where branches of one family differ), then towards its start;
 * the form keeping the most characters wins, a cut inside a word counting as SNAP_CHARS fewer.
 * Returns null when not even '…' + match + '…' fits.
 */
export function ellipsizeAround(text: string, start: number, end: number, maxW: number, measure: Measure): string | null {
  if (measure(text) <= maxW) return text
  const n = text.length
  const s0 = Math.min(Math.max(0, start), n)
  const e0 = Math.min(Math.max(s0, end), n)
  const match = text.slice(s0, e0)
  // most characters kept wins, each cut inside a word counting as SNAP_CHARS fewer
  let best: string | null = null
  let bestScore = -Infinity
  let bestKept = -1
  const consider = (cand: string) => {
    if (!cand.includes(match) || measure(cand) > maxW) return
    const kept = keptChars(cand)
    const score = kept - SNAP_CHARS * midWordCuts(text, cand)
    if (score > bestScore || (score === bestScore && kept > bestKept)) {
      best = cand
      bestScore = score
      bestKept = kept
    }
  }
  // the cut wholly after the match: keep text[0, end) and shorten the rest (never to a lone character)
  const head = text.slice(0, e0)
  const after = text.slice(e0)
  if (after.length > 0) {
    const room = maxW - measure(head)
    for (const part of [middleEllipsis(after, room, measure), middleEllipsis(after, room, measure, 0.3), endEllipsis(after, room, measure)]) {
      const tail = part.slice(part.indexOf(ELLIPSIS) + 1)
      if (part.includes(ELLIPSIS) && tail.length === 1 && !isSeparator(tail)) continue
      consider(head + part)
    }
  }
  // the cut wholly before it: keep text[start, n) and shorten the start of the name
  const before = text.slice(0, s0)
  const rest = text.slice(s0)
  if (before.length > 0) {
    const room = maxW - measure(rest)
    for (const part of [middleEllipsis(before, room, measure), middleEllipsis(before, room, measure, 0.3)]) {
      const lead = part.slice(0, Math.max(0, part.indexOf(ELLIPSIS)))
      if (part.includes(ELLIPSIS) && lead.length === 1 && !isSeparator(lead)) continue
      consider(part + rest)
    }
  }
  // a window around the match
  const windowOf = (a: number, b: number) => (a > 0 ? ELLIPSIS : '') + text.slice(a, b) + (b < n ? ELLIPSIS : '')
  if (measure(windowOf(s0, e0)) <= maxW) {
    let b = e0
    while (b < n && measure(windowOf(s0, b + 1)) <= maxW) b++
    if (b < n) {
      // end the window after a separator within reach, so it stops between words
      for (let s = b - 1; s >= Math.max(e0, b - SNAP_CHARS); s--) {
        if (isSeparator(text[s])) {
          b = s + 1
          break
        }
      }
    }
    let a = s0
    while (a > 0 && measure(windowOf(a - 1, b)) <= maxW) a--
    if (a > 0) {
      // start it on a separator within reach
      for (let s = a; s <= Math.min(s0, a + SNAP_CHARS); s++) {
        if (isSeparator(text[s])) {
          a = s
          break
        }
      }
    }
    consider(windowOf(a, b))
  }
  return best
}

/** A branch name without a trailing '-<hex>' or '-<timestamp>' suffix (7+ hex digits). */
function stripHashSuffix(name: string): string {
  const stripped = name.replace(/-[0-9a-f]{7,}$/i, '')
  return stripped.length > 0 ? stripped : name
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/**
 * 'feature/…rollup-…': the first path segment, then the name from the start of the token where it
 * first differs from its closest sibling, end-ellipsized to fit; null when that does not fit maxW.
 */
function diffAnchored(name: string, siblings: readonly string[], maxW: number, measure: Measure): string | null {
  if (measure(name) <= maxW) return name
  const d = Math.max(0, ...siblings.map((s) => commonPrefixLen(name, s)))
  let w = Math.min(d, name.length)
  while (w > 0 && !isSeparator(name[w - 1])) w--
  const slash = name.indexOf('/')
  const head = slash >= 0 && slash + 1 <= w ? name.slice(0, slash + 1) : ''
  const lead = head + (w > head.length ? ELLIPSIS : '')
  const out = lead + endEllipsis(name.slice(w), maxW - measure(lead), measure)
  return measure(out) <= maxW ? out : null
}

/**
 * Structural shortenings of one branch name, most informative first and the name itself first:
 * the name without a trailing '-<hex>' or '-<timestamp>' suffix (7+ hex digits), then, for 3+
 * path segments, 'a/…/z' and 'a/b/…'.
 */
export function nameCandidates(name: string): string[] {
  const out = [name]
  const stripped = stripHashSuffix(name)
  if (stripped !== name) out.push(stripped)
  const parts = stripped.split('/')
  if (parts.length >= 3) {
    out.push(`${parts[0]}/${ELLIPSIS}/${parts[parts.length - 1]}`)
    out.push(`${parts[0]}/${parts[1]}/${ELLIPSIS}`)
  }
  return out
}

/**
 * One display string per name, each at most maxW wide (one width for all, or one per name): the
 * first structural candidate that fits, moving to a later candidate when two names would otherwise
 * read the same, and a middle ellipsis when no candidate fits. Names that still read the same after
 * that (the dependabot family: same bot prefix, same '-patch' ending) all switch to one form that
 * keeps where they differ: the start ('dependabot/github_…'), else more of the end, else the part
 * from where each name first differs from the others ('feature/…rollup-…' next to
 * 'feature/…esbuild-…'). Names can still read the same only when no form that fits the width
 * separates them. Deterministic.
 */
export function shortLabels(names: readonly string[], maxW: number | readonly number[], measure: Measure): string[] {
  const widthOf = (i: number) => (typeof maxW === 'number' ? maxW : (maxW[i] ?? LABEL_MAX_W))
  const fits = names.map((n, i) => nameCandidates(n).filter((c) => measure(c) <= widthOf(i)))
  const fallback = names.map((n, i) => middleEllipsis(stripHashSuffix(n), widthOf(i), measure))
  const pick: number[] = names.map((_, i) => (fits[i].length > 0 ? 0 : -1))
  const text = (i: number) => (pick[i] >= 0 ? fits[i][pick[i]] : fallback[i])
  for (let round = 0; round < 3; round++) {
    const seen = new Map<string, number[]>()
    names.forEach((_, i) => {
      const t = text(i)
      const list = seen.get(t)
      if (list) list.push(i)
      else seen.set(t, [i])
    })
    let changed = false
    for (const group of seen.values()) {
      if (group.length < 2) continue
      for (const i of group) {
        const taken = new Set(names.map((_, k) => (k === i ? '' : text(k))))
        for (let c = pick[i] + 1; c < fits[i].length; c++) {
          if (!taken.has(fits[i][c])) {
            pick[i] = c
            changed = true
            break
          }
        }
      }
    }
    if (!changed) break
  }
  const out = names.map((_, i) => text(i))
  // last resort for names that still read the same: the whole group switches to one form that
  // keeps where they differ, provided it makes every member unique: the start, more of the end, or
  // the part from where each name first differs from its siblings ('feature/…rollup-…')
  const diffAlt = (i: number, group: number[]) =>
    diffAnchored(
      stripHashSuffix(names[i]),
      group.filter((k) => k !== i).map((k) => stripHashSuffix(names[k])),
      widthOf(i),
      measure,
    )
  const resolvers: ((i: number, group: number[]) => string | null)[] = [
    (i) => endEllipsis(stripHashSuffix(names[i]), widthOf(i), measure),
    (i) => middleEllipsis(names[i], widthOf(i), measure, 0.3),
    diffAlt,
  ]
  const groups = new Map<string, number[]>()
  out.forEach((t, i) => {
    const list = groups.get(t)
    if (list) list.push(i)
    else groups.set(t, [i])
  })
  for (const [current, group] of groups) {
    if (group.length < 2) continue
    const others = new Set(out.filter((_, k) => !group.includes(k)))
    let resolved = false
    for (const resolve of resolvers) {
      const alts = group.map((i) => resolve(i, group))
      if (alts.every((a) => a !== null) && new Set(alts).size === alts.length && alts.every((a) => !others.has(a!))) {
        group.forEach((i, g) => {
          out[i] = alts[g]!
        })
        resolved = true
        break
      }
    }
    if (resolved) continue
    // no form separates the whole group: members whose diff-anchored form is unique take it, so
    // one name that cannot be told apart does not keep the rest the same
    const alts = group.map((i) => diffAlt(i, group))
    group.forEach((i, g) => {
      const a = alts[g]
      if (a !== null && a !== current && alts.indexOf(a) === alts.lastIndexOf(a) && !others.has(a)) out[i] = a
    })
  }
  return out
}

const BOT_BRANCH = /^(dependabot|renovate|snyk|greenkeeper|pre-commit-ci|imgbot)[/-]|\[bot\]/i

/** Branches opened by dependency bots (dependabot/…, renovate/…, anything with '[bot]'). */
export function isBotBranch(name: string): boolean {
  return BOT_BRANCH.test(name)
}

/** 0 = the default branch, 1 = a human branch, 2 = a bot branch. */
export function labelTier(name: string, defaultBranch: string): 0 | 1 | 2 {
  if (name === defaultBranch) return 0
  return isBotBranch(name) ? 2 : 1
}

export interface LabelMeta {
  /** tier of the node's leading name (0 default, 1 human, 2 bot) */
  tier: 0 | 1 | 2
  /** tip commit time (ms), 0 when unparsable */
  date: number
  /** leading name, the tie-break */
  name: string
  nodeId: string
  /** every branch name at this tip, in label order */
  tips: string[]
}

/**
 * One label per tip node, index-aligned with `meta`. A node's names are ordered default, human,
 * bot, then by name, so 'main' leads 'main, dev'. texts[0] is the wide form: every name joined
 * when that fits LABEL_MAX_W, else the shortened leading name plus ' +N'; texts[1] is the compact
 * form (LABEL_COMPACT_W), kept only when it saves at least LABEL_COMPACT_MIN_SAVING px. Shortening
 * runs over all leading names at once so labels keep where they differ, and a compact form that
 * would read like another label (either of its forms) is dropped. Two wide forms can still read the
 * same only for names wider than LABEL_MAX_W that differ deep inside; the plate shows them in full.
 */
export function buildLabelSpecs(
  nodes: ReadonlyArray<{ id: string; tips: readonly string[]; commit: { date: string } }>,
  defaultBranch: string,
  measure: Measure,
): { specs: LabelSpec[]; meta: LabelMeta[] } {
  const tipNodes: number[] = []
  const tipsOf: string[][] = []
  const byTierThenName = (a: string, b: string) =>
    labelTier(a, defaultBranch) - labelTier(b, defaultBranch) || (a < b ? -1 : a > b ? 1 : 0)
  nodes.forEach((node, j) => {
    if (node.tips.length === 0) return
    tipNodes.push(j)
    tipsOf.push(node.tips.slice().sort(byTierThenName))
  })
  const leading = tipsOf.map((t) => t[0])
  // ' +N' for the other names at a multi-tip node; the shortened leading name leaves room for it
  const extras = tipsOf.map((t) => (t.length > 1 ? ` +${t.length - 1}` : ''))
  const extraW = extras.map((e) => (e === '' ? 0 : measure(e)))
  const wide = shortLabels(leading, extraW.map((w) => LABEL_MAX_W - w), measure)
  const compact = shortLabels(leading, extraW.map((w) => LABEL_COMPACT_W - w), measure)
  const v0s: string[] = []
  const v1s: string[] = []
  tipNodes.forEach((_, q) => {
    const joined = tipsOf[q].join(', ')
    v0s.push(measure(joined) <= LABEL_MAX_W ? joined : wide[q] + extras[q])
    v1s.push(compact[q] + extras[q])
  })
  // which labels each text is a form of, so a compact form that reads like another label is dropped
  const labelsOf = new Map<string, Set<number>>()
  const note = (t: string, q: number) => {
    const set = labelsOf.get(t)
    if (set) set.add(q)
    else labelsOf.set(t, new Set([q]))
  }
  tipNodes.forEach((_, q) => {
    note(v0s[q], q)
    note(v1s[q], q)
  })
  const specs: LabelSpec[] = []
  const meta: LabelMeta[] = []
  tipNodes.forEach((j, q) => {
    const tips = tipsOf[q]
    const joined = tips.join(', ')
    const joinedW = measure(joined)
    const v0 = v0s[q]
    const v1 = v1s[q]
    const w0 = measure(v0)
    const w1 = measure(v1)
    const unique = labelsOf.get(v1)!.size === 1
    const texts = unique && w1 <= w0 - LABEL_COMPACT_MIN_SAVING ? [v0, v1] : [v0]
    specs.push({
      node: j,
      texts,
      widths: texts.length === 2 ? [w0, w1] : [w0],
      fullText: joined,
      fullWidth: joinedW,
      names: tips,
      nameWidths: tips.map((t) => measure(t)),
    })
    const t = Date.parse(nodes[j].commit.date)
    meta.push({
      tier: labelTier(tips[0], defaultBranch),
      date: Number.isFinite(t) ? t : 0,
      name: tips[0],
      nodeId: nodes[j].id,
      tips,
    })
  })
  return { specs, meta }
}

/** Search hits are pinned (and get text forms that show the match) when there are at most this many. */
export const MAX_PINNED_SEARCH_HITS = 8

/**
 * Text forms of a search hit's label that show the match (query: trimmed, lower-cased), or null
 * when every stored form already shows it or no form that fits can. The wide form is the stored one
 * or the joined names when they contain the match and fit, else the first matching name shortened
 * around the match plus ' +N' for the node's other names (so a match on a later name leads the
 * label); the compact form likewise, kept only when it saves LABEL_COMPACT_MIN_SAVING px.
 */
export function matchLabelTexts(spec: LabelSpec, query: string, measure: Measure): { texts: string[]; widths: number[] } | null {
  if (query === '') return null
  const has = (t: string) => t.toLowerCase().includes(query)
  if (spec.texts.every(has)) return null
  const k = spec.names.findIndex(has)
  if (k < 0) return null
  const name = spec.names[k]
  const lower = name.toLowerCase()
  const at = lower.length === name.length ? lower.indexOf(query) : -1
  if (at < 0) return null
  const extra = spec.names.length > 1 ? ` +${spec.names.length - 1}` : ''
  const extraW = extra === '' ? 0 : measure(extra)
  const around = (maxW: number) => {
    const t = ellipsizeAround(name, at, at + query.length, maxW - extraW, measure)
    return t === null ? null : t + extra
  }
  const wide = has(spec.texts[0]) ? spec.texts[0] : has(spec.fullText) && measure(spec.fullText) <= LABEL_MAX_W ? spec.fullText : around(LABEL_MAX_W)
  if (wide === null) return null
  const w0 = measure(wide)
  const stored1 = spec.texts.length > 1 && has(spec.texts[1]) ? spec.texts[1] : null
  const compact = stored1 ?? around(LABEL_COMPACT_W)
  const texts = compact !== null && compact !== wide && measure(compact) <= w0 - LABEL_COMPACT_MIN_SAVING ? [wide, compact] : [wide]
  return { texts, widths: texts.map(measure) }
}

/**
 * Per-search text forms (label index -> forms) for the hits of a search that pins them (1 to
 * MAX_PINNED_SEARCH_HITS hits), so the label the placer keeps shows the match; empty otherwise.
 */
export function searchLabelTexts(
  specs: readonly LabelSpec[],
  hits: ReadonlySet<number>,
  query: string,
  measure: Measure,
): Map<number, { texts: string[]; widths: number[] }> {
  const out = new Map<number, { texts: string[]; widths: number[] }>()
  if (query === '' || hits.size === 0 || hits.size > MAX_PINNED_SEARCH_HITS) return out
  for (const i of hits) {
    const spec = specs[i]
    if (spec === undefined) continue
    const forms = matchLabelTexts(spec, query, measure)
    if (forms !== null) out.set(i, forms)
  }
  return out
}

export interface RankOptions {
  /** the selected branch's reach (node ids), or null when nothing is selected */
  reach: ReadonlySet<string> | null
  /** label indices whose names match the search */
  searchHits: ReadonlySet<number>
  /** label index of the selected branch's tip, -1 for none */
  selectedTip: number
  /** search hits are pinned when there are at most this many (8) */
  maxPinnedHits?: number
  /** how many of the most recent non-bot, non-dimmed tips are pinned (3) */
  recentPinned?: number
}

/**
 * Placement priority (most important first) and the pinned labels, which are placed before
 * everyone else and shown at once. Order: the selected tip, tips inside the selected reach (dimmed
 * ones sort last), search hits, default before human before bot, newer before older, then name.
 * Pinned: the default-branch tip, the selected tip, the search hits when there are at most
 * maxPinnedHits, and the recentPinned most recent non-bot tips that are not dimmed; returned in
 * rank order.
 */
export function rankLabels(
  meta: ReadonlyArray<LabelMeta>,
  opts: RankOptions,
): { order: Int32Array; pinned: number[]; softPinned: number[] } {
  const n = meta.length
  const { reach, searchHits, selectedTip } = opts
  const maxPinnedHits = opts.maxPinnedHits ?? MAX_PINNED_SEARCH_HITS
  const recentPinned = opts.recentPinned ?? 3
  const dimmed = new Uint8Array(n)
  for (let i = 0; i < n; i++) dimmed[i] = reach !== null && !reach.has(meta[i].nodeId) ? 1 : 0
  const byName = (a: number, b: number) => (meta[a].name < meta[b].name ? -1 : meta[a].name > meta[b].name ? 1 : a - b)
  const idx = Array.from({ length: n }, (_, i) => i)
  idx.sort(
    (a, b) =>
      (a === selectedTip ? 0 : 1) - (b === selectedTip ? 0 : 1) ||
      dimmed[a] - dimmed[b] ||
      (searchHits.has(a) ? 0 : 1) - (searchHits.has(b) ? 0 : 1) ||
      meta[a].tier - meta[b].tier ||
      meta[b].date - meta[a].date ||
      byName(a, b),
  )
  const pin = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (meta[i].tier === 0) pin[i] = 1
  if (selectedTip >= 0 && selectedTip < n) pin[selectedTip] = 1
  if (searchHits.size > 0 && searchHits.size <= maxPinnedHits) {
    for (const i of searchHits) if (i >= 0 && i < n) pin[i] = 1
  }
  // pinned only for being recent ('soft'): these wait for a fresh load's fit like everyone else
  const soft = new Uint8Array(n)
  if (recentPinned > 0) {
    const recent = idx
      .filter((i) => dimmed[i] === 0 && meta[i].tier !== 2)
      .sort((a, b) => meta[b].date - meta[a].date || byName(a, b))
    for (let q = 0; q < Math.min(recentPinned, recent.length); q++) {
      if (pin[recent[q]] === 0) soft[recent[q]] = 1
      pin[recent[q]] = 1
    }
  }
  return {
    order: Int32Array.from(idx),
    pinned: idx.filter((i) => pin[i] === 1),
    softPinned: idx.filter((i) => soft[i] === 1),
  }
}
