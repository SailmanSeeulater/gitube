/**
 * The time-lapse clock: when each part of the shown graph appears as the map grows from its
 * oldest fetched commit to today.
 *
 * Progress runs 0..1 at an even pace of one step per commit, not per day, so a repo that slept for
 * a year does not show a year of nothing. Every commit appears by 1 - GROW_SPAN, which leaves the
 * last ones room to finish growing (see growth) before the end.
 *
 * Pure and deterministic. O(commits log commits).
 */
import type { GraphBody } from './build'
import { linkKey } from './contributors'

/** Progress a node or stem takes to grow in, from first sight to full size. */
export const GROW_SPAN = 0.015

export interface Timeline {
  /** Commit times (ms), ascending: every shown commit plus every commit hidden in a skeleton run. */
  times: Float64Array
  /** Shown node id -> progress at which it appears. */
  nodeAt: Map<string, number>
  /** linkKey of a skeleton link -> ascending progress at which each commit its run hides appears. */
  runAt: Map<string, Float64Array>
}

function timeOf(date: string): number {
  const t = Date.parse(date)
  return Number.isFinite(t) ? t : NaN
}

/** Index of the first entry >= t in an ascending array. */
function lowerBound(sorted: Float64Array, t: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Index of the first entry > p in an ascending array: how many are <= p. */
export function countUpTo(sorted: Float64Array, p: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] <= p) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The timeline of the shown graph. In skeleton view each link stands for a run of hidden commits;
 * full is the same graph uncollapsed (pass the shown graph itself in full view) and is walked to
 * date them. Undated commits appear at the start.
 */
export function buildTimeline(shown: GraphBody, full: GraphBody): Timeline {
  const timeById = new Map<string, number>()
  for (const node of full.nodes) timeById.set(node.id, timeOf(node.commit.date))
  for (const node of shown.nodes) if (!timeById.has(node.id)) timeById.set(node.id, timeOf(node.commit.date))

  const shownIds = new Set<string>()
  for (const node of shown.nodes) shownIds.add(node.id)

  // full graph: child -> parents (a commit skeleton view hides has exactly one)
  const parentsOf = new Map<string, string[]>()
  for (const link of full.links) {
    const list = parentsOf.get(link.source)
    if (list) list.push(link.target)
    else parentsOf.set(link.source, [link.target])
  }

  // the commits each shown link hides, walked as in collapseToSkeleton
  const runIds = new Map<string, string[]>()
  const counted = new Set<string>(shownIds)
  for (const node of shown.nodes) {
    for (const first of parentsOf.get(node.id) ?? []) {
      const hidden: string[] = []
      let target = first
      while (!shownIds.has(target)) {
        hidden.push(target)
        counted.add(target)
        const next = parentsOf.get(target)
        if (!next || next.length === 0) break
        target = next[0]
      }
      if (hidden.length > 0) runIds.set(linkKey(node.id, target), hidden)
    }
  }

  let minT = Infinity
  for (const id of counted) {
    const t = timeById.get(id) ?? NaN
    if (t < minT) minT = t
  }
  if (!Number.isFinite(minT)) minT = 0
  const at = (id: string): number => {
    const t = timeById.get(id) ?? NaN
    return Number.isNaN(t) ? minT : t
  }

  const times = new Float64Array(counted.size)
  let k = 0
  for (const id of counted) times[k++] = at(id)
  times.sort()

  // ties share a step: progress of the first commit at that time
  const last = Math.max(1, times.length - 1)
  const progressOf = (t: number): number => (lowerBound(times, t) / last) * (1 - GROW_SPAN)

  const nodeAt = new Map<string, number>()
  for (const node of shown.nodes) nodeAt.set(node.id, progressOf(at(node.id)))
  const runAt = new Map<string, Float64Array>()
  for (const [key, ids] of runIds) {
    const ps = new Float64Array(ids.length)
    ids.forEach((id, i) => (ps[i] = progressOf(at(id))))
    ps.sort()
    runAt.set(key, ps)
  }
  return { times, nodeAt, runAt }
}

/** 0 before something has appeared, rising to 1 over GROW_SPAN of progress. */
export function growth(at: number, progress: number): number {
  if (progress < at) return 0
  return Math.min(1, (progress - at) / GROW_SPAN)
}

/** The commit time (ms) the clock shows at a progress, and how many commits have appeared by then. */
export function clockAt(timeline: Timeline, progress: number): { time: number; commits: number } {
  const n = timeline.times.length
  if (n === 0) return { time: NaN, commits: 0 }
  const last = Math.max(1, n - 1)
  const step = Math.min(n - 1, Math.max(0, Math.floor((Math.min(progress, 1 - GROW_SPAN) / (1 - GROW_SPAN)) * last + 1e-9)))
  // every commit at or before that step's time has appeared
  return { time: timeline.times[step], commits: countUpTo(timeline.times, timeline.times[step]) }
}

/**
 * How much of a stem is drawn, 0..1, growing from the parent towards the child: a run's hidden
 * commits each add an equal share as they appear, and the child's own growth adds the last one.
 * Nothing shows until the parent has appeared.
 */
export function stemGrowth(timeline: Timeline, source: string, target: string, progress: number): number {
  const parentAt = timeline.nodeAt.get(target)
  if (parentAt === undefined || progress < parentAt) return 0
  const child = growth(timeline.nodeAt.get(source) ?? 0, progress)
  const run = timeline.runAt.get(linkKey(source, target))
  if (!run || run.length === 0) return child
  const k = countUpTo(run, progress)
  // the newest hidden commit is still growing in; earlier ones are done
  const partial = k > 0 ? k - 1 + growth(run[k - 1], progress) : 0
  return Math.min(1, (partial + child) / (run.length + 1))
}

/** Commits of a run that have appeared (the '+N' badge while it grows). */
export function runShown(timeline: Timeline, source: string, target: string, progress: number): number {
  const run = timeline.runAt.get(linkKey(source, target))
  return run ? countUpTo(run, progress) : 0
}
