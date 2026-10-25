import { describe, expect, it } from 'vitest'
import { fetchProfileGraphql } from '../src/api/profileGraphql'
import { buildDayIndex, dayDetail } from '../src/profile/dayIndex'
import { buildLifeTimeline, dayKey, dayNumber } from '../src/profile/timeline'
import type { ProfileData, ProfileRepo } from '../src/types'
import kepanoFixture from './fixtures/github/profile-graphql-kepano.json'

/** 2024-06-15 12:00 in Los Angeles (PDT). */
const NOW = Date.parse('2024-06-15T19:00:00Z')
const TODAY = '2024-06-15'

const iso = (day: string) => `${day}T20:00:00Z`
const day = (key: string) => dayNumber(key)

function repo(nameWithOwner: string, over: Partial<ProfileRepo> = {}): ProfileRepo {
  const createdAt = over.createdAt ?? iso('2020-01-01')
  return {
    nameWithOwner,
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

const indexOf = (p: ProfileData, now = NOW) => buildDayIndex(p, buildLifeTimeline(p, now))

// ---------- kepano, replayed ----------

interface Recorded {
  status: number
  headers: Record<string, string>
  body: { data: Record<string, unknown> } & Record<string, unknown>
}
interface RecordedProfile {
  now: string
  user: Recorded
  graphql: Array<Recorded & { variables: Record<string, string> }>
}
const KEPANO = kepanoFixture as unknown as RecordedProfile

/**
 * The recorded answers, found by their variables: the identity call, the repositories page and each
 * window asked for. tests/profileGraphql.test.ts replays the same recording strictly (selections and
 * bounds checked); this only needs the profile it yields.
 */
const replay: typeof globalThis.fetch = async (input, init) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = new URL(href)
  const answer = ({ status, headers, body }: Pick<Recorded, 'status' | 'headers' | 'body'>) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } })
  if (url.pathname.toLowerCase() === '/users/kepano') return answer(KEPANO.user)
  if (url.pathname !== '/graphql') return answer({ status: 404, headers: {}, body: { data: {}, message: 'Not Found' } })
  const variables = (JSON.parse(String(init?.body)) as { variables: Record<string, string> }).variables
  const aliases = Object.keys(variables)
    .filter((k) => k.endsWith('_from'))
    .map((k) => k.slice(0, -'_from'.length))
  if (aliases.length === 0) {
    const page = KEPANO.graphql.find((e) => !Object.keys(e.variables).some((k) => k.endsWith('_from')) && (e.variables.after ?? null) === (variables.after ?? null))!
    return answer(page)
  }
  const data: Record<string, unknown> = {}
  let headers: Record<string, string> = {}
  for (const alias of aliases) {
    const entry = KEPANO.graphql.find((e) => e.variables[`${alias}_from`] === variables[`${alias}_from`] && e.variables[`${alias}_to`] === variables[`${alias}_to`])!
    data[alias] = entry.body.data[alias]
    data.rateLimit = entry.body.data.rateLimit
    headers = entry.headers
  }
  return answer({ status: 200, headers, body: { data } })
}

describe('day index on kepano (recorded, 2013 to 2026)', async () => {
  const now = Date.parse(KEPANO.now)
  const kepano = await fetchProfileGraphql('kepano', { token: 'ghp_TEST_TOKEN_not_a_real_one_0000', fetch: replay, now })
  const timeline = buildLifeTimeline(kepano, now)
  const index = buildDayIndex(kepano, timeline)
  const details = Array.from({ length: timeline.todayDay - timeline.startDay + 1 }, (_, i) => dayDetail(index, timeline.startDay + i))

  it('sums each repo’s commits over its days to its lane’s commits', () => {
    const sums = new Map<string, number>()
    for (const detail of details) {
      for (const { repo, n, unit } of detail.repos) {
        expect(unit).toBe('commits')
        sums.set(repo, (sums.get(repo) ?? 0) + n)
      }
    }
    expect(timeline.lanes.some((lane) => lane.commits > 100)).toBe(true)
    for (const lane of timeline.lanes) expect(sums.get(lane.repo) ?? 0, lane.repo).toBe(lane.commits)
    expect([...sums.keys()].every((repo) => timeline.lanes.some((lane) => lane.repo === repo))).toBe(true)
  })

  it('reads the calendar’s count for every day of the life, and knows every one', () => {
    const listed = new Map(kepano.days.map(({ date, count }) => [date, count]))
    for (const detail of details) {
      expect(detail.known, detail.key).toBe(true)
      expect(detail.count, detail.key).toBe(listed.get(detail.key) ?? null)
    }
    expect(details.reduce((sum, d) => sum + (d.count ?? 0), 0)).toBe(kepano.days.reduce((sum, d) => sum + d.count, 0))
  })

  it('finds each milestone on its day', () => {
    timeline.milestones.forEach((milestone, i) => expect(dayDetail(index, dayNumber(milestone.day)).milestones).toContain(i))
    expect(details.reduce((n, d) => n + d.milestones.length, 0)).toBe(timeline.milestones.length)
  })
})

