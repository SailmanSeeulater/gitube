import { describe, expect, it } from 'vitest'
import {
  DORMANT_DAYS,
  QUIET_MONTH_SHARE,
  buildLifeTimeline,
  dayAt,
  dayKey,
  dayNumber,
  githubDay,
  progressAt,
  progressAtDay,
  type Lane,
  type LifeTimeline,
} from '../src/profile/timeline'
import source from '../src/profile/timeline.ts?raw'
import type { ProfileData, ProfileMilestone, ProfileRepo } from '../src/types'

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

/** Every day from..to (inclusive), with count(day) contributions. */
function calendar(from: string, to: string, count: (day: string) => number): { date: string; count: number }[] {
  const days = []
  for (let n = dayNumber(from); n <= dayNumber(to); n++) days.push({ date: dayKey(n), count: count(dayKey(n)) })
  return days
}

/** One activity entry per day given, with that many commits. */
const commitsOn = (entries: Record<string, number>) => Object.entries(entries).map(([date, commits]) => ({ date, commits }))

/** The active and dormant spans of a lane as [kind, from, to]. */
const shape = (lane: Lane) => lane.spans.map((span) => [span.kind, span.from, span.to])

const laneOf = (timeline: LifeTimeline, name: string) => timeline.lanes.find((lane) => lane.repo === `me/${name}`)!

