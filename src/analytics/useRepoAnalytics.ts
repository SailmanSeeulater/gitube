/**
 * The repo garden's analytics events that follow fetches rather than clicks: grow, fetch-error and
 * pr-overlay. The click events are sent where the click is handled. See analytics/umami.ts.
 *
 * grow counts requests, not fetches: Grow, refresh and a share link each ask for a repo, and the
 * event goes once that request has settled. A token change, a background refetch, a battle's
 * challenger or a saved file opened sends none by itself. The decisions are plain classes (RepoAnalytics
 * and its counters), so they can be tested without React; useRepoAnalytics only feeds them.
 */
import { useCallback, useEffect, useState } from 'react'
import type { RepoRef } from '../api/parseRepoUrl'
import type { GitHubFetchError, PullIndex, RepoData } from '../types'
import type { PullsStatus } from '../hooks/usePulls'
import { useGardenStore } from '../store/useGardenStore'
import { track, type EventData } from './umami'

/** Branch counts in coarse buckets: enough to see what size of repo people grow. */
export function branchBucket(count: number): string {
  if (count <= 1) return '1'
  if (count <= 5) return '2-5'
  if (count <= 20) return '6-20'
  if (count <= 50) return '21-50'
  if (count <= 100) return '51-100'
  return '101+'
}

/**
 * The grow event for a repo on show. The repo is named only for a live fetch without a token, the
 * one case that proves it public: a cached copy may have been fetched with a token since removed.
 */
export function growEventData(data: Pick<RepoData, 'owner' | 'repo' | 'branches'>, cached: boolean, token: boolean): EventData {
  const event: EventData = { mode: 'repo', branches: branchBucket(data.branches.length), cached, token }
  if (!token && !cached) event.repo = `${data.owner}/${data.repo}`
  return event
}

/** The fetched repo on show (never a garden opened from a file), as useRepoData has it. */
export interface RepoOnShow {
  data: Pick<RepoData, 'owner' | 'repo' | 'branches'> | undefined
  /** when it was fetched; changes with every fetch, a refresh's included */
  fetchedAt: string | null
  cachedAt: string | null
  isFetching: boolean
  error: GitHubFetchError | null
}

/** GitHub owner and repo names are case-insensitive. */
function sameRepo(a: RepoRef, b: RepoRef): boolean {
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
}

/**
 * Counts requests to grow a repo. A request is armed with what was on show when it was made, and
 * counted once it has settled: nothing is fetching and its repo is on show, fetched since. A new
 * error drops it uncounted; a request made since replaces it.
 */
export class GrowCounter {
  private armed: { target: RepoRef; fetchedAt: string | null; error: GitHubFetchError | null } | null = null

  /** A request to grow target (Grow, refresh or a share link), made while current was on show. */
  arm(target: RepoRef, current: RepoOnShow): void {
    const shown = current.data !== undefined && sameRepo(current.data, target)
    this.armed = { target, fetchedAt: shown ? current.fetchedAt : null, error: current.error }
  }

  /** The grow event once the armed request has settled with a new fetch of its repo; null otherwise. */
  observe(state: RepoOnShow, token: boolean): EventData | null {
    const armed = this.armed
    // A fetch in flight settles the request later, whatever error is still on show meanwhile.
    if (armed === null || state.isFetching) return null
    if (state.error !== null && state.error !== armed.error) {
      this.armed = null
      return null
    }
    const { data, fetchedAt } = state
    if (!data || !sameRepo(data, armed.target) || fetchedAt === null || fetchedAt === armed.fetchedAt) return null
    this.armed = null
    return growEventData(data, state.cachedAt !== null, token)
  }
}

/**
 * Counts answers from GitHub about a repo's open pull requests, by repo and the answer's fetchedAt.
 * A lookup lays one pull request's review and checks into a new index with the same fetchedAt, and
 * the same answer shown again from the query's cache is not a new one either.
 */
export class PrOverlayCounter {
  private readonly counted = new Set<string>()

