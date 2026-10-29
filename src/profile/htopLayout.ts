/**
 * The htop view's layout (a console view of person mode): a system monitor's process list, one row
 * per lane of the life timeline, each row a meter along the shared time axis from where the person's
 * part in the repo starts to today (or to an archived repo's last activity). The meter's stretches
 * are the lane's spans: dormant ones dim, active ones lit at a level that follows how busy they were
 * (tier 2: the share of their days with counted commits; tier 1 has spans only, every active one
 * lit full, and a token lane GitHub counted no commits to half).
 *
 * World x is days since the timeline's start, as in every person view. Rows go in lane order, which
 * the timeline already makes independent of the profile's order and of private names (compareLanes),
 * and a language's colour slot comes from how many lanes use it (then the language's own name), so
 * nothing here is sorted or seeded by a repo name. Pure and deterministic; one layout serves every
 * camera, viewport and hidden set.
 */
import type { ProfileData } from '../types'
import { repoKey } from './privacy'
import { dayNumber, type Lane, type LifeTimeline } from './timeline'
import { axisOf, type LifeViewItem, type LifeViewModel } from './lifeView'

/** How lit a stretch of a meter is: 0 dormant, 1 to 3 active, from quiet to busy. */
export type HtopLevel = 0 | 1 | 2 | 3

/** A stretch of a meter, in world x; a row's cells tile it from x0 to x1. */
export interface HtopCell {
  x0: number
  x1: number
  level: HtopLevel
}

/** One repo as the htop view draws it. */
export interface HtopRow extends LifeViewItem {
  /** its row, 0 at the top: its lane's index */
  row: number
  /** world x of the lane's first day's start and of its last day's end: the meter's [ and ] */
  x0: number
  x1: number
  rootDay: number
  endDay: number
  language: string | null
  /** index in HTOP_PALETTE.languages (wrapping), -1 for no language */
  slot: number
  /** archived: drawn in the dry colour */
  dry: boolean
  fork: boolean
  /** a repo they only contributed to (isOwn false) */
  visiting: boolean
  /** counted commits with a token, active days without; labels go to the heaviest first */
  weight: number
  stars: number
  cells: HtopCell[]
  /** world x of each day a pull request of theirs was merged into it, a day's middle, ascending, one per day */
  landed: number[]
}

export interface HtopLayout extends LifeViewModel {
  /** in row order (row i at index i); byKey indexes it */
  rows: HtopRow[]
  /** language -> its colour slot */
  slots: ReadonlyMap<string, number>
}

/** Busy shares at or above these light an active stretch at levels 3 and 2 (sqrt of active days / days). */
const BUSY_HIGH = 0.6
const BUSY_MID = 0.3

/** An active span's level: tier 1 lit full, a lane without counted commits half, else by how busy it was. */
function levelOf(lane: Lane, span: Lane['spans'][number], source: ProfileData['source']): HtopLevel {
  if (span.kind === 'dormant') return 0
  if (source !== 'graphql') return 3
  if (!lane.detailed) return 2
  const busy = Math.sqrt(span.activeDays / Math.max(1, span.days))
  return busy >= BUSY_HIGH ? 3 : busy >= BUSY_MID ? 2 : 1
}

function laneWeight(lane: Lane, source: ProfileData['source']): number {
  if (source === 'graphql') return lane.commits
  let days = 0
  for (const span of lane.spans) if (span.kind === 'active') days += span.days
  return days
}

/** Colour slots: the language on the most lanes first, then the language's name in code-unit order. */
export function htopLanguageSlots(lanes: ReadonlyArray<Lane>): Map<string, number> {
  const count = new Map<string, number>()
  for (const lane of lanes) if (lane.language !== null) count.set(lane.language, (count.get(lane.language) ?? 0) + 1)
  const ordered = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || (a < b ? -1 : a > b ? 1 : 0))
  return new Map(ordered.map((language, i) => [language, i]))
}

/** The world x of each day a lane's pull requests landed, a day's middle, one per day. */
function landedX(lane: Pick<Lane, 'landed'>, startDay: number): number[] {
  const out: number[] = []
  for (const key of lane.landed) {
    const x = dayNumber(key) - startDay + 0.5
    if (Number.isFinite(x) && out[out.length - 1] !== x) out.push(x)
  }
  return out
}

/** The htop rows of a timeline; source says whether spans carry counted commits (graphql) or not. */
export function layoutHtop(timeline: LifeTimeline, source: ProfileData['source']): HtopLayout {
  const axis = axisOf(timeline)
  const { startDay, lanes } = timeline
  const slots = htopLanguageSlots(lanes)
  const rows = lanes.map((lane, i): HtopRow => {
    const x0 = lane.startDay - startDay
    const x1 = lane.endDay + 1 - startDay
    const cells = lane.spans.map((span, s): HtopCell => ({
      x0: s === 0 ? x0 : span.fromDay - startDay,
      x1: s === lane.spans.length - 1 ? x1 : span.toDay + 1 - startDay,
      level: levelOf(lane, span, source),
    }))
    return {
      lane: i,
      key: repoKey(lane.repo),
      startDay: lane.startDay,
      x: lane.rootDay - startDay + 0.5,
      row: i,
      x0,
      x1,
      rootDay: lane.rootDay,
      endDay: lane.endDay,
      language: lane.language,
      slot: lane.language !== null ? (slots.get(lane.language) ?? -1) : -1,
      dry: lane.isArchived,
      fork: lane.isFork,
      visiting: !lane.isOwn,
      weight: laneWeight(lane, source),
      stars: lane.stars,
      cells,
      landed: landedX(lane, startDay),
    }
  })
  return { ...axis, byKey: new Map(rows.map((row, i) => [row.key, i])), rows, slots }
}
