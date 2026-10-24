import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { preload } from '../lazy/chunk'
import { pullsChunk } from '../lazy/parts'
import { branchSignature, needsLookup, withLookup } from '../graph/pulls'
import { remainingNow, type RateInfo } from '../api/http'
import { GitHubFetchError, type PullIndex, type PullSummary, type RepoData } from '../types'
import { useGardenStore } from '../store/useGardenStore'
import { toFetchError } from './useRepoData'

/** An automatic lookup (a tip opened in the inspector, a row selected) waits this long for the selection to settle. */
export const LOOKUP_DEBOUNCE_MS = 300
/** ...and only runs while at least this many core requests are left (or the count is not known yet). */
export const AUTO_LOOKUP_MIN_REMAINING = 15

export type PullsStatus = 'off' | 'loading' | 'ready' | 'error'

export interface PullsError {
  message: string
  code: GitHubFetchError['code']
  resetAt: string | null
  /**
   * which limit a rate_limited error hit: the hourly core requests, a token's hourly GraphQL points,
   * or a secondary limit (a short pause GitHub asks for); null for other errors
   */
  limit: 'core' | 'graphql' | 'secondary' | null
  /** worth a retry from the count line now (not a 404; a rate limit only once its reset time has passed) */
  retriable: boolean
}

export interface PullsView {
  index: PullIndex | null
  status: PullsStatus
  error: PullsError | null
  /** asks GitHub again now */
  retry: () => void
  /** marks the index stale, so it is asked again once the graph's own fetch is done (refresh, Grow) */
  invalidate: () => void
  /** Looks one pull request's review and checks up now (3 core requests). */
  lookup: (pr: PullSummary) => void
  /**
   * The same after LOOKUP_DEBOUNCE_MS, if the budget allows (AUTO_LOOKUP_MIN_REMAINING); returns a
   * cancel for an effect's cleanup.
   */
  autoLookup: (pr: PullSummary) => () => void
  /** pull request numbers being looked up */
  lookingUp: ReadonlySet<number>
  /** pull request number -> why its lookup failed */
  lookupErrors: ReadonlyMap<number, string>
  /** an automatic lookup may spend requests now */
  canAutoLookup: boolean
  hasToken: boolean
  /** the core budget as last reported (null until a response said) */
  rate: RateInfo | null
}

/** ['pulls', owner, repo, 'auth' | 'anon', branch signature]: never the token itself. */
export function pullsQueryKey(data: Pick<RepoData, 'owner' | 'repo' | 'branches'> | null | undefined, token: string) {
  return ['pulls', data?.owner ?? '', data?.repo ?? '', token ? 'auth' : 'anon', data ? branchSignature(data.branches) : ''] as const
}

/** Retry once, for a dropped connection or something unexpected; never into a rate limit. */
export function shouldRetryPulls(failureCount: number, err: unknown): boolean {
  const code = toFetchError(err)?.code
  return failureCount < 1 && (code === 'network' || code === 'unknown')
}

/**
 * What the count line and the inspector say of a failed pull request fetch. A rate limit is worth a
 * retry once its reset time has passed (or when none was given: at most one request, none if the
 * listing is skipped again).
 */
export function describePullsError(err: unknown, now: number = Date.now()): PullsError | null {
  const e = toFetchError(err)
  if (!e) return null
  const at = e.resetAt ? Date.parse(e.resetAt) : NaN
  const limit = e.code !== 'rate_limited' ? null : /secondary/i.test(e.message) ? 'secondary' : /GraphQL/i.test(e.message) ? 'graphql' : 'core'
  return {
    message: e.message,
    code: e.code,
    resetAt: e.resetAt ?? null,
    limit,
    retriable:
      e.code === 'network' || e.code === 'unknown' || e.code === 'unauthorized' || (e.code === 'rate_limited' && (!Number.isFinite(at) || at <= now)),
  }
}

/**
 * How long until a rate limit's reset time has passed, plus a second's slack: when the failed fetch
 * turns retriable (usePulls re-reads its error then). null when it already has, or is not known.
 */
export function resetWakeDelay(resetAt: string | null, now: number = Date.now()): number | null {
  if (!resetAt) return null
  const wait = Date.parse(resetAt) - now
  if (!(wait > 0)) return null
  return Math.min(wait + 1000, 0x7fffffff)
}

/**
 * The open pull requests of the repo on show, for the overlay. Runs once enabled (App: the graph is
 * in, its own fetch is idle, no saved file is open, and a battle's challenger is not loading), with
 * the network code loaded lazily. Kept 5 minutes, never written to the repo cache or saved files.
 */
