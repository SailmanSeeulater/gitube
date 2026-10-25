import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BEFORE_SEND_GLOBAL,
  MAX_QUEUED_EVENTS,
  MAX_VALUE_LENGTH,
  UMAMI_DOMAINS,
  UMAMI_HOST,
  beforeSend,
  initAnalytics,
  sanitize,
  track,
  type AnalyticsEnv,
  type AnalyticsEvent,
  type EventData,
} from '../src/analytics/umami'
import { useGardenStore, type LayoutMode } from '../src/store/useGardenStore'
import { THEME_IDS } from '../src/theme/themes'
import type { GitHubFetchError, ViewMode } from '../src/types'

// Token-shaped strings are put together here so that no scanner mistakes this file for a leak.
/** a classic personal access token: ghp_ and 36 characters */
const CLASSIC = 'ghp_' + 'R8vK2mW5qT9xL3nB7cJ4hF6dS1aG0eY2uI8o'
/** a fine-grained token */
const FINE_GRAINED = 'github_pat_' + '11AB2CD3EF0_' + 'xYzWvUtSrQpOnMlKjIhGfEdCbA9876543210xYzWvUtSrQpOnMlKjIhGfEdCbA98765'
/** an OAuth token of the old kind: 40 hex characters */
const HEX40 = '0123456789abcdef0123456789abcdef01234567'
/** a token of no known shape, so only its value gives it away */
const OPAQUE = 'Zq7Wm3Kx9Pt2Lv5Rn8Hy4Jc6'

/** A share link's query string: a repo, a branch and a contributor, any of them private with a token. */
const SEARCH = '?repo=acme/secret&branch=x&by=alice'

const LAYOUTS = Object.keys({ organic: 1, metro: 1, garden: 1 } satisfies Record<LayoutMode, 1>)
const VIEWS = Object.keys({ skeleton: 1, full: 1 } satisfies Record<ViewMode, 1>)
const FETCH_ERROR_CODES = Object.keys({
  not_found: 1,
  not_a_user: 1,
  rate_limited: 1,
  unauthorized: 1,
  network: 1,
  invalid_url: 1,
  aborted: 1,
  empty_repo: 1,
  unknown: 1,
} satisfies Record<GitHubFetchError['code'], 1>)

/** Every payload the app sends, one list per event; a missing event is a type error. */
const APP_EVENTS: Record<AnalyticsEvent, EventData[]> = {
  grow: [
    { mode: 'repo', branches: '2-5', cached: false, token: false, repo: 'expressjs/express' },
    ...['1', '2-5', '6-20', '21-50', '51-100', '101+'].map((branches) => ({ mode: 'repo', branches, cached: true, token: true })),
    // person mode: the login only for a live fetch without a token; rest after a GraphQL fallback
    { mode: 'person', source: 'rest', cached: false, token: false, login: 'octocat' },
    { mode: 'person', source: 'rest', cached: true, token: false },
    { mode: 'person', source: 'graphql', cached: false, token: true },
    { mode: 'person', source: 'graphql', cached: true, token: true },
    { mode: 'person', source: 'rest', cached: false, token: true },
  ],
  'layout-switch': LAYOUTS.map((layout) => ({ layout })),
  'theme-switch': THEME_IDS.map((theme) => ({ theme })),
  'view-mode': VIEWS.map((view) => ({ view })),
  'timelapse-play': [],
  export: ['png', 'webm', 'json', 'garden-file'].map((format) => ({ format })),
  'battle-start': [],
  'pr-overlay': [{ state: 'on' }, { state: 'off' }],
  'share-copy': [],
  'token-added': [],
  'fetch-error': FETCH_ERROR_CODES.map((code) => ({ code })),
}
const ALL_EVENTS = Object.keys(APP_EVENTS) as AnalyticsEvent[]

/** Every run of `length` characters in the token. */
function slicesOf(token: string, length = 8): string[] {
  const slices: string[] = []
  for (let i = 0; i + length <= token.length; i++) slices.push(token.slice(i, i + length))
  return slices
}

