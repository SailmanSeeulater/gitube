/**
 * What happened on one day of a life, for the inspector when a day is hovered: the calendar's count
 * (tier 2), the repos with counted commits (tier 2) or pushes (tier 1) that day, the pull requests
 * landed in other people's repos that day (tier 2), and the milestones on it. The timeline keeps no
 * per-day activity on its lanes, so this indexes the profile once.
 *
 * It reads the profile with the timeline's own rules, so a day's detail always agrees with the lanes:
 * days are GitHub's (a day key as it is, a timestamp by its US Pacific day), nothing after today
 * counts, repos are one per nameWithOwner without case (named as their lane is), a day listed twice
 * in one repo's activity adds up, and copies of a repo listed twice keep the larger count per day.
 * Each repo's commits over every day therefore sum to its lane's commits.
 *
 * Without a token, days before recentFrom are unknown, not quiet: GitHub keeps 30 days of events.
 */
import type { ProfileData } from '../types'
import { repoKey } from './privacy'
import { dayKey, dayNumber, githubDay, type LifeTimeline } from './timeline'

/** A repo's activity on a day: counted commits (tier 2) or pushes (tier 1). */
export interface DayRepo {
  /** nameWithOwner, as its lane spells it; views show it through the namer */
  repo: string
  n: number
  unit: 'commits' | 'pushes'
}

/** The pull requests landed in one repo on a day. */
export interface DayLanded {
  /** nameWithOwner, as its lane spells it; views show it through the namer */
  repo: string
  n: number
}

export interface DayDetail {
  /** day number */
  day: number
  /** 'YYYY-MM-DD', GitHub's day */
  key: string
  /** the profile says what happened that day: false before recentFrom without a token, after today,
   *  and on a day a token profile's calendar does not list (a quarter lost to an error) */
  known: boolean
  /** the calendar's contributions that day (tier 2); null without a calendar or a listing */
  count: number | null
  /** the most active first, then in lane order */
  repos: DayRepo[]
  /** the pull requests landed that day, by repo: the most first, then in lane order (tier 2) */
  landed: DayLanded[]
  /** indexes in timeline.milestones */
  milestones: number[]
}

export interface DayIndex {
  readonly source: ProfileData['source']
  readonly todayDay: number
  /** the first day tier 1's pushes cover; null with a token */
  readonly recentFromDay: number | null
  /** the calendar's count per listed day, zeros kept (tier 2); read through dayDetail */
  readonly calendar: ReadonlyMap<number, number>
  /** the repos active per day, in DayDetail's order */
  readonly repos: ReadonlyMap<number, ReadonlyArray<DayRepo>>
  /** the pull requests landed per day, in DayDetail's order */
  readonly landed: ReadonlyMap<number, ReadonlyArray<DayLanded>>
  readonly milestones: ReadonlyMap<number, ReadonlyArray<number>>
}

/** A date's GitHub day number, as the timeline reads it; NaN if it cannot be read. */
function dayOf(date: string): number {
  const key = githubDay(date)
  return key === null ? NaN : dayNumber(key)
}

function addTo<K>(map: Map<K, number>, key: K, n: number): void {
  map.set(key, (map.get(key) ?? 0) + n)
}

