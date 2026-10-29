/**
 * The constellation's layout (PROFILE_SPEC.md section 5, view 3): one star per lane of the life
 * timeline, placed where the person's part in the repo starts (x) in its language's band (y), sized
 * by activity and glowing by stars, with faint links between repos active at the same time.
 *
 * World units: x is days since the timeline's start, as in every view (a root sits in the middle of
 * its day), so one camera means the same stretch of time here as in the garden; y is a share of the
 * plot, 0 at its top and 1 at its foot. No theme, no camera and no DOM: constellationGeometry turns a
 * star into screen px, and one layout serves every theme, zoom and hidden set (a hidden star is
 * skipped where it is drawn and hit, never re-packed).
 *
 * Pure and deterministic: the same timeline gives the same layout, so the order of the profile's
 * repos cannot move a star. Nothing is seeded from a name: bands go by language weight, slots are
 * filled in lane order (which reads no private name, see compareLanes in timeline.ts), a star's
 * place in its slot is seeded from its days, language and flags (or, sharing its slot with stars
 * rooted the same day, from its turn among them), and every sort ends on an index, so a drawing
 * cannot confirm a guess at a private repo's name.
 */
import type { ProfileData } from '../types'
import { hash01 } from '../components/gardenLook'
import { bloomOfStars } from './lifeGardenLayout'
import { repoKey } from './privacy'
import { dayNumber, type Lane, type LifeTimeline, type Span } from './timeline'
import { axisOf, type LifeViewItem, type LifeViewModel } from './lifeView'

const DAY_MS = 86_400_000

/** Named language bands at most: past this, the first MAX_BANDS - 1 and one for the other languages. */
export const MAX_BANDS = 8
/** A band's least share of the plot before the shares are renormalised, so a one-repo language has room. */
export const MIN_BAND_SHARE = 0.06
/** Rows of stars inside one band at most. */
export const MAX_SLOTS = 7
/** A star sits in the middle half of its slot: this share of the slot's height, about its centre. */
const SLOT_SPREAD = 0.5
/** The partners each star picks: its strongest. */
export const LINKS_PER_STAR = 2
/** Links kept in all, the strongest first. */
export const MAX_LINKS = 400
/** Lanes one month can link at most: the heaviest that month. */
export const MONTH_LANES = 24
/** The band of the languages past the first MAX_BANDS - 1, and of repos with none. */
export const OTHER_LANGUAGES = 'other languages'
export const NO_LANGUAGE = 'no language'

export interface StarBand {
  /** a language's own band, the other languages', or the repos without one (always last) */
  kind: 'language' | 'other' | 'none'
  /** the band's language; null for the other two kinds */
  language: string | null
  /** what the band is called on the canvas: its language, OTHER_LANGUAGES or NO_LANGUAGE */
  label: string
  /** shares of the plot, top to bottom; the bands tile 0..1 */
  y0: number
  y1: number
  /** stars in it */
  count: number
}

/** One repo as the constellation draws it. */
export interface LifeStar extends LifeViewItem {
  /** share of the plot, 0 at the top: inside its band */
  y: number
  /** index in bands */
  band: number
  /** 0..1: the lane's weight against the heaviest, square-rooted; 0 for a seedling */
  size: number
  /** 0..1: bloomOfStars(stars), as the garden's heads */
  glow: number
  /** archived: drawn dry */
  dry: boolean
  /** a fork: drawn with a companion */
  twin: boolean
  /** a repo they only contributed to (isOwn false): drawn hollow */
  visiting: boolean
  /** a token profile's lane GitHub counted no commits to (detailed false) */
  seedling: boolean
  language: string | null
  /** the lane's last day number */
  endDay: number
  stars: number
  /** the days pull requests of theirs were merged into it, as day numbers, ascending, one per day (lane.landed) */
  landed: number[]
  /**
   * How far the star has grown through the time-lapse, piecewise linear: growthShares[i] by the
   * start of day growthDays[i]. 0 before the first day, 1 from the last. Each active span adds its
   * share of the lane's commits (a token profile) or of its active days (otherwise), evenly over its
   * days; a dormant span adds nothing.
   */
  growthDays: number[]
  growthShares: number[]
}

export interface StarLink {
  /** star indexes, a < b */
  a: number
  b: number
  /** months both are active in (among each month's MONTH_LANES heaviest lanes) */
  strength: number
  /** the first day both are active, from which the time-lapse draws the link */
  fromDay: number
}

