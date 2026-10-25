import { describe, expect, it } from 'vitest'
import { fetchProfileRest, loadProfile, pacificDay } from '../src/api/profile'
import { profileCacheKey, type ProfileStore } from '../src/api/profileCache'
import type { CacheEntry } from '../src/api/cachePolicy'
import { GitHubFetchError } from '../src/types'
import type { FetchProgress, ProfileData } from '../src/types'
// Recorded anonymously from api.github.com (see each file's _note), slimmed to what the fetcher reads.
import gaearon from './fixtures/github/profile-gaearon.json'
import vercel from './fixtures/github/profile-vercel.json'

// The cases with no good live source (0 public repos, a 404, a rate limit, failing events, more
// than 500 repos, a fourth page of events) are synthesised below, on a fictional login.

const DAY_MS = 24 * 60 * 60 * 1000
/** Shortly after the fixtures were recorded (2026-10-25, 01:40 Pacific). */
const NOW = Date.parse('2026-10-25T09:00:00Z')
/** pacificDay(NOW - 30 days): 2026-09-25T09:00Z is 02:00 on the 25th in Pacific time. */
const THIRTY_DAYS_AGO = '2026-09-25'
const RATE_RESET = '1792918188'
const RATE_RESET_ISO = new Date(Number(RATE_RESET) * 1000).toISOString()

// ---------- fake fetch ----------

interface Route {
  status?: number
  body: unknown
  headers?: Record<string, string>
}

type Router = (url: URL) => Route | undefined

interface Call {
  url: URL
  method: string
  headers: Headers
}

/** Answers from router (404 for anything it does not know), recording every call. */
function makeFetch(router: Router): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(href)
    calls.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers) })
    if (init?.signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }
    const route = router(url) ?? { status: 404, body: { message: 'Not Found' } }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '42',
        'x-ratelimit-reset': RATE_RESET,
        'x-ratelimit-resource': 'core',
        ...route.headers,
      },
    })
  }
  return { fetch, calls }
}

/** One user's three endpoints; repos and events answer by page number. */
function userRouter(
  login: string,
  routes: { user: Route; repos?: (page: number) => Route | undefined; events?: (page: number) => Route | undefined },
): Router {
  const base = `/users/${login.toLowerCase()}`
  return (url) => {
    const path = url.pathname.toLowerCase()
    const page = Number(url.searchParams.get('page') ?? '1')
    if (path === base) return routes.user
    if (path === `${base}/repos`) return routes.repos?.(page)
    if (path === `${base}/events/public`) return routes.events?.(page)
    return undefined
  }
}

interface Recorded {
  status: number
  headers: Record<string, string>
  body: unknown
}

/** Replays a recorded fixture: its identity answer, and its pages of repos and events in order. */
function replay(recorded: { user: Recorded; repos?: Recorded[]; events?: Recorded[] }): Router {
  return userRouter((recorded.user.body as { login: string }).login, {
    user: recorded.user,
    repos: (page) => recorded.repos?.[page - 1],
    events: (page) => recorded.events?.[page - 1],
  })
}

const gaearonRouter = replay(gaearon)

/** Serves items in pages of 100, with a rel="next" Link on every page but the last. */
function paged(items: unknown[], path: string): (page: number) => Route {
  return (page) => {
    const slice = items.slice((page - 1) * 100, page * 100)
    const headers: Record<string, string> = {}
    if (page * 100 < items.length) headers.link = `<https://api.github.com${path}?per_page=100&page=${page + 1}>; rel="next"`
    return { body: slice, headers }
  }
}

// ---------- synthetic data (fictional login, no real person) ----------

const SPROUT = 'quiet-sprout'
const sproutUser = (overrides: Record<string, unknown> = {}): Route => ({
  body: {
    login: 'Quiet-Sprout',
    name: null,
    avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    created_at: '2015-01-01T00:00:00Z',
    type: 'User',
    ...overrides,
  },
})

