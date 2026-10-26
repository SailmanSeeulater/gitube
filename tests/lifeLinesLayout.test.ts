/**
 * The life lines layout: pure and deterministic (the same timeline, or the same profile in any
 * order, gives the same layout, and a renamed repo, private or not, keeps its track, parts and
 * stations), one line per lane on the shared time axis, tracks packed on what a line holds (its
 * active parts and stations) that never overlap as drawn, a dormant tail cut short of the next line
 * on its track, parts that tile a line, weights, flags and stations on their own days; then a
 * prolific profile of hundreds of repos packed far enough apart to read, the recordings (kepano
 * through the token tier, gaearon without one), an account a day old and a user with no repos.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { fetchProfileGraphql } from '../src/api/profileGraphql'
import { fetchProfileRest } from '../src/api/profile'
import { TRACK_GAP_MIN_DAYS, layoutLifeLines, trackGapDays, type LifeLinesLayout } from '../src/profile/lifeLinesLayout'
import { LINES_MIN_PITCH, linesGeom, linesPlot } from '../src/profile/lifeLinesGeometry'
import { fitLifeCamera } from '../src/profile/lifeCamera'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP } from '../src/profile/lifeGeometry'
import { axisOf } from '../src/profile/lifeView'
import { repoKey } from '../src/profile/privacy'
import { buildLifeTimeline, dayKey, dayNumber, type LifeTimeline } from '../src/profile/timeline'
import type { LifeViewport } from '../src/profile/lifeTypes'
import type { ProfileData, ProfileRepo } from '../src/types'
import { prolific } from './helpers/lifeLinesScale'
import { GAEARON_NOW, KEPANO_NOW, gaearonRouter, kepanoRouter, makeFetch } from './helpers/profileReplay'

/** 2024-06-15 12:00 in Los Angeles (PDT). */
const NOW = Date.parse('2024-06-15T19:00:00Z')
const TODAY = '2024-06-15'

/** A timestamp on a day: 20:00 UTC is 12:00 or 13:00 the same day in Los Angeles. */
const iso = (day: string) => `${day}T20:00:00Z`
const plus = (day: string, n: number) => dayKey(dayNumber(day) + n)

function repo(name: string, over: Partial<ProfileRepo> = {}): ProfileRepo {
  const createdAt = over.createdAt ?? iso('2020-01-01')
  return {
    nameWithOwner: `me/${name}`,
    createdAt,
    firstActiveAt: createdAt,
    lastActiveAt: createdAt,
    isOwn: true,
    language: 'TypeScript',
    languageColor: null,
    stars: 0,
    forks: 0,
    isFork: false,
    isArchived: false,
    isPrivate: false,
    activity: [],
    ...over,
  }
}

function profile(over: Partial<ProfileData> = {}): ProfileData {
  return {
    login: 'me',
    name: null,
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    createdAt: iso('2019-01-10'),
    source: 'graphql',
    repos: [],
    days: [],
    recent: [],
    recentFrom: null,
    milestones: [],
    restrictedContributions: 0,
    truncated: false,
    lostWindows: [],
    fallback: null,
    ...over,
  }
}

/** One activity entry per day given, with that many commits. */
const commitsOn = (entries: Record<string, number>) => Object.entries(entries).map(([date, commits]) => ({ date, commits }))

/** Every day from..to (inclusive), with count(day) contributions. */
function calendar(from: string, to: string, count: (day: string) => number): { date: string; count: number }[] {
  const days = []
  for (let n = dayNumber(from); n <= dayNumber(to); n++) days.push({ date: dayKey(n), count: count(dayKey(n)) })
  return days
}

/** A seeded shuffle, so a failure reproduces. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  let state = seed
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648
    const j = state % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * A token profile with a bit of everything: busy, quiet, archived, forked, starred, visited and
 * private repos, a repo GitHub counted no commits to, and stated milestones naming repos.
 */