/** Values that must never reach Umami with this token set and SEARCH in the address bar. */
function hostileData(token: string): Record<string, unknown> {
  return {
    exact: token,
    padded: ` ${token} `,
    inUrl: `https://api.github.com/user?access_token=${token}`,
    bearer: `Bearer ${token}`,
    head: token.slice(0, 12),
    middle: token.slice(6, 22),
    embedded: `code-${token.slice(10, 30)}-x`,
    tail: token.slice(-10),
    search: SEARCH,
    searchInUrl: `https://repogarden.latesailor.dev/${SEARCH}#top`,
    repoParam: 'repo=acme/secret',
    repoParamQuery: '?repo=acme/secret',
    byParam: '&by=alice',
    branchAndBy: 'branch=x&by=alice',
    repo: 'acme/secret',
    login: 'alice',
  }
}

/** Puts a tracker on a stubbed window, with the address bar's query string. */
function stubTracker(search = '') {
  const umamiTrack = vi.fn<(event: string, data?: EventData) => unknown>()
  vi.stubGlobal('window', { umami: { track: umamiTrack }, location: { search } })
  return umamiTrack
}

/** What the tracker was handed, every call, as one string to search. */
const sentJson = (umamiTrack: ReturnType<typeof stubTracker>) => JSON.stringify(umamiTrack.mock.calls)

function expectNoLeak(json: string, token: string): void {
  expect(json).not.toContain(token)
  for (const slice of slicesOf(token)) expect(json).not.toContain(slice)
  expect(json).not.toMatch(/gh[pousr]_|github_pat_|[0-9a-f]{40}/i)
  expect(json).not.toContain(SEARCH)
  for (const part of ['repo=', 'branch=', 'by=', 'acme/secret', 'alice']) expect(json).not.toContain(part)
}

afterEach(() => {
  vi.unstubAllGlobals()
  useGardenStore.setState({ token: '' })
})

describe('track', () => {
  it('does nothing without a window, without the tracker, or with a broken one', () => {
    expect(typeof window).toBe('undefined')
    expect(() => track('share-copy')).not.toThrow()
    expect(() => track('grow', { mode: 'repo' })).not.toThrow()
    vi.stubGlobal('window', {})
    expect(() => track('grow', { mode: 'repo' })).not.toThrow()
    vi.stubGlobal('window', { umami: {} })
    expect(() => track('grow', { mode: 'repo' })).not.toThrow()
    vi.stubGlobal('window', { umami: { track: 'not a function' } })
    expect(() => track('grow', { mode: 'repo' })).not.toThrow()
  })

  it('never throws when the tracker does', () => {
    const umamiTrack = stubTracker()
    umamiTrack.mockImplementation(() => {
      throw new Error('tracker broke')
    })
    expect(() => track('share-copy')).not.toThrow()
    expect(() => track('export', { format: 'png' })).not.toThrow()
    expect(umamiTrack).toHaveBeenCalledTimes(2)
  })

  it('swallows a failed send', async () => {
    // Vitest fails the run on an unhandled rejection; listening as well makes the check explicit.
    const unhandled = vi.fn()
    const nodeProcess = (globalThis as unknown as { process: NodeLikeProcess }).process
    nodeProcess.on('unhandledRejection', unhandled)
    try {
      const umamiTrack = stubTracker()
      umamiTrack.mockImplementation(() => Promise.reject(new Error('offline')))
      expect(() => track('share-copy')).not.toThrow()
      expect(() => track('export', { format: 'json' })).not.toThrow()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      nodeProcess.off('unhandledRejection', unhandled)
    }
  })

  it('sends an event with no data, or none left, as the name alone', () => {
    const umamiTrack = stubTracker()
    track('timelapse-play')
    track('share-copy', {})
    track('fetch-error', { code: '?repo=acme/secret' })
    expect(umamiTrack.mock.calls).toEqual([['timelapse-play'], ['share-copy'], ['fetch-error']])
  })

  it('keeps booleans, finite numbers and strings, clipping strings to 50 characters', () => {
    const umamiTrack = stubTracker()
    track('grow', { cached: false, token: true, zero: 0, count: -3.5, mode: 'repo', fifty: 'y'.repeat(50), long: 'x'.repeat(80) })
    expect(MAX_VALUE_LENGTH).toBe(50)
    expect(umamiTrack).toHaveBeenCalledWith('grow', {
      cached: false,
      token: true,
      zero: 0,
      count: -3.5,
      mode: 'repo',
      fifty: 'y'.repeat(50),
      long: 'x'.repeat(50),
    })
  })

  it('drops non-finite numbers and anything that is not a string, number or boolean', () => {
    const umamiTrack = stubTracker()
    const data = {
      mode: 'repo',
      nan: NaN,
      inf: Infinity,
      negInf: -Infinity,
      nothing: null,
      missing: undefined,
      list: ['acme/secret'],
      object: { repo: 'acme/secret' },
      date: new Date(0),
      fn: () => 'acme/secret',
      big: BigInt(1),
      symbol: Symbol('s'),
    }
    track('grow', data as unknown as EventData)
    expect(umamiTrack).toHaveBeenCalledWith('grow', { mode: 'repo' })
  })

  it('names a repo or login only while no token is set', () => {
    const umamiTrack = stubTracker()
    const long = 'some-organisation-name/a-really-long-repository-name-that-goes-on'
    track('grow', { mode: 'repo', repo: long, login: 'octocat' })
    expect(umamiTrack).toHaveBeenLastCalledWith('grow', { mode: 'repo', repo: long.slice(0, 50), login: 'octocat' })

    useGardenStore.setState({ token: CLASSIC })
    track('grow', { mode: 'repo', repo: 'acme/secret', login: 'alice', token: true })
    expect(umamiTrack).toHaveBeenLastCalledWith('grow', { mode: 'repo', token: true })
    track('grow', { repo: 'acme/secret', login: 'alice' })
    expect(umamiTrack).toHaveBeenLastCalledWith('grow')
  })

  it('keeps every payload the app sends, a public repo named in the address bar included', () => {
    const search = '?repo=expressjs/express&branch=main&by=alice'
    for (const token of ['', CLASSIC]) {
      useGardenStore.setState({ token })
      const umamiTrack = stubTracker(search)
      for (const event of ALL_EVENTS) {
        for (const data of APP_EVENTS[event]) {
          const expected = { ...data }
          if (token) {
            delete expected.repo
            delete expected.login
          }
          expect(sanitize(data, { token, search })).toEqual(expected)
          track(event, data)
          expect(umamiTrack).toHaveBeenLastCalledWith(event, expected)
        }
        if (APP_EVENTS[event].length === 0) {
          track(event)
          expect(umamiTrack.mock.lastCall).toEqual([event])
        }
      }
    }
  })
})