function rawRepo(i: number, overrides: Record<string, unknown> = {}) {
  const created = new Date(Date.UTC(2015, 0, 2) + i * DAY_MS).toISOString().replace('.000', '')
  return {
    full_name: `Quiet-Sprout/repo-${i}`,
    created_at: created,
    pushed_at: created,
    language: 'TypeScript',
    stargazers_count: 0,
    forks_count: 0,
    fork: false,
    archived: false,
    private: false,
    ...overrides,
  }
}

function event(type: string, repo: string, createdAt: string, id?: string) {
  return { ...(id === undefined ? {} : { id }), type, created_at: createdAt, repo: { name: repo } }
}

/** n push events, one an hour, newest first, ending at the given time. */
function hourlyPushes(n: number, newest: number) {
  return Array.from({ length: n }, (_, i) =>
    event('PushEvent', 'Quiet-Sprout/repo-0', new Date(newest - i * 60 * 60 * 1000).toISOString()),
  )
}

const empty = (): Route => ({ body: [] })

async function expectFetchError(promise: Promise<unknown>): Promise<GitHubFetchError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(GitHubFetchError)
    return err as GitHubFetchError
  }
  throw new Error('expected the fetch to reject')
}

const reposCalls = (calls: Call[]) => calls.filter((c) => c.url.pathname.endsWith('/repos'))
const eventCalls = (calls: Call[]) => calls.filter((c) => c.url.pathname.endsWith('/events/public'))
const pagesOf = (calls: Call[]) => calls.map((c) => c.url.searchParams.get('page'))

/** The day GitHub counts an instant on, worked out independently of pacificDay. */
const pacificDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

// ---------- fetchProfileRest ----------

