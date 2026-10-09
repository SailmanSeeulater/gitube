/**
 * Pure helpers for the garden UI (no React, no DOM) so they can be unit-tested in node.
 */
import type { Branch, FetchStage, GraphNode } from '../types'

export const CANVAS_BG = '#1e1e1e'
export const TEXT_COLOUR = '#dcddde'
export const MUTED_COLOUR = '#999999'
export const ACCENT = '#a78bfa'
export const ROOT_FILL = '#5a5a5a'
export const ROOT_RING = '#8a8a8a'
export const FALLBACK_COLOUR = '#8b8b8b'
export const LABEL_FONT = 'Inter, ui-sans-serif, system-ui, sans-serif'
export const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

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
