/**
 * HTTP helpers shared by the GitHub clients (api/github.ts for the graph, api/pulls.ts for the pull
 * request overlay, api/profile.ts for person mode): the counting Octokit, reading response headers,
 * the rate limit they report, Link paging, and mapping whatever Octokit throws to a GitHubFetchError
 * that never carries the token.
 */
import { Octokit } from '@octokit/rest'
import { GitHubFetchError } from '../types'

export type HeaderBag = Record<string, string | number | undefined>

export interface RateState {
  requestsUsed: number
  remaining: number | null
  resetAt: string | null
}

export interface ErrorContext {
  what: string
  signal?: AbortSignal
  token?: string
  /** What the request was about: a repo (repo mode) or a user (person mode). It words the 404. */
  subject: { owner: string; repo: string } | { login: string }
}

/** GitHub's hourly core (REST) budget as one response reported it. */
export interface RateInfo {
  remaining: number
  /** the hour's allowance (60 without a token, 5000 with one); null when not sent */
  limit: number | null
  /** ISO time the window resets; null when not sent */
  resetAt: string | null
}

/** Default page size of the paged endpoints this app reads. */
export const PER_PAGE = 100

export function readHeader(headers: HeaderBag | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const lower = name.toLowerCase()
  const direct = headers[lower] ?? headers[name]
  if (direct !== undefined && direct !== null) return String(direct)
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key]
      return value === undefined || value === null ? undefined : String(value)
    }
  }
  return undefined
}

/**
 * An Octokit that counts every HTTP request it sends in state.requestsUsed, failed ones included,
 * and remembers the most recent rate-limit headers, also from a failed response (a 403 rate-limit
 * response carries the headers wanted). This hook is the only code that counts requests. It notes
 * only the core (REST) budget: a GraphQL answer is counted, but its points are a separate budget
 * and never reach state.remaining or state.resetAt.
 */
export function createCountingClient(
  opts: { token?: string; fetch?: typeof globalThis.fetch; signal?: AbortSignal },
  state: RateState,
): Octokit {
  const octokit = new Octokit({
    auth: opts.token?.trim() || undefined,
    request: { fetch: opts.fetch, signal: opts.signal },
  })
  octokit.hook.wrap('request', async (request, options) => {
    try {
      const response = await request(options)
      state.requestsUsed += 1
      const headers = response.headers as HeaderBag
      if (reportsCore(headers)) noteRateLimit(state, headers)
      return response
    } catch (err) {
      state.requestsUsed += 1
      const headers = (err as { response?: { headers?: HeaderBag } }).response?.headers
      if (headers && reportsCore(headers)) noteRateLimit(state, headers)
      throw err
    }
  })
  return octokit
}

export function noteRateLimit(state: RateState, headers: HeaderBag | undefined): void {
  const remaining = readHeader(headers, 'x-ratelimit-remaining')
  if (remaining !== undefined) {
    const n = Number(remaining)
    state.remaining = Number.isFinite(n) ? n : null
  }
  const reset = parseResetAt(headers)
  if (reset !== null) state.resetAt = reset
}

/** True when a response's rate headers are about the core (REST) budget: x-ratelimit-resource is 'core' or absent. */
function reportsCore(headers: HeaderBag | undefined): boolean {
  const resource = readHeader(headers, 'x-ratelimit-resource')
  return resource === undefined || resource.trim().toLowerCase() === 'core'
}

/**
 * The core (REST) budget a response reports, or null when it reports another one (GraphQL points
 * are a separate budget, and "N requests left" means the core one) or none at all. A response
 * without x-ratelimit-resource counts as core: the REST endpoints always sent it that way.
 */
