/**
 * Page and event counts through the self-hosted Umami at stats.latesailor.dev.
 *
 * The privacy rules (README, "Analytics"):
 * - Umami never receives the GitHub token, the query string, or the URL path. Share links carry repo
 *   names, contributor logins and battle repos, and with a token those can be private. The tracker
 *   is told to drop the query string (data-exclude-search), and beforeSend cuts every page URL down
 *   to the origin and every referrer down to its origin, so neither a query string nor a path is sent.
 * - Event data may carry a repo name or login only when it was fetched without a token (so it is
 *   public). With a token set, track() drops those keys whatever the caller passed.
 * - Every value is checked: anything that looks like a token or a query string is dropped, and
 *   strings are clipped to MAX_VALUE_LENGTH.
 *
 * The tracker is a script on stats.latesailor.dev, injected after the page has loaded, so the app's
 * own bundle carries none of it. Events tracked while it is on its way wait for it (the first
 * MAX_QUEUED_EVENTS of them) and are sent once it has loaded; if it fails to load they are dropped.
 * Unless initAnalytics adds it, track() is a no-op.
 */
import { useGardenStore } from '../store/useGardenStore'

export const UMAMI_HOST = 'https://stats.latesailor.dev'
/** Where pageviews count; the tracker ignores every other hostname (localhost included). */
export const UMAMI_DOMAINS = 'repogarden.latesailor.dev'
export const MAX_VALUE_LENGTH = 50
/** How many events wait for the tracker while it loads; the first ones are kept, the rest dropped. */
export const MAX_QUEUED_EVENTS = 20
/** The global the tracker's data-before-send attribute names. */
export const BEFORE_SEND_GLOBAL = 'gitubeBeforeSend'

/** The complete list of custom events; nothing else is sent. */
export type AnalyticsEvent =
  | 'grow'
  | 'layout-switch'
  | 'theme-switch'
  | 'view-mode'
  | 'timelapse-play'
  | 'export'
  | 'battle-start'
  | 'pr-overlay'
  | 'share-copy'
  | 'token-added'
  | 'fetch-error'
  | 'poster-export'
  | 'view-switch'

export type EventData = Record<string, string | number | boolean>

/** Keys that hold a repo name or a login: kept only while no token is set. */
const NAME_KEYS = new Set(['repo', 'login'])

/** GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_, fine-grained github_pat_, and the old 40-hex ones. */
const TOKEN_RE = /gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|\b[0-9a-f]{40}\b/i
/** Something of a query string: a key= parameter, after ? or & or on its own (repo=acme/app). */
const QUERY_RE = /[^=\s?&]+=/
/** How many characters running in the token give part of it away. */
const TOKEN_SLICE = 8
const WEBSITE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface UmamiTracker {
  track: (event: string, data?: EventData) => unknown
}

declare global {
  interface Window {
    umami?: UmamiTracker
    [BEFORE_SEND_GLOBAL]?: typeof beforeSend
  }
}

interface QueuedEvent {
  event: AnalyticsEvent
  data?: EventData
}

/** Events tracked while the tracker is on its way; null when it is not (never added, loaded, or failed). */
let queue: QueuedEvent[] | null = null

interface Context {
  /** the token as set now, '' when none */
  token: string
  /** location.search as it is now */
  search: string
}

function currentContext(): Context {
  let token = ''
  try {
    token = useGardenStore.getState().token
  } catch {
    // no store: treat it as tokenless, but the value checks below still run
  }
  const search = typeof window !== 'undefined' && typeof window.location?.search === 'string' ? window.location.search : ''
  return { token, search }
}

/** Whether the value holds the token, or any TOKEN_SLICE characters running in it. */
function holdsToken(value: string, token: string): boolean {
  if (token.length <= TOKEN_SLICE) return value.includes(token)
  for (let i = 0; i + TOKEN_SLICE <= token.length; i++) {
    if (value.includes(token.slice(i, i + TOKEN_SLICE))) return true
  }
  return false
}

function droppable(value: string, { token, search }: Context): boolean {
  if (TOKEN_RE.test(value) || QUERY_RE.test(value)) return true
  if (token && holdsToken(value, token)) return true
  return search.length > 1 && value.includes(search)
}

/** The data with names dropped under a token, token- and query-like values dropped, strings clipped. */
export function sanitize(data: Record<string, unknown>, context: Context = currentContext()): EventData {
  const clean: EventData = {}
  for (const [key, value] of Object.entries(data)) {
    if (context.token && NAME_KEYS.has(key)) continue
    if (typeof value === 'boolean') clean[key] = value
    else if (typeof value === 'number') {
      if (Number.isFinite(value)) clean[key] = value
    } else if (typeof value === 'string') {
      if (!droppable(value, context)) clean[key] = value.slice(0, MAX_VALUE_LENGTH)
    }
  }
  return clean
}