// ---------- the merge rules ----------

describe('day index: token profiles', () => {
  it('merges repos as the timeline does: names without case, the larger count across copies, a day listed twice adding up', () => {
    const p = profile({
      repos: [
        // one copy lists 2020-03-01 twice (3 + 2), the other once (4): the day reads 5
        repo('me/Tool', { lastActiveAt: iso('2020-03-02'), activity: [{ date: '2020-03-01', commits: 3 }, { date: '2020-03-01', commits: 2 }, { date: '2020-03-02', commits: 1 }] }),
        repo('ME/tool', { lastActiveAt: iso('2020-03-01'), activity: [{ date: '2020-03-01', commits: 4 }, { date: '2020-03-03', commits: 6 }] }),
      ],
    })
    const timeline = buildLifeTimeline(p, NOW)
    const index = buildDayIndex(p, timeline)
    expect(timeline.lanes).toHaveLength(1)
    const name = timeline.lanes[0].repo
    expect(dayDetail(index, day('2020-03-01')).repos).toEqual([{ repo: name, n: 5, unit: 'commits' }])
    expect(dayDetail(index, day('2020-03-02')).repos).toEqual([{ repo: name, n: 1, unit: 'commits' }])
    expect(dayDetail(index, day('2020-03-03')).repos).toEqual([{ repo: name, n: 6, unit: 'commits' }])
    expect(5 + 1 + 6).toBe(timeline.lanes[0].commits)
  })

  it('reads timestamps by their US Pacific day and drops days after today', () => {
    const p = profile({
      repos: [
        repo('me/a', {
          activity: [
            // 2020-03-02 05:00 UTC is still March 1 in Los Angeles
            { date: '2020-03-02T05:00:00Z', commits: 2 },
            { date: '2024-06-16', commits: 9 },
            { date: 'not a day', commits: 9 },
            { date: '2020-03-05', commits: 0 },
          ],
        }),
      ],
      days: [
        { date: '2020-03-01', count: 2 },
        { date: '2024-06-16', count: 9 },
      ],
    })
    const index = indexOf(p)
    expect(dayDetail(index, day('2020-03-01')).repos).toEqual([{ repo: 'me/a', n: 2, unit: 'commits' }])
    expect(dayDetail(index, day('2020-03-05')).repos).toEqual([])
    const tomorrow = dayDetail(index, day('2024-06-16'))
    expect(tomorrow).toEqual({ day: day('2024-06-16'), key: '2024-06-16', known: false, count: null, repos: [], milestones: [] })
  })

  it('takes a calendar day listed twice at its larger count, and keeps a listed zero as known', () => {
    const p = profile({
      days: [
        { date: '2021-01-01', count: 3 },
        { date: '2021-01-01', count: 7 },
        { date: '2021-01-02', count: 0 },
      ],
    })
    const index = indexOf(p)
    expect(dayDetail(index, day('2021-01-01'))).toMatchObject({ known: true, count: 7 })
    expect(dayDetail(index, day('2021-01-02'))).toMatchObject({ known: true, count: 0, repos: [] })
    // a day the calendar does not list (a quarter lost to an error) is unknown
    expect(dayDetail(index, day('2021-01-03'))).toMatchObject({ known: false, count: null })
  })

  it('lists the busiest repo first, then in lane order, never by name', () => {
    const p = profile({
      repos: [
        repo('me/zeta', { createdAt: iso('2019-02-01'), activity: [{ date: '2021-05-05', commits: 2 }] }),
        repo('me/alpha', { createdAt: iso('2019-03-01'), activity: [{ date: '2021-05-05', commits: 2 }] }),
        repo('me/mid', { createdAt: iso('2019-04-01'), activity: [{ date: '2021-05-05', commits: 8 }] }),
      ],
    })
    expect(dayDetail(indexOf(p), day('2021-05-05')).repos.map((r) => r.repo)).toEqual(['me/mid', 'me/zeta', 'me/alpha'])
  })

  it('reads a fractional day number as its day', () => {
    const p = profile({ days: [{ date: '2021-01-01', count: 3 }] })
    expect(dayDetail(indexOf(p), day('2021-01-01') + 0.8)).toMatchObject({ day: day('2021-01-01'), key: '2021-01-01', count: 3 })
  })
})

