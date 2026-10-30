/**
 * The measures person mode's views share about a lane of the life timeline: how tall its activity
 * makes it, how strong its star signal is, its active and dormant stretches and its landed pull
 * requests along its own time (0 on its first day, 1 after its last). Phosphor stacks its blocks
 * with them and the constellation sizes its stars' glow, so the views agree on what "busy" and
 * "starred" mean.
 *
 * Pure and deterministic: no theme, no camera, no DOM, and nothing seeded, let alone from a name.
 */
import type { ProfileData } from '../types'
import { dayNumber, type Lane, type LifeTimeline, type Span } from './timeline'
import type { LifeLanded, LifeStemPart } from './lifeTypes'

/** The shortest lane with any weight, as a share of the plot... */
const MIN_HEIGHT = 0.06
/** ...and a token profile's repo GitHub counted no commits to, which has none. */
const SEEDLING_HEIGHT = 0.04
/** log10(1 + stars) at which the star signal is full: 10k stars. Absolute, so people compare fairly. */
const FULL_STARS_LOG = 4

/** The star signal, 0..1 on a log scale; 0 without stars. */
export function starSignal(stars: number): number {
  return stars > 0 ? Math.min(1, Math.log10(1 + stars) / FULL_STARS_LOG) : 0
}

/** A token profile weighs counted commits; without a token there are none, so active days stand in. */
function laneWeight(lane: Lane, source: ProfileData['source']): number {
  if (source === 'graphql') return lane.commits
  let days = 0
  for (const span of lane.spans) if (span.kind === 'active') days += span.days
  return days
}

/** A token profile's lane GitHub counted no commits to (detailed false). */
export function isSeedling(lane: Pick<Lane, 'detailed'>, source: ProfileData['source']): boolean {
  return source === 'graphql' && !lane.detailed
}

/**
 * Each lane's height, 0..1 of the plot, in lane order: the square root of its share of the busiest
 * lane's weight, never under MIN_HEIGHT; a seedling is SEEDLING_HEIGHT.
 */
export function laneHeights(timeline: Pick<LifeTimeline, 'lanes'>, source: ProfileData['source']): number[] {
  let maxWeight = 0
  for (const lane of timeline.lanes) if (!isSeedling(lane, source)) maxWeight = Math.max(maxWeight, laneWeight(lane, source))
  return timeline.lanes.map((lane) => {
    if (isSeedling(lane, source)) return SEEDLING_HEIGHT
    return maxWeight > 0 ? MIN_HEIGHT + (1 - MIN_HEIGHT) * Math.sqrt(laneWeight(lane, source) / maxWeight) : MIN_HEIGHT
  })
}

/** A day's start along the lane: 0 at its first day, 1 after its last. */
function laneTime(lane: Pick<Lane, 'startDay' | 'endDay'>, day: number): number {
  return (day - lane.startDay) / (lane.endDay - lane.startDay + 1)
}

/** The lane's active and dormant stretches, along its own time. */
export function partsOf(lane: Pick<Lane, 'spans' | 'startDay' | 'endDay'>): LifeStemPart[] {
  return lane.spans.map((span: Span) => ({ kind: span.kind, t0: laneTime(lane, span.fromDay), t1: laneTime(lane, span.toDay + 1) }))
}

/** One marker per day a pull request landed, at that day's middle (several that day draw one). */
export function landedOf(lane: Pick<Lane, 'landed' | 'startDay' | 'endDay'>): LifeLanded[] {
  const out: LifeLanded[] = []
  for (const key of lane.landed) {
    const day = dayNumber(key)
    if (!Number.isFinite(day) || (out.length > 0 && out[out.length - 1].day === day)) continue
    out.push({ t: laneTime(lane, day + 0.5), day })
  }
  return out
}

/** How much of a lane has grown by the time-lapse's day, along its own time (0..1); 1 when fully grown. */
export function grownShare(lane: { startDay: number; endDay: number }, at: number | null): number {
  if (at === null) return 1
  const share = (at - lane.startDay) / (lane.endDay - lane.startDay + 1)
  return share >= 1 ? 1 : share > 0 ? share : 0
}
