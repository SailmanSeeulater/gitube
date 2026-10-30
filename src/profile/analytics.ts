/**
 * Person mode's analytics rules (PROFILE_SPEC.md section 6, "Analytics"). Person mode sends load
 * alone (with mode 'person'); the top bar's own events go as they do in repo mode.
 *
 * load counts requests, as in repo mode: a ?user= link or a switch to person mode, a login loaded
 * from the input (the same one again included) and the refresh button each ask for a profile, and
 * the event goes once that request has settled, from GitHub or the cache. A token change, a
 * background refetch or a view switch sends none by itself. The data is decided from the fetch
 * result, never from the token set now. The decisions are plain classes, tested without React;
 * usePersonAnalytics only feeds them, and every event still goes out through track() in
 * analytics/umami.ts.
 */
import type { EventData } from '../analytics/umami'
import type { GitHubFetchError, ProfileData } from '../types'

/**
 * The load event for a profile on show. source is the tier that filled it, so 'rest' after a
 * GraphQL fallback. The login is named only for a live fetch without a token, as loadEventData does
 * for a repo: a cached copy is never proof of a tokenless fetch, and track() dropping the login
 * under a token is only the backstop.
 */
export function personLoadEventData(profile: Pick<ProfileData, 'login' | 'source'>, cached: boolean, token: boolean): EventData {
  const event: EventData = { mode: 'person', source: profile.source, cached, token }
  if (!token && !cached) event.login = profile.login
  return event
}

/**
 * Whether the profile was fetched with a token, read from the fetch result rather than the token
 * set now, which may have changed since the fetch began. A token run is filled by GraphQL, or by
 * REST with the fallback's reason; a tokenless one by REST with none. The cache keeps each copy
 * under the tier that filled it and never keeps a fallback, so this holds for a cached copy too.
 */
export function fetchedWithToken(profile: Pick<ProfileData, 'source' | 'fallback'>): boolean {
  return profile.source === 'graphql' || profile.fallback !== null
}

/** The profile on show, as useProfileData has it. */
export interface ProfileOnShow {
  profile: Pick<ProfileData, 'login' | 'source' | 'fallback'> | undefined
  /** when it was fetched; changes with every fetch, a refresh's included */
  fetchedAt: string | null
  cachedAt: string | null
  isFetching: boolean
  error: GitHubFetchError | null
}

/** Nothing on show: what a request made as person mode mounts was made over. */
export const NOTHING_ON_SHOW: ProfileOnShow = { profile: undefined, fetchedAt: null, cachedAt: null, isFetching: false, error: null }

/** GitHub logins are case-insensitive. */
function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Counts requests for a profile, as LoadCounter does for a repo. A request is armed with what was
 * on show before it was made, and counted once it has settled: nothing is fetching and its login's
 * profile is on show, fetched since. A new error drops it uncounted; a request made since replaces it.
 */
export class ProfileLoadCounter {
  private armed: { login: string; fetchedAt: string | null; error: GitHubFetchError | null } | null = null

  /**
   * A request for login, made while shown was on show. Another login's profile on show (or none)
   * arms with no fetchedAt, so that login's profile counts even when TanStack still holds it and it
   * shows at once, unchanged.
   */
  arm(login: string, shown: ProfileOnShow): void {
    const same = shown.profile !== undefined && sameLogin(shown.profile.login, login)
    this.armed = { login, fetchedAt: same ? shown.fetchedAt : null, error: shown.error }
  }

  /** The load event once the armed request has settled with a new fetch of its profile; null otherwise. */
  observe(state: ProfileOnShow): EventData | null {
    const armed = this.armed
    // A fetch in flight settles the request later, whatever error is still on show meanwhile.
    if (armed === null || state.isFetching) return null
    if (state.error !== null && state.error !== armed.error) {
      this.armed = null
      return null
    }
    const { profile, fetchedAt } = state
    if (!profile || !sameLogin(profile.login, armed.login) || fetchedAt === null || fetchedAt === armed.fetchedAt) return null
    this.armed = null
    return personLoadEventData(profile, state.cachedAt !== null, fetchedWithToken(profile))
  }
}

/** What person mode shows, and which request it answers. */
export interface PersonAnalyticsState extends ProfileOnShow {
  /** the login asked for, as typed */
  login: string
  /** counts the requests for this login (the router's request): a new one is a new request */
  request: number
}

/**
 * Everything usePersonAnalytics decides, without React: the hook feeds it each committed state and
 * sends what comes back. A new login or request is armed with the state observed before it: nothing
 * at mount, else the profile on screen when it was made. Repeating an observe changes nothing, so
 * StrictMode's doubled effects count once.
 */
export class PersonAnalytics {
  private readonly loads = new ProfileLoadCounter()
  private shown: ProfileOnShow = NOTHING_ON_SHOW
  /** the request last armed, as 'login#request' with the login lowercased */
  private request: string | null = null

  /** The refresh button: login asked for again, armed with the state last observed. */
  noteLoad(login: string): void {
    this.loads.arm(login, this.shown)
  }

  observe(state: PersonAnalyticsState): Array<['load', EventData]> {
    const request = `${state.login.toLowerCase()}#${state.request}`
    if (request !== this.request) {
      this.request = request
      this.loads.arm(state.login, this.shown)
    }
    const { profile, fetchedAt, cachedAt, isFetching, error } = state
    this.shown = { profile, fetchedAt, cachedAt, isFetching, error }
    const load = this.loads.observe(this.shown)
    return load ? [['load', load]] : []
  }
}