describe('fetchProfileRest', () => {
  it('reads a real public user from the recorded fixtures, paging through 301 repos', async () => {
    const { fetch, calls } = makeFetch(gaearonRouter)
    const progress: FetchProgress[] = []
    const profile = await fetchProfileRest('Gaearon', { fetch, now: NOW, onProgress: (p) => progress.push(p) })

    // Identity, as GitHub spells the login.
    expect(profile.login).toBe('gaearon')
    expect(profile.name).toBe('dan')
    expect(profile.avatarUrl).toBe('https://avatars.githubusercontent.com/u/810438?v=4')
    expect(profile.createdAt).toBe('2011-05-25T18:18:31Z')
    expect(profile.source).toBe('rest')

    // Repos: every page, oldest first, the fields tier 1 fills.
    const recordedRepos = gaearon.repos.flatMap((p) => p.body)
    expect(profile.repos).toHaveLength(301)
    expect(profile.repos.map((r) => r.nameWithOwner)).toEqual(recordedRepos.map((r) => r.full_name))
    expect(profile.repos[0]).toEqual({
      nameWithOwner: 'gaearon/tictactoe',
      createdAt: '2013-05-20T16:04:40Z',
      firstActiveAt: '2013-05-20T16:04:40Z',
      lastActiveAt: '2014-01-05T19:19:28Z',
      isOwn: true,
      language: 'C#',
      languageColor: null,
      stars: 8,
      forks: 4,
      isFork: false,
      isArchived: false,
      isPrivate: false,
      activity: [],
    })
    for (let i = 1; i < profile.repos.length; i++) {
      expect(profile.repos[i - 1].createdAt <= profile.repos[i].createdAt).toBe(true)
    }
    for (const repo of profile.repos) {
      expect(repo.isOwn).toBe(true)
      expect(repo.firstActiveAt).toBe(repo.createdAt)
      expect(repo.languageColor).toBeNull()
      expect(repo.activity).toEqual([])
    }
    const archived = profile.repos.find((r) => r.nameWithOwner === 'gaearon/babel-plugin-react-transform')
    expect(archived).toMatchObject({ isArchived: true, stars: 1069, forks: 86, language: 'JavaScript' })
    expect(profile.repos.filter((r) => r.language === null)).toHaveLength(78)

    // Tier 1 leaves the tier 2 fields empty and states only the join date.
    expect(profile.days).toEqual([])
    expect(profile.restrictedContributions).toBe(0)
    expect(profile.lostWindows).toEqual([])
    expect(profile.fallback).toBeNull()
    expect(profile.truncated).toBe(false)
    expect(profile.milestones).toEqual([{ kind: 'joined', date: '2011-05-25T18:18:31Z', label: 'Joined GitHub' }])

    // Requests: identity + 4 repo pages + 3 event pages, all GET.
    expect(calls).toHaveLength(8)
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
    const repoCalls = reposCalls(calls)
    expect(pagesOf(repoCalls)).toEqual(['1', '2', '3', '4'])
    for (const call of repoCalls) {
      expect(call.url.searchParams.get('type')).toBe('owner')
      expect(call.url.searchParams.get('sort')).toBe('created')
      // newest first is the default for sort=created: the cap would drop the start of the career
      expect(call.url.searchParams.get('direction')).toBe('asc')
      expect(call.url.searchParams.get('per_page')).toBe('100')
    }
    expect(pagesOf(eventCalls(calls))).toEqual(['1', '2', '3'])
    expect(eventCalls(calls).every((c) => c.url.searchParams.get('per_page') === '100')).toBe(true)

    // Progress: every stage in order, requestsUsed never decreasing, done last with the total.
    expect(progress.map((p) => p.stage)).toEqual(['user', 'repos', 'repos', 'repos', 'repos', 'events', 'events', 'events', 'done'])
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i].requestsUsed).toBeGreaterThanOrEqual(progress[i - 1].requestsUsed)
    }
    const done = progress[progress.length - 1]
    expect(done.requestsUsed).toBe(8)
    expect(done.rateLimitRemaining).toBe(25) // the last recorded answer's x-ratelimit-remaining
    expect(done.rateLimitResetAt).toBe(RATE_RESET_ISO)
    expect(progress[1]).toMatchObject({ stage: 'repos', done: 100, requestsUsed: 2 })
  })

  it('counts recent pushes per repo per GitHub day from the recorded events', async () => {
    const { fetch } = makeFetch(gaearonRouter)
    const profile = await fetchProfileRest('gaearon', { fetch, now: NOW })

    // All three pages came back, so the window starts at the oldest event's day (any event type).
    const recordedEvents = gaearon.events.flatMap((p) => p.body)
    expect(gaearon.events.map((p) => p.body.length)).toEqual([99, 100, 80])
    expect(profile.recentFrom).toBe('2026-10-02')

    // PushEvents only, one entry per repo per day, ordered by day then repo.
    const expected = new Map<string, number>()
    for (const e of recordedEvents) {
      if (e.type !== 'PushEvent') continue
      const key = `${pacificDate(e.created_at)}|${e.repo.name}`
      expected.set(key, (expected.get(key) ?? 0) + 1)
    }
    expect(profile.recent.reduce((sum, r) => sum + r.pushes, 0)).toBe(183)
    expect(new Map(profile.recent.map((r) => [`${r.date}|${r.repo}`, r.pushes]))).toEqual(expected)
    const keys = profile.recent.map((r) => `${r.date}|${r.repo}`)
    expect(keys).toEqual([...keys].sort())
    expect(profile.recent.every((r) => r.date >= profile.recentFrom!)).toBe(true)
    expect(new Set(profile.recent.map((r) => r.repo))).toEqual(
      new Set(['gaearon/react', 'react/react', 'vercel/next.js', 'gaearon/next.js']),
    )
  })

  it("ends a fork's span at its creation when its pushed_at predates it", async () => {
    const { fetch } = makeFetch(gaearonRouter)
    const profile = await fetchProfileRest('gaearon', { fetch, now: NOW })

    // A real fork that kept its parent's push time.
    const recorded = gaearon.repos.flatMap((p) => p.body).find((r) => r.full_name === 'gaearon/react-async-bower')!
    expect(recorded).toMatchObject({ fork: true, created_at: '2014-03-24T11:03:02Z', pushed_at: '2014-03-24T07:14:51Z' })
    const fork = profile.repos.find((r) => r.nameWithOwner === 'gaearon/react-async-bower')!
    expect(fork).toMatchObject({ isFork: true, createdAt: '2014-03-24T11:03:02Z', lastActiveAt: '2014-03-24T11:03:02Z' })

    // Every span ends at max(created_at, pushed_at).
    const byName = new Map(gaearon.repos.flatMap((p) => p.body).map((r) => [r.full_name, r]))
    let earlyForks = 0
    for (const repo of profile.repos) {
      const raw = byName.get(repo.nameWithOwner)!
      const pushedEarlier = Date.parse(raw.pushed_at) < Date.parse(raw.created_at)
      if (pushedEarlier) earlyForks += 1
      expect(repo.lastActiveAt).toBe(pushedEarlier ? raw.created_at : raw.pushed_at)
    }
    expect(earlyForks).toBe(20)
  })

  it('ends a span at its creation when pushed_at is null', async () => {
    const repos = [rawRepo(0, { pushed_at: null }), rawRepo(1, { pushed_at: '2016-03-01T10:00:00Z', fork: true })]
    const { fetch } = makeFetch(userRouter(SPROUT, { user: sproutUser(), repos: paged(repos, '/user/1/repos'), events: empty }))
    const profile = await fetchProfileRest(SPROUT, { fetch, now: NOW })
    expect(profile.repos.map((r) => r.lastActiveAt)).toEqual([repos[0].created_at, '2016-03-01T10:00:00Z'])
  })

  it('reads a user with no public repos and no events in 3 requests', async () => {
    const { fetch, calls } = makeFetch(userRouter(SPROUT, { user: sproutUser(), repos: empty, events: empty }))
    const progress: FetchProgress[] = []
    const profile = await fetchProfileRest(SPROUT, { fetch, now: NOW, onProgress: (p) => progress.push(p) })
    expect(profile.login).toBe('Quiet-Sprout')
    expect(profile.name).toBeNull()
    expect(profile.repos).toEqual([])
    expect(profile.recent).toEqual([])
    expect(profile.recentFrom).toBe(THIRTY_DAYS_AGO)
    expect(profile.truncated).toBe(false)
    expect(calls).toHaveLength(3)
    expect(progress.map((p) => p.stage)).toEqual(['user', 'repos', 'events', 'done'])
    expect(progress[progress.length - 1].requestsUsed).toBe(3)
  })

  it('answers an organization with not_a_user, naming its type and never the token', async () => {
    const token = 'ghp_SECRET_TOKEN_VALUE_1234567890'
    const { fetch, calls } = makeFetch(replay(vercel))
    const err = await expectFetchError(fetchProfileRest('vercel', { fetch, token, now: NOW }))
    expect(err.code).toBe('not_a_user')
    expect(err.message).toContain('vercel')
    expect(err.message).toContain('Organization')
    expect(err.message).not.toContain(token)
    // The identity call decides it: no repos or events are read.
    expect(calls).toHaveLength(1)
    expect(calls[0].headers.get('authorization')).toBe(`token ${token}`)

    const bot = makeFetch(userRouter('helper-bot', { user: sproutUser({ login: 'helper-bot', type: 'Bot' }) }))
    const botErr = await expectFetchError(fetchProfileRest('helper-bot', { fetch: bot.fetch, now: NOW }))
    expect(botErr.code).toBe('not_a_user')
    expect(botErr.message).toContain('Bot')
  })

  it('maps a 404 to not_found in the user wording', async () => {
    const { fetch, calls } = makeFetch(() => undefined)
    const err = await expectFetchError(fetchProfileRest('No-Such-Sprout', { fetch, now: NOW }))
    expect(err.code).toBe('not_found')
    expect(err.message).toBe('No-Such-Sprout was not found. Check the spelling.')
    expect(calls).toHaveLength(1)
  })

  it('maps a 403 with x-ratelimit-remaining 0 to rate_limited, on the identity call or the repo listing', async () => {
    const limited: Route = {
      status: 403,
      body: { message: 'API rate limit exceeded for 1.2.3.4.', documentation_url: 'https://docs.github.com/rest' },
      headers: { 'x-ratelimit-remaining': '0' },
    }
    const first = makeFetch(() => limited)
    const progress: FetchProgress[] = []
    const err = await expectFetchError(fetchProfileRest(SPROUT, { fetch: first.fetch, now: NOW, onProgress: (p) => progress.push(p) }))
    expect(err.code).toBe('rate_limited')
    expect(err.resetAt).toBe(RATE_RESET_ISO)
    expect(err.message).toMatch(/rate limit/i)
    expect(err.message).toMatch(/personal access token/i)
    expect(first.calls).toHaveLength(1)
    expect(progress).toEqual([])

    // Running out on a repo page fails the profile too: a partial repo list would misdraw it.
    const later = makeFetch(
      userRouter(SPROUT, {
        user: sproutUser(),
        repos: (page) => (page === 1 ? paged([...Array(150).keys()].map((i) => rawRepo(i)), '/user/1/repos')(1) : limited),
        events: empty,
      }),
    )
    const e2 = await expectFetchError(fetchProfileRest(SPROUT, { fetch: later.fetch, now: NOW }))
    expect(e2.code).toBe('rate_limited')
    expect(eventCalls(later.calls)).toHaveLength(0)
  })

  it('caps the repos at 5 pages and flags truncated when a sixth exists, in 9 requests at most', async () => {
    const repos = Array.from({ length: 600 }, (_, i) => rawRepo(i))
    const events = hourlyPushes(300, Date.parse('2026-10-24T12:00:00Z'))
    const { fetch, calls } = makeFetch(
      userRouter(SPROUT, { user: sproutUser(), repos: paged(repos, '/user/1/repos'), events: paged(events, '/user/1/events/public') }),
    )
    const progress: FetchProgress[] = []
    const profile = await fetchProfileRest(SPROUT, { fetch, now: NOW, onProgress: (p) => progress.push(p) })
    expect(profile.repos).toHaveLength(500)
    expect(profile.repos[499].nameWithOwner).toBe('Quiet-Sprout/repo-499')
    expect(profile.truncated).toBe(true)
    expect(pagesOf(reposCalls(calls))).toEqual(['1', '2', '3', '4', '5'])
    expect(calls).toHaveLength(9)
    expect(progress.some((p) => p.stage === 'repos' && /cap/i.test(p.message))).toBe(true)
    expect(progress[progress.length - 1]).toMatchObject({ stage: 'done', requestsUsed: 9 })
  })

  it('stops reading events after 3 pages even when GitHub links a fourth', async () => {
    const newest = Date.parse('2026-10-24T12:00:00Z')
    const { fetch, calls } = makeFetch(
      userRouter(SPROUT, {
        user: sproutUser(),
        repos: empty,
        events: (page) =>
          page <= 3
            ? {
                body: hourlyPushes(100, newest - (page - 1) * 100 * 60 * 60 * 1000),
                headers: { link: `<https://api.github.com/user/1/events/public?per_page=100&page=${page + 1}>; rel="next"` },
              }
            : { status: 422, body: { message: 'In order to keep the API fast for everyone, pagination is limited for this resource.' } },
      }),
    )
    const profile = await fetchProfileRest(SPROUT, { fetch, now: NOW })
    expect(pagesOf(eventCalls(calls))).toEqual(['1', '2', '3'])
    // 300 hourly pushes reach back 299 hours from the newest: 2026-10-12T01:00Z, the 11th in Pacific time.
    expect(profile.recentFrom).toBe('2026-10-11')
    expect(profile.recent.reduce((sum, r) => sum + r.pushes, 0)).toBe(300)
  })

  it('counts an event once when the next page repeats it', async () => {
    const newest = Date.parse('2026-10-24T12:00:00Z')
    const first = hourlyPushes(100, newest).map((e, i) => ({ ...e, id: `e${i}` }))
    const repeated = first[first.length - 1]
    const older = event('PushEvent', 'Quiet-Sprout/repo-0', new Date(newest - 100 * 60 * 60 * 1000).toISOString(), 'e100')
    const { fetch } = makeFetch(
      userRouter(SPROUT, {
        user: sproutUser(),
        repos: empty,
        events: (page) =>
          page === 1
            ? { body: first, headers: { link: '<https://api.github.com/user/1/events/public?per_page=100&page=2>; rel="next"' } }
            : { body: [repeated, older] },
      }),
    )
    const profile = await fetchProfileRest(SPROUT, { fetch, now: NOW })
    expect(profile.recent.reduce((sum, r) => sum + r.pushes, 0)).toBe(101)
  })

  it('starts the recent window 30 days back when fewer than 3 pages of events exist', async () => {
    const events = [
      event('PushEvent', 'Quiet-Sprout/repo-0', '2026-10-20T18:00:00Z'),
      event('CreateEvent', 'Quiet-Sprout/repo-0', '2026-10-01T18:00:00Z'),
    ]
    const { fetch } = makeFetch(userRouter(SPROUT, { user: sproutUser(), repos: empty, events: () => ({ body: events }) }))
    const profile = await fetchProfileRest(SPROUT, { fetch, now: NOW })
    expect(profile.recentFrom).toBe(THIRTY_DAYS_AGO)
    expect(profile.recent).toEqual([{ date: '2026-10-20', repo: 'Quiet-Sprout/repo-0', pushes: 1 }])
  })

  it("keys pushes by GitHub's day in US Pacific time, never the machine's", async () => {
    // 2024-03-10T06:30Z is 22:30 on the 9th in Pacific standard time; 08:30Z is 00:30 on the 10th.
    const events = [
      event('PushEvent', 'Quiet-Sprout/repo-1', '2024-03-10T06:30:00Z'),
      event('PushEvent', 'Quiet-Sprout/repo-1', '2024-03-10T08:30:00Z'),
      event('PushEvent', 'Quiet-Sprout/repo-1', '2024-03-10T09:59:00Z'),
      event('PushEvent', 'Quiet-Sprout/repo-0', '2024-03-09T20:00:00Z'),
      event('PullRequestEvent', 'Quiet-Sprout/repo-0', '2024-03-09T21:00:00Z'),
      event('WatchEvent', 'Quiet-Sprout/repo-2', '2024-03-09T21:00:00Z'),
    ]
    const { fetch } = makeFetch(userRouter(SPROUT, { user: sproutUser(), repos: empty, events: () => ({ body: events }) }))
    const profile = await fetchProfileRest(SPROUT, { fetch, now: Date.parse('2024-03-20T12:00:00Z') })
    expect(profile.recentFrom).toBe('2024-02-19')
    expect(profile.recent).toEqual([
      { date: '2024-03-09', repo: 'Quiet-Sprout/repo-0', pushes: 1 },
      { date: '2024-03-09', repo: 'Quiet-Sprout/repo-1', pushes: 1 },
      { date: '2024-03-10', repo: 'Quiet-Sprout/repo-1', pushes: 2 },
    ])
  })

  it('reads day keys across both daylight saving changes', () => {
    expect(pacificDay(Date.parse('2024-03-10T06:30:00Z'))).toBe('2024-03-09')
    expect(pacificDay(Date.parse('2024-03-10T08:00:00Z'))).toBe('2024-03-10') // PST: UTC-8
    expect(pacificDay(Date.parse('2024-07-01T06:59:00Z'))).toBe('2024-06-30') // PDT: UTC-7
    expect(pacificDay(Date.parse('2024-07-01T07:00:00Z'))).toBe('2024-07-01')
    expect(pacificDay(Date.parse('2024-11-03T07:59:00Z'))).toBe('2024-11-03') // still PDT
    expect(pacificDay(Date.parse('2024-11-04T07:59:00Z'))).toBe('2024-11-03') // PST again
  })

  it('keeps the profile when the events fail, with no recent pushes', async () => {
    const serverError: Route = { status: 500, body: { message: 'Server Error' } }
    const limited: Route = { status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0' } }
    const cases: Array<[string, (page: number) => Route | undefined]> = [
      ['a 500 on the first page', () => serverError],
      ['a 500 on the second page', (page) => (page === 1 ? gaearon.events[0] : serverError)],
      ['a rate limit', () => limited],
    ]
    for (const [label, events] of cases) {
      const { fetch, calls } = makeFetch(
        userRouter('gaearon', { user: gaearon.user, repos: (page) => gaearon.repos[page - 1], events }),
      )
      const progress: FetchProgress[] = []
      const profile = await fetchProfileRest('gaearon', { fetch, now: NOW, onProgress: (p) => progress.push(p) })
      expect(profile.repos, label).toHaveLength(301)
      expect(profile.recent, label).toEqual([])
      expect(profile.recentFrom, label).toBe(THIRTY_DAYS_AGO)
      expect(progress.some((p) => p.stage === 'events' && p.message.startsWith('Skipped recent pushes')), label).toBe(true)
      expect(progress[progress.length - 1], label).toMatchObject({ stage: 'done', requestsUsed: calls.length })
    }

    // A network failure is no different.
    const network: typeof globalThis.fetch = async (input, init) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (href.includes('/events/')) throw new TypeError('fetch failed')
      return makeFetch(gaearonRouter).fetch(input, init)
    }
    const profile = await fetchProfileRest('gaearon', { fetch: network, now: NOW })
    expect(profile.repos).toHaveLength(301)
    expect(profile.recent).toEqual([])
  })

  it('aborts the whole fetch, during the repos or the optional events', async () => {
    const abortOn = (needle: string) => {
      const controller = new AbortController()
      const inner = makeFetch(gaearonRouter)
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (href.includes(needle)) controller.abort()
        return inner.fetch(input, init)
      }
      return { fetch, signal: controller.signal, calls: inner.calls }
    }

    const duringRepos = abortOn('/repos?')
    const e1 = await expectFetchError(fetchProfileRest('gaearon', { fetch: duringRepos.fetch, signal: duringRepos.signal, now: NOW }))
    expect(e1.code).toBe('aborted')
    expect(duringRepos.calls).toHaveLength(2)
    expect(eventCalls(duringRepos.calls)).toHaveLength(0)

    // The events are optional, but an abort there is still an abort, not a profile without pushes.
    const duringEvents = abortOn('/events/public')
    const e2 = await expectFetchError(fetchProfileRest('gaearon', { fetch: duringEvents.fetch, signal: duringEvents.signal, now: NOW }))
    expect(e2.code).toBe('aborted')
    expect(eventCalls(duringEvents.calls)).toHaveLength(1)

    const controller = new AbortController()
    controller.abort()
    const before = makeFetch(gaearonRouter)
    const e3 = await expectFetchError(fetchProfileRest('gaearon', { fetch: before.fetch, signal: controller.signal, now: NOW }))
    expect(e3.code).toBe('aborted')
    expect(before.calls).toHaveLength(0)
  })

  it('refuses an empty login without a request', async () => {
    const { fetch, calls } = makeFetch(gaearonRouter)
    const err = await expectFetchError(fetchProfileRest('  ', { fetch }))
    expect(err.code).toBe('invalid_url')
    expect(calls).toHaveLength(0)
  })
})

