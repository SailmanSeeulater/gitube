/**
 * PersonApp's requests for a profile, without React, as RepoApp's Grow handles a repo. The router
 * counts a login's grows (App's request), so a new login or a new request is a new request:
 *
 * - it starts clean, before paint: nothing hidden, selected or revealed (startRequest), and whatever
 *   ends it, a new login or request or PersonApp unmounting, hides private names again;
 * - the same login asked for again is fetched again, live, unless a fetch in flight answers it; a new
 *   login is not, as its own query reads the cache first (RequestTracker);
 * - analytics is fed the request as the router made it (analyticsInput), so a same-login request is
 *   counted once it settles;
 * - the status strip's refresh is a request made in place: noted for analytics, then fetched live
 *   (refreshProfile).
 *
 * A token change is none of these: it changes the query, not the login or the request, so nothing
 * here runs and no grow is noted. PersonApp only wires these to its hooks; the tests drive them as
 * React does.
 */
import type { PersonAnalyticsState, ProfileOnShow } from './analytics'
import type { PersonActions } from './usePersonStore'

/**
 * A request's identity: the login without case (GitHub compares logins so) and the router's count.
 * PersonApp keys its request effects by it alone, so no effect can see a new login and miss a new
 * request, or the other way round. A login holds no '#'.
 */
export function requestKey(login: string, request: number): string {
  return `${login.toLowerCase()}#${request}`
}

/** The lowercased login of a requestKey. */
function ownerOf(key: string): string {
  return key.slice(0, key.lastIndexOf('#'))
}

/** The person store, as a request uses it. */
export type RequestStore = Pick<PersonActions, 'resetFor' | 'setReveal'>

/**
 * A request starts clean: nothing hidden, selected or revealed (resetFor). PersonApp runs this in a
 * layout effect keyed by requestKey, and the cleanup it returns hides private names again when the
 * request ends: replaced by a new login or request, or PersonApp unmounting. The store outlives
 * PersonApp, and a remount's first render reads it before any effect runs, so without the cleanup
 * that render would show the names revealed last time.
 */
export function startRequest(store: RequestStore, key: string): () => void {
  const owner = ownerOf(key)
  store.resetFor(owner)
  return () => store.setReveal(owner, false)
}

/**
 * Says when a request needs a live refetch: the same login asked for again (Grow on the person on
 * show, or an error card's "press Go again"), unless a fetch already in flight answers it. A new
 * login needs none: its own query reads the cache first. PersonApp hands it each commit's
 * requestKey; the first is the mount's, which its query fetches by itself.
 */
export class RequestTracker {
  private last: string

  constructor(first: string) {
    this.last = first
  }

  /** True when key is a new request for the last one's login and nothing is fetching: refetch, live. */
  refetchFor(key: string, isFetching: boolean): boolean {
    const last = this.last
    if (key === last) return false
    this.last = key
    return ownerOf(key) === ownerOf(last) && !isFetching
  }
}

/** What analytics is fed each commit: the request as the router made it, and what is on show. */
export function analyticsInput(login: string, request: number, shown: ProfileOnShow): PersonAnalyticsState {
  const { profile, fetchedAt, cachedAt, isFetching, error } = shown
  return { login, request, profile, fetchedAt, cachedAt, isFetching, error }
}

/** What the status strip's refresh needs: usePersonAnalytics's noteGrow and the query's live refetch. */
export interface RefreshPorts {
  noteGrow: (login: string) => void
  refetch: () => void
}

/**
 * The status strip's refresh: a new request for the person on show, from GitHub. Noted first, armed
 * with what is on show now, so the fetch it starts is counted once it lands.
 */
export function refreshProfile(login: string, ports: RefreshPorts): void {
  ports.noteGrow(login)
  ports.refetch()
}
