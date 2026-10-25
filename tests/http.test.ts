/**
 * The shared HTTP helpers (src/api/http.ts): toFetchError's wording for a user subject (person mode)
 * next to the repo wording it must leave byte-identical, and createCountingClient, the Octokit every
 * REST fetcher counts its requests with. GitHub is faked; no request leaves the process.
 */
import { describe, expect, it, vi } from 'vitest'
import { createCountingClient, toFetchError, type ErrorContext, type RateState } from '../src/api/http'
import { GitHubFetchError } from '../src/types'

const LOGIN = 'octocat'
const USER = { login: LOGIN }
const REPO = { owner: 'owner', repo: 'repo' }
/** Made up for these tests; shaped like a classic token so a leak would be easy to spot. */
const TOKEN = 'ghp_TEST_ONLY_NOT_A_REAL_TOKEN_0123456'
const RESET = '1760003600'
const RESET_ISO = new Date(Number(RESET) * 1000).toISOString()

// ---------- a fake GitHub ----------

type Answer = { status?: number; body: unknown; headers?: Record<string, string> }

interface Call {
  url: string
  headers: Headers
}

/** A fetch that answers each call from `answer`, or throws what it returns when that is an Error. */
function fakeFetch(answer: (url: URL, n: number) => Answer | Error) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url: href, headers: new Headers(init?.headers) })
    if (init?.signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }
    const got = answer(new URL(href), calls.length - 1)
    if (got instanceof Error) throw got
    return new Response(JSON.stringify(got.body), {
      status: got.status ?? 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '59',
        'x-ratelimit-reset': RESET,
        ...got.headers,
      },
    })
  }
  return { fetch, calls }
}

function freshState(): RateState {
  return { requestsUsed: 0, remaining: null, resetAt: null }
}

/** What the identity call throws, raw, before any mapping. */
async function rawFailure(fetch: typeof globalThis.fetch, opts: { token?: string; signal?: AbortSignal } = {}): Promise<unknown> {
  const octokit = createCountingClient({ ...opts, fetch }, freshState())
  try {
    await octokit.users.getByUsername({ username: LOGIN })
  } catch (err) {
    return err
  }
  throw new Error('expected the request to fail')
}

function userCtx(extra: Partial<ErrorContext> = {}): ErrorContext {
  return { what: `reading the profile of ${LOGIN}`, subject: USER, ...extra }
}

/** A plain stand-in for an Octokit RequestError: toFetchError reads only these fields. */
function httpError(status: number, message: string, headers: Record<string, string> = {}) {
  return { name: 'HttpError', status, message, response: { headers } }
}

// ---------- toFetchError ----------