describe('day index: profiles without a token', () => {
  const p = profile({
    source: 'rest',
    repos: [repo('me/Site', { createdAt: iso('2019-02-01'), lastActiveAt: iso('2024-06-10') })],
    recent: [
      { date: '2024-06-10', repo: 'me/site', pushes: 3 },
      { date: '2024-06-10', repo: 'other/lib', pushes: 1 },
      { date: '2024-06-12', repo: 'other/lib', pushes: 2 },
    ],
    recentFrom: '2024-05-16',
  })
  const index = indexOf(p)

  it('counts pushes, named as the lane spells the repo, with no calendar count', () => {
    expect(index.recentFromDay).toBe(day('2024-05-16'))
    expect(dayDetail(index, day('2024-06-10'))).toEqual({
      day: day('2024-06-10'),
      key: '2024-06-10',
      known: true,
      count: null,
      repos: [
        { repo: 'me/Site', n: 3, unit: 'pushes' },
        { repo: 'other/lib', n: 1, unit: 'pushes' },
      ],
      milestones: [],
    })
    expect(dayDetail(index, day('2024-06-12')).repos).toEqual([{ repo: 'other/lib', n: 2, unit: 'pushes' }])
  })

  it('knows the days from recentFrom to today, quiet ones too, and nothing before or after', () => {
    expect(dayDetail(index, day('2024-05-16'))).toMatchObject({ known: true, repos: [] })
    expect(dayDetail(index, day(TODAY))).toMatchObject({ known: true })
    expect(dayDetail(index, day('2024-05-15'))).toMatchObject({ known: false, count: null })
    expect(dayDetail(index, day('2024-06-16'))).toMatchObject({ known: false })
    expect(dayDetail(index, day('2020-01-01'))).toMatchObject({ known: false, repos: [] })
  })

  it('falls back to the first push when recentFrom is missing, and knows nothing with neither', () => {
    expect(indexOf({ ...p, recentFrom: null }).recentFromDay).toBe(day('2024-06-10'))
    const bare = indexOf({ ...p, recentFrom: null, recent: [] })
    expect(bare.recentFromDay).toBeNull()
    expect(dayDetail(bare, day(TODAY)).known).toBe(false)
  })
})

describe('day index: edge cases', () => {
  it('indexes a user with no repos and no events', () => {
    const index = indexOf(profile({ source: 'rest', recentFrom: '2024-05-16' }))
    expect(dayDetail(index, day('2024-06-01'))).toEqual({ day: day('2024-06-01'), key: '2024-06-01', known: true, count: null, repos: [], milestones: [] })
  })

  it('indexes the milestones of a day', () => {
    const p = profile({ milestones: [{ kind: 'joined', date: iso('2019-01-10'), label: 'joined GitHub' }], repos: [repo('me/a', { createdAt: iso('2019-01-10') })] })
    const timeline = buildLifeTimeline(p, NOW)
    const index = buildDayIndex(p, timeline)
    const detail = dayDetail(index, day('2019-01-10'))
    expect(detail.milestones.map((i) => timeline.milestones[i].kind).sort()).toEqual(['first-repo', 'joined'])
    expect(dayKey(detail.day)).toBe('2019-01-10')
  })

  it('hands out copies, so a caller cannot change the index', () => {
    const p = profile({ repos: [repo('me/a', { activity: [{ date: '2020-01-01', commits: 1 }] })] })
    const index = indexOf(p)
    const detail = dayDetail(index, day('2020-01-01'))
    const milestones = [...detail.milestones]
    detail.repos[0].n = 99
    detail.repos.push({ repo: 'x/y', n: 1, unit: 'commits' })
    detail.milestones.push(7)
    expect(dayDetail(index, day('2020-01-01')).repos).toEqual([{ repo: 'me/a', n: 1, unit: 'commits' }])
    expect(dayDetail(index, day('2020-01-01')).milestones).toEqual(milestones)
  })
})