export function coreRateFromHeaders(headers: HeaderBag | undefined): RateInfo | null {
  if (!reportsCore(headers)) return null
  const remaining = Number(readHeader(headers, 'x-ratelimit-remaining'))
  if (readHeader(headers, 'x-ratelimit-remaining') === undefined || !Number.isFinite(remaining)) return null
  const limitText = readHeader(headers, 'x-ratelimit-limit')
  const limit = limitText === undefined ? null : Number(limitText)
  const resetText = readHeader(headers, 'x-ratelimit-reset')
  const resetSeconds = resetText === undefined ? NaN : Number(resetText)
  return {
    remaining,
    limit: limit !== null && Number.isFinite(limit) ? limit : null,
    resetAt: Number.isFinite(resetSeconds) && resetSeconds > 0 ? new Date(resetSeconds * 1000).toISOString() : null,
  }
}

/**
 * Requests left as a budget last said, or null when that is not known any more: never reported, or
 * its window has reset since (the hour refilled it).
 */
export function remainingNow(rate: RateInfo | null | undefined, now: number = Date.now()): number | null {
  if (!rate) return null
  if (rate.resetAt !== null) {
    const reset = Date.parse(rate.resetAt)
    if (Number.isFinite(reset) && reset <= now) return null
  }
  return rate.remaining
}

/**
 * When the caller may retry, from the response headers. retry-after wins: GitHub only sends
 * it for secondary (abuse) limits, which clear within minutes, whereas x-ratelimit-reset is
 * on every response and points at the hourly primary window. GitHub's docs say to honour
 * retry-after first.
 */
export function parseResetAt(headers: HeaderBag | undefined): string | null {
  const retryAfter = readHeader(headers, 'retry-after')?.trim()
  if (retryAfter !== undefined && retryAfter !== '') {
    const n = Number(retryAfter)
    if (Number.isFinite(n) && n >= 0) return new Date(Date.now() + n * 1000).toISOString()
    const at = Date.parse(retryAfter) // RFC 7231 also allows an HTTP-date
    if (Number.isFinite(at)) return new Date(at).toISOString()
  }
  const reset = readHeader(headers, 'x-ratelimit-reset')
  if (reset !== undefined) {
    const n = Number(reset)
    if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toISOString()
  }
  return null
}

export function errorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

/** True when err carries a real HTTP response (Octokit synthesises status 500 with none for a fetch failure). */
export function hasHttpResponse(err: unknown): boolean {
  return (err as { response?: unknown } | null)?.response !== undefined
}

/** A genuine 5xx answer from GitHub: worth exactly one retry. */
export function isServerErrorResponse(err: unknown): boolean {
  const status = errorStatus(err)
  return hasHttpResponse(err) && status !== undefined && status >= 500 && status < 600
}

export function hasNextLink(headers: HeaderBag | undefined, pageLength: number, perPage = PER_PAGE): boolean {
  const link = readHeader(headers, 'link')
  if (link !== undefined) return /<[^<>]+>;\s*rel="next"/.test(link)
  // No Link header at all: assume more pages only when the page is full.
  return pageLength >= perPage
}

/** The page number of the rel="last" link, or null when there is none. */
export function lastPageFromLink(headers: HeaderBag | undefined): number | null {
  const link = readHeader(headers, 'link')
  if (link === undefined) return null
  for (const part of link.split(',')) {
    const m = /<([^<>]+)>;\s*rel="last"/.exec(part)
    if (!m) continue
    const page = Number(/[?&]page=(\d+)/.exec(m[1])?.[1])
    return Number.isFinite(page) && page > 0 ? page : null
  }
  return null
}

/** Remove the token from any text that might end up in an error message. */
export function scrub(text: string, token: string | undefined): string {
  if (!token) return text
  return text.split(token).join('[REDACTED]')
}

/**
 * Map anything thrown by Octokit (RequestError, AbortError, plain Error) to a GitHubFetchError.
 * Never includes the token.
 */