const RICH = profile({
  repos: [
    repo('busy', { createdAt: iso('2019-02-01'), stars: 900, language: 'Go', activity: commitsOn({ '2019-02-01': 20, '2019-02-10': 30, '2020-06-01': 50, '2023-01-03': 5 }) }),
    repo('quiet', { createdAt: iso('2019-03-01'), activity: commitsOn({ '2019-03-02': 1 }) }),
    repo('old', { createdAt: iso('2019-04-01'), isArchived: true, stars: 40, activity: commitsOn({ '2019-04-01': 4, '2019-04-20': 2 }) }),
    repo('copy', { createdAt: iso('2019-05-01'), isFork: true, stars: 3, activity: commitsOn({ '2019-05-02': 2 }) }),
    { ...repo('theirs', { createdAt: iso('2015-01-01'), isOwn: false, language: 'Rust', activity: commitsOn({ '2021-01-05': 7, '2021-03-01': 1 }) }), nameWithOwner: 'them/Theirs', firstActiveAt: iso('2021-01-05') },
    repo('Upper', { createdAt: iso('2022-08-01'), language: null, activity: commitsOn({ '2022-08-01': 2 }) }),
    repo('secret-one', { createdAt: iso('2021-06-01'), isPrivate: true, language: 'Rust', activity: commitsOn({ '2021-06-01': 3, '2022-02-01': 9 }) }),
    repo('secret-two', { createdAt: iso('2021-06-01'), isPrivate: true, language: 'Rust', activity: commitsOn({ '2021-06-01': 1 }) }),
    repo('seedling', { createdAt: iso('2023-08-01'), stars: 5 }),
    repo('backdated', { createdAt: iso('2022-01-10'), activity: commitsOn({ '2021-11-01': 2, '2022-01-10': 1 }) }),
  ],
  days: calendar('2019-01-01', TODAY, (day) => (day === '2019-02-10' ? 30 : day === '2021-01-05' ? 7 : 0)),
  milestones: [
    { kind: 'joined', date: iso('2019-01-10'), label: 'joined GitHub' },
    // before their part in the repo starts: no station, only its marker on the horizon
    { kind: 'first-pr', date: iso('2020-11-20'), label: 'first pull request', repo: 'THEM/theirs' },
    { kind: 'first-issue', date: iso('2020-01-01'), label: 'first issue', repo: 'someone/elsewhere' },
  ],
})

const richTimeline = buildLifeTimeline(RICH, NOW)
const rich = layoutLifeLines(richTimeline, 'graphql')
const lineOf = (layout: LifeLinesLayout, name: string) => layout.lines[layout.byKey.get(repoKey(name))!]

/** The layout as plain data: byKey is a Map, checked against lines on its own. */
function plain(layout: LifeLinesLayout): Omit<LifeLinesLayout, 'byKey'> {
  const { byKey: _byKey, ...rest } = layout
  return rest
}

/** Every number anywhere in a value. */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value]
  if (Array.isArray(value)) return value.flatMap(numbersIn)
  if (value && typeof value === 'object') return Object.values(value).flatMap(numbersIn)
  return []
}