describe('privacy', () => {
  it('never sends the token, any piece of it, or the query string', () => {
    for (const token of [CLASSIC, FINE_GRAINED, HEX40, OPAQUE]) {
      useGardenStore.setState({ token })
      const umamiTrack = stubTracker(SEARCH)
      for (const event of ALL_EVENTS) track(event, { ...hostileData(token), count: 3, mode: 'repo' } as EventData)
      expect(umamiTrack).toHaveBeenCalledTimes(ALL_EVENTS.length)
      // the harmless values still go
      for (const call of umamiTrack.mock.calls) expect(call[1]).toEqual({ count: 3, mode: 'repo' })
      expectNoLeak(sentJson(umamiTrack), token)
    }
  })

  it('drops token-shaped values even when no token is set', () => {
    const umamiTrack = stubTracker()
    for (const value of [CLASSIC, FINE_GRAINED, HEX40, 'gho_' + 'abcdEFGH1234', 'ghs_' + 'abcdEFGH1234', `token ${CLASSIC}`]) {
      track('fetch-error', { code: value })
    }
    expect(umamiTrack.mock.calls).toEqual(Array.from({ length: 6 }, () => ['fetch-error']))
  })

  it('drops the query string and its parameters when no token is set, but names a public repo', () => {
    const umamiTrack = stubTracker(SEARCH)
    track('grow', {
      search: SEARCH,
      searchInUrl: `https://repogarden.latesailor.dev/${SEARCH}`,
      repoParam: 'repo=acme/secret',
      byParam: '&by=alice',
      branchAndBy: 'branch=x&by=alice',
      repo: 'acme/garden',
      login: 'octocat',
    })
    expect(umamiTrack).toHaveBeenCalledWith('grow', { repo: 'acme/garden', login: 'octocat' })
  })

  it('reads the token as it is when the event is sent', () => {
    const umamiTrack = stubTracker()
    track('grow', { repo: 'acme/garden' })
    useGardenStore.setState({ token: OPAQUE })
    track('grow', { repo: 'acme/garden' })
    useGardenStore.setState({ token: '' })
    track('grow', { repo: 'acme/garden' })
    expect(umamiTrack.mock.calls).toEqual([['grow', { repo: 'acme/garden' }], ['grow'], ['grow', { repo: 'acme/garden' }]])
  })
})

