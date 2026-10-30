import { beforeEach, describe, expect, it } from 'vitest'
import type { EventData } from '../src/analytics/umami'
import { NOTHING_ON_SHOW, PersonAnalytics, type ProfileOnShow } from '../src/profile/analytics'
import { RequestTracker, analyticsInput, refreshProfile, requestKey, startRequest } from '../src/profile/personRequests'
import { isRevealed } from '../src/profile/privacy'
import { usePersonStore } from '../src/profile/usePersonStore'
import personAppSource from '../src/PersonApp.tsx?raw'

const initial = usePersonStore.getState()
const store = () => usePersonStore.getState()

// each test starts from the store as a page load leaves it
beforeEach(() => usePersonStore.setState(initial, true))

const T1 = '2026-10-25T10:00:00.000Z'
const T2 = '2026-10-25T10:05:00.000Z'
const SAVED = '2026-10-24T09:00:00.000Z'

type Shown = ProfileOnShow['profile'] & {}
const octo: Shown = { login: 'Octocat', source: 'rest', fallback: null }
const kepano: Shown = { login: 'kepano', source: 'graphql', fallback: null }
const kepanoRest: Shown = { login: 'kepano', source: 'rest', fallback: null }

const nothing = NOTHING_ON_SHOW
const fetching: ProfileOnShow = { ...nothing, isFetching: true }
/** profile on show, fetched live at fetchedAt unless the rest says otherwise */
const showing = (profile: Shown, fetchedAt: string, rest: Partial<ProfileOnShow> = {}): ProfileOnShow => ({ ...nothing, profile, fetchedAt, ...rest })

/** A visitor's marks on the store: a repo hidden, one selected, private names revealed for owner. */
function mark(owner: string): void {
  store().toggleHidden('me/a')
  store().select('me/b')
  store().setSearch('plans')
  store().setReveal(owner, true)
}

/**
 * PersonApp's request wiring as React runs it, one commit at a time, in the order PersonApp declares
 * it: the layout effect keyed by requestKey (the last one's cleanup first), then the refetch effect,
 * then usePersonAnalytics's effect. What PersonApp would call is recorded in calls, the loads sent in
 * loads.
 */
class PersonAppRun {
  readonly calls: string[] = []
  readonly loads: EventData[] = []
  private readonly analytics = new PersonAnalytics()
  private tracker: RequestTracker | null = null
  private key: string | null = null
  private end: (() => void) | null = null
  private login = ''

  /** A render with these props and this state on show, then its effects. */
  commit(login: string, request: number, shown: ProfileOnShow): void {
    this.login = login
    const key = requestKey(login, request)
    // useState's initializer runs on the first render only
    this.tracker ??= new RequestTracker(key)
    if (key !== this.key) {
      this.end?.()
      this.end = startRequest(store(), key)
      this.key = key
    }
    if (this.tracker.refetchFor(key, shown.isFetching)) this.calls.push('refetch')
    for (const [, data] of this.analytics.observe(analyticsInput(login, request, shown))) this.loads.push(data)
  }

  /** The status strip's refresh button. */
  refresh(): void {
    refreshProfile(this.login, {
      noteLoad: (who) => {
        this.calls.push(`noteLoad ${who}`)
        this.analytics.noteLoad(who)
      },
      refetch: () => this.calls.push('refetch'),
    })
  }

  /** Leaving person mode: the layout effect's cleanup. */
  unmount(): void {
    this.end?.()
    this.end = null
    this.key = null
  }
}

describe('requestKey', () => {
  it('is one key per login, in any case, and request', () => {
    expect(requestKey('Kepano', 0)).toBe(requestKey('kepano', 0))
    expect(requestKey('kepano', 1)).not.toBe(requestKey('kepano', 0))
    expect(requestKey('octocat', 0)).not.toBe(requestKey('kepano', 0))
  })
})

