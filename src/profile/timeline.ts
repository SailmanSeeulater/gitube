/**
 * The life timeline: one GitHub user's coding life as the person-mode views draw it
 * (PROFILE_SPEC.md sections 4 and 5).
 *
 * - lanes: one per repo, rooted where the person's part in it starts (firstActiveAt), cut into
 *   active and dormant spans;
 * - eras: calendar years, with their contributions (tier 2) and the repos rooted in them;
 * - language eras: the dominant language per quarter, runs of the same one merged;
 * - streaks: the longest and the current run of contribution days (tier 2);
 * - milestones: the ones the API states, plus first repo, top repo, longest streak and language
 *   switches;
 * - clock: the time-lapse's progress at an even pace per active month rather than per day, so a
 *   quiet year does not play as dead air (the idea of graph/timeline.ts, by months, not commits).
 *
 * Everything is counted in GitHub's days ('YYYY-MM-DD', US Pacific; section 2): a timestamp is read
 * in America/Los_Angeles, never in the viewer's time zone. A day is also a day number, the days
 * since 1970-01-01 of its key, which is what the views measure along a time axis. Nothing lies after
 * now's day, and days before the account's creation (backdated commits) are kept.
 *
 * Pure and deterministic: now is passed in, and the order of the profile's repos, days, activity
 * and milestones does not change the result. GitHub names a repo once, but should two repos share
 * a nameWithOwner they become one lane (see mergeRepos), so that input order cannot pick between
 * them either.
 */
import type { ProfileData, ProfileMilestone, ProfileRepo } from '../types'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** The time zone GitHub counts contribution days in. */
export const GITHUB_TIME_ZONE = 'America/Los_Angeles'
/** Quiet days in a row at which a repo falls dormant: shorter gaps stay inside one active span. */
export const DORMANT_DAYS = 30
/** A month with nothing in it plays for this share of an active month's time in the time-lapse. */
export const QUIET_MONTH_SHARE = 0.1

export interface Span {
  kind: 'active' | 'dormant'
  /** first day, inclusive */
  from: string
  /** last day, inclusive */
  to: string
  fromDay: number
  toDay: number
  /** days from `from` to `to`, both counted */
  days: number
  /** counted commits in it (tier 2): 0 for a dormant span and for a tier-1 span */
  commits: number
  /** days in it with counted commits (tier 2) */
  activeDays: number
}

export interface Lane {
  /** nameWithOwner; the views show "private repo" in its place while private names are hidden */
  repo: string
  /** the day the repo was created on GitHub */
  born: string
  /**
   * Where the person's part in it starts, and where the views plant the lane: firstActiveAt's day,
   * which is createdAt's for their own repos. If firstActiveAt cannot be read: createdAt's for their
   * own repos, the first counted day for repos they only contributed to (then the other one). Lanes are ordered by firstActiveAt and counted in the era of their root;
   * commits backdated before it draw spans before it but never move it.
   */
  root: string
  rootDay: number
  /** first day drawn: the root, or an earlier activity day (commits backdated before it) */
  start: string
  /** last day: today, or the last active day of an archived repo, which ends there rather than lying dormant */
  end: string
  startDay: number
  endDay: number
  /** the last day with activity: a counted commit, the root, or the last push (tier 1) */
  lastActive: string
  language: string | null
  isOwn: boolean
  isFork: boolean
  isArchived: boolean
  /** any copy of it is private (mergeRepos), as privacy.ts's privateRepoKeys reads a repo */
  isPrivate: boolean
  stars: number
  forks: number
  /** counted commits (tier 2); 0 when the spans come from the first-active-to-last-push span */
  commits: number
  /** days with counted commits (tier 2) */
  activeDays: number
  /** the spans come from activity days (tier 2); false for one span from firstActiveAt to lastActiveAt
   *  (tier 1, or a tier-2 repo GitHub counted no commits to) */
  detailed: boolean
  /** in time order from start to end, active and dormant in turn, starting with an active one; the
   *  root is always in an active span */
  spans: Span[]
}

export interface Era {
  year: number
  /** January 1 */
  from: string
  /** December 31, or today in the current year */
  to: string
  fromDay: number
  toDay: number
  /** the calendar's contributions in the year (tier 2); null without a calendar (tier 1) */
  contributions: number | null
  /** lanes rooted in the year: own repos created, or repos first contributed to, that year */
  reposBorn: number
}