export function buildDayIndex(profile: ProfileData, timeline: LifeTimeline): DayIndex {
  const today = timeline.todayDay

  // A day listed twice counts once, at its larger count, as in the timeline.
  const calendar = new Map<number, number>()
  for (const { date, count } of profile.days) {
    const day = dayOf(date)
    if (day <= today) calendar.set(day, Math.max(calendar.get(day) ?? 0, count))
  }

  // Commits per repo key per day: summed within a copy, the larger across copies (mergeRepos's rules).
  const commits = new Map<string, Map<number, number>>()
  for (const repo of profile.repos) {
    const byDay = new Map<number, number>()
    for (const { date, commits: n } of repo.activity) {
      const day = dayOf(date)
      if (day <= today && n > 0) addTo(byDay, day, n)
    }
    const key = repoKey(repo.nameWithOwner)
    const merged = commits.get(key)
    if (!merged) commits.set(key, byDay)
    else for (const [day, n] of byDay) merged.set(day, Math.max(merged.get(day) ?? 0, n))
  }

  // Pushes per repo key per day (tier 1): one row per repo and day, so a repeat adds up.
  const pushes = new Map<string, Map<number, number>>()
  const spelled = new Map<string, string>()
  let firstPush = Infinity
  for (const { date, repo, pushes: n } of profile.recent) {
    const day = dayOf(date)
    if (!(day <= today && n > 0)) continue
    const key = repoKey(repo)
    let byDay = pushes.get(key)
    if (!byDay) pushes.set(key, (byDay = new Map()))
    addTo(byDay, day, n)
    firstPush = Math.min(firstPush, day)
    // a repo without a lane (a push to someone else's) keeps its first spelling in code-unit order
    const was = spelled.get(key)
    if (was === undefined || repo < was) spelled.set(key, repo)
  }

  const lanes = new Map<string, number>()
  timeline.lanes.forEach((lane, i) => {
    lanes.set(repoKey(lane.repo), i)
    spelled.set(repoKey(lane.repo), lane.repo)
  })
  const repos = new Map<number, DayRepo[]>()
  const note = (key: string, byDay: Map<number, number>, unit: DayRepo['unit']) => {
    const repo = spelled.get(key) ?? key
    for (const [day, n] of byDay) {
      let list = repos.get(day)
      if (!list) repos.set(day, (list = []))
      list.push({ repo, n, unit })
    }
  }
  for (const [key, byDay] of commits) note(key, byDay, 'commits')
  for (const [key, byDay] of pushes) note(key, byDay, 'pushes')
  // Lane order, not names, breaks a tie, so the order shows nothing of a hidden name.
  const laneOf = (repo: string) => lanes.get(repoKey(repo)) ?? Infinity
  const order = (a: DayRepo, b: DayRepo) =>
    b.n - a.n || (a.unit === b.unit ? 0 : a.unit === 'commits' ? -1 : 1) || laneOf(a.repo) - laneOf(b.repo) || (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0)
  for (const list of repos.values()) list.sort(order)

  // Pull requests landed per day per repo key (tier 2), one entry each; a repo without a lane is
  // dropped, as the timeline drops it. Lane order breaks a tie here too.
  const landedBy = new Map<number, Map<string, number>>()
  for (const { day: date, repo } of profile.landed) {
    const day = dayOf(date)
    const key = repoKey(repo)
    if (!(day <= today) || !lanes.has(key)) continue
    let byRepo = landedBy.get(day)
    if (!byRepo) landedBy.set(day, (byRepo = new Map()))
    addTo(byRepo, key, 1)
  }
  const landed = new Map<number, DayLanded[]>()
  for (const [day, byRepo] of landedBy) {
    const list = [...byRepo].map(([key, n]): DayLanded => ({ repo: spelled.get(key) ?? key, n }))
    list.sort((a, b) => b.n - a.n || laneOf(a.repo) - laneOf(b.repo) || (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0))
    landed.set(day, list)
  }

  const milestones = new Map<number, number[]>()
  timeline.milestones.forEach((milestone, i) => {
    const day = dayNumber(milestone.day)
    if (!Number.isFinite(day)) return
    const list = milestones.get(day)
    if (list) list.push(i)
    else milestones.set(day, [i])
  })

  let recentFromDay: number | null = null
  if (profile.source === 'rest') {
    const from = profile.recentFrom === null ? NaN : dayOf(profile.recentFrom)
    recentFromDay = Number.isFinite(from) ? from : Number.isFinite(firstPush) ? firstPush : null
  }

  return { source: profile.source, todayDay: today, recentFromDay, calendar, repos, landed, milestones }
}

/** One day's detail (a day number; a fractional one reads its day). */
export function dayDetail(index: DayIndex, day: number): DayDetail {
  const d = Math.floor(day)
  const upToToday = d <= index.todayDay
  const repos = upToToday ? (index.repos.get(d) ?? []).map((repo) => ({ ...repo })) : []
  const landed = upToToday ? (index.landed.get(d) ?? []).map((row) => ({ ...row })) : []
  const known =
    upToToday &&
    (index.source === 'graphql' ? index.calendar.has(d) || repos.length > 0 || landed.length > 0 : index.recentFromDay !== null && d >= index.recentFromDay)
  return {
    day: d,
    key: dayKey(d),
    known,
    count: index.source === 'graphql' ? (index.calendar.get(d) ?? null) : null,
    repos,
    landed,
    milestones: [...(index.milestones.get(d) ?? [])],
  }
}