/**
 * Sends a custom event. While the tracker is on its way the event waits for it; without the tracker
 * it does nothing. Never throws.
 */
export function track(event: AnalyticsEvent, data?: EventData): void {
  try {
    const umami = typeof window === 'undefined' ? undefined : window.umami
    if (!umami || typeof umami.track !== 'function') {
      // sanitized as it waits too, so a token cleared before the tracker arrives brings no name back
      if (queue && queue.length < MAX_QUEUED_EVENTS) queue.push({ event, data: data ? sanitize(data) : undefined })
      return
    }
    // sanitized now, not when it was tracked, so a token set while it waited still drops names
    const clean = data ? sanitize(data) : {}
    const sent = Object.keys(clean).length > 0 ? umami.track(event, clean) : umami.track(event)
    // the tracker's send is async; a failure there is none of the app's business
    if (sent instanceof Promise) sent.catch(() => {})
  } catch {
    // analytics never breaks the app
  }
}

/** The tracker has loaded: sends the events that waited for it, in order. */
function flushQueue(): void {
  const waiting = queue ?? []
  queue = null
  for (const { event, data } of waiting) track(event, data)
}

/** The tracker failed to load: the events that waited for it are never sent. */
function dropQueue(): void {
  queue = null
}

/** The URL's origin, or '' when it has none (unparsable, or an opaque origin such as data:). */
function originOf(url: string): string {
  try {
    const { origin } = new URL(url)
    return origin === 'null' ? '' : origin
  } catch {
    return ''
  }
}

/**
 * The tracker's last step before each request (data-before-send): sends no path, query string or
 * fragment, and sanitizes event data, so the rules hold even if the tracker's own attributes stopped
 * working. The page URL becomes its origin and '/': the server answers every path with the app, so
 * a path like /acme/secret-repo could carry a private repo name, and the app has one route, so a path
 * says nothing worth counting. A referrer from this site (which the tracker turns into a path)
 * becomes '/', one from anywhere else its origin.
 */
export function beforeSend(_type: string, payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload }
  if (typeof out.url === 'string') out.url = `${originOf(out.url)}/`
  if (typeof out.referrer === 'string') {
    out.referrer = out.referrer === '' ? '' : out.referrer.startsWith('/') ? '/' : originOf(out.referrer)
  }
  if (out.data !== null && typeof out.data === 'object') out.data = sanitize(out.data as Record<string, unknown>)
  return out
}

export interface AnalyticsEnv {
  PROD: boolean
  VITE_UMAMI_WEBSITE_ID?: string
  /** comma-separated hostnames to count instead of UMAMI_DOMAINS, for checking a local build only */
  VITE_UMAMI_DOMAINS?: string
}

/**
 * Adds the tracker script once the page has loaded, in a production build with a website ID set.
 * Returns whether it will be added.
 */
export function initAnalytics(env: AnalyticsEnv = import.meta.env): boolean {
  try {
    if (!env.PROD) return false
    const id = env.VITE_UMAMI_WEBSITE_ID?.trim() ?? ''
    if (!WEBSITE_ID_RE.test(id)) return false
    if (typeof window === 'undefined' || typeof document === 'undefined') return false
    // already added, or waiting for the load event to be
    if (window[BEFORE_SEND_GLOBAL] || document.querySelector(`script[src="${UMAMI_HOST}/script.js"]`)) return false
    window[BEFORE_SEND_GLOBAL] = beforeSend
    // from here on, events wait for the tracker instead of going nowhere
    queue ??= []
    const inject = () => {
      const script = document.createElement('script')
      script.src = `${UMAMI_HOST}/script.js`
      script.defer = true
      script.referrerPolicy = 'no-referrer'
      // fetched with CORS (the server allows any origin), so no cookie goes with it
      script.crossOrigin = 'anonymous'
      script.setAttribute('data-website-id', id)
      script.setAttribute('data-exclude-search', 'true')
      script.setAttribute('data-exclude-hash', 'true')
      script.setAttribute('data-do-not-track', 'true')
      script.setAttribute('data-domains', env.VITE_UMAMI_DOMAINS?.trim() || UMAMI_DOMAINS)
      script.setAttribute('data-before-send', BEFORE_SEND_GLOBAL)
      // the tracker defines window.umami as it runs, so by its load event the waiting events can go
      script.addEventListener('load', flushQueue, { once: true })
      script.addEventListener('error', dropQueue, { once: true })
      document.head.appendChild(script)
    }
    // from the load event a failure would only be an uncaught error; with no script coming, nothing waits
    const injectLater = () => {
      try {
        inject()
      } catch {
        dropQueue()
      }
    }
    // after the app's own files, so the tracker never competes with them
    if (document.readyState === 'complete') inject()
    else window.addEventListener('load', injectLater, { once: true })
    return true
  } catch {
    dropQueue()
    return false
  }
}