describe('toFetchError with a user subject', () => {
  it('words a 404 for a user, keeping the login as typed', async () => {
    const { fetch } = fakeFetch(() => ({ status: 404, body: { message: 'Not Found' } }))
    const err = toFetchError(await rawFailure(fetch), userCtx())
    expect(err).toBeInstanceOf(GitHubFetchError)
    expect(err.code).toBe('not_found')
    expect(err.message).toBe('octocat was not found. Check the spelling.')

    const cased = toFetchError(httpError(404, 'Not Found'), userCtx({ subject: { login: 'OctoCat' } }))
    expect(cased.message).toBe('OctoCat was not found. Check the spelling.')
  })

  it('maps a primary rate limit to rate_limited with resetAt, and the token hint only without a token', async () => {
    const limited = () =>
      fakeFetch(() => ({
        status: 403,
        body: { message: 'API rate limit exceeded for 1.2.3.4.' },
        headers: { 'x-ratelimit-remaining': '0' },
      }))
    const anon = toFetchError(await rawFailure(limited().fetch), userCtx())
    expect(anon.code).toBe('rate_limited')
    expect(anon.resetAt).toBe(RESET_ISO)
    expect(anon.message).toBe(
      `GitHub API rate limit exceeded while reading the profile of octocat. Retry after ${RESET_ISO}. ` +
        'Add a personal access token to raise the limit from 60 to 5000 requests per hour.',
    )

    const withToken = toFetchError(await rawFailure(limited().fetch, { token: TOKEN }), userCtx({ token: TOKEN }))
    expect(withToken.code).toBe('rate_limited')
    expect(withToken.message).toBe(`GitHub API rate limit exceeded while reading the profile of octocat. Retry after ${RESET_ISO}.`)
  })

  it('maps a secondary rate limit to rate_limited, timed by retry-after', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))
    try {
      const { fetch } = fakeFetch(() => ({
        status: 429,
        body: { message: 'You have exceeded a secondary rate limit.' },
        headers: { 'retry-after': '60' },
      }))
      const err = toFetchError(await rawFailure(fetch), userCtx())
      expect(err.code).toBe('rate_limited')
      expect(err.resetAt).toBe('2026-10-09T10:01:00.000Z')
      expect(err.message).toBe(
        'GitHub API secondary rate limit exceeded while reading the profile of octocat. Retry after 2026-10-09T10:01:00.000Z.',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps a thrown fetch failure to network', async () => {
    const { fetch } = fakeFetch(() => new TypeError('fetch failed'))
    const err = toFetchError(await rawFailure(fetch), userCtx())
    expect(err.code).toBe('network')
    expect(err.message).toMatch(/^Network error while reading the profile of octocat: /)
    expect(err.message).toContain('fetch failed')
  })

  it('maps an aborted signal to aborted, whatever was thrown', async () => {
    const controller = new AbortController()
    controller.abort()
    const { fetch, calls } = fakeFetch(() => ({ body: {} }))
    const raw = await rawFailure(fetch, { signal: controller.signal })
    expect(calls).toHaveLength(1)
    const err = toFetchError(raw, userCtx({ signal: controller.signal }))
    expect(err.code).toBe('aborted')
    expect(err.message).toBe('Fetch aborted while reading the profile of octocat')

    // An aborted signal wins over the status of the error in hand.
    expect(toFetchError(httpError(404, 'Not Found'), userCtx({ signal: controller.signal })).code).toBe('aborted')
  })

  it('maps a 401 to unauthorized, with or without a token', async () => {
    const { fetch } = fakeFetch(() => ({ status: 401, body: { message: 'Requires authentication' } }))
    const anon = toFetchError(await rawFailure(fetch), userCtx())
    expect(anon.code).toBe('unauthorized')
    expect(anon.message).toBe('GitHub rejected the credentials (401) while reading the profile of octocat. Authentication is required.')

    const bad = toFetchError(await rawFailure(fetch, { token: TOKEN }), userCtx({ token: TOKEN }))
    expect(bad.code).toBe('unauthorized')
    expect(bad.message).toBe('GitHub rejected the credentials (401) while reading the profile of octocat. The token is invalid or expired.')
  })

  it('keeps a 409 unexpected: an empty repo is repo-only', () => {
    const err = toFetchError(httpError(409, 'Conflict'), userCtx())
    expect(err.code).toBe('unknown')
    expect(err.message).toBe('Unexpected error while reading the profile of octocat (HTTP 409): Conflict')
  })

  it('never puts the token in a message, even when GitHub or fetch echoes it', async () => {
    const echoes: Array<Answer | Error> = [
      { status: 401, body: { message: `Bad credentials ${TOKEN}` } },
      { status: 403, body: { message: `Resource not accessible by ${TOKEN}` } },
      { status: 500, body: { message: `Server error near ${TOKEN}` } },
      new TypeError(`fetch failed for ${TOKEN}`),
    ]
    const codes: string[] = []
    for (const echo of echoes) {
      const { fetch, calls } = fakeFetch(() => echo)
      const raw = await rawFailure(fetch, { token: TOKEN })
      // The token did travel, in the header it belongs in.
      expect(calls[0].headers.get('authorization')).toBe(`token ${TOKEN}`)
      const err = toFetchError(raw, userCtx({ token: TOKEN }))
      codes.push(err.code)
      expect(err.message).not.toContain(TOKEN)
    }
    expect(codes).toEqual(['unauthorized', 'unauthorized', 'unknown', 'network'])
  })

  it('passes a GitHubFetchError through untouched', () => {
    const original = new GitHubFetchError('already mapped', 'not_a_user')
    expect(toFetchError(original, userCtx())).toBe(original)
  })
})

