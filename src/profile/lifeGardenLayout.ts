/**
 * The life garden's layout (PROFILE_SPEC.md section 5, view 1): one plant per lane of the life
 * timeline, rooted where the person's part in the repo starts, on a horizon with time running left
 * to right. Height follows total activity, a leaf marks each active span, the head carries the star
 * signal (a bloom, or a wilted head on an archived repo, sized by stars either way), and forks and
 * repos they only contributed to are flagged for the painter.
 *
 * World units: x is days since the timeline's start (a root sits in the middle of its day), heights
 * are shares of the plot. No theme, no camera and no DOM: lifeGeometry turns a plant into screen px,
 * and one layout serves every theme, zoom and hidden set (hidden plants are skipped where they are
 * drawn and hit, never re-packed, as Garden keeps positions across toggles).
 *
 * Pure and deterministic, like the timeline it reads: the same timeline gives the same layout, so the
 * order of the profile's repos cannot move a plant. A plant's shape is seeded from its days and
 * language, never its name, so a drawing cannot confirm a guess at a private repo's name.
 */
import type { ProfileData } from '../types'
import { hash01 } from '../components/gardenLook'
import { repoKey } from './privacy'
import { progressAtDay, type Lane, type LifeTimeline, type Span } from './timeline'
import type { LifeGardenLayout, LifeLeaf, LifePlant, LifeStemPart, LifeTip } from './lifeTypes'
import { axisOf } from './lifeView'

/** Depth rows: plants rooted close together step back a row instead of overlapping. */
export const LIFE_ROWS = 4
/** Leaves on one plant at most: the heaviest active spans keep theirs. */
export const MAX_LEAVES_PER_PLANT = 16
/** The shortest plant with any weight, as a share of the plot... */
const MIN_HEIGHT = 0.06
/** ...and a token profile's repo GitHub counted no commits to, which has none. */
const SEEDLING_HEIGHT = 0.04
/** log10(1 + stars) at which a head is full size: 10k stars. Absolute, so people compare fairly. */
const FULL_BLOOM_LOG = 4
/** Plants rooted within this share of the life from either end lean inward, so no head hangs off the plot. */
const EDGE_SHARE = 0.1

/** A head's size from stars, 0..1 on a log scale; 0 without stars. */
export function bloomOfStars(stars: number): number {
  return stars > 0 ? Math.min(1, Math.log10(1 + stars) / FULL_BLOOM_LOG) : 0
}

/** Root days closer than this share a row only when every row is taken: about 1/150 of the life. */
function rowGap(days: number): number {
  return Math.max(4, Math.round(days / 150))
}

/**
 * Greedy depth rows in lane order: the first row whose last root is at least gap days back, else the
 * row whose last root is oldest (the lowest on a tie).
 */
function packRows(lanes: ReadonlyArray<Lane>, gap: number): number[] {
  const last: number[] = new Array<number>(LIFE_ROWS).fill(-Infinity)
  return lanes.map((lane) => {
    let row = last.findIndex((day) => lane.rootDay - day >= gap)
    if (row < 0) row = last.indexOf(Math.min(...last))
    last[row] = lane.rootDay
    return row
  })
}

/** A token profile weighs counted commits; without a token there are none, so active days stand in. */
function spanWeight(span: Span, source: ProfileData['source']): number {
  return source === 'graphql' ? span.commits : span.days
}

function laneWeight(lane: Lane, source: ProfileData['source']): number {
  if (source === 'graphql') return lane.commits
  let days = 0
  for (const span of lane.spans) if (span.kind === 'active') days += span.days
  return days
}

/** Stem time of a day's start: 0 at the lane's first day, 1 after its last. */
function stemTime(lane: Lane, day: number): number {
  return (day - lane.startDay) / (lane.endDay - lane.startDay + 1)
}

function partsOf(lane: Lane): LifeStemPart[] {
  return lane.spans.map((span) => ({ kind: span.kind, t0: stemTime(lane, span.fromDay), t1: stemTime(lane, span.toDay + 1) }))
}