describe('startRequest', () => {
  it('starts a request clean for its login, the privacy toggle included', () => {
    store().resetFor('kepano')
    mark('kepano')
    startRequest(store(), requestKey('Kepano', 1))
    expect(store()).toMatchObject({ owner: 'kepano', selected: null, revealFor: null, search: '' })
    expect(store().hidden.size).toBe(0)
  })

  it('hides private names again when the request ends, so a remount cannot show them on its first render', () => {
    const end = startRequest(store(), requestKey('Kepano', 0))
    store().setReveal('kepano', true)
    expect(isRevealed(store().revealFor, 'kepano')).toBe(true)
    end()
    // what a remount's first render reads, before any of its effects run
    expect(store().revealFor).toBeNull()
    expect(isRevealed(store().revealFor, 'kepano')).toBe(false)
  })
})

describe('RequestTracker', () => {
  it('asks for no refetch on mount, nor for the same request seen again', () => {
    const tracker = new RequestTracker(requestKey('kepano', 0))
    expect(tracker.refetchFor(requestKey('kepano', 0), false)).toBe(false)
    expect(tracker.refetchFor(requestKey('Kepano', 0), false)).toBe(false)
  })

  it('asks for a live refetch of the same login asked for again, in any case', () => {
    const tracker = new RequestTracker(requestKey('kepano', 0))
    expect(tracker.refetchFor(requestKey('Kepano', 1), false)).toBe(true)
    // StrictMode runs the effect again: still one refetch
    expect(tracker.refetchFor(requestKey('kepano', 1), false)).toBe(false)
  })

  it('leaves a request a fetch in flight answers to that fetch', () => {
    const tracker = new RequestTracker(requestKey('kepano', 0))
    expect(tracker.refetchFor(requestKey('kepano', 1), true)).toBe(false)
    // the fetch lands: that request is answered, not refetched
    expect(tracker.refetchFor(requestKey('kepano', 1), false)).toBe(false)
  })

  it('asks for none for a new login, which reads its cache first, nor going back', () => {
    const tracker = new RequestTracker(requestKey('octocat', 0))
    expect(tracker.refetchFor(requestKey('kepano', 0), false)).toBe(false)
    expect(tracker.refetchFor(requestKey('octocat', 0), false)).toBe(false)
  })
})

describe('refreshProfile', () => {
  it('notes the load for the person on show, then fetches live', () => {
    const calls: string[] = []
    refreshProfile('kepano', { noteLoad: (who) => calls.push(`noteLoad ${who}`), refetch: () => calls.push('refetch') })
    expect(calls).toEqual(['noteLoad kepano', 'refetch'])
  })
})

describe('analyticsInput', () => {
  it('carries the request as the router made it, and only what is on show', () => {
    const shown = { ...showing(kepano, T1), refetch: () => {}, isPending: false }
    expect(analyticsInput('Kepano', 3, shown)).toEqual({ login: 'Kepano', request: 3, ...showing(kepano, T1) })
  })
})