describe('beforeSend', () => {
  it('strips the query string and fragment from the page and referrer URLs', () => {
    const payload = {
      website: 'site',
      hostname: 'repogarden.latesailor.dev',
      title: 'repo-garden',
      url: `https://repogarden.latesailor.dev/${SEARCH}#top`,
      referrer: `/${SEARCH}`,
    }
    expect(beforeSend('event', payload)).toEqual({
      website: 'site',
      hostname: 'repogarden.latesailor.dev',
      title: 'repo-garden',
      url: 'https://repogarden.latesailor.dev/',
      referrer: '/',
    })
    expect(beforeSend('event', { url: 'https://repogarden.latesailor.dev/#/x?repo=acme/secret', referrer: 'https://example.com/a?b=c' })).toEqual({
      url: 'https://repogarden.latesailor.dev/',
      referrer: 'https://example.com',
    })
    // the input is left as it was
    expect(payload.url).toBe(`https://repogarden.latesailor.dev/${SEARCH}#top`)
  })

  it('sends the page as its origin, whatever path it was on', () => {
    const url = (value: string) => beforeSend('pageview', { url: value }).url
    expect(url('https://repogarden.latesailor.dev/acme/secret?repo=x#y')).toBe('https://repogarden.latesailor.dev/')
    expect(url('https://repogarden.latesailor.dev/acme/secret-repo')).toBe('https://repogarden.latesailor.dev/')
    expect(url('https://repogarden.latesailor.dev/')).toBe('https://repogarden.latesailor.dev/')
    expect(url('http://localhost:4173/acme/secret')).toBe('http://localhost:4173/')
    // not a URL, or one with no origin of its own: no path either way
    for (const value of ['', '/', '/acme/secret?repo=x', 'acme/secret', 'not a url', 'data:text/html,acme/secret']) {
      expect(url(value)).toBe('/')
    }
  })

  it('sends a referrer as its origin, or as / when it is this site', () => {
    const referrer = (value: string) => beforeSend('pageview', { url: '/', referrer: value }).referrer
    // the tracker turns a referrer from this site into its path
    expect(referrer('/acme/secret?x')).toBe('/')
    expect(referrer('/')).toBe('/')
    expect(referrer('https://github.com/acme/secret?x=1')).toBe('https://github.com')
    expect(referrer('https://www.google.com/search?q=repo-garden')).toBe('https://www.google.com')
    expect(referrer('')).toBe('')
    for (const value of ['garbage', 'acme/secret', '?repo=acme/secret', 'data:text/html,acme/secret']) {
      expect(referrer(value)).toBe('')
    }
  })

  it('leaves a URL or referrer that is not a string alone', () => {
    expect(beforeSend('event', { name: 'grow' })).toEqual({ name: 'grow' })
    expect(beforeSend('event', { url: null, referrer: undefined })).toEqual({ url: null, referrer: undefined })
  })

  it('sanitizes event data as track does, and leaves payloads without it alone', () => {
    vi.stubGlobal('window', { location: { search: SEARCH } })
    useGardenStore.setState({ token: CLASSIC })
    const out = beforeSend('event', {
      url: `https://repogarden.latesailor.dev/${SEARCH}`,
      referrer: `https://repogarden.latesailor.dev/?repo=acme/other`,
      name: 'grow',
      data: { ...hostileData(CLASSIC), branches: '2-5', count: 3, nan: NaN, long: 'x'.repeat(80), nested: { a: 1 } },
    })
    expect(out).toEqual({
      url: 'https://repogarden.latesailor.dev/',
      referrer: 'https://repogarden.latesailor.dev',
      name: 'grow',
      data: { branches: '2-5', count: 3, long: 'x'.repeat(50) },
    })
    expectNoLeak(JSON.stringify(out), CLASSIC)

    // a pageview, a performance report: no data to clean
    expect(beforeSend('pageview', { url: '/', title: 'repo-garden' })).toEqual({ url: '/', title: 'repo-garden' })
    expect(beforeSend('performance', { url: '/', lcp: 1200 })).toEqual({ url: '/', lcp: 1200 })
    expect(beforeSend('event', { name: 'share-copy', data: null })).toEqual({ name: 'share-copy', data: null })
  })
})

