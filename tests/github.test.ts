import { describe, expect, it, vi } from 'vitest'
import { fetchRepoData } from '../src/api/github'
import { buildGraph } from '../src/graph'
import { GitHubFetchError } from '../src/types'
import type { FetchProgress } from '../src/types'
import repoFixture from './fixtures/github/repo.json'
import branchesFixture from './fixtures/github/branches.json'
import compareFeatureX from './fixtures/github/compare-feature-x.json'
import compareOld from './fixtures/github/compare-old.json'
import commitsPage1 from './fixtures/github/commits-page1.json'
import commitsPage2 from './fixtures/github/commits-page2.json'

// ---------- SHAs used by the fixtures ----------
const M1 = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1' // tip of main
const M2 = 'a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2'
const M3 = 'a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3' // merge base of feature/x
const M4 = 'a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4' // tip of old = merge base of old
const M5 = 'a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5' // oldest fetched trunk commit
const ROOT_PARENT = '0000000000000000000000000000000000000000' // never fetched
const UNFETCHED = 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0' // parent beyond a capped compare
const F1 = 'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1'
const F2 = 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2' // tip of feature/x

const RATE_REMAINING = '4321'
const RATE_RESET = '1760000000'
const RATE_RESET_ISO = new Date(Number(RATE_RESET) * 1000).toISOString()

const REF = { owner: 'owner', repo: 'repo' }

// ---------- fake fetch ----------

interface Route {
  status?: number
  body: unknown
  headers?: Record<string, string>
}

type Router = (url: URL, init: RequestInit | undefined) => Route | undefined

interface Call {
  url: string
  method: string
  headers: Headers
}

interface FakeFetch {
  fetch: typeof globalThis.fetch
  calls: Call[]
}

function makeFetch(router: Router, rate: { remaining?: string; reset?: string } = {}): FakeFetch {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(href)
    calls.push({ url: href, method: init?.method ?? 'GET', headers: new Headers(init?.headers) })
    if (init?.signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }
    const route = router(url, init) ?? { status: 404, body: { message: 'Not Found' } }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': rate.remaining ?? RATE_REMAINING,
        'x-ratelimit-reset': rate.reset ?? RATE_RESET,
        ...route.headers,
      },
    })
  }
  return { fetch, calls }
}

const NEXT_LINK = '<https://api.github.com/repos/owner/repo/commits?sha=main&per_page=100&page=2>; rel="next"'

/** Routes matching the JSON fixtures: 3 branches, 2 compares, 2 pages of trunk commits. */
const standardRouter: Router = (url) => {
  const path = url.pathname
  if (path === '/repos/owner/repo') return { body: repoFixture }
  if (path === '/repos/owner/repo/branches') return { body: branchesFixture }
  const compare = /^\/repos\/owner\/repo\/compare\/(.+)$/.exec(path)
  if (compare) {
    const basehead = decodeURIComponent(compare[1])
    if (basehead === 'main...feature/x') return { body: compareFeatureX }
    if (basehead === 'main...old') return { body: compareOld }
    return undefined
  }
  if (path === '/repos/owner/repo/commits') {
    if (url.searchParams.get('sha') !== 'main') return undefined
    const page = url.searchParams.get('page') ?? '1'
    if (page === '1') return { body: commitsPage1, headers: { link: NEXT_LINK } }
    if (page === '2') return { body: commitsPage2 }
    return undefined
  }
  return undefined
}

/** Build a synthetic GitHub commit object. */
function rawCommit(sha: string, parents: string[], date: string, message = `commit ${sha.slice(0, 7)}`) {
  return {
    sha,
    html_url: `https://github.com/owner/repo/commit/${sha}`,
    commit: {
      message,
      author: { name: 'Gen', email: 'gen@example.com', date },
      committer: { name: 'Gen', email: 'gen@example.com', date },
    },
    author: { login: 'gen' },
    parents: parents.map((p) => ({ sha: p })),
  }
}

function fakeSha(prefix: string, n: number): string {
  return (prefix + n.toString(16).padStart(4, '0')).padEnd(40, 'c')
}

/** A linear trunk of n synthetic commits, newest first, each pointing at the next (the last at an unfetched one). */
function linearTrunk(n: number) {
  return Array.from({ length: n }, (_, i) =>
    rawCommit(fakeSha('a', i), [fakeSha('a', i + 1)], new Date(Date.UTC(2026, 9, 1, 0, 0, n - i)).toISOString()),
  )
}

function mainOnly(trunk: ReturnType<typeof linearTrunk>) {
  return { name: 'main', commit: { sha: trunk[0].sha, url: '' }, protected: true }
}