  /** The pr-overlay event for an answer not counted yet: on with rings drawn, off without; null otherwise. */
  observe(repo: RepoRef | undefined, status: PullsStatus, index: PullIndex | null, markCount: number): EventData | null {
    if (repo === undefined || status !== 'ready' || index === null) return null
    const key = `${repo.owner}/${repo.repo}@${index.fetchedAt}`.toLowerCase()
    if (this.counted.has(key)) return null
    this.counted.add(key)
    return { state: markCount > 0 ? 'on' : 'off' }
  }
}

/**
 * Counts failed loads of the repo on show, once each and only once nothing is fetching: TanStack
 * shows a query's old error again while it fetches that query anew (a repo shown again, a token
 * removed), and that fetch may well succeed.
 */
export class FetchErrorCounter {
  private counted: GitHubFetchError | null = null

  /** The fetch-error event for an error not counted yet, once its fetch has settled; null otherwise. */
  observe(error: GitHubFetchError | null, isFetching: boolean): EventData | null {
    if (error === null || isFetching || error === this.counted) return null
    this.counted = error
    return { code: error.code }
  }
}

export interface RepoAnalyticsState extends RepoOnShow {
  pullsStatus: PullsStatus
  pullsIndex: PullIndex | null
  /** tips the overlay draws a ring on */
  prMarkCount: number
}

export type RepoAnalyticsEvent = ['grow' | 'fetch-error' | 'pr-overlay', EventData]

/**
 * Everything useRepoAnalytics decides, without React: the hook feeds it each committed state and
 * sends what comes back. A request (noteGrow) is armed with the state last observed, the one on
 * screen when it was made.
 */
export class RepoAnalytics {
  private readonly grows = new GrowCounter()
  private readonly errors = new FetchErrorCounter()
  private readonly overlays = new PrOverlayCounter()
  private shown: RepoOnShow

  /** initialRepo: a share link's repo, asked for from the first render. */
  constructor(initial: RepoOnShow, initialRepo: RepoRef | null = null) {
    this.shown = initial
    if (initialRepo) this.grows.arm(initialRepo, initial)
  }

  noteGrow(ref: RepoRef): void {
    this.grows.arm(ref, this.shown)
  }

  observe(state: RepoAnalyticsState, token: boolean): RepoAnalyticsEvent[] {
    const { data, fetchedAt, cachedAt, isFetching, error } = state
    this.shown = { data, fetchedAt, cachedAt, isFetching, error }
    const events: RepoAnalyticsEvent[] = []
    const grow = this.grows.observe(this.shown, token)
    if (grow) events.push(['grow', grow])
    const failed = this.errors.observe(error, isFetching)
    if (failed) events.push(['fetch-error', failed])
    const overlay = this.overlays.observe(data, state.pullsStatus, state.pullsIndex, state.prMarkCount)
    if (overlay) events.push(['pr-overlay', overlay])
    return events
  }
}

interface RepoAnalyticsInput extends RepoAnalyticsState {
  data: RepoData | undefined
  /** a share link's repo, grown from the first render: read once */
  initialRepo?: RepoRef | null
}

/**
 * Sends grow, fetch-error and pr-overlay as the repo on show changes. Returns noteGrow (stable),
 * which Grow and refresh call with the repo they ask for.
 */
export function useRepoAnalytics(input: RepoAnalyticsInput): (ref: RepoRef) => void {
  const { data, fetchedAt, cachedAt, isFetching, error, pullsStatus, pullsIndex, prMarkCount } = input
  const [analytics] = useState(() => new RepoAnalytics(input, input.initialRepo ?? null))
  useEffect(() => {
    const state = { data, fetchedAt, cachedAt, isFetching, error, pullsStatus, pullsIndex, prMarkCount }
    for (const [event, eventData] of analytics.observe(state, useGardenStore.getState().token !== '')) track(event, eventData)
  }, [analytics, data, fetchedAt, cachedAt, isFetching, error, pullsStatus, pullsIndex, prMarkCount])
  return useCallback((ref: RepoRef) => analytics.noteGrow(ref), [analytics])
}