export function usePulls(data: RepoData | null | undefined, enabled: boolean): PullsView {
  const token = useGardenStore((s) => s.token)
  const noteRate = useGardenStore((s) => s.noteRate)
  const rate = useGardenStore((s) => s.rate)
  const queryClient = useQueryClient()
  const key = useMemo(() => pullsQueryKey(data, token), [data, token])
  const keyRef = useRef(key)
  keyRef.current = key

  const query = useQuery<PullIndex, Error>({
    queryKey: key,
    enabled: enabled && !!data,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    networkMode: 'always',
    retry: shouldRetryPulls,
    queryFn: async ({ signal }) => {
      if (!data) throw new GitHubFetchError('No repository loaded', 'unknown')
      let part
      try {
        part = await pullsChunk.load()
      } catch {
        throw new GitHubFetchError("couldn't load the pull request part of the app (reload the page to try again)", 'network')
      }
      const budget = useGardenStore.getState().rate
      return part.fetchPullIndex({ owner: data.owner, repo: data.repo }, data, {
        token: token || undefined,
        signal,
        onRate: noteRate,
        // a count from an hour that has since reset says nothing
        remaining: remainingNow(budget),
        resetAt: budget?.resetAt ?? null,
      })
    },
  })

  // ---- lookups (no token: review and checks one pull request at a time) ----
  const [lookingUp, setLookingUp] = useState<ReadonlySet<number>>(() => new Set())
  const [lookupErrors, setLookupErrors] = useState<ReadonlyMap<number, string>>(() => new Map())
  const inflight = useRef(new Set<string>())
  // a different repo (or token) starts with no lookups on record
  const keyText = key.join('\u0000')
  const [lookupsFor, setLookupsFor] = useState(keyText)
  if (lookupsFor !== keyText) {
    setLookupsFor(keyText)
    setLookingUp(new Set())
    setLookupErrors(new Map())
  }

  const left = remainingNow(rate)
  const canAutoLookup = left === null || left >= AUTO_LOOKUP_MIN_REMAINING

  const lookup = useCallback(
    (pr: PullSummary) => {
      if (!data) return
      const startKey = keyRef.current
      const tag = `${startKey.join('\u0000')}#${pr.number}`
      if (inflight.current.has(tag)) return
      // answered meanwhile (another view of the same pull request asked first)
      const current = queryClient.getQueryData<PullIndex>(startKey)?.byBranch.get(pr.head)?.find((p) => p.number === pr.number)
      if (current && !needsLookup(current)) return
      inflight.current.add(tag)
      setLookingUp((prev) => new Set(prev).add(pr.number))
      void (async () => {
        try {
          const part = await pullsChunk.load()
          const found = await part.lookupPull({ owner: data.owner, repo: data.repo }, pr, { token: token || undefined, onRate: noteRate })
          queryClient.setQueryData<PullIndex>(startKey, (old) => (old ? withLookup(old, pr.head, pr.number, found) : old))
          setLookupErrors((prev) => {
            if (!prev.has(pr.number)) return prev
            const next = new Map(prev)
            next.delete(pr.number)
            return next
          })
        } catch (err) {
          const message = toFetchError(err)?.message ?? String(err)
          if (keyRef.current === startKey) setLookupErrors((prev) => new Map(prev).set(pr.number, message))
        } finally {
          inflight.current.delete(tag)
          if (keyRef.current === startKey) {
            setLookingUp((prev) => {
              const next = new Set(prev)
              next.delete(pr.number)
              return next
            })
          }
        }
      })()
    },
    [data, token, noteRate, queryClient],
  )

  const autoRef = useRef(canAutoLookup)
  autoRef.current = canAutoLookup
  const autoLookup = useCallback(
    (pr: PullSummary) => {
      const timer = setTimeout(() => {
        if (autoRef.current) lookup(pr)
      }, LOOKUP_DEBOUNCE_MS)
      return () => clearTimeout(timer)
    },
    [lookup],
  )

  const queryRefetch = query.refetch
  const retry = useCallback(() => void queryRefetch(), [queryRefetch])
  const invalidate = useCallback(() => {
    if (!data) return
    void queryClient.invalidateQueries({ queryKey: ['pulls', data.owner, data.repo], refetchType: 'none' })
  }, [data, queryClient])

  // the code comes with the data, so a tip opened later finds its block ready
  useEffect(() => {
    if (data) preload(pullsChunk)
  }, [data])

  const index = query.data ?? null
  // a refetch that fails keeps the index it had: what was read stays on show
  const status: PullsStatus = !data ? 'off' : index ? 'ready' : query.isError && !query.isFetching ? 'error' : enabled || query.isFetching ? 'loading' : 'off'

  // a rate limit turns retriable once its reset time has passed: read the error again then (and,
  // while the overlay is wanted and the page on show, ask once by itself)
  const [tick, setTick] = useState(0)
  const failedReset = status === 'error' ? (toFetchError(query.error)?.resetAt ?? null) : null
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  useEffect(() => {
    const wait = resetWakeDelay(failedReset)
    if (wait === null) return
    const timer = setTimeout(() => {
      setTick((n) => n + 1)
      if (enabledRef.current && (typeof document === 'undefined' || document.visibilityState === 'visible')) void queryRefetch()
    }, wait)
    return () => clearTimeout(timer)
  }, [failedReset, queryRefetch])
  // tick re-reads the error against the clock once its reset time has passed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const error = useMemo(() => (status === 'error' ? describePullsError(query.error, Date.now()) : null), [status, query.error, tick])

  const hasToken = token !== ''
  return useMemo<PullsView>(
    () => ({ index, status, error, retry, invalidate, lookup, autoLookup, lookingUp, lookupErrors, canAutoLookup, hasToken, rate }),
    [index, status, error, retry, invalidate, lookup, autoLookup, lookingUp, lookupErrors, canAutoLookup, hasToken, rate],
  )
}
