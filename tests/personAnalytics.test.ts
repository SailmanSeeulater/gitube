import { afterEach, describe, expect, it } from 'vitest'
import {
  NOTHING_ON_SHOW,
  PersonAnalytics,
  ProfileLoadCounter,
  fetchedWithToken,
  personLoadEventData,
  type PersonAnalyticsState,
  type ProfileOnShow,
} from '../src/profile/analytics'
import { useAppStore } from '../src/store/useAppStore'
import { GitHubFetchError, type ProfileData } from '../src/types'

const TOKEN = 'ghp_' + 'R8vK2mW5qT9xL3nB7cJ4hF6dS1aG0eY2uI8o'

afterEach(() => {
  useAppStore.setState({ token: '' })
})

/** The only fields the rule reads; a public login, spelt as GitHub spells it. */
const octocat: Pick<ProfileData, 'login' | 'source'> = { login: 'Octocat', source: 'rest' }

describe('personLoadEventData', () => {
  it('names the login only for a live fetch without a token', () => {
    expect(personLoadEventData(octocat, false, false)).toEqual({
      mode: 'person',
      source: 'rest',
      cached: false,
      token: false,
      login: 'Octocat',
    })
  })

  it('never names the login for a profile from the cache', () => {
    // a cached copy is never proof of a tokenless fetch, whatever tier its key names
    expect(personLoadEventData(octocat, true, false)).toEqual({ mode: 'person', source: 'rest', cached: true, token: false })
    expect(personLoadEventData(octocat, true, true)).toEqual({ mode: 'person', source: 'rest', cached: true, token: true })
  })

  it('never names the login under a token, without leaning on track() to drop it', () => {
    // the rule's own output is checked here: track()'s sanitizer is only the backstop
    const event = personLoadEventData(octocat, false, true)
    expect(event).toEqual({ mode: 'person', source: 'rest', cached: false, token: true })
    expect('login' in event).toBe(false)
  })

  it('reports the tier that filled the profile', () => {
    expect(personLoadEventData({ ...octocat, source: 'graphql' }, false, true).source).toBe('graphql')
    expect(personLoadEventData({ ...octocat, source: 'graphql' }, true, true).source).toBe('graphql')
    // a token set but REST filled the profile after a GraphQL fallback: the tier is rest
    expect(personLoadEventData(octocat, false, true).source).toBe('rest')
  })

  it("keeps GitHub's casing of the login", () => {
    // the cache keys by the lowercased login; the event keeps the spelling the profile carries
    expect(personLoadEventData({ login: 'MixedCase-Login', source: 'rest' }, false, false).login).toBe('MixedCase-Login')
  })

  it('carries no other name and no repo', () => {
    for (const cached of [false, true]) {
      for (const token of [false, true]) {
        const keys = Object.keys(personLoadEventData(octocat, cached, token)).sort()
        const expected = ['cached', 'mode', 'source', 'token']
        if (!cached && !token) expected.push('login')
        expect(keys, `cached ${cached}, token ${token}`).toEqual(expected.sort())
      }
    }
  })
})

// ---------- counting load requests ----------

const T1 = '2026-10-25T10:00:00.000Z'
const T2 = '2026-10-25T10:05:00.000Z'
const T3 = '2026-10-25T10:10:00.000Z'
const SAVED = '2026-10-24T09:00:00.000Z'

type Shown = ProfileOnShow['profile'] & {}
const octo: Shown = { login: 'Octocat', source: 'rest', fallback: null }
const kepano: Shown = { login: 'kepano', source: 'graphql', fallback: null }
/** a token run that GraphQL refused, filled by REST */
const fellBack: Shown = { login: 'kepano', source: 'rest', fallback: { message: 'GraphQL rate limit exceeded', limit: 'graphql', resetAt: null } }

const OCTO_EVENT = { mode: 'person', source: 'rest', cached: false, token: false, login: 'Octocat' }
const KEPANO_EVENT = { mode: 'person', source: 'graphql', cached: false, token: true }

const nothing = NOTHING_ON_SHOW
const fetching: ProfileOnShow = { ...nothing, isFetching: true }
/** profile on show, fetched live at fetchedAt unless the rest says otherwise */
const showing = (profile: Shown, fetchedAt: string, rest: Partial<ProfileOnShow> = {}): ProfileOnShow => ({ ...nothing, profile, fetchedAt, ...rest })

