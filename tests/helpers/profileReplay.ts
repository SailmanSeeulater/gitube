/**
 * A fake GitHub for person mode's tests, moved here from tests/profileGraphql.test.ts unchanged so
 * other tests can replay the same recordings: the GraphQL recordings of kepano (2013 to 2026) and
 * sindresorhus's 2018 Q1, the REST recording of gaearon (Phase 1), a fetch that answers from a
 * router and records every call, and the routers that replay the recordings. A GraphQL request is
 * answered by the window aliases and bounds it asks for, and only for the selection it was recorded
 * with (anything else is an HTTP 400). See tests/profileGraphql.test.ts for what the recordings are.
 */
import kepanoFixture from '../fixtures/github/profile-graphql-kepano.json'
import sindreFixture from '../fixtures/github/profile-graphql-sindresorhus-2018q1.json'
import gaearon from '../fixtures/github/profile-gaearon.json'

/** The Phase 1 fixtures' clock: shortly after they were recorded. */
export const GAEARON_NOW = Date.parse('2026-10-25T09:00:00Z')
export const CORE_RESET = '1792918188'
export const GQL_RESET = '1792926000'

// ---------- recorded fixtures ----------

export interface Recorded {
  status: number
  headers: Record<string, string>
  body: unknown
}

export interface RecordedGql extends Recorded {
  variables: Record<string, string>
  /** selectionHash of the query this entry answers */
  selection: string
  body: { data: Record<string, unknown> }
}

export interface RecordedProfile {
  now: string
  user: Recorded & { body: { login: string; created_at: string } }
  graphql: RecordedGql[]
}

export interface RawWindowUser {
  contributionsCollection: {
    contributionCalendar: { weeks: Array<{ contributionDays: Array<{ date: string; contributionCount: number }> }> }
    commitContributionsByRepository: Array<{
      repository: { nameWithOwner: string; createdAt: string; pushedAt: string | null; primaryLanguage: { name: string; color: string } | null }
      contributions: { nodes: Array<{ occurredAt: string; commitCount: number }>; pageInfo: { hasNextPage: boolean } }
    }>
    pullRequestContributionsByRepository: Array<{
      repository: { nameWithOwner: string; isPrivate: boolean }
      contributions: { nodes: Array<{ occurredAt: string; pullRequest: { merged: boolean; mergedAt: string | null } }>; pageInfo: { hasNextPage: boolean } }
    }>
    restrictedContributionsCount: number
  }
}

export const KEPANO = kepanoFixture as unknown as RecordedProfile
export const SINDRE = sindreFixture as unknown as RecordedProfile
export const KEPANO_NOW = Date.parse(KEPANO.now)
export const SINDRE_NOW = Date.parse(SINDRE.now)

/** The window answers a recording holds, by alias, with the bounds they were asked for. */
export function windowIndex(rec: RecordedProfile): Map<string, { from: string; to: string; user: unknown; entry: RecordedGql }> {
  const index = new Map<string, { from: string; to: string; user: unknown; entry: RecordedGql }>()
  for (const entry of rec.graphql) {
    for (const key of Object.keys(entry.variables)) {
      if (!key.endsWith('_from')) continue
      const alias = key.slice(0, -'_from'.length)
      index.set(alias, { from: entry.variables[key], to: entry.variables[`${alias}_to`], user: entry.body.data[alias], entry })
    }
  }
  return index
}

export const KEPANO_WINDOWS = windowIndex(KEPANO)
export const SINDRE_WINDOWS = windowIndex(SINDRE)

/**
 * What a query selects, as a hash the fixtures store: its text with the window aliases folded away,
 * so that a batch of any windows selects the same as one of 4 (their variable declarations and
 * user(login) aliases collapse to one), then hashed with 64-bit FNV-1a, which is synchronous like
 * the replay. It tells a drifted query from the recorded one, nothing more.
 */
export function selectionHash(query: string): string {
  const folded = query
    .replace(/\bw\d{4}q[1-4]/g, 'w')
    .replace(/(, \$w_from: DateTime!, \$w_to: DateTime!)+/g, '$1')
    .replace(/( w: user\(login: \$login\) \{ contributionsCollection\(from: \$w_from, to: \$w_to\) \{ \.\.\.Window \} \})+/g, '$1')
  let h = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(folded)) h = ((h ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn
  return `fnv1a64:${h.toString(16).padStart(16, '0')}`
}

/** Every recorded window's collection, in date order. */
export function recordedCollections(rec: RecordedProfile): Array<[string, RawWindowUser['contributionsCollection']]> {
  return [...windowIndex(rec)].sort(([a], [b]) => (a < b ? -1 : 1)).map(([alias, w]) => [alias, (w.user as RawWindowUser).contributionsCollection])
}

// ---------- a fake GitHub ----------

export interface Route {
  status?: number
  body?: unknown
  headers?: Record<string, string>
  /** never answers: waits for the request's signal to abort */
  hang?: boolean
}

export interface Call {
  url: URL
  method: string
  headers: Headers
  body: { query: string; variables: Record<string, string> } | null
}

export type Router = (call: Call) => Route | undefined

export const CORE_HEADERS = { 'x-ratelimit-resource': 'core', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4321', 'x-ratelimit-reset': CORE_RESET }
export const GQL_HEADERS = { 'x-ratelimit-resource': 'graphql', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': GQL_RESET }

export function abortError(): Error {
  const err = new Error('The operation was aborted')
  err.name = 'AbortError'
  return err
}

/** Answers from router (404 for anything it does not know), recording every call and how many ran at once. */
export function makeFetch(router: Router): { fetch: typeof globalThis.fetch; calls: Call[]; maxInFlight: () => number } {
  const calls: Call[] = []
  let inFlight = 0
  let maxInFlight = 0
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(href)
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Call['body']) : null
    const call: Call = { url, method: (init?.method ?? 'GET').toUpperCase(), headers: new Headers(init?.headers), body }
    calls.push(call)
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      await new Promise((resolve) => setTimeout(resolve, 1))
      const signal = init?.signal
      if (signal?.aborted) throw abortError()
      const route = router(call) ?? { status: 404, body: { message: 'Not Found' } }
      if (route.hang) {
        await new Promise<void>((_, reject) => {
          if (!signal) return
          // The router may have aborted it already, and an abort fires its event only once.
          if (signal.aborted) return reject(abortError())
          signal.addEventListener('abort', () => reject(abortError()), { once: true })
        })
      }
      const defaults = url.pathname === '/graphql' ? GQL_HEADERS : CORE_HEADERS
      return new Response(JSON.stringify(route.body ?? null), {
        status: route.status ?? 200,
        headers: { 'content-type': 'application/json; charset=utf-8', ...defaults, ...route.headers },
      })
    } finally {
      inFlight--
    }
  }
  return { fetch, calls, maxInFlight: () => maxInFlight }
}