export interface ConstellationLayout extends LifeViewModel {
  /** top to bottom: the named languages by weight, then the other languages, then none */
  bands: StarBand[]
  /** in paint order: the smallest first, then the faintest, then lane order; byKey indexes it */
  stars: LifeStar[]
  /** sorted by a, then b */
  links: StarLink[]
}

/** Code-unit order: the same in every locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** A token profile weighs counted commits; without a token there are none, so active days stand in. */
function laneWeight(lane: Lane, source: ProfileData['source']): number {
  if (source === 'graphql') return lane.commits
  let days = 0
  for (const span of lane.spans) if (span.kind === 'active') days += span.days
  return days
}

function activeSpans(lane: Lane): Span[] {
  return lane.spans.filter((span) => span.kind === 'active')
}

/** A day number's month, counted from year 0 (year * 12 + month), off the UTC calendar: no day key is formatted. */
function monthOf(day: number): number {
  const date = new Date(day * DAY_MS)
  return date.getUTCFullYear() * 12 + date.getUTCMonth()
}

/** Root days closer than this share a slot only when every slot of the band is taken: about 1/120 of the life. */
function slotGap(days: number): number {
  return Math.max(4, Math.round(days / 120))
}

/** Slots in a band of count stars: about its square root, 1 to MAX_SLOTS. */
function slotCount(count: number): number {
  return Math.min(MAX_SLOTS, Math.max(1, Math.ceil(Math.sqrt(count))))
}

/**
 * The bands, top to bottom, and each lane's band. Named languages rank by weight, then repo count,
 * then name; past MAX_BANDS the first MAX_BANDS - 1 keep a band and the rest share one. Repos with no
 * language get the last band. A band's height follows the square root of its count, never under
 * MIN_BAND_SHARE before the shares are renormalised.
 */
function bandsOf(lanes: ReadonlyArray<Lane>, weights: ReadonlyArray<number>): { bands: StarBand[]; bandOf: number[] } {
  const byLanguage = new Map<string, { weight: number; count: number }>()
  let none = 0
  lanes.forEach((lane, i) => {
    if (lane.language === null) {
      none++
      return
    }
    let entry = byLanguage.get(lane.language)
    if (!entry) byLanguage.set(lane.language, (entry = { weight: 0, count: 0 }))
    entry.weight += weights[i]
    entry.count++
  })
  const ranked = [...byLanguage].sort(([a, x], [b, y]) => y.weight - x.weight || y.count - x.count || compareText(a, b))
  const named = ranked.length > MAX_BANDS ? ranked.slice(0, MAX_BANDS - 1) : ranked
  const rows: Array<Omit<StarBand, 'y0' | 'y1'>> = named.map(([language, { count }]) => ({ kind: 'language', language, label: language, count }))
  const bandOfLanguage = new Map(named.map(([language], i) => [language, i]))
  let other = -1
  if (ranked.length > named.length) {
    other = rows.length
    let count = 0
    for (const [, entry] of ranked.slice(named.length)) count += entry.count
    rows.push({ kind: 'other', language: null, label: OTHER_LANGUAGES, count })
  }
  let noLanguage = -1
  if (none > 0) {
    noLanguage = rows.length
    rows.push({ kind: 'none', language: null, label: NO_LANGUAGE, count: none })
  }

  let roots = 0
  for (const row of rows) roots += Math.sqrt(row.count)
  const shares = rows.map((row) => Math.max(MIN_BAND_SHARE, Math.sqrt(row.count) / roots))
  let total = 0
  for (const share of shares) total += share
  let y = 0
  const bands = rows.map((row, i): StarBand => {
    const y0 = y
    y = i === rows.length - 1 ? 1 : y + shares[i] / total
    return { ...row, y0, y1: y }
  })
  const bandOf = lanes.map((lane) => (lane.language === null ? noLanguage : (bandOfLanguage.get(lane.language) ?? other)))
  return { bands, bandOf }
}

interface Slots {
  /** each lane's slot in its band */
  slot: number[]
  /** its turn, in lane order, among the lanes rooted the same day in the same slot, and how many they are */
  turn: number[]
  crowd: number[]
}

/**
 * Each lane's slot in its band, greedily in lane order: the first slot whose last root is at least
 * gap days back, else the slot whose last root is oldest, then the one holding the fewest lanes
 * rooted that day, then the lowest. So a day rooting more lanes in a band than it has slots deals
 * them round the slots, and turn and crowd tell apart those sharing one, from lane order and days
 * alone.
 */
