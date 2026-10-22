/**
 * A failed pull request fetch, as the count line and the inspector read it (describePullsError): a
 * rate limit says which limit it hit, and turns retriable once its reset time has passed, which
 * usePulls notices by itself (resetWakeDelay times its re-read).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubFetchError } from '../types'
import { describePullsError, resetWakeDelay } from './usePulls'

const NOW = Date.parse('2026-10-22T01:00:00Z')
const past = '2026-10-22T00:59:00Z'
const future = '2026-10-22T01:30:00Z'

afterEach(() => {
  vi.useRealTimers()
})

describe('describePullsError', () => {
  it('a rate limit is retriable once its reset time has passed, not before', () => {
    expect(describePullsError(new GitHubFetchError('x', 'rate_limited', past), NOW)?.retriable).toBe(true)
    expect(describePullsError(new GitHubFetchError('x', 'rate_limited', future), NOW)?.retriable).toBe(false)
    // no reset time given: worth one more try (one request at most; none if the listing is skipped again)
    expect(describePullsError(new GitHubFetchError('x', 'rate_limited', null), NOW)?.retriable).toBe(true)
    expect(describePullsError(new GitHubFetchError('x', 'rate_limited', 'not a date'), NOW)?.retriable).toBe(true)
  })

  it('says which limit was hit', () => {
    const limit = (message: string) => describePullsError(new GitHubFetchError(message, 'rate_limited', future), NOW)?.limit
    expect(limit('GitHub API secondary rate limit exceeded while listing pull requests.')).toBe('secondary')
    expect(limit('GitHub GraphQL rate limit exceeded while reading pull requests.')).toBe('graphql')
    expect(limit('GitHub API rate limit exceeded while listing pull requests.')).toBe('core')
    expect(limit('only 3 GitHub requests left this hour')).toBe('core')
    expect(describePullsError(new GitHubFetchError('x', 'not_found'), NOW)).toMatchObject({ limit: null, retriable: false })
  })

  it('keeps the other codes as they were', () => {
    for (const code of ['network', 'unknown', 'unauthorized'] as const) expect(describePullsError(new GitHubFetchError('x', code), NOW)?.retriable).toBe(true)
    expect(describePullsError(new GitHubFetchError('x', 'not_found'), NOW)?.retriable).toBe(false)
  })
})

describe('resetWakeDelay', () => {
  it('waits until a second past the reset time, and not at all once it has passed', () => {
    expect(resetWakeDelay(future, NOW)).toBe(30 * 60 * 1000 + 1000)
    expect(resetWakeDelay(past, NOW)).toBeNull()
    expect(resetWakeDelay(null, NOW)).toBeNull()
    expect(resetWakeDelay('not a date', NOW)).toBeNull()
    // never past what setTimeout can wait
    expect(resetWakeDelay('2099-01-01T00:00:00Z', NOW)).toBe(0x7fffffff)
  })

  it('wakes the hook when the error has turned retriable, with no new error in between', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const err = new GitHubFetchError('GitHub API rate limit exceeded while listing pull requests.', 'rate_limited', '2026-10-22T01:00:30Z')
    let error = describePullsError(err)
    expect(error?.retriable).toBe(false)
    // as usePulls's effect does: re-read the same error when the timer fires
    const wait = resetWakeDelay(err.resetAt ?? null)
    expect(wait).toBe(31_000)
    setTimeout(() => {
      error = describePullsError(err)
    }, wait ?? 0)
    vi.advanceTimersByTime(30_500)
    expect(error?.retriable).toBe(false)
    vi.advanceTimersByTime(500)
    expect(error?.retriable).toBe(true)
  })
})