describe('fetchedWithToken', () => {
  it('reads the token from what filled the profile', () => {
    expect(fetchedWithToken(octo)).toBe(false)
    expect(fetchedWithToken(kepano)).toBe(true)
    expect(fetchedWithToken(fellBack)).toBe(true)
  })
})

describe('ProfileLoadCounter', () => {
  /** A counter that has already counted octocat, fetched at T1 (and shows it). */
  function loadedOcto() {
    const counter = new ProfileLoadCounter()
    counter.arm('octocat', nothing)
    expect(counter.observe(showing(octo, T1))).toEqual(OCTO_EVENT)
    return counter
  }

  it('counts nothing without a request: a fetch, a token change or a background refetch alone', () => {
    const counter = new ProfileLoadCounter()
    expect(counter.observe(fetching)).toBeNull()
    expect(counter.observe(showing(octo, T1))).toBeNull()

    const loaded = loadedOcto()
    // a token added: the profile is another query, fetched over GraphQL
    expect(loaded.observe(fetching)).toBeNull()
    expect(loaded.observe(showing({ ...octo, source: 'graphql' }, T2))).toBeNull()
    // a background refetch
    expect(loaded.observe(showing(octo, T2, { isFetching: true }))).toBeNull()
    expect(loaded.observe(showing(octo, T3))).toBeNull()
  })

  it("counts a request answered by a profile TanStack still holds, unchanged, once another login's was on show", () => {
    const counter = loadedOcto()
    counter.arm('kepano', showing(octo, T1))
    // kepano was fetched at T1 too, before octocat, and shows at once
    expect(counter.observe(showing(kepano, T1))).toEqual(KEPANO_EVENT)
    expect(counter.observe(showing(kepano, T1))).toBeNull()
  })

  it('matches logins in any case, and waits while another login is on show', () => {
    const counter = new ProfileLoadCounter()
    counter.arm('OCTOCAT', nothing)
    expect(counter.observe(showing(kepano, T1))).toBeNull()
    expect(counter.observe(showing(octo, T1))).toEqual(OCTO_EVENT)
  })

  it('counts a refresh of a cached copy once, as a live fetch', () => {
    const counter = new ProfileLoadCounter()
    const cached = showing(octo, SAVED, { cachedAt: SAVED })
    counter.arm('octocat', nothing)
    expect(counter.observe(cached)).toEqual({ mode: 'person', source: 'rest', cached: true, token: false })

    counter.arm('octocat', cached)
    expect(counter.observe(cached)).toBeNull()
    expect(counter.observe({ ...cached, isFetching: true })).toBeNull()
    expect(counter.observe(showing(octo, T2))).toEqual(OCTO_EVENT)
    expect(counter.observe(showing(octo, T3))).toBeNull()
  })

  it('waits for a fetch in flight, a request made during it included', () => {
    const counter = loadedOcto()
    counter.arm('octocat', showing(octo, T1, { isFetching: true }))
    expect(counter.observe(showing(octo, T1, { isFetching: true }))).toBeNull()
    expect(counter.observe(showing(octo, T2, { isFetching: true }))).toBeNull()
    expect(counter.observe(showing(octo, T2))).toEqual(OCTO_EVENT)
  })

  it('keeps a request made with an error on show armed through that error', () => {
    const counter = new ProfileLoadCounter()
    const limited = new GitHubFetchError('slow down', 'rate_limited')
    const failed: ProfileOnShow = { ...nothing, error: limited }
    counter.arm('kepano', failed)
    expect(counter.observe(failed)).toBeNull()
    expect(counter.observe({ ...failed, isFetching: true })).toBeNull()
    expect(counter.observe(showing(kepano, T1))).toEqual(KEPANO_EVENT)
  })

  it('drops a request a new error answers, but not for an old one shown while it is fetched again', () => {
    const counter = new ProfileLoadCounter()
    counter.arm('octocat', nothing)
    expect(counter.observe(fetching)).toBeNull()
    expect(counter.observe({ ...nothing, error: new GitHubFetchError('slow down', 'rate_limited') })).toBeNull()
    expect(counter.observe(showing(octo, T1))).toBeNull()

    // a failed refetch keeps the profile it had on show
    counter.arm('octocat', showing(octo, T1))
    expect(counter.observe(showing(octo, T1, { error: new GitHubFetchError('offline', 'network') }))).toBeNull()
    expect(counter.observe(showing(octo, T2))).toBeNull()

    // a query that failed before shows its error again while it is fetched again
    counter.arm('kepano', showing(octo, T2))
    const earlier = new GitHubFetchError('kepano was not found. Check the spelling.', 'not_found')
    expect(counter.observe({ ...nothing, error: earlier, isFetching: true })).toBeNull()
    expect(counter.observe(showing(kepano, T3))).toEqual(KEPANO_EVENT)
  })

  it('takes the token from the fetch result, never from the token set now', () => {
    // a token set after a tokenless fetch: the rule still says tokenless (track() drops the name)
    useAppStore.setState({ token: TOKEN })
    const live = new ProfileLoadCounter()
    live.arm('octocat', nothing)
    expect(live.observe(showing(octo, T1))).toEqual(OCTO_EVENT)

    // a token cleared between a token fetch and its arrival: no name goes
    useAppStore.setState({ token: '' })
    for (const profile of [kepano, fellBack]) {
      const counter = new ProfileLoadCounter()
      counter.arm('kepano', nothing)
      const event = counter.observe(showing(profile, T1))
      expect(event).toEqual({ mode: 'person', source: profile.source, cached: false, token: true })
      expect(event && 'login' in event).toBe(false)
    }
  })
})

