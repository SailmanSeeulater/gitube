/**
 * The git log view's layout (person mode's console views): `git log --graph` laid along the shared
 * time axis. The person's timeline is the trunk, along the horizon from their start to today; each
 * repo is a branch that forks off the trunk at its root day and runs on its own lane until its last
 * activity, with a commit on its active days, and the milestones are tags on the trunk.
 *
 * World units: x is days since the timeline's start, the same x as every person view (a day's middle
 * at +0.5); a branch sits on a lane, which gitLogGeometry turns into screen px. Lanes are packed like
 * the life lines' tracks: greedily in lane order, a branch taking the first lane whose last branch
 * ended a gap before it starts, so hundreds of repos share a few dozen lanes.
 *
 * Commits: the timeline keeps no per-day activity on its lanes, only spans. A detailed lane (tier 2)
 * has a commit on the first and last day of each active span (both are active days) and the rest of
 * the span's active days spread evenly between them; the painter thins them where they crowd. Any
 * other lane (tier 1, or no counted commits) has one at its root and one at its last push.
 *
 * Pure and deterministic. Nothing is read from a name: lanes are packed in lane order (which the
 * timeline makes independent of the profile's order and of names), language slots go by the first
 * lane of each language, and a branch's hash comes from its lane index, its days and its flags, so a
 * drawing cannot confirm a guess at a private repo's name.
 */
import type { ProfileData } from '../types'
import { repoKey } from './privacy'
import { dayNumber, type Lane, type LifeTimeline } from './timeline'
import { axisOf, type LifeViewItem, type LifeViewModel } from './lifeView'

/** Branches on one lane keep at least this many days apart... */
export const LANE_GAP_MIN_DAYS = 14
/** ...or this share of the life, whichever is more, so the gap (and the fork) still shows zoomed out. */
export const LANE_GAP_SHARE = 1 / 100
/** How many language slots the palette has (yellow, blue, purple, green, red). */
export const LANGUAGE_SLOTS = 5

/** The gap kept between two branches on one lane, in days. */
export function laneGapDays(days: number): number {
  return Math.max(LANE_GAP_MIN_DAYS, Math.round(days * LANE_GAP_SHARE))
}

/** One repo as the git log draws it. */
export interface GitBranch extends LifeViewItem {
  /** world x of its first day's start (its root's, or a backdated commit's) */
  x0: number
  /** world x of the end of its last active day: where the branch stops */
  x1: number
  rootDay: number
  /** its last active day (a day number): its tip, an archived repo's terminal */
  tipDay: number
  /** its row: 0 next to the trunk, counting up */
  track: number
  language: string | null
  /** the palette slot of its language, 0..LANGUAGE_SLOTS-1; -1 with no language */
  slot: number
  /** archived: ends in a terminal */
  archived: boolean
  fork: boolean
  /** a repo they only contributed to (isOwn false): its commits are hollow */
  visiting: boolean
  /** world x of each commit, a day's middle, ascending, no two on the same day */
  commits: Float64Array
  /** seven hex digits from its lane index, days and flags: never its name */
  hash: string
  /** world x free on its lane before it (since the last branch there ended); Infinity for the first */
  room: number
  /** counted commits with a token, active days without; labels go to the heaviest first */
  weight: number
  stars: number
}

export interface GitLogLayout extends LifeViewModel {
  /** in paint order: by track, then x, then lane order; byKey indexes it */
  branches: GitBranch[]
  /** how many lanes the branches take */
  tracks: number
  /** each language's palette slot, by its first lane */
  slots: ReadonlyMap<string, number>
}

/** Each language's palette slot, in order of the language's first lane, cycling through LANGUAGE_SLOTS. */
export function gitLogSlots(lanes: ReadonlyArray<Lane>): Map<string, number> {
  const slots = new Map<string, number>()
  for (const lane of lanes) if (lane.language !== null && !slots.has(lane.language)) slots.set(lane.language, slots.size % LANGUAGE_SLOTS)
  return slots
}

