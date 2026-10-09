import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRepoData } from '../api/github'
import type { RepoRef } from '../api/parseRepoUrl'
import { GitHubFetchError, type FetchProgress, type RepoData } from '../types'
import { useGardenStore } from '../store/useGardenStore'

export interface UseRepoDataResult {
  data: RepoData | undefined
  /** Always a GitHubFetchError (unexpected errors are wrapped with code 'unknown'). */
  error: GitHubFetchError | null
  isFetching: boolean
  /** True while the first fetch for this key is in flight and no data exists yet. */
  isPending: boolean
  refetch: () => void
}

/** ['repo', owner, repo, 'auth' | 'anon'] — token presence, never the token value, is part of the key. */
export function repoQueryKey(ref: RepoRef | null, token: string): readonly ['repo', string, string, 'auth' | 'anon'] {
  return ['repo', ref?.owner ?? '', ref?.repo ?? '', token ? 'auth' : 'anon'] as const
}

/** Narrow anything thrown by the fetch layer to a GitHubFetchError. */
export function toFetchError(err: unknown): GitHubFetchError | null {
  if (err === null || err === undefined) return null
  if (err instanceof GitHubFetchError) return err
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return new GitHubFetchError('Fetch aborted', 'aborted')
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return new GitHubFetchError(err.message || 'Fetch aborted', 'aborted')
    return new GitHubFetchError(err.message || 'Unknown error', 'unknown')
  }
  return new GitHubFetchError(String(err), 'unknown')
}

/**
 * Run the fetch even when the browser reports itself offline. TanStack's default 'online'
 * mode pauses the query silently (fetchStatus 'paused': isFetching false, error null), which
 * leaves App in the empty state with Grow enabled but inert. With 'always' the fetch runs,
 * fails fast with a 'network' error, and the "check your connection" card shows; the next
 * Grow then really refetches. (A paused query would have auto-resumed on reconnect, but the
 * silent in-between state is exactly when the user needs feedback.)
 */
export const REPO_QUERY_NETWORK_MODE = 'always' as const

/** Retry once, and only for errors a second attempt could plausibly fix. */
export function shouldRetryRepoQuery(failureCount: number, err: unknown): boolean {
  const code = toFetchError(err)?.code
  return failureCount < 1 && (code === 'network' || code === 'unknown')
}

const INITIAL_PROGRESS: FetchProgress = {
  stage: 'repo',
  done: 0,
  total: 0,
  message: 'contacting GitHub',
  requestsUsed: 0,
  rateLimitRemaining: null,
  rateLimitResetAt: null,
}

/**
 * Fetches RepoData for the given ref through TanStack Query, streaming FetchProgress into the store.
 * Disabled (idle) while ref is null.
 */
export function useRepoData(ref: RepoRef | null): UseRepoDataResult {
  const token = useGardenStore((s) => s.token)
  const setProgress = useGardenStore((s) => s.setProgress)

  const query = useQuery<RepoData, Error>({
    queryKey: repoQueryKey(ref, token),
    enabled: ref !== null,
    retry: shouldRetryRepoQuery,
    networkMode: REPO_QUERY_NETWORK_MODE,
    queryFn: async ({ signal }) => {
      if (ref === null) throw new GitHubFetchError('No repository selected', 'invalid_url')
      setProgress({ ...INITIAL_PROGRESS })
      return fetchRepoData(ref, {
        token: token || undefined,
        onProgress: setProgress,
        signal,
      })
    },
  })

  const error = useMemo(() => toFetchError(query.error), [query.error])
  const queryRefetch = query.refetch
  const refetch = useCallback(() => {
    void queryRefetch()
  }, [queryRefetch])

  return {
    data: query.data,
    error,
    isFetching: query.isFetching,
    isPending: query.isPending && ref !== null,
    refetch,
  }
}