const ID = '6f1b3c2a-9d4e-4f5a-8b7c-0d1e2f3a4b5c'

interface Listener {
  type: string
  listener: () => void
  options: unknown
}

interface FakeScript {
  tag: string
  src: string
  defer: boolean
  referrerPolicy: string
  crossOrigin: string | null
  attributes: Record<string, string>
  listeners: Listener[]
  setAttribute: (name: string, value: string) => void
  addEventListener: (type: string, listener: () => void, options: unknown) => void
}

/** Runs, once, the listeners for that event. */
function fire(listeners: Listener[], type: string): void {
  const matching = listeners.filter((l) => l.type === type)
  for (const l of matching) listeners.splice(listeners.indexOf(l), 1)
  for (const { listener } of matching) listener()
}

/** Just enough of a page: a document that records scripts added to its head, and the load event. */
function stubPage(readyState: DocumentReadyState = 'complete') {
  const scripts: FakeScript[] = []
  const listeners: Listener[] = []
  const page = {
    readyState,
    head: {
      appendChild: (el: FakeScript) => {
        scripts.push(el)
        return el
      },
    },
    createElement: (tag: string): FakeScript => {
      const el: FakeScript = {
        tag,
        src: '',
        defer: false,
        referrerPolicy: '',
        crossOrigin: null,
        attributes: {},
        listeners: [],
        setAttribute: (name, value) => void (el.attributes[name] = value),
        addEventListener: (type, listener, options) => void el.listeners.push({ type, listener, options }),
      }
      return el
    },
    querySelector: (selector: string) => scripts.find((s) => selector === `${s.tag}[src="${s.src}"]`) ?? null,
  }
  const win: Record<string, unknown> = {
    addEventListener: (type: string, listener: () => void, options: unknown) => listeners.push({ type, listener, options }),
  }
  vi.stubGlobal('document', page)
  vi.stubGlobal('window', win)
  const load = () => {
    page.readyState = 'complete'
    fire(listeners, 'load')
  }
  return { scripts, listeners, win, load }
}

