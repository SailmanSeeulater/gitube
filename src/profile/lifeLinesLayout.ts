/**
 * The life lines layout (PROFILE_SPEC.md section 5, view 2): each lane of the life timeline is a line
 * along the time axis, from where the person's part in the repo starts to today (or to an archived
 * repo's last activity), cut into active and dormant parts that the painter draws thick and thin. The
 * milestones that name a repo are stations on its line, and the language eras are bands behind them.
 * Its own small module, like a tube map in spirit only: graph/metro.ts lays out branch DAGs and is
 * not bent to fit.
 *
 * World units: x is days since the timeline's start, the same x as every person view, so one camera
 * means the same in all of them; a line sits on a track, and lifeLinesGeometry turns tracks into
 * screen px. No theme, no camera and no DOM, and one layout serves every theme, zoom and hidden set
 * (hidden lines are skipped where they are drawn and hit, never re-packed).
 *
 * A line holds its track only while it has something to show: to the end of its last active part
 * and past its last station (an archived line to its terminus). Its dormant tail after that runs on
 * towards today only until the next line on its track starts, a gap short of it, so a profile of
 * hundreds of mostly quiet repos packs into a few dozen tracks instead of one each, and the tracks
 * stay far enough apart (LINES_MIN_PITCH) to tell thick from thin and to hover.
 *
 * Pure and deterministic, like the timeline it reads: tracks are packed in lane order, which the
 * timeline already makes independent of the profile's order and of private names (compareLanes), and
 * nothing is seeded from a name, so a drawing cannot confirm a guess at a private repo's name.
 */
import type { ProfileData } from '../types'
import { repoKey } from './privacy'
import { dayNumber, type Lane, type LifeMilestone, type LifeTimeline } from './timeline'
import { axisOf, type LifeViewItem, type LifeViewModel } from './lifeView'

/** Lines on one track keep at least this many days apart... */
export const TRACK_GAP_MIN_DAYS = 14
/** ...or this share of the life (1/100), whichever is more, so the gap still shows when zoomed out. */
export const TRACK_GAP_SHARE = 1 / 100

/** The gap kept between two lines on one track, in days. */
export function trackGapDays(days: number): number {
  return Math.max(TRACK_GAP_MIN_DAYS, Math.round(days * TRACK_GAP_SHARE))
}

/** A stretch of a line, in world x; the parts of a line tile it from x0 to x1. */
export interface LifeLinePart {
  kind: 'active' | 'dormant'
  x0: number
  x1: number
  /**
   * 0..1: an active part's weight against the heaviest active span in the profile (the square root
   * of its share of commits, with a token), 1 for every active part without a token, 0 when dormant
   */
  weight: number
}

/** One repo as the life lines view draws it. */
export interface LifeLine extends LifeViewItem {
  /** world x of the lane's first day's start and of its last day's end */
  x0: number
  x1: number
  /**
   * world x it is drawn to: x1, or, when another line follows it on its track, a gap before that
   * line starts (its dormant tail cut short there; never its active parts or a station)
   */
  end: number
  rootDay: number
  endDay: number
  /** its row, 0 at the top */
  track: number
  language: string | null
  /** archived: drawn dry, with a terminus where it ends */
  dry: boolean
  /** a fork: drawn with a branch stub into its start */
  branch: boolean
  /** a repo they only contributed to (isOwn false): its start is hollow */
  visiting: boolean
  /** a token profile's lane GitHub counted no commits to (detailed false): drawn dotted */
  seedling: boolean
  /** counted commits with a token, active days without; labels go to the heaviest first */
  weight: number
  stars: number
  /** tile it from x0 to x1; what lies past end is not drawn */
  parts: LifeLinePart[]
}

/**
 * A milestone that names a repo, drawn on that repo's line on its own day. One dated outside the
 * line's days (a first pull request before their part in the repo starts) has no station: its
 * marker on the horizon still shows it.
 */
export interface LineStation {
  /** index in timeline.milestones */
  index: number
  kind: LifeMilestone['kind']
  /** index in layout.lines */
  line: number
  /** the milestone's day (a day number), inside its line's days */
  day: number
  /** world x: that day's middle */
  x: number
}

export interface LifeLinesLayout extends LifeViewModel {
  /** in paint order: by track, then x, then lane order; byKey indexes it */
  lines: LifeLine[]
  /** how many tracks the lines take */
  tracks: number
  /** by milestone index */
  stations: LineStation[]
}

/** With a token a lane weighs its counted commits; without one, its active days. */
function laneWeight(lane: Lane, source: ProfileData['source']): number {
  if (source === 'graphql') return lane.commits
  let days = 0
  for (const span of lane.spans) if (span.kind === 'active') days += span.days
  return days
}

/**
 * World x a lane holds its track to: the end of its last active span or its last station's day,
 * whichever is later, and an archived lane's end (its terminus). Its root is in an active span.
 */