export interface LanguageEra {
  language: string
  /** its first and last quarter, as 'YYYYqN' */
  fromQuarter: string
  toQuarter: string
  /** the first day of its first quarter */
  from: string
  /** the last day of its last quarter, or today */
  to: string
  fromDay: number
  toDay: number
  /** the language's weight in the era's quarters: commits (tier 2) or active repo-span days (tier 1) */
  weight: number
}

export interface Streak {
  /** first day, inclusive */
  from: string
  /** last day, inclusive */
  to: string
  fromDay: number
  toDay: number
  days: number
}

export interface Streaks {
  /** the longest run of days with contributions (the earliest of equals); null if there are none */
  longest: Streak | null
  /** the run ending today, or yesterday while today has none yet (GitHub's convention); else null */
  current: Streak | null
}

export interface LifeMilestone extends ProfileMilestone {
  /** GitHub's day of date, which places it on the timeline */
  day: string
}

export interface ClockMonth {
  /** 'YYYY-MM' */
  month: string
  /** day number of its first day; the first month starts at the timeline's start instead */
  fromDay: number
  /** anything happened in it: it gets a full share of the time-lapse, a quiet month QUIET_MONTH_SHARE */
  active: boolean
  /** progress at its first day */
  at: number
}

/** The time-lapse clock, read with progressAt and dayAt. */
export interface LifeClock {
  /** every month from the timeline's start to now's, ascending; the first one starts at the
   *  timeline's start and the last one ends at nowDay */
  months: ClockMonth[]
  /** now as a fractional day number: today's day number plus the share of today gone by */
  nowDay: number
}

export interface LifeTimeline {
  /** now's day: nothing lies after it */
  today: string
  /** the first day anything happened: the account's creation, or earlier activity (backdated commits) */
  start: string
  todayDay: number
  startDay: number
  /** by firstActiveAt (the instant, not only the day), then public before private, public ones by
   *  nameWithOwner and private ones by what the views show of them (compareLanes); one per nameWithOwner */
  lanes: Lane[]
  /** every calendar year from the first one the profile reaches (start, or the calendar's first day) to now's */
  eras: Era[]
  /** in time order; a quarter with nothing weighted has no dominant language and does not break an era */
  languageEras: LanguageEra[]
  /** null without a contribution calendar (tier 1) */
  streaks: Streaks | null
  /** the API's and the derived ones, by day, then kind; one of each kind, but one language switch a day */
  milestones: LifeMilestone[]
  clock: LifeClock
}

// ---------- days ----------

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

/** A day key's day number; NaN for anything that is not a calendar day. */
export function dayNumber(key: string): number {
  if (!DAY_KEY.test(key)) return NaN
  const year = +key.slice(0, 4)
  const month = +key.slice(5, 7) - 1
  const date = +key.slice(8, 10)
  const t = Date.UTC(year, month, date)
  // Date.UTC rolls 2023-02-30 over into March: that is not a day
  return month >= 0 && month <= 11 && date >= 1 && t < Date.UTC(year, month + 1, 1) ? t / DAY_MS : NaN
}

/** A day number's key, 'YYYY-MM-DD'. */
export function dayKey(day: number): string {
  return new Date(Math.floor(day) * DAY_MS).toISOString().slice(0, 10)
}

// Built once: making a DateTimeFormat costs far more than using one.
let pacific: Intl.DateTimeFormat | undefined
const WALL_PARTS: string[] = ['year', 'month', 'day', 'hour', 'minute', 'second']