/** Serves `trunk` in pages of 100 with a rel="next" Link on every full page but the last. */
function linearTrunkRouter(trunk: ReturnType<typeof linearTrunk>, branches: unknown[]): Router {
  return (url) => {
    if (url.pathname === '/repos/owner/repo') return { body: repoFixture }
    if (url.pathname === '/repos/owner/repo/branches') return { body: branches }
    if (url.pathname === '/repos/owner/repo/commits') {
      const page = Number(url.searchParams.get('page') ?? '1')
      const start = (page - 1) * 100
      const slice = trunk.slice(start, start + 100)
      const last = start + 100 >= trunk.length
      const headers: Record<string, string> = last ? {} : { link: NEXT_LINK }
      return { body: slice, headers }
    }
    return undefined
  }
}

async function expectFetchError(promise: Promise<unknown>): Promise<GitHubFetchError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(GitHubFetchError)
    return err as GitHubFetchError
  }
  throw new Error('expected fetchRepoData to reject')
}

// ---------- tests ----------

describe('fetchRepoData', () => {
  it('assembles branches, commits, truncation markers and progress from the fixtures', async () => {
    const { fetch, calls } = makeFetch(standardRouter)
    const progress: FetchProgress[] = []
    const data = await fetchRepoData(REF, { fetch, onProgress: (p) => progress.push(p) })

    expect(data.owner).toBe('owner')
    expect(data.repo).toBe('repo')
    expect(data.defaultBranch).toBe('main')

    // Branches: default first, then listing order.
    expect(data.branches.map((b) => b.name)).toEqual(['main', 'feature/x', 'old'])
    expect(data.branches.map((b) => b.isDefault)).toEqual([true, false, false])

    const [main, featureX, old] = data.branches
    expect(main).toEqual({
      name: 'main',
      tipSha: M1,
      isDefault: true,
      mergeBaseSha: null,
      aheadBy: 0,
      behindBy: 0,
      tipDate: '2026-10-05T10:00:00Z',
    })
    expect(featureX).toEqual({
      name: 'feature/x',
      tipSha: F2,
      isDefault: false,
      mergeBaseSha: M3,
      aheadBy: 2,
      behindBy: 2,
      tipDate: '2026-10-07T09:00:00Z',
    })
    expect(old).toEqual({
      name: 'old',
      tipSha: M4,
      isDefault: false,
      mergeBaseSha: M4,
      aheadBy: 0,
      behindBy: 3,
      tipDate: '2026-10-02T10:00:00Z',
    })

    // Commit map: merge bases + unique branch commits + trunk, with parents.
    expect(Object.keys(data.commits).sort()).toEqual([M1, M2, M3, M4, M5, F1, F2].sort())
    expect(data.commits[M3]).toEqual({
      sha: M3,
      parents: [M4],
      message: 'Trunk commit 3 (fork point of feature/x)',
      author: 'Alice',
      date: '2026-10-03T10:05:00Z', // committer date wins over author date
      url: `https://github.com/owner/repo/commit/${M3}`,
    })
    expect(data.commits[F1].parents).toEqual([M3])
    expect(data.commits[F2].parents).toEqual([F1])
    expect(data.commits[F2].author).toBe('bob') // commit.author null -> author.login
    expect(data.commits[M5].author).toBe('Alice')
    expect(data.commits[M5].parents).toEqual([ROOT_PARENT])

    // Roots: only the oldest trunk commit has an unfetched parent.
    expect(data.truncatedAt).toEqual([M5])
    expect(data.truncated).toBe(false)

    // Requests: repo + branches + 2 compares + 2 trunk pages.
    expect(calls).toHaveLength(6)
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
    expect(calls.some((c) => c.url.includes('/repos/owner/repo/compare/main...feature%2Fx'))).toBe(true)
    expect(calls.some((c) => c.url.includes('/repos/owner/repo/compare/main...old'))).toBe(true)
    // Compare must stay unpaged so GitHub returns the newest commits with the tip last.
    const compareCalls = calls.filter((c) => c.url.includes('/compare/'))
    expect(compareCalls.every((c) => !new URL(c.url).searchParams.has('per_page'))).toBe(true)
    expect(calls.filter((c) => c.url.includes('/commits?')).map((c) => new URL(c.url).searchParams.get('page'))).toEqual([
      '1',
      '2',
    ])

    // Progress: every stage, requestsUsed never decreases, done last.
    expect(progress.map((p) => p.stage)).toEqual(['repo', 'branches', 'compare', 'compare', 'trunk', 'trunk', 'done'])
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i].requestsUsed).toBeGreaterThanOrEqual(progress[i - 1].requestsUsed)
    }
    expect(progress[0].requestsUsed).toBe(1)
    expect(progress[progress.length - 1]).toMatchObject({
      stage: 'done',
      done: 1,
      total: 1,
      requestsUsed: 6,
      rateLimitRemaining: Number(RATE_REMAINING),
      rateLimitResetAt: RATE_RESET_ISO,
    })
    const compareProgress = progress.filter((p) => p.stage === 'compare')
    expect(compareProgress.map((p) => p.done)).toEqual([1, 2])
    expect(compareProgress.every((p) => p.total === 2)).toBe(true)
    const trunkProgress = progress.filter((p) => p.stage === 'trunk')
    expect(trunkProgress.map((p) => p.done)).toEqual([3, 5])
    expect(trunkProgress.every((p) => p.total === 500)).toBe(true)
    expect(progress.every((p) => typeof p.message === 'string' && p.message.length > 0)).toBe(true)
  })

  it('percent-encodes awkward branch names in the compare path without double-encoding', async () => {
    const names = ['feature/x', 'fix #12', 'rel 100%', 'wip/ünïcode', 'a.b-c_d']
    const branches = [
      { name: 'main', commit: { sha: M1, url: '' }, protected: false },
      ...names.map((name, i) => ({ name, commit: { sha: fakeSha('b', i), url: '' }, protected: false })),
    ]
    const seen: string[] = []
    const router: Router = (url) => {
      if (url.pathname === '/repos/owner/repo') return { body: repoFixture }
      if (url.pathname === '/repos/owner/repo/branches') return { body: branches }
      const m = /^\/repos\/owner\/repo\/compare\/(.+)$/.exec(url.pathname)
      if (m) {
        seen.push(m[1])
        const name = decodeURIComponent(m[1]).replace(/^main\.\.\./, '')
        const idx = names.indexOf(name)
        if (idx === -1) return undefined
        const tip = rawCommit(fakeSha('b', idx), [M1], '2026-10-08T00:00:00Z')
        return {
          body: { ...compareOld, merge_base_commit: rawCommit(M1, [M2], '2026-10-05T10:00:00Z'), ahead_by: 1, behind_by: 0, commits: [tip] },
        }
      }
      if (url.pathname === '/repos/owner/repo/commits') return { body: [rawCommit(M1, [M2], '2026-10-05T10:00:00Z')] }
      return undefined
    }
    const { fetch } = makeFetch(router)
    const data = await fetchRepoData(REF, { fetch })

    expect(seen.sort()).toEqual(
      [
        'main...feature%2Fx',
        'main...fix%20%2312',
        'main...rel%20100%25',
        'main...wip%2F%C3%BCn%C3%AFcode',
        'main...a.b-c_d',
      ].sort(),
    )
    expect(data.branches.map((b) => b.name)).toEqual(['main', ...names])
  })

  it('maps a 404 on the repo lookup to not_found', async () => {
    const { fetch, calls } = makeFetch((url) =>
      url.pathname === '/repos/owner/repo' ? { status: 404, body: { message: 'Not Found' } } : undefined,
    )
    const err = await expectFetchError(fetchRepoData(REF, { fetch }))
    expect(err.code).toBe('not_found')
    expect(err.message).toContain('owner/repo')
    expect(calls).toHaveLength(1)
  })

  it('maps a 403 with x-ratelimit-remaining 0 to rate_limited with resetAt', async () => {
    const reset = '1760003600'
    const { fetch } = makeFetch(
      () => ({
        status: 403,
        body: { message: 'API rate limit exceeded for 1.2.3.4.', documentation_url: 'https://docs.github.com/rest' },
      }),
      { remaining: '0', reset },
    )
    const progress: FetchProgress[] = []
    const err = await expectFetchError(fetchRepoData(REF, { fetch, onProgress: (p) => progress.push(p) }))
    expect(err.code).toBe('rate_limited')
    expect(err.resetAt).toBe(new Date(Number(reset) * 1000).toISOString())
    expect(err.message).toMatch(/rate limit/i)
    expect(err.message).toMatch(/token/i)
  })

  it('honours retry-after over x-ratelimit-reset on a secondary rate limit and omits the token hint', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))
    try {
      const { fetch } = makeFetch(
        () => ({
          status: 403,
          body: { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' },
          headers: { 'retry-after': '60' },
        }),
        { remaining: '4999', reset: String(Math.floor(Date.now() / 1000) + 3500) },
      )
      const err = await expectFetchError(fetchRepoData(REF, { fetch }))
      expect(err.code).toBe('rate_limited')
      expect(err.resetAt).toBe('2026-10-09T10:01:00.000Z')
      expect(err.message).toMatch(/secondary rate limit/i)
      expect(err.message).toContain('2026-10-09T10:01:00.000Z')
      expect(err.message).not.toMatch(/personal access token/i)

      // retry-after alone (generic message, quota left) is enough to classify as rate_limited.
      const terse = makeFetch(
        () => ({ status: 403, body: { message: 'Forbidden' }, headers: { 'retry-after': '30' } }),
        { remaining: '4999', reset: String(Math.floor(Date.now() / 1000) + 3500) },
      )
      const e2 = await expectFetchError(fetchRepoData(REF, { fetch: terse.fetch }))
      expect(e2.code).toBe('rate_limited')
      expect(e2.resetAt).toBe('2026-10-09T10:00:30.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts an HTTP-date retry-after and still prefers it over x-ratelimit-reset', async () => {
    const { fetch } = makeFetch(
      () => ({
        status: 429,
        body: { message: 'You have exceeded a secondary rate limit.' },
        headers: { 'retry-after': 'Fri, 09 Oct 2026 10:02:00 GMT' },
      }),
      { remaining: '4999', reset: '1760003600' },
    )
    const err = await expectFetchError(fetchRepoData(REF, { fetch }))
    expect(err.code).toBe('rate_limited')
    expect(err.resetAt).toBe('2026-10-09T10:02:00.000Z')
    expect(err.message).toMatch(/secondary/i)
  })

  it('keeps the token hint for a primary limit only when no token was given', async () => {
    const make = () =>
      makeFetch(() => ({ status: 403, body: { message: 'API rate limit exceeded for user ID 1.' } }), {
        remaining: '0',
        reset: '1760003600',
      })
    const anon = await expectFetchError(fetchRepoData(REF, { fetch: make().fetch }))
    expect(anon.code).toBe('rate_limited')
    expect(anon.message).toMatch(/^GitHub API rate limit exceeded/)
    expect(anon.message).toMatch(/personal access token/i)
    expect(anon.resetAt).toBe(new Date(1760003600 * 1000).toISOString())

    const withToken = await expectFetchError(fetchRepoData(REF, { fetch: make().fetch, token: 'ghp_example' }))
    expect(withToken.code).toBe('rate_limited')
    expect(withToken.message).toMatch(/^GitHub API rate limit exceeded/)
    expect(withToken.message).not.toMatch(/personal access token/i)
  })

  it('treats a 429 as rate_limited and a plain 403 as unauthorized', async () => {
    const tooMany = makeFetch(() => ({ status: 429, body: { message: 'Too Many Requests' } }), { remaining: '12' })
    const e1 = await expectFetchError(fetchRepoData(REF, { fetch: tooMany.fetch }))
    expect(e1.code).toBe('rate_limited')

    const forbidden = makeFetch(() => ({ status: 403, body: { message: 'Resource not accessible by integration' } }), {
      remaining: '12',
    })
    const e2 = await expectFetchError(fetchRepoData(REF, { fetch: forbidden.fetch }))
    expect(e2.code).toBe('unauthorized')
  })

  it('maps 401 to unauthorized, sends the token, and never leaks it in the error', async () => {
    const token = 'ghp_SECRET_TOKEN_VALUE_1234567890'
    const { fetch, calls } = makeFetch(() => ({ status: 401, body: { message: `Bad credentials ${token}` } }))
    const err = await expectFetchError(fetchRepoData(REF, { fetch, token }))
    expect(err.code).toBe('unauthorized')
    expect(err.message).not.toContain(token)
    expect(calls[0].headers.get('authorization')).toBe(`token ${token}`)
  })

  it('maps a 409 (empty repository) to empty_repo', async () => {
    const empty = {
      status: 409,
      body: { message: 'Git Repository is empty.', documentation_url: 'https://docs.github.com/rest/commits/commits#list-commits' },
    }
    const run = async (branchesRoute: Route) => {
      const { fetch, calls } = makeFetch((url) => {
        if (url.pathname === '/repos/owner/repo') return { body: repoFixture }
        if (url.pathname === '/repos/owner/repo/branches') return branchesRoute
        if (url.pathname === '/repos/owner/repo/commits') return empty
        return undefined
      })
      const progress: FetchProgress[] = []
      const err = await expectFetchError(fetchRepoData(REF, { fetch, onProgress: (p) => progress.push(p) }))
      return { err, calls, progress }
    }

    // GitHub answers 409 on the branch listing too; the paginate plugin swallows that one.
    const a = await run(empty)
    expect(a.err.code).toBe('empty_repo')
    expect(a.err.message).toContain('owner/repo')
    expect(a.err.message).toMatch(/no commits/i)
    expect(a.calls).toHaveLength(3)
    expect(a.progress.some((p) => p.stage === 'branches' && p.message === 'Listed 0 branches')).toBe(true)
    expect(a.progress.some((p) => p.stage === 'trunk')).toBe(false)

    // Same outcome when the listing is an ordinary empty 200.
    const b = await run({ body: [] })
    expect(b.err.code).toBe('empty_repo')
    expect(b.calls).toHaveLength(3)
  })

  it('maps a thrown fetch failure to network', async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    const err = await expectFetchError(fetchRepoData(REF, { fetch }))
    expect(err.code).toBe('network')
  })

  it('maps an aborted signal to aborted', async () => {
    const controller = new AbortController()
    const inner = makeFetch(standardRouter)
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (href.includes('/branches')) controller.abort()
      return inner.fetch(input, init)
    }
    const err = await expectFetchError(fetchRepoData(REF, { fetch, signal: controller.signal }))
    expect(err.code).toBe('aborted')
    expect(inner.calls.length).toBeLessThanOrEqual(2)
    // The signal must have been forwarded to fetch.
    expect(inner.calls.length).toBeGreaterThan(0)
  })

  it('skips a branch whose compare 404s and still returns the others', async () => {
    const { fetch, calls } = makeFetch((url, init) => {
      if (url.pathname.includes('/compare/main...old')) return { status: 404, body: { message: 'Not Found' } }
      return standardRouter(url, init)
    })
    const progress: FetchProgress[] = []
    const data = await fetchRepoData(REF, { fetch, onProgress: (p) => progress.push(p) })

    expect(data.branches.map((b) => b.name)).toEqual(['main', 'feature/x'])
    expect(data.commits[F2]).toBeDefined()
    // 'old' contributed nothing, but the trunk still contains its tip commit.
    expect(data.commits[M4]).toBeDefined()
    // A vanished branch is not missing history, so the data is not flagged as truncated.
    expect(data.truncated).toBe(false)
    expect(calls).toHaveLength(6)
    const skip = progress.find((p) => p.stage === 'compare' && /skipped/i.test(p.message))
    expect(skip).toBeDefined()
    expect(skip?.message).toContain('old')
    expect(progress.filter((p) => p.stage === 'compare').map((p) => p.done)).toEqual([1, 2])
    expect(progress[progress.length - 1].stage).toBe('done')
  })

  it('skips a branch whose compare 500s (after one retry), flags truncation and still returns the others', async () => {
    const { fetch, calls } = makeFetch((url, init) => {
      if (url.pathname.includes('/compare/main...old')) return { status: 500, body: { message: 'Server Error' } }
      return standardRouter(url, init)
    })
    const progress: FetchProgress[] = []
    const data = await fetchRepoData(REF, { fetch, onProgress: (p) => progress.push(p) })

    expect(data.branches.map((b) => b.name)).toEqual(['main', 'feature/x'])
    expect(data.commits[F2]).toBeDefined()
    expect(data.truncated).toBe(true)
    // repo + branches + feature/x compare + old compare twice (one retry) + 2 trunk pages
    expect(calls).toHaveLength(7)
    expect(calls.filter((c) => c.url.includes('/compare/main...old'))).toHaveLength(2)
    const skip = progress.find((p) => p.stage === 'compare' && /skipped .*old.*HTTP 500/i.test(p.message))
    expect(skip).toBeDefined()
    expect(skip?.message).toMatch(/too large/i)
    expect(progress.filter((p) => p.stage === 'compare').map((p) => p.done)).toEqual([1, 2])
    expect(progress[progress.length - 1].stage).toBe('done')
    expect(progress[progress.length - 1].requestsUsed).toBe(7)
  })

  it('recovers when a compare 502s once and then succeeds, without flagging truncation', async () => {
    let oldCompares = 0
    const { fetch, calls } = makeFetch((url, init) => {
      if (url.pathname.includes('/compare/main...old')) {
        oldCompares += 1
        if (oldCompares === 1) return { status: 502, body: { message: 'Bad Gateway' } }
      }
      return standardRouter(url, init)
    })
    const progress: FetchProgress[] = []
    const data = await fetchRepoData(REF, { fetch, onProgress: (p) => progress.push(p) })

    expect(data.branches.map((b) => b.name)).toEqual(['main', 'feature/x', 'old'])
    expect(data.truncated).toBe(false)
    expect(calls).toHaveLength(7)
    expect(progress.some((p) => /skipped/i.test(p.message))).toBe(false)
  })

  it('skips a branch whose compare 422s without retrying and flags truncation', async () => {
    const { fetch, calls } = makeFetch((url, init) => {
      if (url.pathname.includes('/compare/main...old')) return { status: 422, body: { message: 'Validation Failed' } }
      return standardRouter(url, init)
    })
    const progress: FetchProgress[] = []
    const data = await fetchRepoData(REF, { fetch, onProgress: (p) => progress.push(p) })

    expect(data.branches.map((b) => b.name)).toEqual(['main', 'feature/x'])
    expect(data.truncated).toBe(true)
    expect(calls).toHaveLength(6)
    const skip = progress.find((p) => p.stage === 'compare' && /skipped .*old.*HTTP 422/i.test(p.message))
    expect(skip).toBeDefined()
    expect(skip?.message).not.toMatch(/too large/i)
    expect(progress.filter((p) => p.stage === 'compare').map((p) => p.done)).toEqual([1, 2])
    expect(progress[progress.length - 1].stage).toBe('done')
  })

  it('still fails the whole fetch when a compare hits a network error or a rate limit', async () => {
    const inner = makeFetch(standardRouter)
    const dropped: typeof globalThis.fetch = async (input, init) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (href.includes('/compare/')) throw new TypeError('fetch failed')
      return inner.fetch(input, init)
    }
    const e1 = await expectFetchError(fetchRepoData(REF, { fetch: dropped }))
    expect(e1.code).toBe('network')

    const limited = makeFetch(
      (url, init) =>
        url.pathname.includes('/compare/')
          ? { status: 403, body: { message: 'API rate limit exceeded for 1.2.3.4.' } }
          : standardRouter(url, init),
      { remaining: '0' },
    )
    const e2 = await expectFetchError(fetchRepoData(REF, { fetch: limited.fetch }))
    expect(e2.code).toBe('rate_limited')
  })

  it('falls back to the first trunk commit when the listed default-branch sha was rewritten before the trunk walk', async () => {
    const STALE = 'dead0000dead0000dead0000dead0000dead0000'
    const { fetch } = makeFetch((url, init) => {
      if (url.pathname === '/repos/owner/repo/branches') {
        return {
          body: branchesFixture.map((b) => (b.name === 'main' ? { ...b, commit: { ...b.commit, sha: STALE } } : b)),
        }
      }
      return standardRouter(url, init)
    })
    const data = await fetchRepoData(REF, { fetch })

    expect(data.commits[STALE]).toBeUndefined()
    expect(data.branches[0]).toMatchObject({ name: 'main', isDefault: true, tipSha: M1, tipDate: '2026-10-05T10:00:00Z' })
    expect(data.branches.every((b) => b.tipSha in data.commits)).toBe(true)
  })

  it('prefers the listed default-branch sha whenever the trunk walk fetched it', async () => {
    const { fetch } = makeFetch((url, init) => {
      if (url.pathname === '/repos/owner/repo/branches') {
        return {
          body: branchesFixture.map((b) => (b.name === 'main' ? { ...b, commit: { ...b.commit, sha: M2 } } : b)),
        }
      }
      return standardRouter(url, init)
    })
    const data = await fetchRepoData(REF, { fetch })

    expect(data.branches[0]).toMatchObject({ name: 'main', isDefault: true, tipSha: M2, tipDate: data.commits[M2].date })
    expect(data.branches.every((b) => b.tipSha in data.commits)).toBe(true)
  })

  it('caps the branch list at maxBranches, keeps the default branch and reports the drop', async () => {
    const { fetch, calls } = makeFetch(standardRouter)
    const progress: FetchProgress[] = []
    const data = await fetchRepoData(REF, { fetch, maxBranches: 2, onProgress: (p) => progress.push(p) })

    expect(data.truncated).toBe(true)
    expect(data.branches.map((b) => b.name)).toEqual(['main', 'feature/x'])
    expect(calls.filter((c) => c.url.includes('/compare/'))).toHaveLength(1)
    const capMessage = progress.find((p) => p.stage === 'branches' && /dropped 1 branch/.test(p.message))
    expect(capMessage).toBeDefined()
  })

  it('stops the trunk walk at trunkLimit and flags truncation', async () => {
    const { fetch, calls } = makeFetch(standardRouter)
    const data = await fetchRepoData(REF, { fetch, trunkLimit: 3 })

    expect(data.truncated).toBe(true)
    expect(calls.filter((c) => c.url.includes('/commits?'))).toHaveLength(1)
    // M4 came from old's merge base, M5 never arrived, so M4 is a root; M5 is absent.
    expect(data.commits[M4]).toBeDefined()
    expect(data.commits[M5]).toBeUndefined()
    expect(data.truncatedAt).toEqual([M4])
  })

  it('stops the trunk walk early once 100 commits cover every merge base', async () => {
    const trunk = Array.from({ length: 150 }, (_, i) =>
      rawCommit(fakeSha('a', i), [fakeSha('a', i + 1)], new Date(Date.UTC(2026, 9, 1, 0, 0, 150 - i)).toISOString()),
    )
    const mergeBase = trunk[50]
    const tip = rawCommit(fakeSha('f', 1), [mergeBase.sha], '2026-10-09T00:00:00Z')
    const branches = [
      { name: 'feature/x', commit: { sha: tip.sha, url: '' }, protected: false },
      { name: 'main', commit: { sha: trunk[0].sha, url: '' }, protected: false },
    ]
    const router: Router = (url) => {
      if (url.pathname === '/repos/owner/repo') return { body: repoFixture }
      if (url.pathname === '/repos/owner/repo/branches') return { body: branches }
      if (url.pathname.startsWith('/repos/owner/repo/compare/')) {
        return { body: { ...compareOld, merge_base_commit: mergeBase, ahead_by: 1, behind_by: 50, commits: [tip] } }
      }
      if (url.pathname === '/repos/owner/repo/commits') {
        const page = url.searchParams.get('page') ?? '1'
        if (page === '1') return { body: trunk.slice(0, 100), headers: { link: NEXT_LINK } }
        if (page === '2') return { body: trunk.slice(100) }
      }
      return undefined
    }
    const { fetch, calls } = makeFetch(router)
    const data = await fetchRepoData(REF, { fetch })

    expect(calls.filter((c) => c.url.includes('/commits?'))).toHaveLength(1)
    expect(data.truncated).toBe(true)
    expect(Object.keys(data.commits)).toHaveLength(101)
    expect(data.truncatedAt).toEqual([trunk[99].sha])
    expect(data.branches[1]).toMatchObject({ name: 'feature/x', mergeBaseSha: mergeBase.sha, tipSha: tip.sha })
  })

  it('keeps walking the trunk past 100 commits while a merge base is still uncovered', async () => {
    const trunk = Array.from({ length: 150 }, (_, i) =>
      rawCommit(fakeSha('a', i), [fakeSha('a', i + 1)], new Date(Date.UTC(2026, 9, 1, 0, 0, 150 - i)).toISOString()),
    )
    const mergeBase = trunk[120]
    const tip = rawCommit(fakeSha('f', 1), [mergeBase.sha], '2026-10-09T00:00:00Z')
    const branches = [
      { name: 'feature/x', commit: { sha: tip.sha, url: '' }, protected: false },
      { name: 'main', commit: { sha: trunk[0].sha, url: '' }, protected: false },
    ]
    const router: Router = (url) => {
      if (url.pathname === '/repos/owner/repo') return { body: repoFixture }
      if (url.pathname === '/repos/owner/repo/branches') return { body: branches }
      if (url.pathname.startsWith('/repos/owner/repo/compare/')) {
        return { body: { ...compareOld, merge_base_commit: mergeBase, ahead_by: 1, behind_by: 120, commits: [tip] } }
      }
      if (url.pathname === '/repos/owner/repo/commits') {
        const page = url.searchParams.get('page') ?? '1'
        if (page === '1') return { body: trunk.slice(0, 100), headers: { link: NEXT_LINK } }
        if (page === '2') return { body: trunk.slice(100) }
      }
      return undefined
    }
    const { fetch, calls } = makeFetch(router)
    const data = await fetchRepoData(REF, { fetch })

    expect(calls.filter((c) => c.url.includes('/commits?'))).toHaveLength(2)
    expect(data.truncated).toBe(false)
    expect(Object.keys(data.commits)).toHaveLength(151)
    expect(data.truncatedAt).toEqual([trunk[149].sha])
  })

  it('walks a trunk-only repo to trunkLimit instead of stopping at 100', async () => {
    const trunk = linearTrunk(250)
    const { fetch, calls } = makeFetch(linearTrunkRouter(trunk, [mainOnly(trunk)]))
    const data = await fetchRepoData(REF, { fetch })

    expect(calls.filter((c) => c.url.includes('/commits?'))).toHaveLength(3)
    expect(Object.keys(data.commits)).toHaveLength(250)
    expect(data.truncated).toBe(false)
    expect(data.truncatedAt).toEqual([trunk[249].sha])
    expect(data.branches).toHaveLength(1)
  })

  it('still caps a trunk-only repo at an explicit trunkLimit', async () => {
    const trunk = linearTrunk(250)
    const { fetch, calls } = makeFetch(linearTrunkRouter(trunk, [mainOnly(trunk)]))
    const data = await fetchRepoData(REF, { fetch, trunkLimit: 150 })

    expect(calls.filter((c) => c.url.includes('/commits?'))).toHaveLength(2)
    expect(Object.keys(data.commits)).toHaveLength(150)
    expect(data.truncated).toBe(true)
    expect(data.truncatedAt).toEqual([trunk[149].sha])
  })

  it('keeps walking the trunk when every compare was skipped (no merge base known)', async () => {
    const trunk = linearTrunk(250)
    const branches = [mainOnly(trunk), { name: 'gone', commit: { sha: fakeSha('f', 9), url: '' }, protected: false }]
    // No compare route for 'gone', so the fake fetch answers 404 and the branch is skipped.
    const { fetch, calls } = makeFetch(linearTrunkRouter(trunk, branches))
    const data = await fetchRepoData(REF, { fetch })

    expect(data.branches.map((b) => b.name)).toEqual(['main'])
    expect(calls.filter((c) => c.url.includes('/commits?'))).toHaveLength(3)
    expect(Object.keys(data.commits)).toHaveLength(250)
    expect(data.truncated).toBe(false)
  })

  it('flags a branch whose unique commits GitHub capped and records the oldest returned sha', async () => {
    const { fetch } = makeFetch((url, init) => {
      if (url.pathname.includes('/compare/main...feature%2Fx')) {
        // A real capped response: the oldest returned commit's parent was not returned.
        return {
          body: {
            ...compareFeatureX,
            ahead_by: 7,
            total_commits: 7,
            commits: [{ ...compareFeatureX.commits[0], parents: [{ sha: UNFETCHED }] }, compareFeatureX.commits[1]],
          },
        }
      }
      return standardRouter(url, init)
    })
    const data = await fetchRepoData(REF, { fetch })

    expect(data.truncated).toBe(true)
    expect(data.truncatedAt).toContain(F1)
    expect(data.truncatedAt).toContain(M5)
    expect(data.branches[1]).toMatchObject({ name: 'feature/x', aheadBy: 7, tipSha: F2 })
  })

  it('does not mark a capped compare as a root when another branch supplied the missing parent', async () => {
    const M0 = fakeSha('a', 0)
    const S1 = fakeSha('b', 1)
    const S2 = fakeSha('b', 2)
    const L3 = fakeSha('b', 3)
    const L4 = fakeSha('b', 4)
    const base = rawCommit(M0, [], '2026-10-01T00:00:00Z')
    const chain = [
      rawCommit(S1, [M0], '2026-10-02T00:00:00Z'),
      rawCommit(S2, [S1], '2026-10-03T00:00:00Z'),
      rawCommit(L3, [S2], '2026-10-04T00:00:00Z'),
      rawCommit(L4, [L3], '2026-10-05T00:00:00Z'),
    ]
    const branches = [
      { name: 'main', commit: { sha: M0, url: '' }, protected: true },
      { name: 'short', commit: { sha: S2, url: '' }, protected: false },
      { name: 'long', commit: { sha: L4, url: '' }, protected: false },
    ]
    const router: Router = (url) => {
      if (url.pathname === '/repos/owner/repo') return { body: repoFixture }
      if (url.pathname === '/repos/owner/repo/branches') return { body: branches }
      if (url.pathname === '/repos/owner/repo/compare/main...short') {
        return { body: { ...compareOld, merge_base_commit: base, ahead_by: 2, behind_by: 0, total_commits: 2, commits: chain.slice(0, 2) } }
      }
      if (url.pathname === '/repos/owner/repo/compare/main...long') {
        return { body: { ...compareOld, merge_base_commit: base, ahead_by: 4, behind_by: 0, total_commits: 4, commits: chain } }
      }
      if (url.pathname === '/repos/owner/repo/commits') return { body: [base] }
      return undefined
    }
    const { fetch } = makeFetch(router)
    const data = await fetchRepoData(REF, { fetch, branchLimit: 2 })

    // 'long' was cut to [L3, L4], but S2 (L3's parent) arrived through 'short', so nothing is a root.
    expect(data.truncated).toBe(true)
    expect(Object.keys(data.commits).sort()).toEqual([M0, S1, S2, L3, L4].sort())
    expect(data.commits[L3].parents).toEqual([S2])
    expect(data.truncatedAt).toEqual([])
    const full = buildGraph(data, 'full')
    expect(full.nodes.find((n) => n.id === L3)?.isRoot).toBe(false)
    expect(full.links.some((l) => l.source === L3 && l.target === S2)).toBe(true)
  })

  it('honours branchLimit by keeping only the newest unique commits', async () => {
    const { fetch } = makeFetch(standardRouter)
    const data = await fetchRepoData(REF, { fetch, branchLimit: 1 })

    expect(data.commits[F2]).toBeDefined()
    expect(data.commits[F1]).toBeUndefined()
    expect(data.truncated).toBe(true)
    expect(data.truncatedAt).toContain(F2)
    expect(data.branches[1]).toMatchObject({ name: 'feature/x', tipSha: F2, tipDate: '2026-10-07T09:00:00Z' })
  })

  it('parses the rate-limit headers into every progress event', async () => {
    const { fetch } = makeFetch(standardRouter, { remaining: '77', reset: '1760009999' })
    const progress: FetchProgress[] = []
    await fetchRepoData(REF, { fetch, onProgress: (p) => progress.push(p) })
    expect(progress.every((p) => p.rateLimitRemaining === 77)).toBe(true)
    expect(progress.every((p) => p.rateLimitResetAt === new Date(1760009999 * 1000).toISOString())).toBe(true)
  })
})
