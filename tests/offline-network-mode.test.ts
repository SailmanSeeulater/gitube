import { afterEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query'
import { GitHubFetchError } from '../src/types'
import { REPO_QUERY_NETWORK_MODE, shouldRetryRepoQuery, toFetchError } from '../src/hooks/useRepoData'

type Result = ReturnType<QueryObserver<unknown, Error>['getCurrentResult']>

/** Same defaults as src/main.tsx, so the observer sees what the app's QueryClient would apply. */
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 } },
  })
}

/** Subscribe (which starts the fetch) and resolve with the first result that satisfies `until`. */
function observe(observer: QueryObserver<unknown, Error>, until: (r: Result) => boolean, timeoutMs: number): Promise<Result> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`query did not settle within ${timeoutMs} ms: ${JSON.stringify(observer.getCurrentResult())}`))
    }, timeoutMs)
    const unsubscribe = observer.subscribe((r) => {
      if (until(r)) {
        clearTimeout(timer)
        unsubscribe()
        resolve(r)
      }
    })
  })
}

describe('useRepoData query options while the browser reports offline', () => {
  afterEach(() => {
    onlineManager.setOnline(true)
  })

  it("with the hook's networkMode the fetch runs, retries once and lands in a 'network' error", async () => {
    onlineManager.setOnline(false)
    const client = makeClient()
    let calls = 0
    const observer = new QueryObserver<unknown, Error>(client, {
      queryKey: ['repo', 'owner', 'repo', 'anon'],
      queryFn: async () => {
        calls += 1
        // what src/api/github.ts throws when fetch itself fails
        throw new GitHubFetchError('Network error while looking up owner/repo: fetch failed', 'network')
      },
      retry: shouldRetryRepoQuery,
      retryDelay: 10,
      networkMode: REPO_QUERY_NETWORK_MODE,
    })
    const result = await observe(observer, (r) => r.status === 'error', 2000)

    expect(calls).toBe(2)
    expect(result.fetchStatus).toBe('idle')
    expect(result.isFetching).toBe(false)
    expect(result.isPaused).toBe(false)
    expect(toFetchError(result.error)?.code).toBe('network')
    // App.tsx renders the ErrorCard on `error && !isFetching`; that condition now holds.
    expect(result.error !== null && !result.isFetching).toBe(true)
    client.clear()
  })

  it("documents why: TanStack's default 'online' mode pauses silently with no error and no fetch", async () => {
    onlineManager.setOnline(false)
    const client = makeClient()
    let calls = 0
    const observer = new QueryObserver<unknown, Error>(client, {
      queryKey: ['repo', 'owner', 'repo', 'anon'],
      queryFn: async () => {
        calls += 1
        throw new GitHubFetchError('fetch failed', 'network')
      },
      retry: shouldRetryRepoQuery,
      retryDelay: 10,
    })
    // Subscribing is what starts the fetch; a query that pauses straight away never notifies
    // a change, so read the result directly after giving the retryer a moment.
    const unsubscribe = observer.subscribe(() => {})
    await new Promise((resolve) => setTimeout(resolve, 50))
    const result = observer.getCurrentResult()
    unsubscribe()

    expect(calls).toBe(0)
    expect(result.isFetching).toBe(false)
    expect(result.isPaused).toBe(true)
    expect(result.error).toBeNull()
    expect(result.data).toBeUndefined()
    client.clear()
  })

  it('shouldRetryRepoQuery retries once and only for network/unknown errors', () => {
    expect(shouldRetryRepoQuery(0, new GitHubFetchError('x', 'network'))).toBe(true)
    expect(shouldRetryRepoQuery(0, new GitHubFetchError('x', 'unknown'))).toBe(true)
    expect(shouldRetryRepoQuery(0, new Error('plain'))).toBe(true) // wrapped as 'unknown'
    expect(shouldRetryRepoQuery(1, new GitHubFetchError('x', 'network'))).toBe(false)
    for (const code of ['not_found', 'rate_limited', 'unauthorized', 'invalid_url', 'aborted', 'empty_repo'] as const) {
      expect(shouldRetryRepoQuery(0, new GitHubFetchError('x', code))).toBe(false)
    }
  })
})
