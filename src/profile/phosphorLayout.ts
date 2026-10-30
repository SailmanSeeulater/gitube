/**
 * The phosphor view's layout: a green-phosphor monitor where each repo is a stack of square blocks
 * rising from the ground line at the x of its root day. A stack's height follows the lane's
 * activity (lifeMeasures' laneHeights), its blocks run through the lane's days from the ground up
 * (dormant stretches dimmer), and its head block carries the star signal (bigger for starred repos).
 *
 * World units as in every view: x is days since the timeline's start (a root sits in its day's
 * middle), heights are shares of the plot. Nothing here is seeded at all, let alone from a name.
 * Pure and deterministic: the same timeline gives the same layout.
 */
import type { ProfileData } from '../types'
import { isSeedling, landedOf, laneHeights, partsOf, starSignal } from './lifeMeasures'
import { repoKey } from './privacy'
import type { LifeLanded, LifeStemPart } from './lifeTypes'
import type { LifeTimeline } from './timeline'
import { axisOf, type LifeViewItem, type LifeViewModel } from './lifeView'

/** One repo as the phosphor view draws it. */
export interface PhosphorStack extends LifeViewItem {
  /** 0..1 of the plot: the lane's height (laneHeights) */
  height: number
  /** 0..1, log-scaled stars (starSignal): how much bigger the head block is */
  head: number
  stars: number
  /** archived: drawn dim */
  dry: boolean
  /** a token profile's lane GitHub counted no commits to: drawn faint */
  seedling: boolean
  /** a repo they only contributed to: a hollow head */
  visiting: boolean
  fork: boolean
  language: string | null
  /** the lane's last day number */
  endDay: number
  /** the lane's active and dormant stretches by stack time (0 at the ground, 1 at the head) */
  parts: LifeStemPart[]
  /** one marker per day a pull request of theirs was merged into it, by stack time, ascending */
  landed: LifeLanded[]
}

export interface PhosphorLayout extends LifeViewModel {
  /** in paint order: the tallest first (behind), then x, then lane order; byKey indexes it */
  stacks: PhosphorStack[]
}

function comparePaint(a: PhosphorStack, b: PhosphorStack): number {
  return b.height - a.height || a.x - b.x || a.lane - b.lane
}

/** The phosphor view of a timeline; source says whether lanes weigh commits (graphql) or active days (rest). */
export function layoutPhosphor(timeline: LifeTimeline, source: ProfileData['source']): PhosphorLayout {
  const axis = axisOf(timeline)
  const heights = laneHeights(timeline, source)
  const stacks = timeline.lanes.map(
    (lane, i): PhosphorStack => ({
      lane: i,
      key: repoKey(lane.repo),
      startDay: lane.startDay,
      x: lane.rootDay - axis.startDay + 0.5,
      height: heights[i],
      head: starSignal(lane.stars),
      stars: lane.stars,
      dry: lane.isArchived,
      seedling: isSeedling(lane, source),
      visiting: !lane.isOwn,
      fork: lane.isFork,
      language: lane.language,
      endDay: lane.endDay,
      parts: partsOf(lane),
      landed: landedOf(lane),
    }),
  )
  stacks.sort(comparePaint)
  return { ...axis, byKey: new Map(stacks.map((stack, i) => [stack.key, i])), stacks }
}
