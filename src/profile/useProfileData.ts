/**
 * Person mode's data: one user's ProfileData through TanStack Query, the way useRepoData grows a
 * repo. A profile fetched in this browser within a day is shown from the cache at no API cost
 * (api/profileCache.ts, through loadProfile), until refetch asks GitHub again.
 *
 * The query key holds the lowercased login and the tier, never the token: a token added or removed
 * is another query (the cache keeps the tiers apart too), and a login typed in another case is the
 * same one.
 */
import { useCallback, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RateInfo } from '../api/http'
import { loadProfile } from '../api/profile'
import { browserProfileStore, type ProfileStore, type ProfileTier } from '../api/profileCache'
import { shouldRetryRepoQuery, toFetchError } from '../hooks/useRepoData'
import { useGardenStore } from '../store/useGardenStore'
import type { FetchProgress, GitHubFetchError, ProfileData } from '../types'

export interface ProfileResult {
  profile: ProfileData
  /** when the cached copy was fetched (ISO); null for a live fetch */
  cachedAt: string | null
}

export interface UseProfileDataResult {
  profile: ProfileData | undefined
  /** When the profile came from this browser's cache: the ISO time it was fetched. null for a live fetch. */
  cachedAt: string | null
  /** When the profile on show was fetched from GitHub (ISO): cachedAt for a cached copy; null without one. */
  fetchedAt: string | null
  /** Always a GitHubFetchError (unexpected errors are wrapped with code 'unknown'). */
  error: GitHubFetchError | null
  isFetching: boolean
  /** True while the first fetch for this key is in flight and no profile exists yet. */
  isPending: boolean
  /** Fetches from GitHub again, skipping the cache. */
  refetch: () => void
}

/**
 * The repo garden's REPO_QUERY_NETWORK_MODE (hooks/useRepoData.ts), for the same reason: offline,
 * the fetch fails fast with a 'network' error card instead of pausing in silence. A copy rather than
 * an import, which would be one more name the first download exports; a test keeps them equal.
 */
export const PROFILE_QUERY_NETWORK_MODE = 'always' as const

/** ['profile', login lowercased, tier]: whether a token is set, never its value, is part of the key. */
export function profileQueryKey(login: string, token: string): readonly ['profile', string, ProfileTier] {
  return ['profile', login.toLowerCase(), token.trim() ? 'graphql' : 'rest'] as const
}

/** What a profile query needs from the app; tests hand in their own. */
export interface ProfileQueryDeps {
  /** the token as set, '' when none */
  token: string
  setProgress: (progress: FetchProgress | null) => void
  noteRate: (rate: RateInfo | null) => void
  /** the profile cache, or null where there is none */
  store: () => ProfileStore | null
  /** Whether this run skips the cache (refetch asked for it); clears the request. */
  takeLive: () => boolean
  /** Fetch implementation handed to Octokit; tests inject a fake. */
  fetch?: typeof globalThis.fetch
  /** The clock (ms since the epoch); defaults to Date.now(). */
  now?: () => number
}

/** Anything with a slash in it: a repo is named owner/name, and links can name one too. */
const SLASHED = /\S*\/\S*/g

/**
 * The query function for login. The strip shows 'starting' until the first progress arrives, not
 * an earlier run's last message; every live fetch refreshes the cache (loadProfile).
 */
export function profileQueryFn(login: string, deps: ProfileQueryDeps): (ctx: { signal: AbortSignal }) => Promise<ProfileResult> {
  return ({ signal }) => {
    deps.setProgress(null)
    return loadProfile(login, {
      token: deps.token || undefined,
      store: deps.store(),
      live: deps.takeLive(),
      signal,
      fetch: deps.fetch,
      now: deps.now?.(),
      onProgress: (progress) => {
        // A GraphQL fallback's progress quotes GitHub's error verbatim, and the strip shows it: a
        // private repo name must not reach the page that way, so anything slashed goes.
        const message = progress.message.replace(SLASHED, '…')
        deps.setProgress(message === progress.message ? progress : { ...progress, message })
        // core requests only (GraphQL points never reach it): the budget the repo garden spends too
        if (progress.rateLimitRemaining !== null) {
          deps.noteRate({ remaining: progress.rateLimitRemaining, limit: null, resetAt: progress.rateLimitResetAt })
        }
      },
    })
  }
}

/** The query options useProfileData passes, so tests can observe the very same query. */
export function profileQueryOptions(login: string, deps: ProfileQueryDeps) {
  return {
    queryKey: profileQueryKey(login, deps.token),
    queryFn: profileQueryFn(login, deps),
    retry: shouldRetryRepoQuery,
    networkMode: PROFILE_QUERY_NETWORK_MODE,
  }
}

let shared: ProfileStore | null | undefined

/** This browser's profile store, made once. */
function sharedProfileStore(): ProfileStore | null {
  if (shared === undefined) shared = browserProfileStore()
  return shared
}

/**
 * Fetches login's profile through TanStack Query, streaming FetchProgress into the store. A copy
 * fetched in this browser within a day is shown instead, at no API cost, until refetch asks GitHub.
 */
export function useProfileData(login: string): UseProfileDataResult {
  const token = useGardenStore((s) => s.token)
  const setProgress = useGardenStore((s) => s.setProgress)
  const noteRate = useGardenStore((s) => s.noteRate)
  /** set by refetch: the next run skips the cache */
  const liveRef = useRef(false)

  const takeLive = useCallback(() => {
    const live = liveRef.current
    liveRef.current = false
    return live
  }, [])
  const query = useQuery<ProfileResult, Error>(
    profileQueryOptions(login, { token, setProgress, noteRate, store: sharedProfileStore, takeLive }),
  )

  const error = useMemo(() => toFetchError(query.error), [query.error])
  const queryRefetch = query.refetch
  const refetch = useCallback(() => {
    liveRef.current = true
    void queryRefetch()
  }, [queryRefetch])

  return {
    profile: query.data?.profile,
    cachedAt: query.data?.cachedAt ?? null,
    fetchedAt: query.data ? (query.data.cachedAt ?? new Date(query.dataUpdatedAt).toISOString()) : null,
    error,
    isFetching: query.isFetching,
    isPending: query.isPending,
    refetch,
  }
}
