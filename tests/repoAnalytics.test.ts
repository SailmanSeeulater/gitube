import { afterEach, describe, expect, it, vi } from 'vitest'
import { track, type EventData } from '../src/analytics/umami'
import {
  FetchErrorCounter,
  GrowCounter,
  PrOverlayCounter,
  RepoAnalytics,
  branchBucket,
  growEventData,
  type RepoAnalyticsState,
  type RepoOnShow,
} from '../src/analytics/useRepoAnalytics'
import { withLookup } from '../src/graph/pulls'
import { useGardenStore } from '../src/store/useGardenStore'
import { GitHubFetchError, type Branch, type PullIndex, type PullSummary, type RepoData } from '../src/types'

const TOKEN = 'ghp_' + 'R8vK2mW5qT9xL3nB7cJ4hF6dS1aG0eY2uI8o'

/** A repo with this many branches; the analytics read nothing else of them. */
function repoWith(branches: number, owner = 'expressjs', repo = 'express'): RepoData {
  const list = Array.from({ length: branches }, (_, i) => ({ name: `b${i}` }) as Branch)
  return { owner, repo, defaultBranch: 'b0', branches: list, commits: {}, truncated: false, truncatedAt: [] }
}

function stubTracker() {
  const umamiTrack = vi.fn<(event: string, data?: EventData) => unknown>()
  vi.stubGlobal('window', { umami: { track: umamiTrack }, location: { search: '?repo=expressjs/express' } })
  return umamiTrack
}

afterEach(() => {
  vi.unstubAllGlobals()
  useGardenStore.setState({ token: '' })
})

describe('branchBucket', () => {
  it('puts branch counts in coarse buckets, edges included', () => {
    const cases: [number, string][] = [
      [0, '1'],
      [1, '1'],
      [2, '2-5'],
      [5, '2-5'],
      [6, '6-20'],
      [20, '6-20'],
      [21, '21-50'],
      [50, '21-50'],
      [51, '51-100'],
      [100, '51-100'],
      [101, '101+'],
      [5000, '101+'],
    ]
    for (const [count, bucket] of cases) expect(branchBucket(count), `${count} branches`).toBe(bucket)
  })
})

describe('growEventData', () => {
  it('names the repo only for a live fetch without a token', () => {
    expect(growEventData(repoWith(7), false, false)).toEqual({
      mode: 'repo',
      branches: '6-20',
      cached: false,
      token: false,
      repo: 'expressjs/express',
    })
    // a cached copy may have been fetched with a token since removed
    expect(growEventData(repoWith(7), true, false)).toEqual({ mode: 'repo', branches: '6-20', cached: true, token: false })
    expect(growEventData(repoWith(7), false, true)).toEqual({ mode: 'repo', branches: '6-20', cached: false, token: true })
    expect(growEventData(repoWith(7), true, true)).toEqual({ mode: 'repo', branches: '6-20', cached: true, token: true })
  })

  it('buckets the branch count', () => {
    expect(growEventData(repoWith(1), false, true).branches).toBe('1')
    expect(growEventData(repoWith(101), false, true).branches).toBe('101+')
  })

  it('loses the name on the way out if a token arrives after the fetch, and clips a long one', () => {
    const umamiTrack = stubTracker()
    const long = repoWith(3, 'some-organisation-name', 'a-really-long-repository-name-that-goes-on')
    track('grow', growEventData(long, false, false))
    expect(umamiTrack).toHaveBeenLastCalledWith('grow', {
      mode: 'repo',
      branches: '2-5',
      cached: false,
      token: false,
      repo: 'some-organisation-name/a-really-long-repository-name-that-goes-on'.slice(0, 50),
    })
    const data = growEventData(repoWith(3), false, false)
    expect(data.repo).toBe('expressjs/express')
    useGardenStore.setState({ token: TOKEN })
    track('grow', data)
    expect(umamiTrack).toHaveBeenLastCalledWith('grow', { mode: 'repo', branches: '2-5', cached: false, token: false })
  })
})