/** Every invariant a layout must keep, for any profile. */
function expectValid(layout: LifeLinesLayout, timeline: LifeTimeline, source: ProfileData['source']): void {
  const { startDay, todayDay } = timeline
  const days = todayDay - startDay + 1
  // the shared axis, as every view has it
  expect({ ...axisOf(timeline) }).toEqual({
    startDay: layout.startDay,
    todayDay: layout.todayDay,
    days: layout.days,
    years: layout.years,
    languages: layout.languages,
    milestones: layout.milestones,
  })
  expect(layout.days).toBe(days)
  // finite throughout, and plain data
  for (const n of numbersIn(plain(layout))) expect(Number.isFinite(n)).toBe(true)
  expect(JSON.parse(JSON.stringify(plain(layout)))).toEqual(plain(layout))

  // one line per lane, indexed by key
  expect(layout.lines).toHaveLength(timeline.lanes.length)
  expect(new Set(layout.lines.map((line) => line.lane)).size).toBe(timeline.lanes.length)
  expect(layout.byKey.size).toBe(layout.lines.length)
  layout.lines.forEach((line, i) => expect(layout.byKey.get(line.key)).toBe(i))

  // paint order: track, then x, then lane
  const order = layout.lines.map((l) => [l.track, l.x, l.lane])
  expect(order).toEqual([...order].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]))

  const gap = trackGapDays(days)
  const token = source === 'graphql'
  for (const line of layout.lines) {
    const lane = timeline.lanes[line.lane]
    expect(line.key).toBe(repoKey(lane.repo))
    expect([line.startDay, line.rootDay, line.endDay]).toEqual([lane.startDay, lane.rootDay, lane.endDay])
    expect(line.x).toBe(lane.rootDay - startDay + 0.5)
    expect(line.x0).toBe(lane.startDay - startDay)
    expect(line.x1).toBe(lane.endDay + 1 - startDay)
    expect(line.x0).toBeGreaterThanOrEqual(0)
    expect(line.x1).toBeLessThanOrEqual(days)
    expect(line.x).toBeGreaterThan(line.x0)
    expect(line.x).toBeLessThan(line.x1)
    expect(line.track).toBeGreaterThanOrEqual(0)
    expect(line.track).toBeLessThan(layout.tracks)
    // drawn past its root to its end, or to a gap short of the next line on its track
    expect(line.end).toBeGreaterThan(line.x)
    expect(line.end).toBeLessThanOrEqual(line.x1)
    if (line.dry) expect(line.end).toBe(line.x1)
    expect([line.language, line.dry, line.branch, line.visiting, line.stars]).toEqual([lane.language, lane.isArchived, lane.isFork, !lane.isOwn, lane.stars])
    expect(line.seedling).toBe(token && !lane.detailed)
    // an archived line ends at its last activity, any other at today
    if (lane.isArchived) expect(line.x1).toBe(lane.endDay + 1 - startDay)
    else expect([lane.endDay, line.x1]).toEqual([todayDay, days])

    // the parts tile the line, active and dormant in turn from an active one
    expect(line.parts.length).toBeGreaterThan(0)
    expect(line.parts[0].x0).toBe(line.x0)
    expect(line.parts.at(-1)!.x1).toBe(line.x1)
    line.parts.forEach((part, p) => {
      expect(part.kind).toBe(p % 2 === 0 ? 'active' : 'dormant')
      expect(part.x1).toBeGreaterThan(part.x0)
      if (p > 0) expect(part.x0).toBe(line.parts[p - 1].x1)
      expect(part.weight).toBeGreaterThanOrEqual(0)
      expect(part.weight).toBeLessThanOrEqual(1)
      if (part.kind === 'dormant') expect(part.weight).toBe(0)
      else if (!token) expect(part.weight).toBe(1)
      // only a dormant tail is ever cut short
      if (part.kind === 'active') expect(part.x1).toBeLessThanOrEqual(line.end)
    })
  }

  // lines on one track never overlap as drawn, the gap between them included: each is cut a gap
  // short of the next, or runs to its own end on the last
  for (let t = 0; t < layout.tracks; t++) {
    const on = layout.lines.filter((line) => line.track === t).sort((a, b) => a.x0 - b.x0)
    expect(on.length, `track ${t}`).toBeGreaterThan(0)
    for (let i = 1; i < on.length; i++) {
      expect(on[i - 1].end + gap).toBeLessThanOrEqual(on[i].x0)
      expect(on[i - 1].end).toBe(Math.min(on[i - 1].x1, on[i].x0 - gap))
    }
    expect(on.at(-1)!.end).toBe(on.at(-1)!.x1)
  }

  // a station for each milestone naming a lane's repo on that lane's days, on its own day on that
  // repo's line, and on the drawn part of it
  const named = timeline.milestones.flatMap((m, index) => {
    const lane = m.repo ? timeline.lanes.find((l) => repoKey(l.repo) === repoKey(m.repo!)) : undefined
    const day = dayNumber(m.day)
    return lane && day >= lane.startDay && day <= lane.endDay ? [index] : []
  })
  expect(layout.stations.map((s) => s.index)).toEqual(named)
  for (const station of layout.stations) {
    const milestone = timeline.milestones[station.index]
    const line = layout.lines[station.line]
    expect(line.key).toBe(repoKey(milestone.repo!))
    expect(station.kind).toBe(milestone.kind)
    expect(station.day).toBe(dayNumber(milestone.day))
    expect(station.x).toBe(station.day - startDay + 0.5)
    expect(station.x).toBeGreaterThanOrEqual(line.x0 + 0.5)
    expect(station.x + 0.5).toBeLessThanOrEqual(line.end)
  }
}