describe('PersonAnalytics', () => {
  /** person mode's state for login's request, showing on */
  const at = (login: string, request: number, on: ProfileOnShow): PersonAnalyticsState => ({ ...on, login, request })

  it('counts a mount with the profile already on show once, even observed twice', () => {
    // a ?user= link or a switch back from repo mode, the profile still in TanStack's memory
    const analytics = new PersonAnalytics()
    expect(analytics.observe(at('octocat', 0, showing(octo, T1)))).toEqual([['load', OCTO_EVENT]])
    // StrictMode runs the effect again
    expect(analytics.observe(at('octocat', 0, showing(octo, T1)))).toEqual([])
    // person mode mounted again over the same memory: a new request
    expect(new PersonAnalytics().observe(at('octocat', 0, showing(octo, T1)))).toEqual([['load', OCTO_EVENT]])
  })

  it("counts a ?user= link's profile once, when it arrives", () => {
    const analytics = new PersonAnalytics()
    expect(analytics.observe(at('OctoCat', 0, fetching))).toEqual([])
    expect(analytics.observe(at('OctoCat', 0, showing(octo, T1)))).toEqual([['load', OCTO_EVENT]])
    expect(analytics.observe(at('OctoCat', 0, showing(octo, T1)))).toEqual([])
  })

  it('counts a switch to a login in memory, and back', () => {
    const analytics = new PersonAnalytics()
    expect(analytics.observe(at('octocat', 0, showing(octo, T1)))).toHaveLength(1)
    expect(analytics.observe(at('kepano', 0, showing(kepano, T2)))).toEqual([['load', KEPANO_EVENT]])
    expect(analytics.observe(at('octocat', 0, showing(octo, T1)))).toEqual([['load', OCTO_EVENT]])
  })

  it('counts the same login again once its live refetch lands', () => {
    const analytics = new PersonAnalytics()
    expect(analytics.observe(at('octocat', 0, showing(octo, T1)))).toHaveLength(1)
    expect(analytics.observe(at('octocat', 1, showing(octo, T1)))).toEqual([])
    expect(analytics.observe(at('octocat', 1, showing(octo, T1, { isFetching: true })))).toEqual([])
    expect(analytics.observe(at('octocat', 1, showing(octo, T2)))).toEqual([['load', OCTO_EVENT]])
  })

  it('counts the same login asked for while it is fetching once, when that fetch lands', () => {
    const analytics = new PersonAnalytics()
    expect(analytics.observe(at('octocat', 0, fetching))).toEqual([])
    expect(analytics.observe(at('octocat', 1, fetching))).toEqual([])
    expect(analytics.observe(at('octocat', 1, showing(octo, T1)))).toEqual([['load', OCTO_EVENT]])
    expect(analytics.observe(at('octocat', 1, showing(octo, T1)))).toEqual([])
  })

  it('counts a refresh once, and a failed one not at all', () => {
    const analytics = new PersonAnalytics()
    const cached = showing(kepano, SAVED, { cachedAt: SAVED })
    expect(analytics.observe(at('kepano', 0, cached))).toEqual([['load', { ...KEPANO_EVENT, cached: true }]])
    analytics.noteLoad('kepano')
    expect(analytics.observe(at('kepano', 0, { ...cached, isFetching: true }))).toEqual([])
    expect(analytics.observe(at('kepano', 0, showing(kepano, T1)))).toEqual([['load', KEPANO_EVENT]])

    analytics.noteLoad('kepano')
    expect(analytics.observe(at('kepano', 0, showing(kepano, T1, { isFetching: true })))).toEqual([])
    const offline = new GitHubFetchError('offline', 'network')
    expect(analytics.observe(at('kepano', 0, showing(kepano, T1, { error: offline })))).toEqual([])
    expect(analytics.observe(at('kepano', 0, showing(kepano, T2)))).toEqual([])
  })

  it('sends none for a token change, a background refetch or a refetch on reconnect', () => {
    const analytics = new PersonAnalytics()
    expect(analytics.observe(at('kepano', 0, showing(fellBack, T1)))).toEqual([['load', { mode: 'person', source: 'rest', cached: false, token: true }]])
    // a token changed: the other tier's query, fetched from scratch
    expect(analytics.observe(at('kepano', 0, fetching))).toEqual([])
    expect(analytics.observe(at('kepano', 0, showing(kepano, T2)))).toEqual([])
    // TanStack refetching in the background (back online, or stale data shown again)
    expect(analytics.observe(at('kepano', 0, showing(kepano, T2, { isFetching: true })))).toEqual([])
    expect(analytics.observe(at('kepano', 0, showing(kepano, T3)))).toEqual([])
  })

  it('sends none when a token is added after a failed request, and counts the next request', () => {
    const analytics = new PersonAnalytics()
    const limited = new GitHubFetchError('API rate limit exceeded', 'rate_limited')
    expect(analytics.observe(at('kepano', 0, fetching))).toEqual([])
    expect(analytics.observe(at('kepano', 0, { ...nothing, error: limited }))).toEqual([])
    // the token: another query, which works
    expect(analytics.observe(at('kepano', 0, fetching))).toEqual([])
    expect(analytics.observe(at('kepano', 0, showing(kepano, T1)))).toEqual([])
    // loaded again
    expect(analytics.observe(at('kepano', 1, showing(kepano, T1, { isFetching: true })))).toEqual([])
    expect(analytics.observe(at('kepano', 1, showing(kepano, T2)))).toEqual([['load', KEPANO_EVENT]])
  })

  it('counts no load for a login that fails, then counts the login it goes back to', () => {
    const analytics = new PersonAnalytics()
    expect(analytics.observe(at('octocat', 0, showing(octo, T1)))).toHaveLength(1)
    const missing = new GitHubFetchError('nobody-here was not found. Check the spelling.', 'not_found')
    expect(analytics.observe(at('nobody-here', 0, fetching))).toEqual([])
    expect(analytics.observe(at('nobody-here', 0, { ...nothing, error: missing }))).toEqual([])
    expect(analytics.observe(at('octocat', 0, showing(octo, T1)))).toEqual([['load', OCTO_EVENT]])
  })

  it('sends only load, with no key beyond the rule and no repo', () => {
    const analytics = new PersonAnalytics()
    const states = [showing(octo, T1), showing(kepano, T1), showing(fellBack, T2), showing(octo, SAVED, { cachedAt: SAVED })]
    const events = states.flatMap((state, i) => analytics.observe(at(state.profile?.login ?? '', i, state)))
    expect(events).toHaveLength(states.length)
    for (const [name, data] of events) {
      expect(name).toBe('load')
      for (const key of Object.keys(data)) expect(['mode', 'source', 'cached', 'token', 'login']).toContain(key)
      if (data.token) expect('login' in data).toBe(false)
    }
  })
})