describe('GrowCounter', () => {
  const T1 = '2026-10-23T10:00:00.000Z'
  const T2 = '2026-10-23T10:05:00.000Z'
  const T3 = '2026-10-23T10:10:00.000Z'
  const SAVED = '2026-10-22T09:00:00.000Z'
  const express = repoWith(4)
  const acme = repoWith(30, 'acme', 'app')
  const EXPRESS_EVENT = { mode: 'repo', branches: '2-5', cached: false, token: false, repo: 'expressjs/express' }

  const nothing: RepoOnShow = { data: undefined, fetchedAt: null, cachedAt: null, isFetching: false, error: null }
  const fetching: RepoOnShow = { ...nothing, isFetching: true }
  /** data on show, fetched live at fetchedAt unless the rest says otherwise */
  const showing = (data: RepoData, fetchedAt: string, rest: Partial<RepoOnShow> = {}): RepoOnShow => ({ ...nothing, data, fetchedAt, ...rest })
  const ref = (data: RepoData) => ({ owner: data.owner, repo: data.repo })

  /** A counter that has already counted express, fetched at T1 (and shows it). */
  function grownExpress() {
    const counter = new GrowCounter()
    counter.arm(ref(express), nothing)
    expect(counter.observe(showing(express, T1), false)).toEqual(EXPRESS_EVENT)
    return counter
  }

  it('counts nothing without a request: a fetch, a token change or a background refetch alone', () => {
    const counter = new GrowCounter()
    expect(counter.observe(fetching, false)).toBeNull()
    expect(counter.observe(showing(express, T1), false)).toBeNull()

    const grown = grownExpress()
    // a token added: the repo is fetched again under another query key
    expect(grown.observe(fetching, true)).toBeNull()
    expect(grown.observe(showing(express, T2), true)).toBeNull()
    // a background refetch
    expect(grown.observe(showing(express, T2, { isFetching: true }), true)).toBeNull()
    expect(grown.observe(showing(express, T3), true)).toBeNull()
  })

  it("counts a share link's repo once, when its data arrives", () => {
    const counter = new GrowCounter()
    counter.arm({ owner: 'ExpressJS', repo: 'Express' }, nothing)
    expect(counter.observe(nothing, false)).toBeNull()
    expect(counter.observe(fetching, false)).toBeNull()
    expect(counter.observe(showing(express, T1), false)).toEqual(EXPRESS_EVENT)
    expect(counter.observe(showing(express, T1), false)).toBeNull()
    // the same fetch, handed over as a new object
    expect(counter.observe(showing({ ...express }, T1), false)).toBeNull()
  })

  it('counts a refresh of a cached copy once, as a live fetch', () => {
    const counter = new GrowCounter()
    const cached = showing(express, SAVED, { cachedAt: SAVED })
    counter.arm(ref(express), nothing)
    expect(counter.observe(cached, false)).toEqual({ mode: 'repo', branches: '2-5', cached: true, token: false })

    counter.arm(ref(express), cached)
    // the refetch has not started yet, then it runs
    expect(counter.observe(cached, false)).toBeNull()
    expect(counter.observe({ ...cached, isFetching: true }, false)).toBeNull()
    expect(counter.observe(showing(express, T2), false)).toEqual(EXPRESS_EVENT)
    expect(counter.observe(showing(express, T3), false)).toBeNull()
  })

  it('counts growing a repo again after a failed grow of another', () => {
    const counter = grownExpress()
    counter.arm(ref(acme), showing(express, T1))
    expect(counter.observe(fetching, false)).toBeNull()
    const notFound = new GitHubFetchError('Not Found: acme/app', 'not_found')
    const failed: RepoOnShow = { ...nothing, error: notFound }
    expect(counter.observe(failed, false)).toBeNull()

    // express is still in the query cache, fetched at T1, and shows at once
    counter.arm(ref(express), failed)
    expect(counter.observe(showing(express, T1), false)).toEqual(EXPRESS_EVENT)
  })

  it('counts growing a repo again after a saved file was opened', () => {
    const counter = grownExpress()
    // opening a file grows nothing, and no repo is fetched while it is open
    expect(counter.observe(nothing, false)).toBeNull()
    counter.arm(ref(express), nothing)
    expect(counter.observe(showing(express, T1), false)).toEqual(EXPRESS_EVENT)
  })

  it('counts a request answered by stale data and its refetch once, after the refetch', () => {
    const counter = grownExpress()
    counter.arm(ref(acme), showing(express, T1))
    expect(counter.observe(showing(acme, T1, { isFetching: true }), false)).toBeNull()
    expect(counter.observe(showing(acme, T2), false)).toEqual({ mode: 'repo', branches: '21-50', cached: false, token: false, repo: 'acme/app' })
    expect(counter.observe(showing(acme, T2), false)).toBeNull()
  })

  it('waits for a fetch in flight, a Grow made during it included', () => {
    const counter = grownExpress()
    counter.arm(ref(express), showing(express, T1, { isFetching: true }))
    expect(counter.observe(showing(express, T1, { isFetching: true }), false)).toBeNull()
    expect(counter.observe(showing(express, T2, { isFetching: true }), false)).toBeNull()
    expect(counter.observe(showing(express, T2), false)).toEqual(EXPRESS_EVENT)
  })

  it('keeps a request made with an error on show armed through that error', () => {
    const counter = new GrowCounter()
    const notFound = new GitHubFetchError('Not Found: acme/app', 'not_found')
    const failed: RepoOnShow = { ...nothing, error: notFound }
    counter.arm(ref(acme), failed)
    expect(counter.observe(failed, false)).toBeNull()
    expect(counter.observe({ ...failed, isFetching: true }, false)).toBeNull()
    expect(counter.observe(showing(acme, T1), true)).toEqual({ mode: 'repo', branches: '21-50', cached: false, token: true })
  })

  it('drops a request a new error answers, but not for an old one shown while it is fetched again', () => {
    const counter = new GrowCounter()
    counter.arm(ref(express), nothing)
    expect(counter.observe(fetching, false)).toBeNull()
    expect(counter.observe({ ...nothing, error: new GitHubFetchError('slow down', 'rate_limited') }, false)).toBeNull()
    expect(counter.observe(showing(express, T1), false)).toBeNull()

    // a failed refetch keeps the data it had on show
    counter.arm(ref(express), showing(express, T1))
    const offline = new GitHubFetchError('offline', 'network')
    expect(counter.observe(showing(express, T1, { error: offline }), false)).toBeNull()
    expect(counter.observe(showing(express, T2), false)).toBeNull()

    // a query that failed before shows its error again while it is fetched again
    counter.arm(ref(acme), showing(express, T2))
    const earlier = new GitHubFetchError('Not Found: acme/app', 'not_found')
    expect(counter.observe({ ...nothing, error: earlier, isFetching: true }, false)).toBeNull()
    expect(counter.observe(showing(acme, T3), false)).toEqual({ mode: 'repo', branches: '21-50', cached: false, token: false, repo: 'acme/app' })
  })
})