describe('life lines layout: placement', () => {
  it('is deterministic: the same timeline gives the same layout', () => {
    expect(layoutLifeLines(richTimeline, 'graphql')).toEqual(rich)
    expect(layoutLifeLines(buildLifeTimeline(RICH, NOW), 'graphql')).toEqual(rich)
  })

  it('gives the same layout for the profile in any order: repos, activity and milestones shuffled', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const repos = shuffled(RICH.repos, seed).map((r, i) => ({ ...r, activity: shuffled(r.activity, seed * 31 + i) }))
      const timeline = buildLifeTimeline({ ...RICH, repos, milestones: shuffled(RICH.milestones, seed * 7), days: shuffled(RICH.days, seed * 13) }, NOW)
      expect(layoutLifeLines(timeline, 'graphql'), `seed ${seed}`).toEqual(rich)
    }
  })

  it('keeps every invariant on a rich token profile', () => {
    expectValid(rich, richTimeline, 'graphql')
    // the first pull request predates its lane, and the first issue names a repo not held
    expect(rich.stations.map((s) => s.kind).sort()).toEqual(['first-repo', 'top-repo'])
  })

  it('puts every line on the shared time axis: x0 at its first day, x at its root, x1 after its last day', () => {
    const backdated = lineOf(rich, 'me/backdated')
    expect(backdated.x0).toBe(dayNumber('2021-11-01') - richTimeline.startDay)
    expect(backdated.x).toBe(dayNumber('2022-01-10') - richTimeline.startDay + 0.5)
    expect(backdated.x1).toBe(rich.days)
    const theirs = lineOf(rich, 'them/theirs')
    expect(theirs.x).toBe(dayNumber('2021-01-05') - richTimeline.startDay + 0.5)
    expect(theirs.visiting).toBe(true)
  })

  it('flags archived, forked, visited and seedling lines', () => {
    expect(lineOf(rich, 'me/old')).toMatchObject({ dry: true, branch: false, visiting: false, seedling: false, stars: 40 })
    expect(lineOf(rich, 'me/old').x1).toBe(dayNumber('2019-04-20') + 1 - richTimeline.startDay)
    expect(lineOf(rich, 'me/copy')).toMatchObject({ dry: false, branch: true, visiting: false })
    expect(lineOf(rich, 'them/theirs')).toMatchObject({ visiting: true, language: 'Rust' })
    expect(lineOf(rich, 'me/seedling')).toMatchObject({ seedling: true, weight: 0 })
    expect(lineOf(rich, 'me/upper').language).toBeNull()
  })

  it('weighs lines by commits with a token and by active days without', () => {
    expect(lineOf(rich, 'me/busy').weight).toBe(105)
    expect(lineOf(rich, 'me/quiet').weight).toBe(1)
    const rest = buildLifeTimeline({ ...RICH, source: 'rest', days: [] }, NOW)
    const layout = layoutLifeLines(rest, 'rest')
    for (const line of layout.lines) {
      const lane = rest.lanes[line.lane]
      expect(line.weight).toBe(lane.spans.filter((s) => s.kind === 'active').reduce((n, s) => n + s.days, 0))
      expect(line.seedling).toBe(false)
    }
    expectValid(layout, rest, 'rest')
  })

  it("weighs an active part by the square root of its share of the heaviest span's commits", () => {
    let heaviest = 0
    for (const lane of richTimeline.lanes) for (const span of lane.spans) if (span.kind === 'active') heaviest = Math.max(heaviest, span.commits)
    expect(heaviest).toBe(50)
    for (const line of rich.lines) {
      const spans = richTimeline.lanes[line.lane].spans
      line.parts.forEach((part, p) => {
        expect(part.kind).toBe(spans[p].kind)
        expect(part.weight).toBeCloseTo(part.kind === 'active' ? Math.sqrt(spans[p].commits / heaviest) : 0, 12)
      })
    }
    // busy: 50 commits in its first run and its second, 5 in its last
    expect(lineOf(rich, 'me/busy').parts.map((p) => p.weight)).toEqual([1, 0, 1, 0, Math.sqrt(5 / 50), 0])
  })

  it('places a station on its own day for each milestone naming a lane on its days', () => {
    // first repo and top repo are on their lines, at their roots
    const first = rich.stations.find((s) => s.kind === 'first-repo')!
    const busy = lineOf(rich, 'me/busy')
    expect(rich.lines[first.line]).toBe(busy)
    expect([first.day, first.x]).toEqual([busy.rootDay, busy.x])
    expect(rich.lines[rich.stations.find((s) => s.kind === 'top-repo')!.line]).toBe(busy)
    // a milestone naming a repo the profile does not hold has no station
    expect(rich.stations.some((s) => s.kind === 'first-issue')).toBe(false)
  })

  it('gives a milestone dated before its lane starts no station, not one moved onto its first day; the horizon still shows it', () => {
    const index = richTimeline.milestones.findIndex((m) => m.kind === 'first-pr')
    const theirs = lineOf(rich, 'them/theirs')
    expect(dayNumber(richTimeline.milestones[index].day)).toBeLessThan(theirs.startDay)
    expect(rich.stations.some((s) => s.index === index || s.kind === 'first-pr')).toBe(false)
    expect(rich.milestones.some((m) => m.index === index)).toBe(true)
  })

  it("holds a line's track past a station in its dormant tail, the station on its own day", () => {
    const repos = [
      { ...repo('lib', { createdAt: iso('2015-01-01'), isOwn: false, activity: commitsOn({ '2021-01-05': 3 }) }), nameWithOwner: 'them/lib', firstActiveAt: iso('2021-01-05') },
      repo('next', { createdAt: iso('2021-06-01'), activity: commitsOn({ '2021-06-01': 1 }) }),
    ]
    const layoutWith = (milestones: ProfileData['milestones']) => {
      const timeline = buildLifeTimeline(profile({ repos, milestones }), NOW)
      const layout = layoutLifeLines(timeline, 'graphql')
      expectValid(layout, timeline, 'graphql')
      return { timeline, layout }
    }
    const gap = trackGapDays(rich.days)

    // without a station on lib, next shares its track, and lib's dormant tail stops a gap short of it
    const bare = layoutWith([]).layout
    expect([lineOf(bare, 'them/lib').track, lineOf(bare, 'me/next').track]).toEqual([0, 0])
    expect(lineOf(bare, 'them/lib').end).toBe(lineOf(bare, 'me/next').x0 - gap)
    expect(lineOf(bare, 'them/lib').x1).toBe(bare.days)

    // a first pull request in lib's tail after next starts: lib holds its track past it, drawn to today
    const { timeline, layout } = layoutWith([
      { kind: 'first-pr', date: iso('2021-09-01'), label: 'first pull request', repo: 'them/lib' },
      { kind: 'first-issue', date: iso('2020-12-01'), label: 'first issue', repo: 'them/lib' },
    ])
    const lib = lineOf(layout, 'them/lib')
    expect([lib.track, lineOf(layout, 'me/next').track]).toEqual([0, 1])
    expect(lib.end).toBe(lib.x1)
    const pr = layout.stations.find((s) => s.kind === 'first-pr')!
    expect(layout.lines[pr.line]).toBe(lib)
    expect(pr.day).toBe(dayNumber('2021-09-01'))
    expect(pr.x).toBe(dayNumber('2021-09-01') - timeline.startDay + 0.5)
    // the first issue, before lib starts: no station, only its marker on the horizon
    const issue = timeline.milestones.findIndex((m) => m.kind === 'first-issue')
    expect(layout.stations.some((s) => s.index === issue)).toBe(false)
    expect(layout.milestones.some((m) => m.index === issue)).toBe(true)
  })
})