/** A seeded shuffle, so a failure reproduces. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let state = seed
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648
    const j = state % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

describe('life timeline: lanes', () => {
  it(`merges activity days fewer than ${DORMANT_DAYS} quiet days apart into one active span`, () => {
    // Jan 1 and Jan 31: 29 quiet days between
    const tl = buildLifeTimeline(
      profile({ repos: [repo('a', { createdAt: iso('2023-01-01'), isArchived: true, activity: commitsOn({ '2023-01-01': 3, '2023-01-31': 2 }) })] }),
      NOW,
    )
    const lane = laneOf(tl, 'a')
    expect(shape(lane)).toEqual([['active', '2023-01-01', '2023-01-31']])
    expect(lane.spans[0]).toMatchObject({ days: 31, commits: 5, activeDays: 2 })
    expect(lane).toMatchObject({ commits: 5, activeDays: 2, detailed: true })
  })

  it(`splits them at ${DORMANT_DAYS} quiet days, with a dormant span between`, () => {
    // Jan 1 and Feb 1: 30 quiet days between
    const tl = buildLifeTimeline(
      profile({ repos: [repo('a', { createdAt: iso('2023-01-01'), isArchived: true, activity: commitsOn({ '2023-01-01': 3, '2023-02-01': 2 }) })] }),
      NOW,
    )
    const lane = laneOf(tl, 'a')
    expect(shape(lane)).toEqual([
      ['active', '2023-01-01', '2023-01-01'],
      ['dormant', '2023-01-02', '2023-01-31'],
      ['active', '2023-02-01', '2023-02-01'],
    ])
    expect(lane.spans[1]).toMatchObject({ days: DORMANT_DAYS, commits: 0, activeDays: 0 })
    expect(lane.spans[2]).toMatchObject({ commits: 2, activeDays: 1 })
  })

  it('lets a repo lie dormant from its last activity up to today', () => {
    const tl = buildLifeTimeline(
      profile({ repos: [repo('a', { createdAt: iso('2023-01-01'), activity: commitsOn({ '2023-01-01': 1, '2024-01-10': 4 }) })] }),
      NOW,
    )
    const lane = laneOf(tl, 'a')
    expect(shape(lane)).toEqual([
      ['active', '2023-01-01', '2023-01-01'],
      ['dormant', '2023-01-02', '2024-01-09'],
      ['active', '2024-01-10', '2024-01-10'],
      ['dormant', '2024-01-11', TODAY],
    ])
    expect(lane).toMatchObject({ start: '2023-01-01', end: TODAY, lastActive: '2024-01-10', endDay: dayNumber(TODAY) })
  })

  it('ends an archived repo at its last activity instead of letting it lie dormant', () => {
    const tl = buildLifeTimeline(
      profile({ repos: [repo('a', { createdAt: iso('2023-01-01'), isArchived: true, activity: commitsOn({ '2023-01-01': 1, '2023-03-05': 4 }) })] }),
      NOW,
    )
    const lane = laneOf(tl, 'a')
    expect(shape(lane)).toEqual([
      ['active', '2023-01-01', '2023-01-01'],
      ['dormant', '2023-01-02', '2023-03-04'],
      ['active', '2023-03-05', '2023-03-05'],
    ])
    expect(lane).toMatchObject({ end: '2023-03-05', lastActive: '2023-03-05', isArchived: true })
  })

  it(`counts a quiet spell at the end as dormant only once it lasts ${DORMANT_DAYS} days`, () => {
    const tl = buildLifeTimeline(
      profile({
        repos: [
          repo('recent', { createdAt: iso('2024-05-01'), activity: commitsOn({ '2024-05-01': 1, [plus(TODAY, -(DORMANT_DAYS - 1))]: 1 }) }),
          repo('quiet', { createdAt: iso('2024-05-01'), activity: commitsOn({ '2024-05-01': 1, [plus(TODAY, -DORMANT_DAYS)]: 1 }) }),
        ],
      }),
      NOW,
    )
    // 29 quiet days so far: still active through today
    expect(shape(laneOf(tl, 'recent'))).toEqual([['active', '2024-05-01', TODAY]])
    expect(laneOf(tl, 'recent').lastActive).toBe(plus(TODAY, -(DORMANT_DAYS - 1)))
    // 30 quiet days: dormant
    expect(shape(laneOf(tl, 'quiet'))).toEqual([
      ['active', '2024-05-01', plus(TODAY, -DORMANT_DAYS)],
      ['dormant', plus(TODAY, -DORMANT_DAYS + 1), TODAY],
    ])
  })

  it('counts the day a repo was born as active, so the lane starts with an active span', () => {
    const tl = buildLifeTimeline(profile({ repos: [repo('a', { createdAt: iso('2023-01-01'), isArchived: true, activity: commitsOn({ '2023-06-01': 2 }) })] }), NOW)
    expect(shape(laneOf(tl, 'a'))).toEqual([
      ['active', '2023-01-01', '2023-01-01'],
      ['dormant', '2023-01-02', '2023-05-31'],
      ['active', '2023-06-01', '2023-06-01'],
    ])
    expect(laneOf(tl, 'a').spans[0]).toMatchObject({ commits: 0, activeDays: 0 })
  })

  it('orders lanes by the instant of firstActiveAt, then by name, and roots a contributed repo where they arrived', () => {
    const tl = buildLifeTimeline(
      profile({
        repos: [
          repo('b', { createdAt: iso('2021-04-01') }),
          repo('a', { createdAt: iso('2021-04-01') }),
          // the same day, earlier in it (08:00 in Los Angeles)
          repo('z', { createdAt: '2021-04-01T15:00:00Z' }),
          repo('upstream', { createdAt: iso('2010-01-01'), firstActiveAt: iso('2020-02-03'), isOwn: false, activity: commitsOn({ '2020-02-03': 1 }) }),
        ],
      }),
      NOW,
    )
    expect(tl.lanes.map((lane) => lane.repo)).toEqual(['me/upstream', 'me/z', 'me/a', 'me/b'])
    expect(laneOf(tl, 'upstream')).toMatchObject({ born: '2010-01-01', root: '2020-02-03', rootDay: dayNumber('2020-02-03'), start: '2020-02-03', isOwn: false })
    expect(laneOf(tl, 'z')).toMatchObject({ born: '2021-04-01', root: '2021-04-01', start: '2021-04-01' })
  })

  it('keeps a lane at its root when commits are backdated before it: they draw spans, not a new order or birth year', () => {
    const tl = buildLifeTimeline(
      profile({
        createdAt: iso('2014-01-01'),
        repos: [
          repo('backdated', { createdAt: iso('2020-05-05'), isArchived: true, activity: commitsOn({ '2012-03-03': 4 }) }),
          repo('middle', { createdAt: iso('2015-08-08'), isArchived: true }),
        ],
      }),
      NOW,
    )
    expect(tl.lanes.map((lane) => lane.repo)).toEqual(['me/middle', 'me/backdated'])
    expect(laneOf(tl, 'backdated')).toMatchObject({ born: '2020-05-05', root: '2020-05-05', rootDay: dayNumber('2020-05-05'), start: '2012-03-03' })
    expect(shape(laneOf(tl, 'backdated'))).toEqual([
      ['active', '2012-03-03', '2012-03-03'],
      ['dormant', '2012-03-04', '2020-05-04'],
      ['active', '2020-05-05', '2020-05-05'],
    ])
    // the timeline still starts at the backdated commit, but no repo is born in 2012
    expect(tl.start).toBe('2012-03-03')
    const born = Object.fromEntries(tl.eras.map((era) => [era.year, era.reposBorn]))
    expect(born).toMatchObject({ 2012: 0, 2015: 1, 2020: 1 })
    expect(tl.eras.reduce((n, era) => n + era.reposBorn, 0)).toBe(2)
  })

  it('reads timestamps as GitHub days in Los Angeles', () => {
    // 2023-03-01T05:00Z is still February 28 in Los Angeles
    const tl = buildLifeTimeline(profile({ repos: [repo('a', { createdAt: '2023-03-01T05:00:00Z', isArchived: true })] }), NOW)
    expect(laneOf(tl, 'a')).toMatchObject({ born: '2023-02-28', root: '2023-02-28', start: '2023-02-28' })
  })
})

describe('life timeline: tier 1 and tier 2', () => {
  it('draws a tier-1 repo as one active span from its birth to its last push, then dormant', () => {
    const tl = buildLifeTimeline(
      profile({ source: 'rest', repos: [repo('a', { createdAt: iso('2020-03-01'), lastActiveAt: iso('2022-08-01') })] }),
      NOW,
    )
    const lane = laneOf(tl, 'a')
    expect(shape(lane)).toEqual([
      ['active', '2020-03-01', '2022-08-01'],
      ['dormant', '2022-08-02', TODAY],
    ])
    expect(lane).toMatchObject({ detailed: false, commits: 0, activeDays: 0, lastActive: '2022-08-01' })
  })

  it('gives tier 1 eras repos born and no contribution count, and no streaks', () => {
    const tl = buildLifeTimeline(
      profile({
        source: 'rest',
        createdAt: iso('2021-05-05'),
        repos: [repo('a', { createdAt: iso('2021-06-01') }), repo('b', { createdAt: iso('2021-09-01') }), repo('c', { createdAt: iso('2023-02-01') })],
      }),
      NOW,
    )
    expect(tl.eras.map((era) => [era.year, era.contributions, era.reposBorn])).toEqual([
      [2021, null, 2],
      [2022, null, 0],
      [2023, null, 1],
      [2024, null, 0],
    ])
    expect(tl.streaks).toBeNull()
  })

  it('gives tier 2 eras the calendar total of each year', () => {
    const tl = buildLifeTimeline(
      profile({
        createdAt: iso('2022-03-01'),
        days: calendar('2022-01-01', TODAY, (day) => (day.endsWith('-01') ? 2 : 0)),
        repos: [repo('a', { createdAt: iso('2022-03-01') })],
      }),
      NOW,
    )
    expect(tl.eras.map((era) => [era.year, era.contributions, era.reposBorn])).toEqual([
      [2022, 24, 1],
      [2023, 24, 0],
      [2024, 12, 0],
    ])
    expect(tl.eras[0]).toMatchObject({ from: '2022-01-01', to: '2022-12-31' })
    expect(tl.eras[2]).toMatchObject({ from: '2024-01-01', to: TODAY })
  })

  it("starts the eras at the calendar's first year even when that year holds nothing but zeros", () => {
    const tl = buildLifeTimeline(
      profile({
        createdAt: iso('2018-02-10'),
        days: calendar('2017-01-01', TODAY, (day) => (day >= '2018-03-01' && day.endsWith('-01') ? 1 : 0)),
      }),
      NOW,
    )
    expect(tl.start).toBe('2018-02-10')
    expect(tl.eras[0]).toMatchObject({ year: 2017, contributions: 0, reposBorn: 0 })
    expect(tl.eras[1]).toMatchObject({ year: 2018, contributions: 10 })
  })

  it('counts a calendar day listed twice once, at its larger count, and adds up an activity day listed twice', () => {
    const tl = buildLifeTimeline(
      profile({
        days: [
          // the larger count first, so keeping the last one listed would fail
          { date: '2024-03-03', count: 5 },
          { date: '2024-03-03', count: 2 },
        ],
        repos: [
          repo('a', {
            createdAt: iso('2024-03-03'),
            activity: [
              { date: '2024-03-03', commits: 2 },
              { date: '2024-03-03', commits: 5 },
            ],
          }),
        ],
      }),
      NOW,
    )
    expect(tl.eras.at(-1)).toMatchObject({ year: 2024, contributions: 5 })
    expect(laneOf(tl, 'a')).toMatchObject({ commits: 7, activeDays: 1 })
    expect(laneOf(tl, 'a').spans[0]).toMatchObject({ commits: 7, activeDays: 1 })
  })

  it('falls back to the tier-1 span for a tier-2 repo GitHub counted no commits to', () => {
    const tl = buildLifeTimeline(
      profile({
        repos: [
          repo('uncounted', { createdAt: iso('2021-01-01'), lastActiveAt: iso('2021-12-01') }),
          repo('counted', { createdAt: iso('2021-01-01'), activity: commitsOn({ '2021-01-01': 1, '2021-01-20': 1 }) }),
        ],
      }),
      NOW,
    )
    expect(shape(laneOf(tl, 'uncounted'))).toEqual([
      ['active', '2021-01-01', '2021-12-01'],
      ['dormant', '2021-12-02', TODAY],
    ])
    expect(laneOf(tl, 'uncounted').detailed).toBe(false)
    expect(laneOf(tl, 'counted').detailed).toBe(true)
    expect(shape(laneOf(tl, 'counted'))[0]).toEqual(['active', '2021-01-01', '2021-01-20'])
  })

  it('weighs tier 1 languages by active span days and tier 2 languages by commits', () => {
    // Q1 2020 (91 days): py spans all of it, go only Feb and March (60 days); Q2 is go's alone
    const py = repo('py', { language: 'Python', createdAt: iso('2020-01-01'), lastActiveAt: iso('2020-03-31'), isArchived: true })
    const go = repo('go', { language: 'Go', createdAt: iso('2020-02-01'), lastActiveAt: iso('2020-06-30'), isArchived: true })
    const tier1 = buildLifeTimeline(profile({ source: 'rest', repos: [py, go] }), NOW)
    expect(tier1.languageEras.map((era) => [era.language, era.fromQuarter, era.toQuarter, era.weight])).toEqual([
      ['Python', '2020q1', '2020q1', 91],
      ['Go', '2020q2', '2020q2', 91],
    ])

    // the same quarter by commits: go has more days, py more commits
    const tier2 = buildLifeTimeline(
      profile({
        repos: [
          { ...py, activity: commitsOn({ '2020-01-01': 10 }) },
          { ...go, activity: commitsOn({ '2020-02-01': 1, '2020-02-02': 1, '2020-02-03': 1 }) },
        ],
      }),
      NOW,
    )
    expect(tier2.languageEras.map((era) => [era.language, era.fromQuarter, era.toQuarter, era.weight])).toEqual([['Python', '2020q1', '2020q1', 10]])
  })

  it('weighs a tier-1 repo only up to its last push, so a newer language takes over from a dormant one', () => {
    const tl = buildLifeTimeline(
      profile({
        source: 'rest',
        repos: [
          // not archived: it lies dormant from April 2020 to today, which weighs nothing
          repo('old', { language: 'Python', createdAt: iso('2020-01-01'), lastActiveAt: iso('2020-03-31') }),
          repo('new', { language: 'Go', createdAt: iso('2021-01-01'), lastActiveAt: iso('2021-02-15') }),
        ],
      }),
      NOW,
    )
    expect(shape(laneOf(tl, 'old'))).toEqual([
      ['active', '2020-01-01', '2020-03-31'],
      ['dormant', '2020-04-01', TODAY],
    ])
    // 2021q1: Go's 46 active days against none of Python's (its dormant 90 would have won)
    expect(tl.languageEras.map((era) => [era.language, era.fromQuarter, era.toQuarter, era.weight])).toEqual([
      ['Python', '2020q1', '2020q1', 91],
      ['Go', '2021q1', '2021q1', 46],
    ])
    expect(tl.milestones.filter((m) => m.kind === 'language-switch').map((m) => [m.day, m.label])).toEqual([['2021-01-01', 'Python to Go']])
  })
})

describe('life timeline: language eras', () => {
  it('turns a change of dominant language into a language-switch milestone', () => {
    const tl = buildLifeTimeline(
      profile({
        repos: [
          repo('py', { language: 'Python', createdAt: iso('2021-01-05'), activity: commitsOn({ '2021-01-05': 4, '2021-05-10': 3 }) }),
          repo('ts', { language: 'TypeScript', createdAt: iso('2021-07-02'), activity: commitsOn({ '2021-07-02': 5, '2021-11-11': 1, '2022-02-02': 2 }) }),
        ],
      }),
      NOW,
    )
    expect(tl.languageEras.map((era) => [era.language, era.from, era.to, era.weight])).toEqual([
      ['Python', '2021-01-01', '2021-06-30', 7],
      ['TypeScript', '2021-07-01', '2022-03-31', 8],
    ])
    expect(tl.milestones.filter((m) => m.kind === 'language-switch')).toEqual([
      // date is a timestamp, the GitHub day's start (midnight in Los Angeles); day is its key
      { kind: 'language-switch', date: '2021-07-01T07:00:00.000Z', day: '2021-07-01', label: 'Python to TypeScript' },
    ])
  })

  it('makes no switch while the language stays, even across a quiet quarter, and ignores repos without a language', () => {
    const tl = buildLifeTimeline(
      profile({
        repos: [
          repo('one', { createdAt: iso('2021-01-05'), activity: commitsOn({ '2021-01-05': 2 }) }),
          repo('two', { createdAt: iso('2021-08-01'), activity: commitsOn({ '2021-08-01': 1 }) }),
          repo('notes', { language: null, createdAt: iso('2021-04-01'), activity: commitsOn({ '2021-04-01': 50, '2021-08-02': 50 }) }),
        ],
      }),
      NOW,
    )
    expect(tl.languageEras.map((era) => [era.language, era.fromQuarter, era.toQuarter, era.weight])).toEqual([['TypeScript', '2021q1', '2021q3', 3]])
    expect(tl.milestones.some((m) => m.kind === 'language-switch')).toBe(false)
  })

  it('breaks a tie with no era before it by name, whichever lane starts first, and ends the current era today', () => {
    // Rust's lane starts first, then the mirror: Go's
    for (const [rustDay, goDay] of [
      ['2024-04-02', '2024-05-02'],
      ['2024-05-02', '2024-04-02'],
    ]) {
      const tl = buildLifeTimeline(
        profile({
          repos: [
            repo('rust', { language: 'Rust', createdAt: iso(rustDay), activity: commitsOn({ [rustDay]: 5 }) }),
            repo('go', { language: 'Go', createdAt: iso(goDay), activity: commitsOn({ [goDay]: 5 }) }),
          ],
        }),
        NOW,
      )
      expect(tl.languageEras.map((era) => [era.language, era.from, era.to]), rustDay).toEqual([['Go', '2024-04-01', TODAY]])
    }
  })

  it('keeps the language of the era so far through a tied quarter, so a tie is no switch', () => {
    // 2021q2 ties Rust and Go at 3 commits, between two Rust quarters
    const tl = buildLifeTimeline(
      profile({
        repos: [
          repo('rust', { language: 'Rust', createdAt: iso('2021-01-05'), activity: commitsOn({ '2021-01-05': 5, '2021-04-05': 3, '2021-07-05': 4 }) }),
          repo('go', { language: 'Go', createdAt: iso('2021-04-06'), activity: commitsOn({ '2021-04-06': 3 }) }),
        ],
      }),
      NOW,
    )
    expect(tl.languageEras.map((era) => [era.language, era.fromQuarter, era.toQuarter, era.weight])).toEqual([['Rust', '2021q1', '2021q3', 12]])
    expect(tl.milestones.some((m) => m.kind === 'language-switch')).toBe(false)

    // a tie the era's language is not in falls back to name order
    const out = buildLifeTimeline(
      profile({
        repos: [
          repo('py', { language: 'Python', createdAt: iso('2021-01-05'), activity: commitsOn({ '2021-01-05': 5 }) }),
          repo('rust', { language: 'Rust', createdAt: iso('2021-04-05'), activity: commitsOn({ '2021-04-05': 3 }) }),
          repo('go', { language: 'Go', createdAt: iso('2021-04-06'), activity: commitsOn({ '2021-04-06': 3 }) }),
        ],
      }),
      NOW,
    )
    expect(out.languageEras.map((era) => [era.language, era.fromQuarter])).toEqual([
      ['Python', '2021q1'],
      ['Go', '2021q2'],
    ])
  })
})

describe('life timeline: streaks', () => {
  const streaksFor = (days: { date: string; count: number }[], now = NOW) => buildLifeTimeline(profile({ days }), now).streaks!

  it('finds the longest run of contribution days, the earliest of equals', () => {
    const runs = [
      ['2024-01-01', '2024-01-05'],
      ['2024-02-01', '2024-02-07'],
      ['2024-03-01', '2024-03-07'],
    ]
    const days = calendar('2024-01-01', TODAY, (day) => (runs.some(([from, to]) => day >= from && day <= to) ? 1 : 0))
    const { longest, current } = streaksFor(days)
    expect(longest).toEqual({ from: '2024-02-01', to: '2024-02-07', fromDay: dayNumber('2024-02-01'), toDay: dayNumber('2024-02-07'), days: 7 })
    expect(current).toBeNull()
  })

  it('counts the current streak through today', () => {
    const { current } = streaksFor(calendar('2024-06-01', TODAY, (day) => (day >= '2024-06-10' ? 3 : 0)))
    expect(current).toMatchObject({ from: '2024-06-10', to: TODAY, days: 6 })
  })

  it('counts the current streak through yesterday while today has none yet', () => {
    const zeroToday = streaksFor(calendar('2024-06-01', TODAY, (day) => (day >= '2024-06-10' && day < TODAY ? 3 : 0)))
    expect(zeroToday.current).toMatchObject({ from: '2024-06-10', to: '2024-06-14', days: 5 })
    // the calendar may not list today at all
    const noToday = streaksFor(calendar('2024-06-01', '2024-06-14', (day) => (day >= '2024-06-10' ? 3 : 0)))
    expect(noToday.current).toMatchObject({ from: '2024-06-10', to: '2024-06-14', days: 5 })
  })

  it('has no current streak once a whole day was missed', () => {
    const { longest, current } = streaksFor(calendar('2024-06-01', TODAY, (day) => (day >= '2024-06-10' && day <= '2024-06-13' ? 1 : 0)))
    expect(current).toBeNull()
    expect(longest).toMatchObject({ from: '2024-06-10', to: '2024-06-13', days: 4 })
  })

  it("takes today from now's day in Los Angeles, never UTC, and skips days after it", () => {
    // 05:00 UTC on June 16 is 22:00 on June 15 in Los Angeles
    const now = Date.parse('2024-06-16T05:00:00Z')
    const days = [...calendar('2024-06-10', '2024-06-15', (day) => (day >= '2024-06-13' ? 1 : 0)), { date: '2024-06-16', count: 9 }]
    const tl = buildLifeTimeline(profile({ days }), now)
    expect(tl.today).toBe('2024-06-15')
    expect(tl.streaks!.current).toMatchObject({ from: '2024-06-13', to: '2024-06-15', days: 3 })
    expect(tl.eras.at(-1)).toMatchObject({ to: '2024-06-15', contributions: 3 })
    // and 06:00 UTC on June 15 is still June 14 there
    expect(buildLifeTimeline(profile(), Date.parse('2024-06-15T06:00:00Z')).today).toBe('2024-06-14')
  })

  it('has no streak without a contribution day', () => {
    expect(streaksFor(calendar('2024-06-01', TODAY, () => 0))).toEqual({ longest: null, current: null })
  })
})

describe('life timeline: milestones', () => {
  it('derives first repo, top repo, longest streak and language switches, and merges the API ones by day, then kind', () => {
    const stated: ProfileMilestone[] = [
      { kind: 'first-pr', date: '2019-03-04T08:00:00Z', label: 'first pull request', repo: 'someone/else' },
      { kind: 'joined', date: iso('2019-01-10'), label: 'joined GitHub' },
      // the same kind and day as the derived first repo: kept once, the API's own
      { kind: 'first-repo', date: '2019-01-10T23:00:00Z', label: 'first repository', repo: 'me/hello' },
    ]
    const tl = buildLifeTimeline(
      profile({
        milestones: stated,
        days: calendar('2019-01-01', TODAY, (day) => (day >= '2020-05-01' && day <= '2020-05-03' ? 1 : 0)),
        repos: [
          repo('hello', { createdAt: iso('2019-01-10'), language: 'Python', activity: commitsOn({ '2019-01-10': 1 }) }),
          repo('star', { createdAt: iso('2021-03-03'), stars: 40, activity: commitsOn({ '2021-03-03': 2 }) }),
          repo('also-star', { createdAt: iso('2022-01-01'), stars: 40 }),
          // not theirs: older and far more starred, but neither their first nor their top repo
          repo('upstream', { createdAt: iso('2012-01-01'), firstActiveAt: iso('2020-05-01'), isOwn: false, stars: 9000, activity: commitsOn({ '2020-05-01': 1 }) }),
        ],
      }),
      NOW,
    )
    expect(tl.milestones.map(({ kind, day, label, repo }) => [kind, day, label, repo])).toEqual([
      ['joined', '2019-01-10', 'joined GitHub', undefined],
      ['first-repo', '2019-01-10', 'first repository', 'me/hello'],
      ['first-pr', '2019-03-04', 'first pull request', 'someone/else'],
      // upstream's commits make 2020q2 a TypeScript quarter
      ['language-switch', '2020-04-01', 'Python to TypeScript', undefined],
      ['longest-streak', '2020-05-01', 'longest streak: 3 days', undefined],
      ['top-repo', '2021-03-03', 'most starred repo: 40 stars', 'me/star'],
    ])
    expect(tl.milestones.find((m) => m.kind === 'top-repo')!.date).toBe(iso('2021-03-03'))
  })

  it('names the first repo when the API states none, and no top repo when nothing has a star', () => {
    const tl = buildLifeTimeline(profile({ source: 'rest', repos: [repo('b', { createdAt: iso('2020-02-02') }), repo('a', { createdAt: iso('2020-02-02') })] }), NOW)
    expect(tl.milestones).toEqual([{ kind: 'first-repo', date: iso('2020-02-02'), day: '2020-02-02', label: 'first repo', repo: 'me/a' }])
  })

  it('keeps one milestone of each kind but language-switch: the earliest stated one, else a derived one that is no fork', () => {
    const repos = [
      // a fork on the first day, more starred than anything: neither their first nor their top repo
      repo('fork', { createdAt: iso('2019-01-10'), isFork: true, stars: 500 }),
      repo('early', { createdAt: iso('2019-02-02'), stars: 2 }),
      repo('hello', { createdAt: iso('2019-05-05') }),
    ]
    const derived = buildLifeTimeline(profile({ repos }), NOW)
    expect(derived.milestones.map(({ kind, day, repo }) => [kind, day, repo])).toEqual([
      ['first-repo', '2019-02-02', 'me/early'],
      ['top-repo', '2019-02-02', 'me/early'],
    ])

    const stated = buildLifeTimeline(
      profile({
        repos,
        milestones: [
          // on another day than the derived first repo: still the only first repo
          { kind: 'first-repo', date: iso('2019-05-05'), label: 'first repository', repo: 'me/hello' },
          { kind: 'first-pr', date: iso('2019-06-01'), label: 'first pull request', repo: 'other/later' },
          { kind: 'first-pr', date: iso('2019-03-01'), label: 'first pull request', repo: 'other/earlier' },
        ],
      }),
      NOW,
    )
    expect(stated.milestones.map(({ kind, day, repo }) => [kind, day, repo])).toEqual([
      ['top-repo', '2019-02-02', 'me/early'],
      ['first-pr', '2019-03-01', 'other/earlier'],
      ['first-repo', '2019-05-05', 'me/hello'],
    ])
  })
})

describe('life timeline: an empty profile', () => {
  it('has no lanes, eras with nothing in them, and a clock from the account to now', () => {
    for (const source of ['graphql', 'rest'] as const) {
      const tl = buildLifeTimeline(profile({ source }), NOW)
      expect(tl.lanes).toEqual([])
      expect(tl.languageEras).toEqual([])
      expect(tl.milestones).toEqual([])
      expect(tl.start).toBe('2019-01-10')
      expect(tl.eras.map((era) => era.year)).toEqual([2019, 2020, 2021, 2022, 2023, 2024])
      expect(tl.eras.every((era) => era.contributions === (source === 'graphql' ? 0 : null) && era.reposBorn === 0)).toBe(true)
      expect(tl.streaks).toEqual(source === 'graphql' ? { longest: null, current: null } : null)
      expect(tl.clock.months[0]).toMatchObject({ month: '2019-01', fromDay: dayNumber('2019-01-10'), active: true, at: 0 })
      expect(progressAt(tl.clock, '2019-01-01')).toBe(0)
      expect(progressAt(tl.clock, tl.start)).toBe(0)
      expect(progressAt(tl.clock, NOW)).toBe(1)
    }
  })
})

describe('life timeline: days before the account was created', () => {
  it('keeps backdated days and commits, and starts the timeline at the first of them', () => {
    const tl = buildLifeTimeline(
      profile({
        createdAt: iso('2015-06-01'),
        // the first window starts on January 1 of the earliest contribution year
        days: calendar('2014-01-01', TODAY, (day) => (day >= '2014-03-10' && day <= '2014-03-12' ? 2 : 0)),
        repos: [repo('old', { createdAt: iso('2015-07-01'), isArchived: true, activity: commitsOn({ '2014-03-10': 2, '2014-03-11': 2, '2014-03-12': 2 }) })],
      }),
      NOW,
    )
    expect(tl.start).toBe('2014-03-10')
    // the repo is born, and counted, in 2015, where it is rooted: the backdated commits do not move it
    expect(tl.eras[0]).toMatchObject({ year: 2014, contributions: 6, reposBorn: 0 })
    expect(tl.eras[1]).toMatchObject({ year: 2015, contributions: 0, reposBorn: 1 })
    const lane = laneOf(tl, 'old')
    expect(lane).toMatchObject({ born: '2015-07-01', root: '2015-07-01', start: '2014-03-10', commits: 6 })
    // the day the repo came to GitHub is active too
    expect(shape(lane)).toEqual([
      ['active', '2014-03-10', '2014-03-12'],
      ['dormant', '2014-03-13', '2015-06-30'],
      ['active', '2015-07-01', '2015-07-01'],
    ])
    expect(tl.clock.months[0]).toMatchObject({ month: '2014-03', fromDay: dayNumber('2014-03-10') })
    expect(progressAt(tl.clock, '2014-03-01')).toBe(0)
    expect(progressAt(tl.clock, '2014-03-10')).toBe(0)
    expect(progressAt(tl.clock, '2014-03-11')).toBeGreaterThan(0)
  })

  it('never puts a day after today, whatever the input says', () => {
    const tl = buildLifeTimeline(
      profile({
        days: [{ date: plus(TODAY, 1), count: 5 }],
        milestones: [
          { kind: 'first-pr', date: iso(plus(TODAY, 1)), label: 'first pull request' },
          { kind: 'joined', date: 'not a date', label: 'joined GitHub' },
        ],
        repos: [repo('a', { createdAt: iso('2024-01-01'), lastActiveAt: iso(plus(TODAY, 3)) }), repo('b', { createdAt: iso('2024-01-01'), activity: commitsOn({ '2024-01-01': 1, [plus(TODAY, 2)]: 7 }) })],
      }),
      NOW,
    )
    for (const lane of tl.lanes) for (const span of lane.spans) expect(span.to <= TODAY).toBe(true)
    expect(laneOf(tl, 'a').lastActive).toBe(TODAY)
    expect(laneOf(tl, 'b')).toMatchObject({ commits: 1, lastActive: '2024-01-01' })
    expect(tl.eras.at(-1)!.contributions).toBe(0)
    expect(tl.streaks).toEqual({ longest: null, current: null })
    // a milestone after today, or with no readable date, has no place on the timeline
    expect(tl.milestones.map((m) => m.kind)).toEqual(['first-repo'])
  })
})

describe('life timeline: determinism', () => {
  const rich = profile({
    createdAt: iso('2018-11-20'),
    days: calendar('2018-01-01', TODAY, (day) => (Number(day.slice(8)) % 3 === 0 && day.slice(5, 7) !== '07' ? Number(day.slice(9)) : 0)),
    milestones: [
      { kind: 'joined', date: iso('2018-11-20'), label: 'joined GitHub' },
      { kind: 'first-issue', date: iso('2019-02-02'), label: 'first issue', repo: 'other/x' },
      // the same kind and day twice, in other words: one stands, whichever comes first
      { kind: 'first-pr', date: iso('2019-03-03'), label: 'first pull request', repo: 'other/y' },
      { kind: 'first-pr', date: iso('2019-03-03'), label: 'first PR', repo: 'other/z' },
      // stated twice on the day of the derived TypeScript to Go switch
      { kind: 'language-switch', date: iso('2020-01-01'), label: 'picked up Go' },
      { kind: 'language-switch', date: iso('2020-01-01'), label: 'moved to Go' },
    ],
    repos: [
      repo('site', { createdAt: iso('2019-01-01'), stars: 3, activity: commitsOn({ '2019-01-03': 2, '2019-01-06': 1, '2019-04-09': 5 }) }),
      // listed twice, as overlapping pages could: one lane, each day at the larger count
      repo('site', { createdAt: iso('2019-01-01'), stars: 4, activity: commitsOn({ '2019-01-03': 1, '2019-05-05': 2 }) }),
      repo('tool', { language: 'Go', createdAt: iso('2019-01-01'), stars: 3, isArchived: true, activity: commitsOn({ '2020-02-03': 4, '2020-02-27': 1 }) }),
      repo('fork', { language: 'C', createdAt: iso('2020-06-06'), isFork: true }),
      repo('secret', { language: 'Rust', createdAt: iso('2021-09-09'), isPrivate: true, activity: commitsOn({ '2021-09-09': 1, '2022-03-03': 8, '2022-03-06': 2 }) }),
      repo('upstream', { createdAt: iso('2011-01-01'), firstActiveAt: iso('2023-03-03'), isOwn: false, stars: 900, activity: commitsOn({ '2023-03-03': 6 }) }),
      repo('notes', { language: null, createdAt: iso('2022-12-12'), activity: commitsOn({ '2022-12-12': 1 }) }),
    ],
  })

  it('gives the same output for the same input, and leaves the input alone', () => {
    const before = structuredClone(rich)
    expect(buildLifeTimeline(rich, NOW)).toEqual(buildLifeTimeline(rich, NOW))
    expect(rich).toEqual(before)
  })

  it('gives the same output whatever order the repos, days, activity and milestones come in', () => {
    const expected = buildLifeTimeline(rich, NOW)
    for (const seed of [1, 7, 42]) {
      const mixed: ProfileData = {
        ...rich,
        days: shuffled(rich.days, seed),
        milestones: shuffled(rich.milestones, seed),
        repos: shuffled(rich.repos, seed).map((r) => ({ ...r, activity: shuffled(r.activity, seed + 1) })),
      }
      expect(buildLifeTimeline(mixed, NOW)).toEqual(expected)
    }
    // the first of each pair by label stands, and the stated switch over the derived one
    expect(expected.milestones.filter((m) => m.kind === 'first-pr').map((m) => [m.day, m.label, m.repo])).toEqual([['2019-03-03', 'first PR', 'other/z']])
    expect(expected.milestones.filter((m) => m.kind === 'language-switch').map((m) => [m.day, m.label])).toEqual([
      ['2020-01-01', 'moved to Go'],
      ['2021-07-01', 'Go to Rust'],
      ['2023-01-01', 'Rust to TypeScript'],
    ])
    expect(expected.lanes.filter((lane) => lane.repo === 'me/site')).toHaveLength(1)
    expect(laneOf(expected, 'site')).toMatchObject({ commits: 2 + 1 + 5 + 2, activeDays: 4 })
  })

  it('merges two repos with the same nameWithOwner into one lane, the same in either order', () => {
    const a = repo('twin', { createdAt: iso('2020-01-01'), stars: 1, activity: commitsOn({ '2020-01-01': 2, '2020-02-01': 1 }) })
    const b = repo('twin', { createdAt: iso('2020-01-01'), stars: 5, language: 'Go', activity: commitsOn({ '2020-01-01': 3, '2020-03-01': 4 }) })
    const ab = buildLifeTimeline(profile({ repos: [a, b] }), NOW)
    expect(buildLifeTimeline(profile({ repos: [b, a] }), NOW)).toEqual(ab)
    expect(ab.lanes).toHaveLength(1)
    // each day at the larger count: 3 + 1 + 4
    const lane = laneOf(ab, 'twin')
    expect(lane).toMatchObject({ commits: 8, activeDays: 3 })
    // the other fields come whole from one copy, not mixed
    expect([
      [a.language, a.stars],
      [b.language, b.stars],
    ]).toContainEqual([lane.language, lane.stars])
    expect(ab.milestones.filter((m) => m.kind === 'top-repo')).toHaveLength(1)
  })

  it('takes the fields of the freshest copy, and merges names that differ only in case', () => {
    const stale = repo('twin', { lastActiveAt: iso('2024-03-01'), stars: 10 })
    const fresh = repo('Twin', { lastActiveAt: iso('2024-06-14'), stars: 12 })
    for (const repos of [
      [stale, fresh],
      [fresh, stale],
    ]) {
      const tl = buildLifeTimeline(profile({ source: 'rest', repos }), NOW)
      expect(tl.lanes).toHaveLength(1)
      expect(tl.lanes[0]).toMatchObject({ repo: 'me/Twin', stars: 12, lastActive: '2024-06-14' })
    }
  })

  it("roots a repo they only contributed to at their first counted day when firstActiveAt cannot be read", () => {
    const tl = buildLifeTimeline(
      profile({
        createdAt: iso('2019-01-01'),
        repos: [repo('linux', { isOwn: false, createdAt: iso('2010-01-01'), firstActiveAt: '', activity: commitsOn({ '2022-05-05': 3 }) })],
      }),
      NOW,
    )
    expect(laneOf(tl, 'linux').root).toBe('2022-05-05')
    expect(tl.start).toBe('2019-01-01')
  })
})

describe('life timeline: the time-lapse clock', () => {
  it('has no length to share out for an account made at this very moment, and stays finite', () => {
    const midnight = Date.parse('2024-06-15T07:00:00Z')
    const tl = buildLifeTimeline(profile({ createdAt: '2024-06-15T07:00:00Z', days: [], repos: [] }), midnight)
    for (const month of tl.clock.months) expect(Number.isFinite(month.at)).toBe(true)
    expect(progressAt(tl.clock, '2024-06-15T07:00:00Z')).toBe(1)
    expect(Number.isFinite(dayAt(tl.clock, 0.5))).toBe(true)
  })

  // busy every month of 2021, silent all of 2022, busy again from 2023; the account (and the
  // timeline) starts on January 4, 2021, after the calendar's first day
  const days = calendar('2021-01-01', TODAY, (day) => (day.startsWith('2022') ? 0 : day.endsWith('-15') ? 1 : 0))
  const tl = buildLifeTimeline(profile({ createdAt: iso('2021-01-04'), days }), NOW)
  const { clock } = tl
  const activeMonths = (timeline: LifeTimeline) => timeline.clock.months.filter((month) => month.active).map((month) => month.month)

  it("runs from 0 at the timeline's start, not the 1st of its month, to 1 at now", () => {
    expect(tl.start).toBe('2021-01-04')
    expect(clock.months[0]).toMatchObject({ month: '2021-01', fromDay: tl.startDay, at: 0 })
    expect(clock.months[1]).toMatchObject({ month: '2021-02', fromDay: dayNumber('2021-02-01') })
    expect(clock.months.at(-1)!.month).toBe('2024-06')
    expect(progressAt(clock, tl.start)).toBe(0)
    expect(dayAt(clock, 0)).toBe(tl.startDay)
    // the days before the account no longer play
    expect(progressAt(clock, '2021-01-01')).toBe(0)
    expect(progressAt(clock, '2021-01-05')).toBeGreaterThan(0)
    expect(progressAt(clock, '2020-05-05')).toBe(0)
    expect(progressAt(clock, NOW)).toBe(1)
    expect(progressAt(clock, NOW + 86_400_000)).toBe(1)
    expect(progressAt(clock, new Date(NOW).toISOString())).toBe(1)
    // today began before now
    expect(progressAt(clock, TODAY)).toBeLessThan(1)
    expect(progressAt(clock, 'not a date')).toBe(0)
  })

  it('never runs backwards, through every day and through the hours the clocks change', () => {
    let previous = -1
    for (let n = dayNumber('2020-12-01'); n <= dayNumber(TODAY) + 2; n++) {
      const p = progressAt(clock, dayKey(n))
      expect(p).toBeGreaterThanOrEqual(previous)
      previous = p
    }
    // daylight time ends on 2021-11-07 and starts on 2023-03-12 in Los Angeles
    for (const day of ['2021-11-07', '2023-03-12']) {
      let last = -1
      for (let t = Date.parse(`${day}T00:00:00Z`); t <= Date.parse(`${day}T23:59:00Z`) + 86_400_000; t += 60_000) {
        const p = progressAt(clock, t)
        expect(p).toBeGreaterThanOrEqual(last)
        last = p
      }
    }
  })

  it('plays a quiet year in a small share of the time of a busy one', () => {
    const busy = progressAt(clock, '2024-01-01') - progressAt(clock, '2023-01-01')
    const quiet = progressAt(clock, '2023-01-01') - progressAt(clock, '2022-01-01')
    expect(quiet / busy).toBeCloseTo(QUIET_MONTH_SHARE, 12)
    expect(clock.months.filter((month) => month.month.startsWith('2022')).every((month) => !month.active)).toBe(true)
    // the first month plays only the part of its share inside the timeline: 28 of January's 31 days
    const month = progressAt(clock, '2023-02-01') - progressAt(clock, '2023-01-01')
    expect(progressAt(clock, '2021-02-01')).toBeCloseTo((month * 28) / 31, 12)
  })

  it('gives every active month the same share whatever its length, and every quiet month QUIET_MONTH_SHARE of it', () => {
    // from 2023-01-01, busy every month but April and May 2023 (30 and 31 days)
    const quiet = ['2023-04', '2023-05']
    const exact = buildLifeTimeline(
      profile({ createdAt: iso('2023-01-01'), days: calendar('2023-01-01', TODAY, (day) => (day.endsWith('-15') && !quiet.includes(day.slice(0, 7)) ? 1 : 0)) }),
      NOW,
    )
    const share = (from: string, to: string | number) => progressAt(exact.clock, to) - progressAt(exact.clock, from)
    const months = exact.clock.months
    expect(months.filter((month) => !month.active).map((month) => month.month)).toEqual(quiet)
    // now is noon on June 15 in Los Angeles: 14.5 of June's 30 days have gone by
    const june = 14.5 / 30
    const full = 1 / (months.length - 1 - quiet.length + QUIET_MONTH_SHARE * quiet.length + june)
    // January (31 days) and February (28)
    expect(share('2023-01-01', '2023-02-01')).toBeCloseTo(full, 12)
    expect(share('2023-02-01', '2023-03-01')).toBeCloseTo(full, 12)
    expect(share('2023-02-01', '2023-03-01')).toBeCloseTo(share('2023-01-01', '2023-02-01'), 12)
    // April (30 days) and May (31)
    expect(share('2023-04-01', '2023-05-01')).toBeCloseTo(QUIET_MONTH_SHARE * full, 12)
    expect(share('2023-05-01', '2023-06-01')).toBeCloseTo(QUIET_MONTH_SHARE * full, 12)
    // the current month gets only its days so far, at the same pace as a whole month
    expect(share('2024-06-01', NOW)).toBeCloseTo(full * june, 12)
  })

  it('makes a tier-1 month active for the account, a root, a last push or a recent push, and no other', () => {
    const rest = profile({
      source: 'rest',
      createdAt: iso('2023-01-10'),
      repos: [
        // a tier-1 span knows only its ends: the months between them stay quiet
        repo('a', { createdAt: iso('2023-01-10'), lastActiveAt: iso('2023-04-20') }),
        repo('b', { createdAt: iso('2023-09-05'), lastActiveAt: iso('2023-11-11') }),
      ],
      // a push to someone else's repo: no lane, but a day something happened
      recent: [{ date: '2024-06-03', repo: 'other/lib', pushes: 2 }],
      recentFrom: '2024-06-01',
    })
    const tier1 = buildLifeTimeline(rest, NOW)
    expect(activeMonths(tier1)).toEqual(['2023-01', '2023-04', '2023-09', '2023-11', '2024-06'])
    expect(activeMonths(buildLifeTimeline({ ...rest, recent: [] }, NOW))).toEqual(['2023-01', '2023-04', '2023-09', '2023-11'])
    expect(tier1.start).toBe('2023-01-10')

    // a recent push earlier than the account and every root starts the timeline itself
    const early = buildLifeTimeline(
      profile({
        source: 'rest',
        createdAt: iso('2024-06-05'),
        repos: [repo('c', { createdAt: iso('2024-06-05') })],
        recent: [{ date: '2024-06-02', repo: 'me/c', pushes: 1 }],
        recentFrom: '2024-05-16',
      }),
      NOW,
    )
    expect(early.start).toBe('2024-06-02')
    expect(early.clock.months).toEqual([{ month: '2024-06', fromDay: dayNumber('2024-06-02'), active: true, at: 0 }])
    expect(progressAt(early.clock, '2024-06-02')).toBe(0)
  })

  it('makes the month of a counted commit active even when the calendar lacks its day', () => {
    const tier2 = buildLifeTimeline(
      profile({
        createdAt: iso('2023-01-10'),
        days: calendar('2023-01-01', TODAY, () => 0).filter(({ date }) => date !== '2023-05-17'),
        repos: [repo('a', { createdAt: iso('2023-01-10'), activity: commitsOn({ '2023-05-17': 3 }) })],
      }),
      NOW,
    )
    expect(activeMonths(tier2)).toEqual(['2023-01', '2023-05'])
  })

  it('reads ms, ISO timestamps and day keys alike, as GitHub days', () => {
    // midnight in Los Angeles: standard time on 2023-03-12 (the change comes at 02:00), daylight time on 2023-11-05
    expect(progressAt(clock, '2023-03-12')).toBeCloseTo(progressAt(clock, Date.parse('2023-03-12T08:00:00Z')), 12)
    expect(progressAt(clock, '2023-11-05')).toBeCloseTo(progressAt(clock, '2023-11-05T07:00:00Z'), 12)
    expect(progressAtDay(clock, dayNumber('2023-11-05'))).toBe(progressAt(clock, '2023-11-05'))
    expect(githubDay('2024-06-16T05:00:00Z')).toBe('2024-06-15')
    expect(githubDay(Date.parse('2024-06-16T08:00:00Z'))).toBe('2024-06-16')
    for (const bad of ['2024-02-30', '2023-02-29', '2024-00-10', '2024-13-01', '2024-04-00', '2024-4-1', 'June 1, 2024', '2024-06-01T12:00:00']) {
      expect(githubDay(bad), bad).toBeNull()
    }
    expect(githubDay('2024-06-01T01:30:00+02:00')).toBe('2024-05-31')
    expect(githubDay('2024-02-29')).toBe('2024-02-29')
    expect(dayNumber('1970-01-02')).toBe(1)
    expect(dayKey(dayNumber('2024-12-31'))).toBe('2024-12-31')
  })

  it('places a time of day by the share of its day gone by, on 24-, 25- and 23-hour days', () => {
    // 19:00Z on 2023-06-01 is noon (PDT), halfway through a 24-hour day
    expect(progressAtDay(clock, dayNumber('2023-06-01') + 0.5)).toBeCloseTo(progressAt(clock, '2023-06-01T19:00:00Z'), 12)
    // 2023-11-05 has 25 hours (01:00 to 02:00 comes twice): noon (20:00Z) comes 13 of them after
    // midnight (07:00Z), however many the wall clock shows
    expect(progressAt(clock, '2023-11-05T20:00:00Z')).toBeCloseTo(progressAtDay(clock, dayNumber('2023-11-05') + 13 / 25), 12)
    // 2023-03-12 has 23 hours (02:00 to 03:00 never comes): noon (19:00Z) comes 11 after midnight (08:00Z)
    expect(progressAt(clock, '2023-03-12T19:00:00Z')).toBeCloseTo(progressAtDay(clock, dayNumber('2023-03-12') + 11 / 23), 12)
  })

  it('maps progress back to the day it came from', () => {
    expect(dayAt(clock, 0)).toBe(tl.startDay)
    expect(dayAt(clock, 1)).toBe(clock.nowDay)
    for (const day of [tl.start, '2021-06-17', '2022-02-02', '2022-12-31', '2023-08-08', TODAY]) {
      expect(dayAt(clock, progressAt(clock, day))).toBeCloseTo(dayNumber(day), 6)
    }
    for (let p = 0; p <= 1; p += 0.01) expect(progressAtDay(clock, dayAt(clock, p))).toBeCloseTo(p, 9)
  })
})

describe('life timeline: purity', () => {
  it('reads no clock and sends nothing: its only import is types', () => {
    const imports = [...source.matchAll(/^import .*$/gm)].map((m) => m[0])
    expect(imports).toEqual(["import type { ProfileData, ProfileMilestone, ProfileRepo } from '../types'"])
    // new Date with no argument (with or without parentheses), a bare Date() call, and anything that sends
    const impure = /Date\.now|new Date\b(?!\()|new Date\(\s*\)|(?<![\w.]|new\s+)Date\(|performance\.now|fetch\(|sendBeacon|track\(/
    for (const bad of ['Date.now()', 'new Date()', 'new Date( )', 'new Date;', 'String(Date())', 'performance.now()', 'fetch(url)', 'navigator.sendBeacon', 'umami.track(']) {
      expect(bad, bad).toMatch(impure)
    }
    // what the model may use: a Date from a time it is given, and Date's static parsers
    for (const fine of ['new Date(day * DAY_MS)', 'Date.UTC(2024, 0, 1)', 'Date.parse(date)']) expect(fine, fine).not.toMatch(impure)
    expect(source).not.toMatch(impure)
  })
})