describe('PrOverlayCounter', () => {
  const express = repoWith(4)
  const pr = { number: 7, head: 'feature', review: 'unknown', checks: 'unknown', checkCounts: null } as PullSummary
  const index = (fetchedAt: string) =>
    ({ byBranch: new Map([['feature', [pr]]]), intoBase: 1, total: 1, fromForks: 0, notOnGraph: 0, fetchedAt }) as unknown as PullIndex

  it('waits for an answer', () => {
    const counter = new PrOverlayCounter()
    expect(counter.observe(express, 'off', null, 0)).toBeNull()
    expect(counter.observe(express, 'loading', null, 0)).toBeNull()
    expect(counter.observe(express, 'ready', null, 0)).toBeNull()
    expect(counter.observe(express, 'error', null, 0)).toBeNull()
    expect(counter.observe(undefined, 'ready', index('2026-10-23T10:00:00.000Z'), 0)).toBeNull()
  })

  it('counts each answer once: on with rings drawn, off without', () => {
    const counter = new PrOverlayCounter()
    const first = index('2026-10-23T10:00:00.000Z')
    expect(counter.observe(express, 'ready', first, 3)).toEqual({ state: 'on' })
    expect(counter.observe(express, 'ready', first, 0)).toBeNull()
    expect(counter.observe(express, 'loading', first, 0)).toBeNull()
    expect(counter.observe(express, 'ready', first, 0)).toBeNull()
    // a lookup lays one pull request's review and checks into a new index from the same answer
    const looked = withLookup(first, 'feature', 7, { review: 'approved', checks: 'passing', checkCounts: null })
    expect(looked).not.toBe(first)
    expect(counter.observe(express, 'ready', looked, 3)).toBeNull()

    expect(counter.observe(express, 'ready', index('2026-10-23T10:05:00.000Z'), 0)).toEqual({ state: 'off' })
    // another repo's answer, even from the same moment
    expect(counter.observe(repoWith(4, 'acme', 'app'), 'ready', index('2026-10-23T10:05:00.000Z'), 2)).toEqual({ state: 'on' })
    // the first answer shown again from the query's cache
    expect(counter.observe(express, 'ready', first, 3)).toBeNull()
  })
})