describe('life lines layout: tracks', () => {
  it(`keeps lines on one track at least ${TRACK_GAP_MIN_DAYS} days apart, or 1/100 of the life`, () => {
    expect(trackGapDays(1)).toBe(TRACK_GAP_MIN_DAYS)
    expect(trackGapDays(1400)).toBe(TRACK_GAP_MIN_DAYS)
    expect(trackGapDays(2000)).toBe(20)
    expect(trackGapDays(5049)).toBe(50)
  })

  it('packs greedily in lane order on what a line holds: a line takes the first track free by the gap, else a new one', () => {
    const gap = trackGapDays(dayNumber(TODAY) - dayNumber('2019-01-10') + 1)
    const repos = [
      // archived early: holds track 0 to its terminus, then frees it
      repo('a', { createdAt: iso('2019-02-01'), isArchived: true, activity: commitsOn({ '2019-02-01': 1, '2019-03-01': 1 }) }),
      // overlaps a, and active again a year on: a new track, held through its quiet year
      repo('b', { createdAt: iso('2019-02-15'), activity: commitsOn({ '2019-02-15': 1, '2020-06-01': 1 }) }),
      // archived, starts just inside the gap after a's end: not on a's track, nor on b's
      repo('c', { createdAt: iso(plus('2019-03-01', gap)), isArchived: true, activity: commitsOn({ [plus('2019-03-01', gap)]: 1 }) }),
      // starts long after a and c end: back on track 0, its dormant tail running only until e
      repo('d', { createdAt: iso('2020-01-01'), activity: commitsOn({ '2020-01-01': 1 }) }),
      // starts long after d's one active day: on track 0 after it
      repo('e', { createdAt: iso('2021-01-01'), activity: commitsOn({ '2021-01-01': 1 }) }),
    ]
    const timeline = buildLifeTimeline(profile({ repos }), NOW)
    const layout = layoutLifeLines(timeline, 'graphql')
    expect(['a', 'b', 'c', 'd', 'e'].map((n) => lineOf(layout, `me/${n}`).track)).toEqual([0, 1, 2, 0, 0])
    expect(layout.tracks).toBe(3)
    expectValid(layout, timeline, 'graphql')
    // d's dormant tail is cut a gap short of e; b, e and the archived ones run to their ends
    const d = lineOf(layout, 'me/d')
    expect(d.x1).toBe(layout.days)
    expect(d.end).toBe(lineOf(layout, 'me/e').x0 - gap)
    for (const n of ['a', 'b', 'c', 'e']) expect(lineOf(layout, `me/${n}`).end, n).toBe(lineOf(layout, `me/${n}`).x1)

    // a day later, c fits after a on track 0, and so do d and e after it
    repos[2] = repo('c', { createdAt: iso(plus('2019-03-01', gap + 1)), isArchived: true, activity: commitsOn({ [plus('2019-03-01', gap + 1)]: 1 }) })
    const later = layoutLifeLines(buildLifeTimeline(profile({ repos }), NOW), 'graphql')
    expect(['a', 'b', 'c', 'd', 'e'].map((n) => lineOf(later, `me/${n}`).track)).toEqual([0, 1, 0, 0, 0])
    expect(later.tracks).toBe(2)
  })

  it('keeps a line on its track, with its parts and stations, when a repo is renamed', () => {
    const renamed = (from: string, to: string) => ({ ...RICH, repos: RICH.repos.map((r) => (r.nameWithOwner === from ? { ...r, nameWithOwner: to } : r)) })
    const without = (layout: LifeLinesLayout) => ({ ...plain(layout), lines: layout.lines.map(({ key: _key, ...line }) => line) })
    // a public repo (alone on its root instant), and both private ones (sharing theirs)
    for (const [from, to] of [
      ['me/busy', 'me/zzz-renamed'],
      ['me/secret-one', 'me/aaa-other'],
      ['me/secret-two', 'me/000'],
    ]) {
      const layout = layoutLifeLines(buildLifeTimeline(renamed(from, to), NOW), 'graphql')
      expect(without(layout), `${from} -> ${to}`).toEqual(without(rich))
      const before = lineOf(rich, from)
      const after = lineOf(layout, to)
      expect({ ...after, key: before.key }).toEqual(before)
    }
  })
})

