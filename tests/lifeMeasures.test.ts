/**
 * The measures person mode's views share about a lane (lifeMeasures.ts): its height by counted
 * commits with a token and by active days without, a seedling's, the star signal on a log scale,
 * the lane's stretches end to end along its own time, its landed pull requests, and how much of it
 * the time-lapse has grown.
 */
import { describe, expect, it } from 'vitest'
import { grownShare, isSeedling, landedOf, laneHeights, partsOf, starSignal } from '../src/profile/lifeMeasures'
import { buildLifeTimeline, dayKey, dayNumber } from '../src/profile/timeline'
import type { ProfileData, ProfileRepo } from '../src/types'

/** 2024-06-15 12:00 in Los Angeles (PDT). */
const NOW = Date.parse('2024-06-15T19:00:00Z')

/** A timestamp on a day: 20:00 UTC is 12:00 or 13:00 the same day in Los Angeles. */
const iso = (day: string) => `${day}T20:00:00Z`

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
    landed: [],
    fallback: null,
    ...over,
  }
}

/** One activity entry per day given, with that many commits. */
const commitsOn = (entries: Record<string, number>) => Object.entries(entries).map(([date, commits]) => ({ date, commits }))

/** A token profile: busy, quiet, archived and forked repos, one with no counted commits. */
const RICH = profile({
  repos: [
    repo('busy', { createdAt: iso('2019-02-01'), stars: 900, language: 'Go', activity: commitsOn({ '2019-02-01': 20, '2019-02-10': 30, '2020-06-01': 50 }) }),
    repo('quiet', { createdAt: iso('2019-03-01'), activity: commitsOn({ '2019-03-02': 1 }) }),
    repo('old', { createdAt: iso('2019-04-01'), isArchived: true, stars: 40, activity: commitsOn({ '2019-04-01': 4, '2019-04-20': 2 }) }),
    repo('copy', { createdAt: iso('2019-05-01'), isFork: true, stars: 3 }),
  ],
})

const richTimeline = buildLifeTimeline(RICH, NOW)
const richHeights = laneHeights(richTimeline, 'graphql')
const heightOf = (name: string) => richHeights[richTimeline.lanes.findIndex((lane) => lane.repo.toLowerCase() === `me/${name}`)]

describe('laneHeights', () => {
  it('grows taller with more counted commits on a token profile', () => {
    expect(heightOf('busy')).toBe(1)
    expect(heightOf('busy')).toBeGreaterThan(heightOf('old'))
    expect(heightOf('old')).toBeGreaterThan(heightOf('quiet'))
    expect(heightOf('quiet')).toBeGreaterThanOrEqual(0.06)
  })

  it('grows taller with more active days without a token', () => {
    const p = profile({
      source: 'rest',
      repos: [
        repo('long', { createdAt: iso('2019-01-01'), lastActiveAt: iso('2021-01-01') }),
        repo('short', { createdAt: iso('2020-01-01'), lastActiveAt: iso('2020-02-01') }),
        repo('blink', { createdAt: iso('2022-01-01') }),
      ],
    })
    const timeline = buildLifeTimeline(p, NOW)
    const heights = laneHeights(timeline, 'rest')
    const [long, short, blink] = ['long', 'short', 'blink'].map((n) => heights[timeline.lanes.findIndex((lane) => lane.repo === `me/${n}`)])
    expect(long).toBe(1)
    expect(long).toBeGreaterThan(short)
    expect(short).toBeGreaterThan(blink)
    for (const lane of timeline.lanes) expect(isSeedling(lane, 'rest')).toBe(false)
  })

  it('keeps a token profile repo GitHub counted no commits to short, as a seedling', () => {
    const copy = richTimeline.lanes.find((lane) => lane.repo === 'me/copy')!
    expect(isSeedling(copy, 'graphql')).toBe(true)
    expect(heightOf('copy')).toBe(0.04)
  })

  it('grows a lone repo full height, and only seedlings on a token profile with no counted commits', () => {
    const lone = buildLifeTimeline(profile({ source: 'rest', repos: [repo('a', { createdAt: iso('2024-06-15') })] }), NOW)
    expect(laneHeights(lone, 'rest')).toEqual([1])
    const none = buildLifeTimeline(profile({ repos: [repo('a'), repo('b')] }), NOW)
    expect(laneHeights(none, 'graphql')).toEqual([0.04, 0.04])
  })
})

describe('starSignal', () => {
  it('sizes stars on a log scale, full at 10k, none without', () => {
    expect(starSignal(0)).toBe(0)
    expect(starSignal(9)).toBeCloseTo(0.25, 12)
    expect(starSignal(900)).toBe(Math.log10(901) / 4)
    expect(starSignal(9_999)).toBeCloseTo(1, 12)
    expect(starSignal(1_000_000)).toBe(1)
  })
})

describe('partsOf', () => {
  it('cuts a lane into its spans, end to end from 0 to 1 along its own time', () => {
    for (const lane of richTimeline.lanes) {
      const parts = partsOf(lane)
      expect(parts.map((p) => p.kind)).toEqual(lane.spans.map((s) => s.kind))
      expect(parts[0].t0).toBe(0)
      expect(parts[parts.length - 1].t1).toBeCloseTo(1, 12)
      for (let i = 1; i < parts.length; i++) expect(parts[i].t0).toBe(parts[i - 1].t1)
    }
  })
})

describe('landedOf', () => {
  it("marks each landed day once, in the day's middle, in order", () => {
    const lane = { startDay: dayNumber('2020-01-01'), endDay: dayNumber('2020-01-10'), landed: ['2020-01-02', '2020-01-02', '2020-01-06', 'not a day'] }
    const marks = landedOf(lane)
    expect(marks.map((m) => dayKey(m.day))).toEqual(['2020-01-02', '2020-01-06'])
    expect(marks[0].t).toBeCloseTo(1.5 / 10, 12)
    expect(marks[1].t).toBeCloseTo(5.5 / 10, 12)
  })
})

describe('grownShare', () => {
  it('is all of a lane with the time-lapse off, none before its first day, and all from past its last', () => {
    const lane = { startDay: 100, endDay: 109 }
    expect(grownShare(lane, null)).toBe(1)
    expect(grownShare(lane, 90)).toBe(0)
    expect(grownShare(lane, 105)).toBeCloseTo(0.5, 12)
    expect(grownShare(lane, 200)).toBe(1)
  })
})
