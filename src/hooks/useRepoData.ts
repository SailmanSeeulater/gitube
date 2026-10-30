import { useCallback, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRepoData } from '../api/github'
import type { RepoRef } from '../api/parseRepoUrl'
import { readFresh, remember, sharedRepoStore } from '../api/repoCache'
import { GitHubFetchError, type FetchProgress, type RepoData } from '../types'
import { useAppStore } from '../store/useAppStore'

export interface UseRepoDataResult {
  data: RepoData | undefined
  /** When data came from this browser's cache: the ISO time it was fetched. null for a live fetch. */
  cachedAt: string | null
  /** When the data on show was fetched from GitHub (ISO): cachedAt for a cached copy; null without data. */
  fetchedAt: string | null
  /** Always a GitHubFetchError (unexpected errors are wrapped with code 'unknown'). */
  error: GitHubFetchError | null
  isFetching: boolean
  /** True while the first fetch for this key is in flight and no data exists yet. */
  isPending: boolean
  /** Fetches from GitHub again, skipping the cache. */
  refetch: () => void
}

interface RepoResult {
  repo: RepoData
  cachedAt: string | null
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
 * leaves App in the empty state with Go enabled but inert. With 'always' the fetch runs,
 * fails fast with a 'network' error, and the "check your connection" card shows; the next
 * Go then really refetches. (A paused query would have auto-resumed on reconnect, but the
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
 * A copy fetched in this browser within CACHE_FRESH_MS is shown instead, at no API cost, until
 * refetch asks for GitHub. Every live fetch refreshes the cache. Disabled (idle) while ref is null.
 */
export function useRepoData(ref: RepoRef | null): UseRepoDataResult {
  const token = useAppStore((s) => s.token)
  const setProgress = useAppStore((s) => s.setProgress)
  const noteRate = useAppStore((s) => s.noteRate)
  /** set by refetch: the next run skips the cache */
  const liveRef = useRef(false)

  const query = useQuery<RepoResult, Error>({
    queryKey: repoQueryKey(ref, token),
    enabled: ref !== null,
    retry: shouldRetryRepoQuery,
    networkMode: REPO_QUERY_NETWORK_MODE,
    queryFn: async ({ signal }) => {
      if (ref === null) throw new GitHubFetchError('No repository selected', 'invalid_url')
      const live = liveRef.current
      liveRef.current = false
      const repoStore = sharedRepoStore()
      if (!live && repoStore) {
        const hit = await readFresh(repoStore, ref, Date.now())
        if (hit) return { repo: hit.data, cachedAt: hit.savedAt }
      }
      setProgress({ ...INITIAL_PROGRESS })
      const repo = await fetchRepoData(ref, {
        token: token || undefined,
        onProgress: (progress) => {
          setProgress(progress)
          // the graph's requests are all core ones: the same budget the pull request overlay spends
          if (progress.rateLimitRemaining !== null) {
            noteRate({ remaining: progress.rateLimitRemaining, limit: null, resetAt: progress.rateLimitResetAt })
          }
        },
        signal,
      })
      if (repoStore) void remember(repoStore, repo, Date.now())
      return { repo, cachedAt: null }
    },
  })

  const error = useMemo(() => toFetchError(query.error), [query.error])
  const queryRefetch = query.refetch
  const refetch = useCallback(() => {
    liveRef.current = true
    void queryRefetch()
  }, [queryRefetch])

  return {
    data: query.data?.repo,
    cachedAt: query.data?.cachedAt ?? null,
    fetchedAt: query.data ? (query.data.cachedAt ?? new Date(query.dataUpdatedAt).toISOString()) : null,
    error,
    isFetching: query.isFetching,
    isPending: query.isPending && ref !== null,
    refetch,
  }
}