describe("PersonApp's requests, as React runs them", () => {
  it('fetches the same login again, live, unless a fetch in flight answers it', () => {
    const app = new PersonAppRun()
    app.commit('kepano', 0, showing(kepano, T1))
    expect(app.calls).toEqual([])
    app.commit('kepano', 1, showing(kepano, T1))
    expect(app.calls).toEqual(['refetch'])
    app.commit('kepano', 1, showing(kepano, T1, { isFetching: true }))
    app.commit('kepano', 1, showing(kepano, T2))
    // asked for again while that refetch is in flight: the fetch answers it
    app.commit('kepano', 2, showing(kepano, T2, { isFetching: true }))
    app.commit('kepano', 2, showing(kepano, '2026-10-25T10:06:00.000Z'))
    expect(app.calls).toEqual(['refetch'])
  })

  it('counts each request for the same login once it settles, by its own request number', () => {
    const app = new PersonAppRun()
    app.commit('kepano', 0, showing(kepano, T1))
    expect(app.loads).toHaveLength(1)
    app.commit('kepano', 1, showing(kepano, T1))
    app.commit('kepano', 1, showing(kepano, T1, { isFetching: true }))
    expect(app.loads).toHaveLength(1)
    app.commit('kepano', 1, showing(kepano, T2))
    expect(app.loads).toHaveLength(2)
    app.commit('kepano', 1, showing(kepano, T2))
    expect(app.loads).toHaveLength(2)
  })

  it('does not refetch a new login, which reads its cache first, and counts each switch', () => {
    const app = new PersonAppRun()
    app.commit('Octocat', 0, showing(octo, T1))
    app.commit('kepano', 0, showing(kepano, T2))
    app.commit('octocat', 0, showing(octo, T1))
    expect(app.calls).toEqual([])
    expect(app.loads).toHaveLength(3)
  })

  it('refreshes by noting a load, then fetching live, and counts it once it lands', () => {
    const app = new PersonAppRun()
    const cached = showing(kepano, SAVED, { cachedAt: SAVED })
    app.commit('kepano', 0, cached)
    expect(app.loads).toEqual([{ mode: 'person', source: 'graphql', cached: true, token: true }])
    app.refresh()
    expect(app.calls).toEqual(['noteLoad kepano', 'refetch'])
    app.commit('kepano', 0, { ...cached, isFetching: true })
    app.commit('kepano', 0, showing(kepano, T1))
    expect(app.loads).toEqual([
      { mode: 'person', source: 'graphql', cached: true, token: true },
      { mode: 'person', source: 'graphql', cached: false, token: true },
    ])
  })

  it('neither refetches nor counts a token change', () => {
    const app = new PersonAppRun()
    app.commit('kepano', 0, showing(kepanoRest, T1))
    expect(app.loads).toHaveLength(1)
    // the token makes it another query, fetched from scratch, for the same login and request
    app.commit('kepano', 0, fetching)
    app.commit('kepano', 0, showing(kepano, T2))
    expect(app.calls).toEqual([])
    expect(app.loads).toHaveLength(1)
  })

  it('starts every request clean, keeps the toggle through other renders, and hides names when a request ends', () => {
    const app = new PersonAppRun()
    app.commit('kepano', 0, showing(kepano, T1))
    mark('kepano')
    // any other render keeps what the visitor did
    app.commit('kepano', 0, showing(kepano, T1, { isFetching: true }))
    expect(isRevealed(store().revealFor, 'kepano')).toBe(true)
    expect(store().selected).toBe('me/b')

    // the same login asked for again
    app.commit('kepano', 1, showing(kepano, T1))
    expect(store()).toMatchObject({ owner: 'kepano', selected: null, revealFor: null, search: '' })
    expect(store().hidden.size).toBe(0)

    // a new login
    mark('kepano')
    app.commit('octocat', 0, showing(octo, T2))
    expect(store()).toMatchObject({ owner: 'octocat', selected: null, revealFor: null, search: '' })
    expect(store().hidden.size).toBe(0)

    // leaving person mode, then back: the first render reads a store with nothing revealed
    store().setReveal('octocat', true)
    app.unmount()
    expect(isRevealed(store().revealFor, 'octocat')).toBe(false)
    const again = new PersonAppRun()
    again.commit('octocat', 0, showing(octo, T2))
    expect(store().revealFor).toBeNull()
  })
})

describe('PersonApp', () => {
  it('makes its requests through personRequests, keyed by the login and the request', () => {
    expect(personAppSource).toContain('const asked = requestKey(login, request)')
    expect(personAppSource).toContain('useLayoutEffect(() => startRequest(usePersonStore.getState(), asked), [asked])')
    expect(personAppSource).toContain('const [tracker] = useState(() => new RequestTracker(asked))')
    expect(personAppSource).toContain('if (tracker.refetchFor(asked, isFetching)) refetch()')
    expect(personAppSource).toContain('}, [tracker, asked, isFetching, refetch])')
    expect(personAppSource).toContain('const noteLoad = usePersonAnalytics(analyticsInput(login, request, fetched))')
    expect(personAppSource).toContain('const refresh = useCallback(() => refreshProfile(login, { noteLoad, refetch }), [login, noteLoad, refetch])')
    // and in no other way
    expect(personAppSource.match(/\brefetch\(\)/g)).toHaveLength(1)
    expect(personAppSource.match(/usePersonAnalytics\(/g)).toHaveLength(1)
    expect(personAppSource).not.toMatch(/noteLoad\(|resetFor\(/)
  })
})
