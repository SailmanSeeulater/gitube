/**
 * The helix view's layout (person mode's console views): the life wound into a coil, one turn per
 * calendar year, so the same time of year lands at the same height in every turn and a life's
 * seasons read as bands (the December dips, the summer lulls, the Octobers of landed pull requests).
 * Each repo is a thread wound on the coil over its days, thick where it was busy, thin where it lay
 * dormant, on a ring of its own inside the axis coil.
 *
 * World units: x is days since the timeline's start, the same x as every person view (a day's
 * middle at +0.5), so one camera means the same days here too: the coil's axis runs along it and a
 * zoom spreads the turns apart. A day's angle round the coil is its share of its calendar year,
 * January 1 at the top, and helixGeometry turns a ring and an angle into screen px.
 *
 * Rings are packed like the life lines' tracks: greedily in lane order, a thread taking the first
 * ring whose last thread let go a gap before it starts. A thread holds its ring to the end of its
 * last active span; its dormant tail runs on only until the next thread on the ring starts, a gap
 * short of it, so hundreds of mostly quiet repos share a few dozen rings.
 *
 * Every thread's samples (the points its painter joins and its hit test measures to) are laid down
 * here, SAMPLE_DAYS apart along each span and at both its ends, as world x with the angle there:
 * they depend on the days alone, never on the camera, so paint and hit read the same curve.
 *
 * Pure and deterministic. Nothing is read from a name: rings are packed in lane order (which the
 * timeline makes independent of the profile's order and of names), so a drawing cannot confirm a
 * guess at a private repo's name.
 */
import type { ProfileData } from '../types'
import { repoKey } from './privacy'
import { dayKey, dayNumber, type Lane, type LifeTimeline } from './timeline'
import { axisOf, type LifeViewItem, type LifeViewModel } from './lifeView'

/** Threads on one ring keep at least this many days apart... */
export const RING_GAP_MIN_DAYS = 14
/** ...or this share of the life, whichever is more, so the gap still shows zoomed out. */
export const RING_GAP_SHARE = 1 / 100
/** A span is sampled this many days apart (about 96 points a turn: the chord sits within a fifth of a px of the curve). */
export const SAMPLE_DAYS = 4
const TWO_PI = Math.PI * 2

/** The gap kept between two threads on one ring, in days. */
export function ringGapDays(days: number): number {
  return Math.max(RING_GAP_MIN_DAYS, Math.round(days * RING_GAP_SHARE))
}

/** A stretch of a thread, in world x; the spans of a thread tile it from x0 to its drawn end. */
export interface HelixSpan {
  kind: 'active' | 'dormant'
  x0: number
  x1: number
  /**
   * 0..1: an active span's weight against the heaviest active span in the profile (the square root
   * of its share of commits, with a token), 1 for every active span without a token, 0 when dormant
   */
  weight: number
  /** its samples: layout.sampleX[from .. from + count), ascending from x0 to x1 */
  from: number
  count: number
}

/** One repo as the helix draws it. */
export interface HelixThread extends LifeViewItem {
  /** world x of the lane's first day's start and of its last day's end */
  x0: number
  x1: number
  /**
   * world x it is drawn to: x1, or, when another thread follows it on its ring, a gap before that
   * thread starts (its dormant tail cut short there; never an active span)
   */
  end: number
  rootDay: number
  endDay: number
  /** its ring: 0 the outermost, counting in */
  track: number
  language: string | null
  /** archived: drawn dim */
  dry: boolean
  /** a token profile's lane GitHub counted no commits to: drawn faint */
  seedling: boolean
  /** a repo they only contributed to (isOwn false): drawn dashed */
  visiting: boolean
  fork: boolean
  /** counted commits with a token, active days without; labels go to the heaviest first */
  weight: number
  stars: number
  /** in x order, tiling x0 to end */
  spans: HelixSpan[]
  /** world x of each day a pull request of theirs was merged into it, a day's middle, ascending, one per day */
  landed: Float64Array
}

export interface HelixLayout extends LifeViewModel {
  /** in paint order: by ring, then x, then lane order; byKey indexes it */
  threads: HelixThread[]
  /** how many rings the threads take */
  tracks: number
  /** world x of January 1 of each year from the life's first to the one after its last, ascending */
  yearStarts: Float64Array
  /** every thread's samples: world x, and the cosine and sine of its angle round the coil */
  sampleX: Float64Array
  sampleCos: Float32Array
  sampleSin: Float32Array
}

/** World x of January 1 of each year from the one holding world x 0 to the one after the one holding days. */
export function yearStartsOf(startDay: number, days: number): Float64Array {
  const first = Number(dayKey(startDay).slice(0, 4))
  const last = Number(dayKey(startDay + Math.max(0, days - 1)).slice(0, 4))
  const out: number[] = []
  for (let year = first; year <= last + 1; year++) out.push(dayNumber(`${year}-01-01`) - startDay)
  return Float64Array.from(out)
}

/**
 * The angle of world x round the coil: its share of its calendar year, as radians from January 1
 * (0) through the year (2π). Outside the years laid down it runs on at the nearest year's pace.
 */