describe('life lines layout: edge cases', () => {
  it('lays out a profile with no repos: no lines, no tracks, the axis still there', () => {
    const timeline = buildLifeTimeline(profile({ repos: [], milestones: [{ kind: 'joined', date: iso('2019-01-10'), label: 'joined GitHub' }] }), NOW)
    const layout = layoutLifeLines(timeline, 'graphql')
    expect(layout.lines).toEqual([])
    expect(layout.tracks).toBe(0)
    expect(layout.stations).toEqual([])
    expect(layout.milestones).toHaveLength(1)
    expectValid(layout, timeline, 'graphql')
  })

  it('lays out an account a day old', () => {
    const young = profile({ createdAt: iso('2024-06-14'), repos: [repo('new', { createdAt: iso('2024-06-14'), activity: commitsOn({ '2024-06-14': 1 }) })] })
    for (const source of ['graphql', 'rest'] as const) {
      const timeline = buildLifeTimeline({ ...young, source }, NOW)
      const layout = layoutLifeLines(timeline, source)
      expect(layout.days).toBeLessThanOrEqual(2)
      expect(layout.lines).toHaveLength(1)
      expectValid(layout, timeline, source)
    }
  })
})

/** The canvas host's frame on a laptop screen. */
const FRAME: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }

describe('life lines layout: at scale', () => {
  for (const n of [300, 400, 500]) {
    for (const source of ['graphql', 'rest'] as const) {
      it(`packs ${n} repos ${source === 'graphql' ? 'with' : 'without'} a token into tracks at least ${LINES_MIN_PITCH} px apart`, () => {
        const timeline = buildLifeTimeline(prolific(n, source), NOW)
        const layout = layoutLifeLines(timeline, source)
        expect(layout.lines).toHaveLength(n)
        expectValid(layout, timeline, source)
        // most still run to today: a track each would put them closer than that
        const { top, bottom } = linesPlot(FRAME)
        expect((bottom - top) / layout.lines.filter((l) => !l.dry).length).toBeLessThan(LINES_MIN_PITCH)
        // packed on what each holds, their dormant tails cut short, they take a fifth of that
        expect(layout.tracks).toBeLessThanOrEqual(n / 5)
        expect(layout.lines.filter((l) => l.end < l.x1).length).toBeGreaterThan(n / 2)
        const g = linesGeom(layout, fitLifeCamera(layout.days, FRAME), FRAME)
        expect(g.pitch).toBeGreaterThanOrEqual(LINES_MIN_PITCH)
        // far enough apart that a heavy part is more than twice a dormant one's width
        expect(g.activePx[2]).toBeGreaterThan(2 * g.dormantPx)
      })
    }
  }
})