describe('FetchErrorCounter', () => {
  it('counts each failed load once, after its fetch has settled', () => {
    const counter = new FetchErrorCounter()
    const missing = new GitHubFetchError('Not Found', 'not_found')
    expect(counter.observe(null, false)).toBeNull()
    expect(counter.observe(missing, true)).toBeNull()
    expect(counter.observe(missing, false)).toEqual({ code: 'not_found' })
    expect(counter.observe(missing, false)).toBeNull()
    expect(counter.observe(new GitHubFetchError('slow down', 'rate_limited'), false)).toEqual({ code: 'rate_limited' })
  })

  it('does not count an old error shown again while its query is fetched anew', () => {
    const counter = new FetchErrorCounter()
    const limited = new GitHubFetchError('slow down', 'rate_limited')
    expect(counter.observe(limited, false)).toEqual({ code: 'rate_limited' })
    // another repo on show, then the failed one again: TanStack shows its old error while it refetches
    expect(counter.observe(null, false)).toBeNull()
    expect(counter.observe(limited, true)).toBeNull()
    expect(counter.observe(null, false)).toBeNull()
  })
})

describe('RepoAnalytics', () => {
  const T1 = '2026-10-23T10:00:00.000Z'
  const T2 = '2026-10-23T10:05:00.000Z'
  const express = repoWith(4)
  const acme = repoWith(30, 'acme', 'app')
  const idle: RepoAnalyticsState = {
    data: undefined,
    fetchedAt: null,
    cachedAt: null,
    isFetching: false,
    error: null,
    pullsStatus: 'off',
    pullsIndex: null,
    prMarkCount: 0,
  }
  const pullIndex = (fetchedAt: string) => ({ byBranch: new Map(), intoBase: 0, total: 0, fromForks: 0, notOnGraph: 0, fetchedAt }) as unknown as PullIndex

  it("grows a share link's repo, then its pull requests, in the order they arrive", () => {
    const analytics = new RepoAnalytics({ ...idle, isFetching: true }, { owner: 'expressjs', repo: 'express' })
    expect(analytics.observe({ ...idle, isFetching: true }, false)).toEqual([])
    expect(analytics.observe({ ...idle, data: express, fetchedAt: T1 }, false)).toEqual([
      ['grow', { mode: 'repo', branches: '2-5', cached: false, token: false, repo: 'expressjs/express' }],
    ])
    const shown = { ...idle, data: express, fetchedAt: T1 }
    expect(analytics.observe({ ...shown, pullsStatus: 'loading' }, false)).toEqual([])
    expect(analytics.observe({ ...shown, pullsStatus: 'ready', pullsIndex: pullIndex(T1), prMarkCount: 2 }, false)).toEqual([['pr-overlay', { state: 'on' }]])
  })

  it('arms a request with the state last observed, the one on screen when it was made', () => {
    const analytics = new RepoAnalytics(idle)
    const shown = { ...idle, data: express, fetchedAt: T1 }
    expect(analytics.observe(shown, true)).toEqual([])
    // refresh: the same repo, so it waits for a fetch newer than T1
    analytics.noteGrow({ owner: 'expressjs', repo: 'express' })
    expect(analytics.observe(shown, true)).toEqual([])
    expect(analytics.observe({ ...shown, isFetching: true }, true)).toEqual([])
    expect(analytics.observe({ ...shown, fetchedAt: T2 }, true)).toEqual([['grow', { mode: 'repo', branches: '2-5', cached: false, token: true }]])
  })

  it('counts a failed grow as one fetch-error and no grow, and an old error shown again as neither', () => {
    const analytics = new RepoAnalytics(idle)
    const missing = new GitHubFetchError('Not Found', 'not_found')
    analytics.noteGrow({ owner: 'acme', repo: 'app' })
    expect(analytics.observe({ ...idle, isFetching: true }, false)).toEqual([])
    expect(analytics.observe({ ...idle, error: missing }, false)).toEqual([['fetch-error', { code: 'not_found' }]])
    // express grown, then acme again: its old error shows while it is fetched anew, and that works
    analytics.noteGrow({ owner: 'expressjs', repo: 'express' })
    expect(analytics.observe({ ...idle, data: express, fetchedAt: T1 }, false)).toHaveLength(1)
    analytics.noteGrow({ owner: 'acme', repo: 'app' })
    expect(analytics.observe({ ...idle, error: missing, isFetching: true }, false)).toEqual([])
    expect(analytics.observe({ ...idle, data: acme, fetchedAt: T2 }, false)).toEqual([
      ['grow', { mode: 'repo', branches: '21-50', cached: false, token: false, repo: 'acme/app' }],
    ])
  })
})