function slotsOf(lanes: ReadonlyArray<Lane>, bandOf: ReadonlyArray<number>, counts: ReadonlyArray<number>, gap: number): Slots {
  interface Run {
    /** the slot's last root */
    day: number
    /** the lanes rooted that day in it */
    lanes: number
  }
  const last = counts.map((count) => Array.from({ length: slotCount(count) }, (): Run => ({ day: -Infinity, lanes: 0 })))
  const runs: Run[] = []
  const slot: number[] = []
  const turn: number[] = []
  lanes.forEach((lane, i) => {
    const row = last[bandOf[i]]
    let s = row.findIndex((run) => lane.rootDay - run.day >= gap)
    if (s < 0) {
      s = 0
      for (let k = 1; k < row.length; k++) if (row[k].day < row[s].day || (row[k].day === row[s].day && row[k].lanes < row[s].lanes)) s = k
    }
    if (row[s].day !== lane.rootDay) row[s] = { day: lane.rootDay, lanes: 0 }
    runs.push(row[s])
    slot.push(s)
    turn.push(row[s].lanes++)
  })
  return { slot, turn, crowd: runs.map((run) => run.lanes) }
}

/** The lane's growth through the time-lapse (LifeStar's growthDays and growthShares). */
function growthOf(lane: Lane, source: ProfileData['source']): { days: number[]; shares: number[] } {
  const active = activeSpans(lane)
  const byCommits = source === 'graphql' && lane.commits > 0
  let total = 0
  for (const span of active) total += byCommits ? span.commits : span.days
  const days: number[] = []
  const shares: number[] = []
  let grown = 0
  active.forEach((span, k) => {
    days.push(span.fromDay)
    shares.push(grown)
    grown += total > 0 ? (byCommits ? span.commits : span.days) / total : 0
    days.push(span.toDay + 1)
    shares.push(k === active.length - 1 ? 1 : Math.min(1, grown))
  })
  return { days, shares }
}

/** The first day two lanes' active spans (each in time order) share; NaN when they share none. */
function firstSharedDay(a: ReadonlyArray<Span>, b: ReadonlyArray<Span>): number {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const from = Math.max(a[i].fromDay, b[j].fromDay)
    if (from <= Math.min(a[i].toDay, b[j].toDay)) return from
    if (a[i].toDay < b[j].toDay) i++
    else j++
  }
  return NaN
}

/**
 * Links between repos active at the same time. Each month links the MONTH_LANES heaviest lanes active
 * in it (by weight, then lane order); a pair's strength is the months it shares, and a pair with no
 * day both are active on is dropped. Each star picks its LINKS_PER_STAR strongest partners (then the
 * earliest first shared day, then the lower star index), the picks are pooled, and the MAX_LINKS
 * strongest are kept (then the earliest, then by a and b). Seedlings of a token profile, whose spans
 * GitHub counted nothing in, link to nothing.
 */
function linksOf(lanes: ReadonlyArray<Lane>, weights: ReadonlyArray<number>, linked: ReadonlyArray<boolean>, starOf: ReadonlyArray<number>): StarLink[] {
  const n = lanes.length
  const spans = lanes.map(activeSpans)
  const months = new Map<number, number[]>()
  lanes.forEach((_lane, i) => {
    if (!linked[i]) return
    let previous = -Infinity
    for (const span of spans[i]) {
      // spans run in time order, so a month two spans touch is met twice in a row at most
      const last = monthOf(span.toDay)
      for (let month = Math.max(previous + 1, monthOf(span.fromDay)); month <= last; month++) {
        let bucket = months.get(month)
        if (!bucket) months.set(month, (bucket = []))
        bucket.push(i)
        previous = month
      }
    }
  })

  const strength = new Map<number, number>()
  for (const bucket of months.values()) {
    const kept = bucket.length > MONTH_LANES ? [...bucket].sort((a, b) => weights[b] - weights[a] || a - b).slice(0, MONTH_LANES).sort((a, b) => a - b) : bucket
    for (let p = 0; p < kept.length; p++) {
      for (let q = p + 1; q < kept.length; q++) {
        const pair = kept[p] * n + kept[q]
        strength.set(pair, (strength.get(pair) ?? 0) + 1)
      }
    }
  }

  interface Candidate {
    a: number
    b: number
    strength: number
    fromDay: number
  }
  const partners: Candidate[][] = lanes.map(() => [])
  for (const [pair, shared] of strength) {
    const p = Math.floor(pair / n)
    const q = pair % n
    const fromDay = firstSharedDay(spans[p], spans[q])
    if (Number.isNaN(fromDay)) continue
    const [a, b] = starOf[p] < starOf[q] ? [starOf[p], starOf[q]] : [starOf[q], starOf[p]]
    const link: Candidate = { a, b, strength: shared, fromDay }
    partners[p].push(link)
    partners[q].push(link)
  }

  const picked = new Set<Candidate>()
  partners.forEach((list, lane) => {
    const self = starOf[lane]
    const other = (link: Candidate) => (link.a === self ? link.b : link.a)
    list.sort((x, y) => y.strength - x.strength || x.fromDay - y.fromDay || other(x) - other(y))
    for (const link of list.slice(0, LINKS_PER_STAR)) picked.add(link)
  })
  return [...picked]
    .sort((x, y) => y.strength - x.strength || x.fromDay - y.fromDay || x.a - y.a || x.b - y.b)
    .slice(0, MAX_LINKS)
    .sort((x, y) => x.a - y.a || x.b - y.b)
    .map(({ a, b, strength, fromDay }) => ({ a, b, strength, fromDay }))
}