export function toFetchError(err: unknown, ctx: ErrorContext): GitHubFetchError {
  if (err instanceof GitHubFetchError) return err

  const e = (err ?? {}) as {
    name?: string
    status?: number
    message?: string
    response?: { headers?: HeaderBag; data?: unknown }
    cause?: unknown
  }

  if (ctx.signal?.aborted || e.name === 'AbortError') {
    return new GitHubFetchError(`Fetch aborted while ${ctx.what}`, 'aborted')
  }

  const rawMessage = typeof e.message === 'string' ? e.message : String(err)
  const message = scrub(rawMessage, ctx.token)
  const status = typeof e.status === 'number' ? e.status : undefined
  const headers = e.response?.headers

  // Octokit wraps fetch failures in a RequestError with status 500 and no response.
  if (e.name === 'HttpError' && !e.response) {
    return new GitHubFetchError(`Network error while ${ctx.what}: ${message}`, 'network')
  }
  if (status === undefined && (e.name === 'TypeError' || err instanceof TypeError)) {
    return new GitHubFetchError(`Network error while ${ctx.what}: ${message}`, 'network')
  }

  const subject = ctx.subject
  if (status === 404) {
    if ('login' in subject) return new GitHubFetchError(`${subject.login} was not found. Check the spelling.`, 'not_found')
    return new GitHubFetchError(
      `${subject.owner}/${subject.repo} was not found while ${ctx.what}. It may be private, renamed or misspelled.`,
      'not_found',
    )
  }

  if (status === 403 || status === 429) {
    const remaining = readHeader(headers, 'x-ratelimit-remaining')
    const retryAfter = readHeader(headers, 'retry-after')
    // The hourly primary quota is exhausted only when remaining is 0; a secondary (abuse)
    // limit arrives with retry-after and plenty of quota left, and a token would not help it.
    const primary = remaining === '0'
    const looksRateLimited = status === 429 || primary || retryAfter !== undefined || /rate limit/i.test(message)
    if (looksRateLimited) {
      const resetAt = parseResetAt(headers)
      const kind = primary ? 'rate limit' : 'secondary rate limit'
      const when = resetAt ? ` Retry after ${resetAt}.` : ''
      const hint =
        primary && !ctx.token ? ' Add a personal access token to raise the limit from 60 to 5000 requests per hour.' : ''
      return new GitHubFetchError(`GitHub API ${kind} exceeded while ${ctx.what}.${when}${hint}`, 'rate_limited', resetAt)
    }
    return new GitHubFetchError(
      `GitHub refused the request (403) while ${ctx.what}: ${message}`,
      'unauthorized',
    )
  }

  if (status === 401) {
    const hint = ctx.token ? 'The token is invalid or expired.' : 'Authentication is required.'
    return new GitHubFetchError(`GitHub rejected the credentials (401) while ${ctx.what}. ${hint}`, 'unauthorized')
  }

  // On the repo endpoints wrapped here (repos.get, listBranches, compare, listCommits) the only
  // documented 409 is "Git Repository is empty.", a deterministic state no retry can fix. A user
  // has no such state, so a 409 about one stays unexpected.
  if (status === 409 && 'repo' in subject) {
    return new GitHubFetchError(
      `${subject.owner}/${subject.repo} has no commits yet (GitHub answered 409 while ${ctx.what}).`,
      'empty_repo',
    )
  }

  return new GitHubFetchError(
    `Unexpected error while ${ctx.what}${status !== undefined ? ` (HTTP ${status})` : ''}: ${message}`,
    'unknown',
  )
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight. Stops launching new work after
 * the first failure and rejects with that error once in-flight workers settle.
 */
export async function runPool<T>(
  items: ReadonlyArray<T>,
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0
  let failed = false
  let failure: unknown = undefined

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed) {
      const index = next
      next += 1
      if (index >= items.length) return
      try {
        await worker(items[index], index)
      } catch (err) {
        if (!failed) {
          failed = true
          failure = err
        }
        return
      }
    }
  })

  await Promise.all(runners)
  if (failed) throw failure
}