/** The window aliases a GraphQL call asks for, sorted (none for the repositories query). */
export function aliasesOf(call: Call): string[] {
  return Object.keys(call.body?.variables ?? {})
    .filter((k) => k.endsWith('_from'))
    .map((k) => k.slice(0, -'_from'.length))
    .sort()
}

export const graphqlCalls = (calls: Call[]) => calls.filter((c) => c.url.pathname === '/graphql')
export const windowCalls = (calls: Call[]) => graphqlCalls(calls).filter((c) => aliasesOf(c).length > 0)
export const restCalls = (calls: Call[]) => calls.filter((c) => c.url.pathname !== '/graphql')
export const isGraphql = (call: Call) => call.url.pathname === '/graphql'

/**
 * A GraphQL answer from a recording: the repositories page its cursor asks for, or each window it
 * asks for, from whichever batch recorded it, and only for the login and bounds it was recorded
 * with, and for the selection it was recorded for (anything else is a 400, so a wrong window or
 * bound, or a query whose fields changed since the recording, fails the test).
 */
export function replayGraphql(rec: RecordedProfile, index: Map<string, { from: string; to: string; user: unknown; entry: RecordedGql }>, call: Call): Route {
  const variables = call.body?.variables ?? {}
  const query = call.body?.query ?? ''
  const selection = selectionHash(query)
  const drifted: Route = { status: 400, body: { message: 'the query selects other fields than the recording: record the fixture again' } }
  if (variables.login !== rec.user.body.login) return { status: 400, body: { message: `unrecorded login ${variables.login}` } }
  const aliases = aliasesOf(call)
  if (aliases.length === 0) {
    const page = rec.graphql.find((e) => !Object.keys(e.variables).some((k) => k.endsWith('_from')) && (e.variables.after ?? null) === (variables.after ?? null))
    if (!page) return { status: 400, body: { message: 'unrecorded repositories page' } }
    if (page.selection !== selection) return drifted
    return { status: page.status, headers: page.headers, body: page.body }
  }
  const data: Record<string, unknown> = {}
  let first: RecordedGql | null = null
  for (const alias of aliases) {
    const w = index.get(alias)
    const asked = query.includes(`${alias}: user(login: $login) { contributionsCollection(from: $${alias}_from, to: $${alias}_to)`)
    if (!w || !asked || w.from !== variables[`${alias}_from`] || w.to !== variables[`${alias}_to`]) {
      return { status: 400, body: { message: `unrecorded window ${alias}` } }
    }
    if (w.entry.selection !== selection) return drifted
    data[alias] = w.user
    first ??= w.entry
  }
  data.rateLimit = first?.body.data.rateLimit
  return { status: 200, headers: first?.headers, body: { data } }
}

/** Synthesised: empty REST answers for a login (no repos, no events), for the fallback. */
export function emptyRest(login: string): Router {
  const base = `/users/${login.toLowerCase()}`
  return (call) => {
    const path = call.url.pathname.toLowerCase()
    if (path === `${base}/repos` || path === `${base}/events/public`) return { body: [] }
    return undefined
  }
}

/** kepano from the recording; override answers a GraphQL call first, rest adds empty REST answers. */
export function kepanoRouter(override?: (call: Call, aliases: string[]) => Route | undefined, rest = false): Router {
  const restRouter = emptyRest('kepano')
  return (call) => {
    if (call.url.pathname.toLowerCase() === '/users/kepano') return KEPANO.user
    if (isGraphql(call)) return override?.(call, aliasesOf(call)) ?? replayGraphql(KEPANO, KEPANO_WINDOWS, call)
    return rest ? restRouter(call) : undefined
  }
}

/** gaearon's recorded REST answers (Phase 1), with GraphQL answered by graphql. */
export function gaearonRouter(graphql: (call: Call) => Route | undefined): Router {
  return (call) => {
    if (isGraphql(call)) return graphql(call)
    const path = call.url.pathname.toLowerCase()
    const page = Number(call.url.searchParams.get('page') ?? '1')
    if (path === '/users/gaearon') return gaearon.user
    if (path === '/users/gaearon/repos') return gaearon.repos[page - 1]
    if (path === '/users/gaearon/events/public') return gaearon.events[page - 1]
    return undefined
  }
}