describe('life lines layout: the recordings', () => {
  let kepano: ProfileData
  let gaearon: ProfileData
  beforeAll(async () => {
    ;[kepano, gaearon] = await Promise.all([
      fetchProfileGraphql('kepano', { token: 'test-token-not-real', fetch: makeFetch(kepanoRouter()).fetch, now: KEPANO_NOW }),
      fetchProfileRest('gaearon', { fetch: makeFetch(gaearonRouter(() => undefined)).fetch, now: GAEARON_NOW }),
    ])
  })

  it('lays out kepano through the token tier', () => {
    const timeline = buildLifeTimeline(kepano, KEPANO_NOW)
    const layout = layoutLifeLines(timeline, kepano.source)
    expect(kepano.source).toBe('graphql')
    expect(layout.lines.length).toBeGreaterThan(10)
    expectValid(layout, timeline, 'graphql')
    expect(layout.stations.length).toBeGreaterThan(0)
    expect(layout.lines.some((l) => l.parts.some((p) => p.kind === 'active' && p.weight < 1))).toBe(true)
    expect(linesGeom(layout, fitLifeCamera(layout.days, FRAME), FRAME).pitch).toBeGreaterThanOrEqual(LINES_MIN_PITCH)
    expect(layoutLifeLines(buildLifeTimeline({ ...kepano, repos: shuffled(kepano.repos, 5) }, KEPANO_NOW), 'graphql')).toEqual(layout)
  })

  it('lays out gaearon through the tier without a token', () => {
    const timeline = buildLifeTimeline(gaearon, GAEARON_NOW)
    const layout = layoutLifeLines(timeline, gaearon.source)
    expect(gaearon.source).toBe('rest')
    expect(layout.lines.length).toBeGreaterThan(100)
    expectValid(layout, timeline, 'rest')
    // 301 repos, nearly all running to today: packed on what each holds, a quarter as many tracks
    expect(layout.tracks).toBeLessThanOrEqual(layout.lines.length / 4)
    expect(linesGeom(layout, fitLifeCamera(layout.days, FRAME), FRAME).pitch).toBeGreaterThanOrEqual(LINES_MIN_PITCH)
    expect(layoutLifeLines(buildLifeTimeline({ ...gaearon, repos: shuffled(gaearon.repos, 9) }, GAEARON_NOW), 'rest')).toEqual(layout)
  })
})