export function angleAt(yearStarts: Float64Array, x: number): number {
  let lo = 0
  let hi = yearStarts.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (yearStarts[mid] <= x) lo = mid
    else hi = mid - 1
  }
  const from = yearStarts[lo]
  const length = yearStarts[lo + 1] - from
  return TWO_PI * ((x - from) / length)
}

/** The world x of each day a lane's pull requests landed, a day's middle, one per day. */
function landedX(lane: Pick<Lane, 'landed'>, startDay: number): Float64Array {
  const out: number[] = []
  for (const key of lane.landed) {
    const x = dayNumber(key) - startDay + 0.5
    if (Number.isFinite(x) && out[out.length - 1] !== x) out.push(x)
  }
  return Float64Array.from(out)
}

/** With a token a lane weighs its counted commits; without one, its active days. */
function laneWeight(lane: Lane, source: ProfileData['source']): number {
  if (source === 'graphql') return lane.commits
  let days = 0
  for (const span of lane.spans) if (span.kind === 'active') days += span.days
  return days
}

/** By ring, then x, then lane order: the order threads are painted in. */
function comparePaint(a: HelixThread, b: HelixThread): number {
  return a.track - b.track || a.x - b.x || a.lane - b.lane
}

/** The helix of a timeline; source says whether lanes weigh commits (graphql) or active days (rest). */
export function layoutHelix(timeline: LifeTimeline, source: ProfileData['source']): HelixLayout {
  const axis = axisOf(timeline)
  const { startDay, lanes } = timeline
  const gap = ringGapDays(axis.days)
  const token = source === 'graphql'

  let heaviest = 0
  if (token) for (const lane of lanes) for (const span of lane.spans) if (span.kind === 'active') heaviest = Math.max(heaviest, span.commits)

  // greedy rings in lane order: the first whose last thread let go a gap before this one starts
  const ends: number[] = []
  const held: number[] = []
  const threads = lanes.map((lane, i): HelixThread => {
    const x0 = Math.min(lane.startDay, lane.rootDay) - startDay
    const x1 = lane.endDay + 1 - startDay
    // the ring is held to the end of the last active span (the root is always in one)
    let hold = x0
    for (const span of lane.spans) if (span.kind === 'active') hold = Math.max(hold, span.toDay + 1 - startDay)
    let track = ends.findIndex((end) => end + gap <= x0)
    if (track < 0) track = ends.length
    ends[track] = hold
    held[i] = hold
    const spans = lane.spans.map((span, s): HelixSpan => ({
      kind: span.kind,
      x0: s === 0 ? x0 : span.fromDay - startDay,
      x1: s === lane.spans.length - 1 ? x1 : span.toDay + 1 - startDay,
      weight: span.kind === 'dormant' ? 0 : !token ? 1 : heaviest > 0 ? Math.min(1, Math.sqrt(span.commits / heaviest)) : 0,
      from: 0,
      count: 0,
    }))
    return {
      lane: i,
      key: repoKey(lane.repo),
      startDay: lane.startDay,
      x: lane.rootDay - startDay + 0.5,
      x0,
      x1,
      end: x1,
      rootDay: lane.rootDay,
      endDay: lane.endDay,
      track,
      language: lane.language,
      dry: lane.isArchived,
      seedling: !lane.detailed && token,
      visiting: !lane.isOwn,
      fork: lane.isFork,
      weight: laneWeight(lane, source),
      stars: lane.stars,
      spans,
      landed: landedX(lane, startDay),
    }
  })

  // a dormant tail runs on only until the next thread on the ring starts, a gap short of it
  const byTrack = new Map<number, HelixThread[]>()
  for (const thread of threads) {
    const list = byTrack.get(thread.track)
    if (list) list.push(thread)
    else byTrack.set(thread.track, [thread])
  }
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.x0 - b.x0 || a.lane - b.lane)
    for (let k = 0; k + 1 < list.length; k++) {
      const thread = list[k]
      thread.end = Math.max(held[thread.lane], Math.min(thread.x1, list[k + 1].x0 - gap))
    }
  }
  for (const thread of threads) {
    if (thread.end >= thread.x1) continue
    thread.spans = thread.spans.filter((span) => span.x0 < thread.end)
    const last = thread.spans[thread.spans.length - 1]
    if (last && last.x1 > thread.end) last.x1 = thread.end
  }

  threads.sort(comparePaint)

  // the samples: SAMPLE_DAYS apart along each span, and at both its ends
  const yearStarts = yearStartsOf(startDay, axis.days)
  const xs: number[] = []
  for (const thread of threads) {
    for (const span of thread.spans) {
      span.from = xs.length
      let x = span.x0
      while (x < span.x1) {
        xs.push(x)
        x += SAMPLE_DAYS
      }
      xs.push(span.x1)
      span.count = xs.length - span.from
    }
  }
  const sampleX = Float64Array.from(xs)
  const sampleCos = new Float32Array(xs.length)
  const sampleSin = new Float32Array(xs.length)
  for (let k = 0; k < xs.length; k++) {
    const a = angleAt(yearStarts, xs[k])
    sampleCos[k] = Math.cos(a)
    sampleSin[k] = Math.sin(a)
  }

  const byKey = new Map(threads.map((thread, i) => [thread.key, i]))
  return { ...axis, byKey, threads, tracks: ends.length, yearStarts, sampleX, sampleCos, sampleSin }
}