/** Seven hex digits (28 bits of FNV-1a) of a branch's non-name fields. */
export function branchHash(lane: number, rootDay: number, startDay: number, tipDay: number, flags: number): string {
  let h = 0x811c9dc5
  for (const n of [lane, rootDay, startDay, tipDay, flags]) {
    let v = n | 0
    for (let b = 0; b < 4; b++) {
      h ^= v & 0xff
      h = Math.imul(h, 0x01000193)
      v >>>= 8
    }
  }
  return ((h >>> 4) & 0xfffffff).toString(16).padStart(7, '0')
}

/** A lane's last active day, kept inside its days. */
function tipOf(lane: Lane): number {
  const last = dayNumber(lane.lastActive)
  const day = Number.isFinite(last) ? last : lane.endDay
  return Math.min(lane.endDay, Math.max(lane.startDay, lane.rootDay, day))
}

/** The days of a lane's commits, ascending and distinct (see the module's note). */
function commitDays(lane: Lane, tip: number): number[] {
  const days: number[] = []
  if (lane.detailed) {
    for (const span of lane.spans) {
      if (span.kind !== 'active') continue
      days.push(span.fromDay)
      const between = Math.min(span.activeDays, span.toDay - span.fromDay + 1) - 2
      for (let j = 1; j <= between; j++) days.push(span.fromDay + Math.round((j * (span.toDay - span.fromDay)) / (between + 1)))
      if (span.toDay > span.fromDay) days.push(span.toDay)
    }
  }
  if (days.length === 0) days.push(lane.rootDay, tip)
  days.sort((a, b) => a - b)
  return days.filter((day, i) => day <= tip && day >= lane.startDay && (i === 0 || day !== days[i - 1]))
}

/** With a token a lane weighs its counted commits; without one, its active days. */
function laneWeight(lane: Lane, source: ProfileData['source']): number {
  if (source === 'graphql') return lane.commits
  let days = 0
  for (const span of lane.spans) if (span.kind === 'active') days += span.days
  return days
}

/** By track, then x, then lane order: the order branches are painted in. */
function comparePaint(a: GitBranch, b: GitBranch): number {
  return a.track - b.track || a.x - b.x || a.lane - b.lane
}

/** The git log of a timeline; source says whether lanes weigh commits (graphql) or active days (rest). */
export function layoutGitLog(timeline: LifeTimeline, source: ProfileData['source']): GitLogLayout {
  const axis = axisOf(timeline)
  const { startDay, lanes } = timeline
  const gap = laneGapDays(axis.days)

  const slots = gitLogSlots(lanes)

  // greedy lanes in lane order: the first whose last branch ended a gap before this one starts
  const ends: number[] = []
  const branches = lanes.map((lane, i): GitBranch => {
    const tip = tipOf(lane)
    const x0 = Math.min(lane.startDay, lane.rootDay) - startDay
    const x1 = tip + 1 - startDay
    let track = ends.findIndex((end) => end + gap <= x0)
    if (track < 0) track = ends.length
    const room = track < ends.length ? x0 - ends[track] : Infinity
    ends[track] = x1
    const flags = (lane.isFork ? 1 : 0) | (lane.isOwn ? 2 : 0) | (lane.isArchived ? 4 : 0)
    return {
      lane: i,
      key: repoKey(lane.repo),
      startDay: lane.startDay,
      x: lane.rootDay - startDay + 0.5,
      x0,
      x1,
      rootDay: lane.rootDay,
      tipDay: tip,
      track,
      language: lane.language,
      slot: lane.language === null ? -1 : (slots.get(lane.language) ?? -1),
      archived: lane.isArchived,
      fork: lane.isFork,
      visiting: !lane.isOwn,
      commits: Float64Array.from(commitDays(lane, tip), (day) => day - startDay + 0.5),
      hash: branchHash(i, lane.rootDay, lane.startDay, tip, flags),
      room,
      weight: laneWeight(lane, source),
      stars: lane.stars,
    }
  })
  branches.sort(comparePaint)
  const byKey = new Map(branches.map((branch, i) => [branch.key, i]))
  return { ...axis, byKey, branches, tracks: ends.length, slots }
}