/** [year, month 1-12, day, hour, minute, second] of an instant on a US Pacific wall clock. */
function pacificWall(t: number): number[] {
  pacific ??= new Intl.DateTimeFormat('en-US', {
    timeZone: GITHUB_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  const wall = [1970, 1, 1, 0, 0, 0]
  for (const { type, value } of pacific.formatToParts(t)) {
    const i = WALL_PARTS.indexOf(type)
    if (i >= 0) wall[i] = Number(value)
  }
  return wall
}

/** GitHub's day number of an instant. */
function pacificDay(t: number): number {
  const [year, month, day] = pacificWall(t)
  return Date.UTC(year, month - 1, day) / DAY_MS
}

/** The instant a Pacific day starts. */
/** A GitHub day's start as an ISO timestamp: milestones' dates are timestamps, their day keys are in `day`. */
function dayStartIso(key: string): string {
  return new Date(pacificMidnight(dayNumber(key))).toISOString()
}

function pacificMidnight(day: number): number {
  // 08:00 UTC is midnight on standard time and 01:00 on daylight time; the clocks never change at midnight
  const probe = day * DAY_MS + 8 * HOUR_MS
  const [year, month, date, hour, minute, second] = pacificWall(probe)
  return day * DAY_MS - (Date.UTC(year, month - 1, date, hour, minute, second) - probe)
}

/**
 * An instant as a fractional day number: its Pacific day plus the share of that day gone by. It
 * rises steadily through the 23- and 25-hour days the clock changes on.
 */
function pacificPosition(t: number): number {
  const day = pacificDay(t)
  const from = pacificMidnight(day)
  const to = pacificMidnight(day + 1)
  return day + Math.min(1, Math.max(0, (t - from) / (to - from)))
}

/** An ISO 8601 timestamp with its offset, as GitHub writes them. Date.parse reads others in local time. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i

/** A timestamp (ms or ISO with an offset) as ms; NaN for anything else. */
function instantOf(date: string | number): number {
  if (typeof date === 'number') return date
  return ISO_INSTANT.test(date) ? Date.parse(date) : NaN
}

/** A date's day number: a day key as it is, a timestamp (ms or ISO) by its Pacific day. NaN if unreadable. */
function dayOf(date: string | number): number {
  if (typeof date === 'string' && DAY_KEY.test(date)) return dayNumber(date)
  const t = instantOf(date)
  return Number.isFinite(t) ? pacificDay(t) : NaN
}

/** Like dayOf, but a timestamp keeps how far into its day it is. A day key is its day's start. */
function positionOf(date: string | number): number {
  if (typeof date === 'string' && DAY_KEY.test(date)) return dayNumber(date)
  const t = instantOf(date)
  return Number.isFinite(t) ? pacificPosition(t) : NaN
}

/** GitHub's day of a date (a day key, an ISO timestamp or ms), or null if it cannot be read. */
export function githubDay(date: string | number): string | null {
  const day = dayOf(date)
  return Number.isFinite(day) ? dayKey(day) : null
}

function yearOf(day: number): number {
  return new Date(day * DAY_MS).getUTCFullYear()
}

/** Months and quarters are counted from year 0: year * 12 + month, year * 4 + quarter. */
function monthOf(day: number): number {
  const date = new Date(day * DAY_MS)
  return date.getUTCFullYear() * 12 + date.getUTCMonth()
}

function monthStart(month: number): number {
  return Date.UTC(Math.floor(month / 12), month % 12, 1) / DAY_MS
}

function quarterOf(day: number): number {
  const date = new Date(day * DAY_MS)
  return date.getUTCFullYear() * 4 + Math.floor(date.getUTCMonth() / 3)
}

function quarterStart(quarter: number): number {
  return Date.UTC(Math.floor(quarter / 4), (quarter % 4) * 3, 1) / DAY_MS
}

function quarterKey(quarter: number): string {
  return `${Math.floor(quarter / 4)}q${(quarter % 4) + 1}`
}

/** Code-unit order: the same in every locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ---------- lanes ----------

interface RawSpan {
  kind: 'active' | 'dormant'
  fromDay: number
  toDay: number
  commits: number
  activeDays: number
}

/** A repo with its commits by GitHub day: days after today and days with no commits left out. */
interface MergedRepo {
  repo: ProfileRepo
  byDay: Map<number, number>
}

interface BuiltLane {
  lane: Lane
  /** the merged repo it was built from */
  repo: ProfileRepo
  /** firstActiveAt as a fractional day number (never past now), which orders the lanes */
  rootAt: number
  lastActiveDay: number
  /** [day, commits] for each day with counted commits, ascending */
  activity: [number, number][]
  /** laneSignature, made the first time compareLanes needs it */
  signature?: string
}

/** null before any text, then code-unit order. */
function compareNullable(a: string | null, b: string | null): number {
  return a === b ? 0 : a === null ? -1 : b === null ? 1 : compareText(a, b)
}

/** A total order on a repo's fields besides its name and activity: copies it calls equal are alike. */
function compareRepoFields(a: ProfileRepo, b: ProfileRepo): number {
  return (
    // the freshest copy first: the latest push, then the most stars and forks
    compareText(b.lastActiveAt, a.lastActiveAt) ||
    b.stars - a.stars ||
    b.forks - a.forks ||
    compareText(a.createdAt, b.createdAt) ||
    compareText(a.firstActiveAt, b.firstActiveAt) ||
    compareNullable(a.language, b.language) ||
    compareNullable(a.languageColor, b.languageColor) ||
    Number(a.isOwn) - Number(b.isOwn) ||
    Number(a.isFork) - Number(b.isFork) ||
    Number(a.isArchived) - Number(b.isArchived) ||
    Number(a.isPrivate) - Number(b.isPrivate)
  )
}

/**
 * The profile's repos, one per nameWithOwner (compared without case, as GitHub does). Within one
 * repo's activity a day listed twice adds up; copies of a repo listed twice (a fetcher's pages or
 * windows overlapping) are merged instead: each day keeps the larger of the copies' counts, and the
 * freshest copy (first in compareRepoFields's order) lends the other fields, except that the repo is
 * private when any copy is, as privateRepoKeys hides its name (privacy.ts). These rules ignore which
 * copy came first.
 */
function mergeRepos(repos: ProfileRepo[], today: number): MergedRepo[] {
  const byName = new Map<string, MergedRepo>()
  const secret = new Set<string>()
  for (const repo of repos) {
    const byDay = new Map<number, number>()
    for (const { date, commits } of repo.activity) {
      const day = dayOf(date)
      if (day <= today && commits > 0) byDay.set(day, (byDay.get(day) ?? 0) + commits)
    }
    const key = repo.nameWithOwner.toLowerCase()
    if (repo.isPrivate) secret.add(key)
    const merged = byName.get(key)
    if (!merged) {
      byName.set(key, { repo, byDay })
      continue
    }
    for (const [day, commits] of byDay) merged.byDay.set(day, Math.max(merged.byDay.get(day) ?? 0, commits))
    if (compareRepoFields(repo, merged.repo) < 0) merged.repo = repo
  }
  return [...byName].map(([key, merged]) => (secret.has(key) && !merged.repo.isPrivate ? { ...merged, repo: { ...merged.repo, isPrivate: true } } : merged))
}

function toSpan(raw: RawSpan): Span {
  return {
    kind: raw.kind,
    from: dayKey(raw.fromDay),
    to: dayKey(raw.toDay),
    fromDay: raw.fromDay,
    toDay: raw.toDay,
    days: raw.toDay - raw.fromDay + 1,
    commits: raw.commits,
    activeDays: raw.activeDays,
  }
}

function buildLane({ repo, byDay }: MergedRepo, today: number, nowDay: number): BuiltLane {
  const activity = [...byDay].sort((a, b) => a[0] - b[0])

  // The root: firstActiveAt, else createdAt, else the first counted day. Its instant orders the
  // lanes, so backdated commits, which only add spans before it, cannot reorder them.
  // A repo they only contributed to falls back to their first counted day before its own birth.
  let rootAt = positionOf(repo.firstActiveAt)
  if (Number.isNaN(rootAt) && !repo.isOwn) rootAt = activity[0]?.[0] ?? NaN
  if (Number.isNaN(rootAt)) rootAt = positionOf(repo.createdAt)
  if (Number.isNaN(rootAt)) rootAt = activity[0]?.[0] ?? today
  rootAt = Math.min(rootAt, nowDay)
  const rootDay = Math.floor(rootAt)
  const created = dayOf(repo.createdAt)

  const runs: RawSpan[] = []
  if (activity.length === 0) {
    // no counted commits: one span from the root to the last push, tier 1's only detail
    const last = dayOf(repo.lastActiveAt)
    runs.push({ kind: 'active', fromDay: rootDay, toDay: Math.min(today, Math.max(rootDay, Number.isFinite(last) ? last : rootDay)), commits: 0, activeDays: 0 })
  } else {
    // The root counts as active too: the repo was born, or they arrived, that day.
    // Activity days closer than DORMANT_DAYS quiet days apart share one active span.
    const points = [...new Set([rootDay, ...activity.map(([day]) => day)])].sort((a, b) => a - b)
    let run: RawSpan = { kind: 'active', fromDay: points[0], toDay: points[0], commits: 0, activeDays: 0 }
    for (const day of points) {
      if (day - run.toDay - 1 >= DORMANT_DAYS) {
        runs.push(run)
        run = { kind: 'active', fromDay: day, toDay: day, commits: 0, activeDays: 0 }
      }
      run.toDay = day
      const commits = byDay.get(day) ?? 0
      run.commits += commits
      if (commits > 0) run.activeDays++
    }
    runs.push(run)
  }

  const raw: RawSpan[] = []
  runs.forEach((run, i) => {
    if (i > 0) raw.push({ kind: 'dormant', fromDay: runs[i - 1].toDay + 1, toDay: run.fromDay - 1, commits: 0, activeDays: 0 })
    raw.push(run)
  })
  const lastActiveDay = runs[runs.length - 1].toDay
  // An archived repo ends at its last activity (the views draw it dry); any other runs on to today.
  // A quiet spell only counts as dormant once it lasts DORMANT_DAYS, at a lane's end as between runs.
  if (!repo.isArchived && today > lastActiveDay) {
    if (today - lastActiveDay >= DORMANT_DAYS) raw.push({ kind: 'dormant', fromDay: lastActiveDay + 1, toDay: today, commits: 0, activeDays: 0 })
    else raw[raw.length - 1].toDay = today
  }

  const startDay = raw[0].fromDay
  const endDay = raw[raw.length - 1].toDay
  const born = Math.min(today, Number.isFinite(created) ? created : rootDay)
  let commits = 0
  for (const [, n] of activity) commits += n
  const lane: Lane = {
    repo: repo.nameWithOwner,
    born: dayKey(born),
    root: dayKey(rootDay),
    rootDay,
    start: dayKey(startDay),
    end: dayKey(endDay),
    startDay,
    endDay,
    lastActive: dayKey(lastActiveDay),
    language: repo.language,
    isOwn: repo.isOwn,
    isFork: repo.isFork,
    isArchived: repo.isArchived,
    isPrivate: repo.isPrivate,
    stars: repo.stars,
    forks: repo.forks,
    commits,
    activeDays: activity.length,
    detailed: activity.length > 0,
    spans: raw.map(toSpan),
  }
  return { lane, repo, rootAt, lastActiveDay, activity }
}

/**
 * Everything the views can show of a lane but its name, as text: its fields, its spans and its
 * counted days (which a day's repo list shows). Named field by field, so a field added to Lane stays
 * out until someone decides it reveals nothing.
 */
function laneSignature({ lane, activity }: BuiltLane): string {
  return JSON.stringify([
    lane.born,
    lane.root,
    lane.start,
    lane.end,
    lane.lastActive,
    lane.language,
    lane.isOwn,
    lane.isFork,
    lane.isArchived,
    lane.stars,
    lane.forks,
    lane.commits,
    lane.activeDays,
    lane.detailed,
    lane.spans.map((span) => [span.kind, span.fromDay, span.toDay, span.commits, span.activeDays]),
    activity,
  ])
}

/**
 * The lanes' order: by root instant; on one instant, public before private, public lanes by
 * nameWithOwner. The order shows (the panel's rows, the garden's depth rows and twin seeds, a day's
 * repo list), and a private repo's name may be hidden, so private lanes on one instant never compare
 * names: they go by laneSignature, compared as text rather than hashed, so nothing collides and the
 * order is the same whatever order the repos came in. Only private lanes alike in all of it fall back
 * to the name; those look the same in every view, so the order between them shows nothing of which
 * name is which. A total order, as mergeRepos leaves one lane per name.
 */
function compareLanes(a: BuiltLane, b: BuiltLane): number {
  if (a.rootAt !== b.rootAt) return a.rootAt - b.rootAt
  const secret = a.lane.isPrivate
  if (secret !== b.lane.isPrivate) return secret ? 1 : -1
  if (secret) {
    const bySignature = compareText((a.signature ??= laneSignature(a)), (b.signature ??= laneSignature(b)))
    if (bySignature !== 0) return bySignature
  }
  return compareText(a.lane.repo, b.lane.repo)
}

// ---------- language eras ----------

/**
 * Quarter -> language -> weight, into eras: the heaviest language per quarter, equal neighbours
 * merged. A tie keeps the language of the era so far, so an even quarter is no switch; only with
 * no era yet, or with that language out of the tie, does name order pick.
 */
function languageErasOf(weights: Map<number, Map<string, number>>, today: number): LanguageEra[] {
  const eras: LanguageEra[] = []
  for (const quarter of [...weights.keys()].sort((a, b) => a - b)) {
    const row = weights.get(quarter)!
    const era = eras[eras.length - 1]
    let weight = 0
    for (const w of row.values()) weight = Math.max(weight, w)
    const heaviest = [...row].filter(([, w]) => w === weight).map(([name]) => name)
    const language = era && heaviest.includes(era.language) ? era.language : heaviest.sort(compareText)[0]
    const toDay = Math.min(today, quarterStart(quarter + 1) - 1)
    // A quarter with nothing weighted is not in the map: the same language on both sides of a quiet
    // spell stays one era, and a different one leaves the quiet quarters between them uncovered.
    if (era && era.language === language) {
      era.toQuarter = quarterKey(quarter)
      era.to = dayKey(toDay)
      era.toDay = toDay
      era.weight += weight
    } else {
      const fromDay = quarterStart(quarter)
      eras.push({ language, fromQuarter: quarterKey(quarter), toQuarter: quarterKey(quarter), from: dayKey(fromDay), to: dayKey(toDay), fromDay, toDay, weight })
    }
  }
  return eras
}

// ---------- streaks ----------

function streakOf(fromDay: number, toDay: number): Streak {
  return { from: dayKey(fromDay), to: dayKey(toDay), fromDay, toDay, days: toDay - fromDay + 1 }
}

/** From the ascending days with contributions. */
function streaksOf(days: number[], today: number): Streaks {
  let longest: Streak | null = null
  let current: Streak | null = null
  let from = 0
  for (let i = 0; i < days.length; i++) {
    if (i === 0 || days[i] !== days[i - 1] + 1) from = days[i]
    const ends = i === days.length - 1 || days[i + 1] !== days[i] + 1
    if (!ends) continue
    const run = streakOf(from, days[i])
    if (!longest || run.days > longest.days) longest = run
    // today's count can still be 0 while yesterday's run goes on
    if (days[i] >= today - 1) current = run
  }
  return { longest, current }
}

// ---------- milestones ----------

const KIND_ORDER: ProfileMilestone['kind'][] = ['joined', 'first-repo', 'first-pr', 'first-issue', 'top-repo', 'longest-streak', 'language-switch']

function compareMilestones(a: LifeMilestone, b: LifeMilestone): number {
  return (
    compareText(a.day, b.day) ||
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    compareText(a.label, b.label) ||
    compareText(a.repo ?? '', b.repo ?? '') ||
    compareText(a.date, b.date)
  )
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * The first of the person's own repos by createdAt, and the most starred one if any has a star.
 * Forks are left out: a fork is a copy of someone else's work, not a repo they started. The repos
 * come in lane order, which breaks a tie, as it reads no private name (compareLanes).
 */
function ownRepoMilestones(repos: ProfileRepo[], today: number): LifeMilestone[] {
  const own = repos
    .filter((repo) => repo.isOwn && !repo.isFork && dayOf(repo.createdAt) <= today)
    .map((repo, turn) => ({ repo, time: positionOf(repo.createdAt), turn }))
  const byBirth = (a: (typeof own)[number], b: (typeof own)[number]) => a.time - b.time || a.turn - b.turn
  const out: LifeMilestone[] = []
  const first = [...own].sort(byBirth)[0]
  if (first) out.push({ kind: 'first-repo', date: first.repo.createdAt, day: githubDay(first.repo.createdAt)!, label: 'first repo', repo: first.repo.nameWithOwner })
  const top = own.filter(({ repo }) => repo.stars > 0).sort((a, b) => b.repo.stars - a.repo.stars || byBirth(a, b))[0]
  if (top) {
    out.push({ kind: 'top-repo', date: top.repo.createdAt, day: githubDay(top.repo.createdAt)!, label: `most starred repo: ${plural(top.repo.stars, 'star')}`, repo: top.repo.nameWithOwner })
  }
  return out
}

// ---------- the clock ----------

/** Progress (0..1) at a fractional day number. */
export function progressAtDay(clock: LifeClock, day: number): number {
  const { months, nowDay } = clock
  if (day >= nowDay) return 1
  if (!(day > months[0].fromDay)) return 0
  // the last month starting on or before day
  let lo = 0
  let hi = months.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (months[mid].fromDay <= day) lo = mid
    else hi = mid - 1
  }
  const month = months[lo]
  const next = months[lo + 1]
  const endDay = next ? next.fromDay : nowDay
  const endAt = next ? next.at : 1
  return month.at + ((endAt - month.at) * (day - month.fromDay)) / (endDay - month.fromDay)
}

/**
 * Progress (0..1) at a date: a day key (its start), an ISO timestamp or ms. 0 at the timeline's
 * start and before, 1 at now and after; an unreadable date is at the start, as an undated commit is
 * in graph/timeline.ts.
 */
export function progressAt(clock: LifeClock, date: string | number): number {
  const day = positionOf(date)
  return Number.isNaN(day) ? 0 : progressAtDay(clock, day)
}

/** The inverse of progressAtDay: the fractional day number the clock shows at a progress. */
export function dayAt(clock: LifeClock, progress: number): number {
  const { months, nowDay } = clock
  if (progress >= 1) return nowDay
  if (!(progress > 0)) return months[0].fromDay
  let lo = 0
  let hi = months.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (months[mid].at <= progress) lo = mid
    else hi = mid - 1
  }
  const month = months[lo]
  const next = months[lo + 1]
  const endDay = next ? next.fromDay : nowDay
  const endAt = next ? next.at : 1
  if (endAt <= month.at) return month.fromDay
  return month.fromDay + ((endDay - month.fromDay) * (progress - month.at)) / (endAt - month.at)
}

/**
 * Every month from the start's to now's gets a share of the time-lapse: a full one if anything
 * happened in it, QUIET_MONTH_SHARE if nothing did, and time runs evenly within it. The clock runs
 * from the start day to now, not from the 1st to the month's end, so the first and the current month
 * get only the part of their share that lies inside the timeline, and play at the same pace as any
 * other month.
 */
function clockOf(startDay: number, nowDay: number, today: number, events: Iterable<number>): LifeClock {
  const active = new Set<number>()
  for (const day of events) if (day >= startDay && day <= today) active.add(monthOf(day))
  const first = monthOf(startDay)
  const last = monthOf(today)
  const months: ClockMonth[] = []
  let total = 0
  for (let month = first; month <= last; month++) {
    const isActive = active.has(month)
    const fromDay = month === first ? startDay : monthStart(month)
    const toDay = month === last ? nowDay : monthStart(month + 1)
    const inside = Math.max(0, toDay - fromDay) / (monthStart(month + 1) - monthStart(month))
    months.push({ month: dayKey(monthStart(month)).slice(0, 7), fromDay, active: isActive, at: total })
    total += (isActive ? 1 : QUIET_MONTH_SHARE) * inside
  }
  // a timeline that starts at now (an account made this very moment) has no length to share out
  if (total > 0) for (const month of months) month.at /= total
  return { months, nowDay }
}

// ---------- the timeline ----------

/** The life timeline of a profile at now (ms). */
export function buildLifeTimeline(profile: ProfileData, now: number): LifeTimeline {
  if (!Number.isFinite(now)) throw new RangeError('buildLifeTimeline: now must be a time in ms')
  const nowDay = pacificPosition(now)
  const today = Math.floor(nowDay)
  const hasCalendar = profile.source === 'graphql'

  // The contribution calendar. A day listed twice counts once, at its larger count.
  const calendar = new Map<number, number>()
  let firstCalendarDay = Infinity
  for (const { date, count } of profile.days) {
    const day = dayOf(date)
    if (!(day <= today)) continue
    firstCalendarDay = Math.min(firstCalendarDay, day)
    if (count > 0) calendar.set(day, Math.max(calendar.get(day) ?? 0, count))
  }
  const contributionDays = [...calendar.keys()].sort((a, b) => a - b)

  const repos = mergeRepos(profile.repos, today)
  const built = repos.map((repo) => buildLane(repo, today, nowDay)).sort(compareLanes)
  const lanes = built.map(({ lane }) => lane)

  const account = dayOf(profile.createdAt)
  const recentDays = profile.recent.map(({ date }) => dayOf(date)).filter((day) => day <= today)
  let startDay = Math.min(today, contributionDays[0] ?? Infinity, ...recentDays)
  if (account <= today) startDay = Math.min(startDay, account)
  for (const lane of lanes) startDay = Math.min(startDay, lane.startDay)

  // Eras: calendar years, from the start's (or the calendar's first day's, if earlier) to now's.
  const firstYear = yearOf(Math.min(startDay, firstCalendarDay))
  const contributions = new Map<number, number>()
  for (const [day, count] of calendar) contributions.set(yearOf(day), (contributions.get(yearOf(day)) ?? 0) + count)
  const rooted = new Map<number, number>()
  for (const lane of lanes) rooted.set(yearOf(lane.rootDay), (rooted.get(yearOf(lane.rootDay)) ?? 0) + 1)
  const eras: Era[] = []
  for (let year = firstYear; year <= yearOf(today); year++) {
    const fromDay = Date.UTC(year, 0, 1) / DAY_MS
    const toDay = Math.min(today, Date.UTC(year + 1, 0, 1) / DAY_MS - 1)
    eras.push({
      year,
      from: dayKey(fromDay),
      to: dayKey(toDay),
      fromDay,
      toDay,
      contributions: hasCalendar ? (contributions.get(year) ?? 0) : null,
      reposBorn: rooted.get(year) ?? 0,
    })
  }

  // Language eras, weighted by commits with a calendar (tier 2), else by active span days (tier 1).
  const weights = new Map<number, Map<string, number>>()
  const weigh = (quarter: number, language: string, weight: number) => {
    let row = weights.get(quarter)
    if (!row) weights.set(quarter, (row = new Map()))
    row.set(language, (row.get(language) ?? 0) + weight)
  }
  for (const { lane, activity } of built) {
    if (lane.language === null) continue
    if (hasCalendar) {
      for (const [day, commits] of activity) weigh(quarterOf(day), lane.language, commits)
      continue
    }
    for (const span of lane.spans) {
      if (span.kind !== 'active') continue
      for (let quarter = quarterOf(span.fromDay); quarter <= quarterOf(span.toDay); quarter++) {
        const overlap = Math.min(span.toDay, quarterStart(quarter + 1) - 1) - Math.max(span.fromDay, quarterStart(quarter)) + 1
        weigh(quarter, lane.language, overlap)
      }
    }
  }
  const languageEras = languageErasOf(weights, today)

  const streaks = hasCalendar ? streaksOf(contributionDays, today) : null

  // Milestones, none after today. Every kind but language-switch happens once in a life: the first
  // stated one by day (then label) stands, and a derived one only fills a kind the API states none
  // of. Language switches are kept one a day, again the API's before a derived one.
  const stated: LifeMilestone[] = []
  for (const milestone of profile.milestones) {
    const day = dayOf(milestone.date)
    if (day <= today) stated.push({ ...milestone, day: dayKey(day) })
  }
  const derived: LifeMilestone[] = ownRepoMilestones(built.map(({ repo }) => repo), today)
  if (streaks?.longest) {
    const { from, days } = streaks.longest
    derived.push({ kind: 'longest-streak', date: dayStartIso(from), day: from, label: `longest streak: ${plural(days, 'day')}` })
  }
  for (let i = 1; i < languageEras.length; i++) {
    const { from, language } = languageEras[i]
    derived.push({ kind: 'language-switch', date: dayStartIso(from), day: from, label: `${languageEras[i - 1].language} to ${language}` })
  }
  const seen = new Set<string>()
  const milestones: LifeMilestone[] = []
  for (const milestone of [...stated.sort(compareMilestones), ...derived]) {
    const key = milestone.kind === 'language-switch' ? `${milestone.kind} ${milestone.day}` : milestone.kind
    if (seen.has(key)) continue
    seen.add(key)
    milestones.push(milestone)
  }
  milestones.sort(compareMilestones)

  // The clock's events: the account's creation, each lane's root and activity, the last push of a
  // lane without counted commits, contribution days and recent pushes.
  const events: number[] = [...contributionDays, ...recentDays]
  if (account <= today) events.push(account)
  for (const { lane, lastActiveDay, activity } of built) {
    events.push(lane.rootDay)
    if (!lane.detailed) events.push(lastActiveDay)
    for (const [day] of activity) events.push(day)
  }
  const clock = clockOf(startDay, nowDay, today, events)

  return {
    today: dayKey(today),
    start: dayKey(startDay),
    todayDay: today,
    startDay,
    lanes,
    eras,
    languageEras,
    streaks,
    milestones,
    clock,
  }
}