function heldTo(lane: Lane, startDay: number, lastStation: number): number {
  if (lane.isArchived) return lane.endDay + 1 - startDay
  let day = Math.max(lane.rootDay, lastStation)
  for (const span of lane.spans) if (span.kind === 'active') day = Math.max(day, span.toDay)
  return Math.min(lane.endDay, day) + 1 - startDay
}

/**
 * Greedy tracks in lane order: the first track whose last line is held to at least gap days before
 * this one starts, else a new track. Lanes go in root order and start at or before their root, so a
 * track's lines are placed in x order; each line's drawn end is cut a gap short of the next one's
 * start, or is its own end on the last.
 */
function packTracks(spans: ReadonlyArray<{ x0: number; x1: number; held: number }>, gap: number): { tracks: number[]; ends: number[]; count: number } {
  const held: number[] = []
  const lastOn: number[] = []
  const ends = spans.map(({ x1 }) => x1)
  const tracks = spans.map(({ x0, held: to }, i) => {
    let track = held.findIndex((end) => end + gap <= x0)
    if (track < 0) track = held.length
    else ends[lastOn[track]] = Math.min(ends[lastOn[track]], x0 - gap)
    held[track] = to
    lastOn[track] = i
    return track
  })
  return { tracks, ends, count: held.length }
}

/** By track, then x, then lane order: the order lines are painted in. */
function comparePaint(a: LifeLine, b: LifeLine): number {
  return a.track - b.track || a.x - b.x || a.lane - b.lane
}

/** The life lines of a timeline; source says whether lanes weigh commits (graphql) or active days (rest). */
export function layoutLifeLines(timeline: LifeTimeline, source: ProfileData['source']): LifeLinesLayout {
  const axis = axisOf(timeline)
  const { startDay, lanes } = timeline
  const token = source === 'graphql'

  let heaviest = 0
  if (token) for (const lane of lanes) for (const span of lane.spans) if (span.kind === 'active') heaviest = Math.max(heaviest, span.commits)

  // the milestones that name a lane, on its days: its stations, which it holds its track past
  const laneOf = new Map(lanes.map((lane, i) => [repoKey(lane.repo), i]))
  const named: Array<{ index: number; kind: LifeMilestone['kind']; lane: number; day: number }> = []
  const lastStation = lanes.map(() => -Infinity)
  timeline.milestones.forEach((milestone, index) => {
    if (!milestone.repo) return
    const lane = laneOf.get(repoKey(milestone.repo))
    const day = dayNumber(milestone.day)
    if (lane === undefined || !(day >= lanes[lane].startDay && day <= lanes[lane].endDay)) return
    named.push({ index, kind: milestone.kind, lane, day })
    lastStation[lane] = Math.max(lastStation[lane], day)
  })

  const extents = lanes.map((lane, i) => ({ x0: lane.startDay - startDay, x1: lane.endDay + 1 - startDay, held: heldTo(lane, startDay, lastStation[i]) }))
  const { tracks, ends, count } = packTracks(extents, trackGapDays(axis.days))

  const lines = lanes.map((lane, i): LifeLine => {
    const { x0, x1 } = extents[i]
    // the spans tile the lane day by day; each part starts where the one before ends
    const parts = lane.spans.map((span, s): LifeLinePart => {
      const weight = span.kind === 'dormant' ? 0 : !token ? 1 : heaviest > 0 ? Math.min(1, Math.sqrt(span.commits / heaviest)) : 0
      return { kind: span.kind, x0: s === 0 ? x0 : span.fromDay - startDay, x1: s === lane.spans.length - 1 ? x1 : span.toDay + 1 - startDay, weight }
    })
    return {
      lane: i,
      key: repoKey(lane.repo),
      startDay: lane.startDay,
      x: lane.rootDay - startDay + 0.5,
      x0,
      x1,
      end: ends[i],
      rootDay: lane.rootDay,
      endDay: lane.endDay,
      track: tracks[i],
      language: lane.language,
      dry: lane.isArchived,
      branch: lane.isFork,
      visiting: !lane.isOwn,
      seedling: token && !lane.detailed,
      weight: laneWeight(lane, source),
      stars: lane.stars,
      parts,
    }
  })
  lines.sort(comparePaint)
  const byKey = new Map(lines.map((line, i) => [line.key, i]))

  // a station sits in its own day's middle, on the drawn part of its line (which is held past it)
  const lineOfLane = new Int32Array(lines.length)
  lines.forEach((line, i) => (lineOfLane[line.lane] = i))
  const stations = named.map(({ index, kind, lane, day }): LineStation => ({ index, kind, line: lineOfLane[lane], day, x: day - startDay + 0.5 }))

  return { ...axis, byKey, lines, tracks: count, stations }
}