describe('initAnalytics', () => {
  it('does nothing outside a production build', () => {
    const { scripts, listeners, win } = stubPage()
    expect(initAnalytics({ PROD: false, VITE_UMAMI_WEBSITE_ID: ID })).toBe(false)
    // under Vitest, import.meta.env is not a production build
    expect(initAnalytics()).toBe(false)
    expect(scripts).toHaveLength(0)
    expect(listeners).toHaveLength(0)
    expect(win[BEFORE_SEND_GLOBAL]).toBeUndefined()
  })

  it('does nothing without a website ID', () => {
    const { scripts, listeners, win } = stubPage()
    for (const id of [undefined, '', '   ', '<PASTE-ID-HERE>', 'not-a-uuid', `${ID}x`, ID.replaceAll('-', ''), `${ID}?x=1`]) {
      expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: id })).toBe(false)
    }
    expect(scripts).toHaveLength(0)
    expect(listeners).toHaveLength(0)
    expect(win[BEFORE_SEND_GLOBAL]).toBeUndefined()
  })

  it('does nothing without a page', () => {
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(false)
  })

  it('adds the tracker once the page is complete, with the privacy attributes', () => {
    const { scripts, listeners, win } = stubPage('complete')
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ` ${ID} ` })).toBe(true)
    expect(listeners).toHaveLength(0)
    expect(scripts).toHaveLength(1)
    const [script] = scripts
    expect(script.tag).toBe('script')
    expect(UMAMI_HOST).toBe('https://stats.latesailor.dev')
    expect(script.src).toBe('https://stats.latesailor.dev/script.js')
    expect(script.crossOrigin).toBe('anonymous')
    expect(script.attributes).toEqual({
      'data-website-id': ID,
      'data-exclude-search': 'true',
      'data-exclude-hash': 'true',
      'data-do-not-track': 'true',
      'data-domains': 'repogarden.latesailor.dev',
      'data-before-send': BEFORE_SEND_GLOBAL,
    })
    expect(script.listeners).toEqual([
      { type: 'load', listener: expect.any(Function), options: { once: true } },
      { type: 'error', listener: expect.any(Function), options: { once: true } },
    ])
    expect(UMAMI_DOMAINS).toBe('repogarden.latesailor.dev')
    expect(win[BEFORE_SEND_GLOBAL]).toBe(beforeSend)
  })

  it('waits for the load event while the page is still loading', () => {
    const { scripts, listeners, win, load } = stubPage('interactive')
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(true)
    expect(scripts).toHaveLength(0)
    expect(listeners).toEqual([{ type: 'load', listener: expect.any(Function), options: { once: true } }])
    expect(win[BEFORE_SEND_GLOBAL]).toBe(beforeSend)
    load()
    expect(scripts).toHaveLength(1)
    expect(scripts[0].attributes['data-website-id']).toBe(ID)
  })

  it('lets VITE_UMAMI_DOMAINS replace the counted hostnames', () => {
    const { scripts } = stubPage()
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID, VITE_UMAMI_DOMAINS: ' localhost,127.0.0.1 ' })).toBe(true)
    expect(scripts[0].attributes['data-domains']).toBe('localhost,127.0.0.1')

    const blank = stubPage()
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID, VITE_UMAMI_DOMAINS: '  ' })).toBe(true)
    expect(blank.scripts[0].attributes['data-domains']).toBe(UMAMI_DOMAINS)
  })

  it('adds the script once, however often it is called', () => {
    const complete = stubPage('complete')
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(true)
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(false)
    expect(complete.scripts).toHaveLength(1)

    // called again before the page has loaded, as a remounted root would
    const loading = stubPage('loading')
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(true)
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(false)
    loading.load()
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(false)
    expect(loading.scripts).toHaveLength(1)
  })
})