/** One leaf per active span, in the span's middle, sides alternating; the heaviest MAX_LEAVES_PER_PLANT kept. */
function leavesOf(lane: Lane, source: ProfileData['source'], heaviest: number): LifeLeaf[] {
  let active = lane.spans.filter((span) => span.kind === 'active').map((span) => ({ span, weight: spanWeight(span, source) }))
  if (active.length > MAX_LEAVES_PER_PLANT) {
    active = active
      .sort((a, b) => b.weight - a.weight || a.span.fromDay - b.span.fromDay)
      .slice(0, MAX_LEAVES_PER_PLANT)
      .sort((a, b) => a.span.fromDay - b.span.fromDay)
  }
  return active.map(({ span, weight }, i) => ({
    t: stemTime(lane, (span.fromDay + span.toDay + 1) / 2),
    side: i % 2 === 0 ? 1 : -1,
    size: heaviest > 0 ? Math.sqrt(weight / heaviest) : 0,
    fromDay: span.fromDay,
  }))
}

/** By row from the back, then x, then lane order: the order plants are painted in. */
function comparePaint(a: LifePlant, b: LifePlant): number {
  return b.row - a.row || a.x - b.x || a.lane - b.lane
}

/** The life garden of a timeline; source says whether lanes weigh commits (graphql) or active days (rest). */
export function layoutLifeGarden(timeline: LifeTimeline, source: ProfileData['source']): LifeGardenLayout {
  const axis = axisOf(timeline)
  const { startDay, days } = axis
  const { lanes } = timeline

  const seedlingOf = (lane: Lane) => source === 'graphql' && !lane.detailed
  let maxWeight = 0
  let heaviestSpan = 0
  for (const lane of lanes) {
    if (seedlingOf(lane)) continue
    maxWeight = Math.max(maxWeight, laneWeight(lane, source))
    for (const span of lane.spans) if (span.kind === 'active') heaviestSpan = Math.max(heaviestSpan, spanWeight(span, source))
  }

  const rows = packRows(lanes, rowGap(days))
  // Lanes alike in every seeded field are told apart by their turn among them, in lane order.
  const seen = new Map<string, number>()
  const plants = lanes.map((lane, i): LifePlant => {
    const seedling = seedlingOf(lane)
    const height = seedling ? SEEDLING_HEIGHT : maxWeight > 0 ? MIN_HEIGHT + (1 - MIN_HEIGHT) * Math.sqrt(laneWeight(lane, source) / maxWeight) : MIN_HEIGHT
    const shape = `${lane.born}|${lane.root}|${lane.start}|${lane.language ?? ''}|${lane.isOwn}|${lane.isFork}`
    const twin = seen.get(shape) ?? 0
    seen.set(shape, twin + 1)
    const seed = `${shape}#${twin}`
    const tip: LifeTip = lane.isArchived ? 'wilted' : lane.stars > 0 ? 'bloom' : 'bud'
    const x = lane.rootDay - startDay + 0.5
    let lean = hash01(`${seed}:lean`) * 2 - 1
    if (x < days * EDGE_SHARE) lean = Math.abs(lean)
    else if (x > days * (1 - EDGE_SHARE)) lean = -Math.abs(lean)
    return {
      lane: i,
      key: repoKey(lane.repo),
      x,
      row: rows[i],
      height,
      reach: 1 + 15 * height,
      bend: hash01(`${seed}:bend`) * 2 - 1,
      lean,
      turn: hash01(seed),
      tip,
      bloom: bloomOfStars(lane.stars),
      dry: lane.isArchived,
      cutting: lane.isFork,
      visiting: !lane.isOwn,
      backDays: Math.max(0, lane.rootDay - lane.startDay),
      seedling,
      parts: partsOf(lane),
      leaves: seedling ? [] : leavesOf(lane, source, heaviestSpan),
      language: lane.language,
      startDay: lane.startDay,
      endDay: lane.endDay,
      appearAt: progressAtDay(timeline.clock, lane.startDay),
    }
  })
  plants.sort(comparePaint)

  return { ...axis, rows: LIFE_ROWS, plants, byKey: new Map(plants.map((plant, i) => [plant.key, i])) }
}