// ---------- loadProfile ----------

function memoryStore(): ProfileStore & { map: Map<string, CacheEntry<ProfileData>> } {
  const map = new Map<string, CacheEntry<ProfileData>>()
  return {
    map,
    get: async (key) => map.get(key),
    put: async (entry) => void map.set(entry.key, entry),
    all: async () => [...map.values()],
    delete: async (key) => void map.delete(key),
  }
}

describe('loadProfile', () => {
  it('serves a second load within 24 hours from the cache, with no requests', async () => {
    const store = memoryStore()
    const { fetch, calls } = makeFetch(gaearonRouter)

    const first = await loadProfile('gaearon', { fetch, store, now: NOW })
    expect(first.cachedAt).toBeNull()
    expect(calls).toHaveLength(8)
    expect([...store.map.keys()]).toEqual([profileCacheKey('gaearon', 'rest')])

    // Any casing of the login, almost a day later: no request at all.
    const second = await loadProfile('GAEARON', { fetch, store, now: NOW + 24 * 60 * 60 * 1000 - 1 })
    expect(calls).toHaveLength(8)
    expect(second.cachedAt).toBe(new Date(NOW).toISOString())
    expect(second.profile).toEqual(first.profile)

    // A day on, it is fetched again.
    const third = await loadProfile('gaearon', { fetch, store, now: NOW + 24 * 60 * 60 * 1000 })
    expect(third.cachedAt).toBeNull()
    expect(calls).toHaveLength(16)
  })

  it('does not read a rest entry once a token is set, nor store a REST profile as a token one', async () => {
    const store = memoryStore()
    const { fetch, calls } = makeFetch(gaearonRouter)
    await loadProfile('gaearon', { fetch, store, now: NOW })
    expect(calls).toHaveLength(8)

    const token = 'ghp_example_token'
    const withToken = await loadProfile('gaearon', { fetch, store, token, now: NOW + 1000 })
    expect(withToken.cachedAt).toBeNull()
    expect(calls).toHaveLength(16)
    expect(calls[8].headers.get('authorization')).toBe(`token ${token}`)
    // Until Phase 2, REST fills a token run's profile, and only a GraphQL one is kept under 'graphql'.
    expect([...store.map.keys()]).toEqual([profileCacheKey('gaearon', 'rest')])
    await loadProfile('gaearon', { fetch, store, token, now: NOW + 2000 })
    expect(calls).toHaveLength(24)

    // Without the token the rest entry still serves.
    const anon = await loadProfile('gaearon', { fetch, store, now: NOW + 3000 })
    expect(anon.cachedAt).toBe(new Date(NOW).toISOString())
    expect(calls).toHaveLength(24)
  })

  it('skips the cache when live, and remembers the new fetch', async () => {
    const store = memoryStore()
    const { fetch, calls } = makeFetch(gaearonRouter)
    await loadProfile('gaearon', { fetch, store, now: NOW })
    const live = await loadProfile('gaearon', { fetch, store, live: true, now: NOW + 60_000 })
    expect(live.cachedAt).toBeNull()
    expect(calls).toHaveLength(16)
    expect(store.map.get(profileCacheKey('gaearon', 'rest'))?.savedAt).toBe(new Date(NOW + 60_000).toISOString())
  })

  it('fetches every time without a store, and caches no failure', async () => {
    const { fetch, calls } = makeFetch(gaearonRouter)
    expect((await loadProfile('gaearon', { fetch, store: null, now: NOW })).cachedAt).toBeNull()
    await loadProfile('gaearon', { fetch, store: null, now: NOW })
    expect(calls).toHaveLength(16)

    const store = memoryStore()
    const org = makeFetch(replay(vercel))
    const err = await expectFetchError(loadProfile('vercel', { fetch: org.fetch, store, now: NOW }))
    expect(err.code).toBe('not_a_user')
    expect(store.map.size).toBe(0)
  })
})