describe('events tracked before the tracker has loaded', () => {
  /** A fresh copy of the module (and of the store it reads), so no earlier test has armed its queue. */
  async function freshModule() {
    vi.resetModules()
    const umami = await import('../src/analytics/umami')
    const { useGardenStore: store } = await import('../src/store/useGardenStore')
    return { ...umami, store }
  }

  /** What the tracker does as it runs: it defines window.umami, then the script's load event fires. */
  function runTracker(page: ReturnType<typeof stubPage>) {
    const umamiTrack = vi.fn<(event: string, data?: EventData) => unknown>()
    page.win.umami = { track: umamiTrack }
    fire(page.scripts[0].listeners, 'load')
    return umamiTrack
  }

  it('waits for the tracker and sends them in order once it has loaded', async () => {
    const { initAnalytics, track } = await freshModule()
    const page = stubPage('loading')
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(true)
    track('grow', { mode: 'repo', repo: 'expressjs/express', cached: false })
    track('share-copy')
    page.load()
    track('export', { format: 'png' })
    expect(page.scripts).toHaveLength(1)

    const umamiTrack = runTracker(page)
    expect(umamiTrack.mock.calls).toEqual([['grow', { mode: 'repo', repo: 'expressjs/express', cached: false }], ['share-copy'], ['export', { format: 'png' }]])
    // and once it is here, events go straight to it
    track('timelapse-play')
    expect(umamiTrack.mock.calls).toHaveLength(4)
    expect(umamiTrack.mock.lastCall).toEqual(['timelapse-play'])
  })

  it(`keeps the first ${MAX_QUEUED_EVENTS} and drops the rest`, async () => {
    const { initAnalytics, track, MAX_QUEUED_EVENTS: max } = await freshModule()
    expect(max).toBe(20)
    const page = stubPage('complete')
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(true)
    for (let n = 0; n < 25; n++) track('layout-switch', { n })
    const umamiTrack = runTracker(page)
    expect(umamiTrack.mock.calls).toEqual(Array.from({ length: 20 }, (_, n) => ['layout-switch', { n }]))
  })

  it('drops them when the tracker fails to load', async () => {
    const { initAnalytics, track } = await freshModule()
    const page = stubPage('complete')
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(true)
    track('share-copy')
    track('export', { format: 'json' })
    fire(page.scripts[0].listeners, 'error')
    // nothing is kept after a failure either
    track('battle-start')
    const umamiTrack = runTracker(page)
    expect(umamiTrack).not.toHaveBeenCalled()
    track('token-added')
    expect(umamiTrack.mock.calls).toEqual([['token-added']])
  })

  it('sanitizes each one as it is sent, so a token set while it waited drops names', async () => {
    const { initAnalytics, track, store } = await freshModule()
    const page = stubPage('complete')
    page.win.location = { search: SEARCH }
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(true)
    track('grow', { mode: 'repo', repo: 'acme/secret', login: 'alice', code: OPAQUE.slice(2, 14), count: 3 })
    track('fetch-error', { code: OPAQUE })
    store.setState({ token: OPAQUE })
    const umamiTrack = runTracker(page)
    expect(umamiTrack.mock.calls).toEqual([['grow', { mode: 'repo', count: 3 }], ['fetch-error']])
    expectNoLeak(sentJson(umamiTrack), OPAQUE)
  })

  it('sanitizes each one as it waits too, so a token cleared before the tracker loads brings no name back', async () => {
    const { initAnalytics, track, store } = await freshModule()
    const page = stubPage('complete')
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(true)
    store.setState({ token: OPAQUE })
    track('grow', { mode: 'repo', repo: 'acme/secret', login: 'alice', count: 3 })
    store.setState({ token: '' })
    const umamiTrack = runTracker(page)
    expect(umamiTrack.mock.calls).toEqual([['grow', { mode: 'repo', count: 3 }]])
    expect(sentJson(umamiTrack)).not.toContain('acme/secret')
    expect(sentJson(umamiTrack)).not.toContain('alice')
  })

  it('keeps nothing when the tracker is not being added', async () => {
    // null: initAnalytics is never called
    const off: (AnalyticsEnv | null)[] = [
      null,
      { PROD: false, VITE_UMAMI_WEBSITE_ID: ID },
      { PROD: true, VITE_UMAMI_WEBSITE_ID: '' },
      { PROD: true, VITE_UMAMI_WEBSITE_ID: 'not-a-uuid' },
    ]
    for (const env of off) {
      const { initAnalytics, track } = await freshModule()
      stubPage('complete')
      if (env) expect(initAnalytics(env)).toBe(false)
      expect(() => track('share-copy')).not.toThrow()
      track('grow', { mode: 'repo' })
      // a tracker added later sends only what was tracked once it was on its way
      const page = stubPage('complete')
      expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(true)
      track('token-added')
      expect(runTracker(page).mock.calls).toEqual([['token-added']])
    }
  })

  it('keeps waiting when initAnalytics runs again, and adds the script once', async () => {
    const { initAnalytics, track } = await freshModule()
    const page = stubPage('loading')
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(true)
    track('share-copy')
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(false)
    track('battle-start')
    page.load()
    expect(page.scripts).toHaveLength(1)
    expect(runTracker(page).mock.calls).toEqual([['share-copy'], ['battle-start']])
  })

  it('never throws when the tracker breaks while they are sent', async () => {
    const { initAnalytics, track } = await freshModule()
    const page = stubPage('complete')
    expect(initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(true)
    track('share-copy')
    track('export', { format: 'png' })
    const umamiTrack = vi.fn(() => {
      throw new Error('tracker broke')
    })
    page.win.umami = { track: umamiTrack }
    expect(() => fire(page.scripts[0].listeners, 'load')).not.toThrow()
    expect(umamiTrack).toHaveBeenCalledTimes(2)

    // a load event with no tracker behind it (it bailed out before defining window.umami)
    const again = await freshModule()
    const empty = stubPage('complete')
    expect(again.initAnalytics({ PROD: true, VITE_UMAMI_WEBSITE_ID: ID })).toBe(true)
    again.track('share-copy')
    expect(() => fire(empty.scripts[0].listeners, 'load')).not.toThrow()
  })
})

/** The two methods of Node's process the rejection check needs (the tests have no Node types). */
interface NodeLikeProcess {
  on: (event: 'unhandledRejection', listener: (reason: unknown) => void) => void
  off: (event: 'unhandledRejection', listener: (reason: unknown) => void) => void
}