describe('toFetchError with a repo subject', () => {
  const what = 'looking up owner/repo'
  const repoCtx = (extra: Partial<ErrorContext> = {}): ErrorContext => ({ what, subject: REPO, ...extra })

  // Every repo message, spelled out in full: person mode must not change a byte of them.
  const cases: Array<{ name: string; err: unknown; token?: string; code: string; message: string }> = [
    {
      name: '404',
      err: httpError(404, 'Not Found'),
      code: 'not_found',
      message: 'owner/repo was not found while looking up owner/repo. It may be private, renamed or misspelled.',
    },
    {
      name: '409',
      err: httpError(409, 'Git Repository is empty.'),
      code: 'empty_repo',
      message: 'owner/repo has no commits yet (GitHub answered 409 while looking up owner/repo).',
    },
    {
      name: 'primary rate limit',
      err: httpError(403, 'API rate limit exceeded', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': RESET }),
      code: 'rate_limited',
      message:
        `GitHub API rate limit exceeded while looking up owner/repo. Retry after ${RESET_ISO}. ` +
        'Add a personal access token to raise the limit from 60 to 5000 requests per hour.',
    },
    {
      name: 'primary rate limit with a token',
      err: httpError(403, 'API rate limit exceeded', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': RESET }),
      token: TOKEN,
      code: 'rate_limited',
      message: `GitHub API rate limit exceeded while looking up owner/repo. Retry after ${RESET_ISO}.`,
    },
    {
      name: 'secondary rate limit',
      err: httpError(429, 'Too Many Requests', { 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': RESET }),
      code: 'rate_limited',
      message: `GitHub API secondary rate limit exceeded while looking up owner/repo. Retry after ${RESET_ISO}.`,
    },
    {
      name: '403 refusal',
      err: httpError(403, `Resource not accessible by ${TOKEN}`),
      token: TOKEN,
      code: 'unauthorized',
      message: 'GitHub refused the request (403) while looking up owner/repo: Resource not accessible by [REDACTED]',
    },
    {
      name: '401 without a token',
      err: httpError(401, 'Requires authentication'),
      code: 'unauthorized',
      message: 'GitHub rejected the credentials (401) while looking up owner/repo. Authentication is required.',
    },
    {
      name: '401 with a token',
      err: httpError(401, 'Bad credentials'),
      token: TOKEN,
      code: 'unauthorized',
      message: 'GitHub rejected the credentials (401) while looking up owner/repo. The token is invalid or expired.',
    },
    {
      name: 'network (Octokit wrapped)',
      err: { name: 'HttpError', status: 500, message: 'fetch failed' },
      code: 'network',
      message: 'Network error while looking up owner/repo: fetch failed',
    },
    {
      name: 'network (bare TypeError)',
      err: new TypeError('Failed to fetch'),
      code: 'network',
      message: 'Network error while looking up owner/repo: Failed to fetch',
    },
    {
      name: 'abort',
      err: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      code: 'aborted',
      message: 'Fetch aborted while looking up owner/repo',
    },
    {
      name: 'unexpected status',
      err: httpError(502, 'Bad Gateway'),
      code: 'unknown',
      message: 'Unexpected error while looking up owner/repo (HTTP 502): Bad Gateway',
    },
    {
      name: 'unexpected throw',
      err: new Error('boom'),
      code: 'unknown',
      message: 'Unexpected error while looking up owner/repo: boom',
    },
  ]

  for (const c of cases) {
    it(`keeps the ${c.name} message byte-identical`, () => {
      const err = toFetchError(c.err, repoCtx({ token: c.token }))
      expect(err.code).toBe(c.code)
      expect(err.message).toBe(c.message)
    })
  }

  it('words everything but the 404 and the 409 the same for a user', () => {
    for (const c of cases) {
      if (c.name === '404' || c.name === '409') continue
      const asUser = toFetchError(c.err, { what, subject: USER, token: c.token })
      expect(asUser.code).toBe(c.code)
      expect(asUser.message).toBe(c.message)
    }
  })
})

// ---------- createCountingClient ----------

describe('createCountingClient', () => {
  it('counts every attempt, answered or not, and notes the rate headers of each answer', async () => {
    const { fetch } = fakeFetch((_url, n): Answer | Error => {
      if (n === 0) return { body: { login: LOGIN, type: 'User' }, headers: { 'x-ratelimit-remaining': '59' } }
      if (n === 1) return { status: 404, body: { message: 'Not Found' }, headers: { 'x-ratelimit-remaining': '58' } }
      if (n === 2) return new TypeError('fetch failed')
      return {
        status: 403,
        body: { message: 'API rate limit exceeded' },
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1760007200' },
      }
    })
    const state = freshState()
    const octokit = createCountingClient({ fetch }, state)

    await octokit.users.getByUsername({ username: LOGIN })
    expect(state).toEqual({ requestsUsed: 1, remaining: 59, resetAt: RESET_ISO })

    await expect(octokit.users.getByUsername({ username: 'missing' })).rejects.toMatchObject({ status: 404 })
    expect(state).toEqual({ requestsUsed: 2, remaining: 58, resetAt: RESET_ISO })

    // A fetch that never reached GitHub still counts, and leaves the last known budget alone.
    await expect(octokit.users.getByUsername({ username: LOGIN })).rejects.toThrow(/fetch failed/)
    expect(state).toEqual({ requestsUsed: 3, remaining: 58, resetAt: RESET_ISO })

    // A rate-limit refusal carries the headers wanted most.
    await expect(octokit.users.getByUsername({ username: LOGIN })).rejects.toMatchObject({ status: 403 })
    expect(state).toEqual({ requestsUsed: 4, remaining: 0, resetAt: new Date(1760007200 * 1000).toISOString() })
  })

  it('counts each page of a paginated listing', async () => {
    const next = '<https://api.github.com/users/octocat/repos?per_page=100&page=2>; rel="next"'
    const { fetch, calls } = fakeFetch((url) =>
      url.searchParams.get('page') === '2' ? { body: [{ name: 'b' }] } : { body: [{ name: 'a' }], headers: { link: next } },
    )
    const state = freshState()
    const octokit = createCountingClient({ fetch }, state)
    const names: string[] = []
    for await (const page of octokit.paginate.iterator(octokit.repos.listForUser, { username: LOGIN, per_page: 100 })) {
      for (const r of page.data) names.push(r.name)
    }
    expect(names).toEqual(['a', 'b'])
    expect(calls).toHaveLength(2)
    expect(state.requestsUsed).toBe(2)
  })

  it('sends a token trimmed, and no authorization without one', async () => {
    const withToken = fakeFetch(() => ({ body: {} }))
    await createCountingClient({ fetch: withToken.fetch, token: `  ${TOKEN}\n` }, freshState()).users.getByUsername({ username: LOGIN })
    expect(withToken.calls[0].headers.get('authorization')).toBe(`token ${TOKEN}`)

    for (const token of [undefined, '', '   ']) {
      const anon = fakeFetch(() => ({ body: {} }))
      await createCountingClient({ fetch: anon.fetch, token }, freshState()).users.getByUsername({ username: LOGIN })
      expect(anon.calls[0].headers.get('authorization')).toBeNull()
    }
  })

  it('keeps each client on the state it was given', async () => {
    const { fetch } = fakeFetch(() => ({ body: {} }))
    const a = freshState()
    const b = freshState()
    const clientA = createCountingClient({ fetch }, a)
    const clientB = createCountingClient({ fetch }, b)
    await clientA.users.getByUsername({ username: LOGIN })
    await clientA.users.getByUsername({ username: LOGIN })
    await clientB.users.getByUsername({ username: LOGIN })
    expect(a.requestsUsed).toBe(2)
    expect(b.requestsUsed).toBe(1)
  })
})