/** The days a lane's pull requests landed, as day numbers, one per day. */
function landedDays(lane: Pick<Lane, 'landed'>): number[] {
  const out: number[] = []
  for (const key of lane.landed) {
    const day = dayNumber(key)
    if (Number.isFinite(day) && out[out.length - 1] !== day) out.push(day)
  }
  return out
}

/** The smallest first, then the faintest, then lane order: the order stars are painted in. */
function comparePaint(a: LifeStar, b: LifeStar): number {
  return a.size - b.size || a.glow - b.glow || a.lane - b.lane
}

/** The constellation of a timeline; source says whether lanes weigh commits (graphql) or active days (rest). */
export function layoutConstellation(timeline: LifeTimeline, source: ProfileData['source']): ConstellationLayout {
  const axis = axisOf(timeline)
  const { lanes } = timeline
  const weights = lanes.map((lane) => laneWeight(lane, source))
  const seedling = lanes.map((lane) => source === 'graphql' && !lane.detailed)
  let heaviest = 0
  lanes.forEach((_lane, i) => {
    if (!seedling[i]) heaviest = Math.max(heaviest, weights[i])
  })

  const { bands, bandOf } = bandsOf(lanes, weights)
  const counts = bands.map((band) => band.count)
  const slots = slotsOf(lanes, bandOf, counts, slotGap(axis.days))
  // Lanes alike in every seeded field are told apart by their turn among them, in lane order (as the garden's are).
  const seen = new Map<string, number>()
  const stars = lanes.map((lane, i): LifeStar => {
    const shape = `${lane.born}|${lane.root}|${lane.start}|${lane.language ?? ''}|${lane.isOwn}|${lane.isFork}`
    const twin = seen.get(shape) ?? 0
    seen.set(shape, twin + 1)
    const band = bands[bandOf[i]]
    // A star alone in its slot on its day sits where its seed puts it in the slot's middle half; stars
    // sharing a slot on their day share the middle half evenly, by their turn, so none hides another.
    const crowd = slots.crowd[i]
    const offset = crowd > 1 ? ((slots.turn[i] + 0.5) / crowd - 0.5) * SLOT_SPREAD : (hash01(`${shape}#${twin}`) - 0.5) * SLOT_SPREAD
    const growth = growthOf(lane, source)
    return {
      lane: i,
      key: repoKey(lane.repo),
      startDay: lane.startDay,
      x: lane.rootDay - timeline.startDay + 0.5,
      y: band.y0 + ((band.y1 - band.y0) * (slots.slot[i] + 0.5 + offset)) / slotCount(band.count),
      band: bandOf[i],
      size: seedling[i] || heaviest <= 0 ? 0 : Math.sqrt(weights[i] / heaviest),
      glow: bloomOfStars(lane.stars),
      dry: lane.isArchived,
      twin: lane.isFork,
      visiting: !lane.isOwn,
      seedling: seedling[i],
      language: lane.language,
      endDay: lane.endDay,
      stars: lane.stars,
      landed: landedDays(lane),
      growthDays: growth.days,
      growthShares: growth.shares,
    }
  })
  stars.sort(comparePaint)
  const starOf = new Array<number>(lanes.length)
  stars.forEach((star, i) => {
    starOf[star.lane] = i
  })

  return {
    ...axis,
    byKey: new Map(stars.map((star, i) => [star.key, i])),
    bands,
    stars,
    links: linksOf(lanes, weights, seedling.map((s) => !s), starOf),
  }
}
