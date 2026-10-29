/**
 * Person mode's fetchers: one GitHub user's repos over time, as ProfileData (PROFILE_SPEC.md
 * sections 2 and 3). Tier 1, here, needs no token: the REST identity call, the user's own repos
 * and their recent public pushes, 3 to 9 requests out of the same hourly budget repo mode spends.
 * Tier 2 (api/profileGraphql.ts) reads contributions over GraphQL with a token; both start from the
 * same identity call here, and fetchProfile picks the tier and falls back from GraphQL to REST.
 *
 * Days are GitHub's: a day key is the date in US Pacific time, never the viewer's time zone.
 */
import type { Octokit } from '@octokit/rest'
import { GitHubFetchError } from '../types'
import type { FetchProgress, ProfileData, ProfileFetchStage, ProfileRepo } from '../types'
import {
  PER_PAGE,
  createCountingClient,
  hasNextLink,
  scrub,
  toFetchError,
  type ErrorContext,
  type HeaderBag,
  type RateState,
} from './http'
import { readProfile, rememberProfile, type ProfileStore, type ProfileTier } from './profileCache'
import { UseRest, graphqlProfile } from './profileGraphql'

export interface ProfileFetchOptions {
  token?: string
  signal?: AbortSignal
  /** Fetch implementation handed to Octokit; defaults to globalThis.fetch. Tests inject a fake. */
  fetch?: typeof globalThis.fetch
  onProgress?: (progress: FetchProgress) => void
  /** The clock (ms since the epoch): where the recent window ends, and the cache's now. Default Date.now(). */
  now?: number
}

/** At most this many pages of 100 repos (500 repos), in either tier; a page beyond them sets truncated. */
export const MAX_REPO_PAGES = 5
/** GitHub keeps 300 public events and answers a 4th page of 100 with HTTP 422. */
const MAX_EVENT_PAGES = 3
/** GitHub keeps this many days of public events. */
const EVENT_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
/** GitHub counts days in US Pacific time. */
const GITHUB_TIME_ZONE = 'America/Los_Angeles'

/**
 * Structural views of the REST answers read here. Kept minimal so both Octokit's generated types
 * and the slimmed fixtures fit.
 */
interface RawUser {
  login: string
  name?: string | null
  avatar_url: string
  created_at: string
  type: string
}

interface RawRepo {
  full_name: string
  created_at?: string | null
  pushed_at?: string | null
  language?: string | null
  stargazers_count?: number
  forks_count?: number
  fork: boolean
  archived?: boolean
  private: boolean
}

interface RawEvent {
  /** GitHub's id for the event (the recorded fixtures were slimmed without it) */
  id?: string
  type: string | null
  created_at: string | null
  repo: { name: string }
}

/**
 * One profile fetch's shared machinery, whichever tier fills it: the client (which counts every
 * request, GraphQL ones included), the clock, progress, and the error context about the user.
 */
export interface ProfileSession {
  octokit: Octokit
  state: RateState
  /** the login as typed, trimmed */
  typed: string
  /** whom errors name: the typed login until the identity call has answered, then GitHub's spelling */
  subject: string
  token: string | undefined
  signal: AbortSignal | undefined
  now: number
  emit: (stage: ProfileFetchStage, done: number, total: number, message: string) => void
  throwIfAborted: () => void
  /** An error context about the user (session.subject). */
  ctx: (what: string) => ErrorContext
}

/** What the identity call says of a user. */
export interface ProfileIdentity {
  /** as GitHub spells it */
  login: string
  name: string | null
  avatarUrl: string
  createdAt: string
}

/** Sets up one fetch for login: refuses an empty login, and creates the counting client and progress. */
export function openProfileSession(login: string, opts: ProfileFetchOptions): ProfileSession {
  const typed = login.trim()
  if (!typed) throw new GitHubFetchError('No GitHub user given', 'invalid_url')
  const signal = opts.signal
  const token = opts.token?.trim() || undefined
  const state: RateState = { requestsUsed: 0, remaining: null, resetAt: null }
  const octokit = createCountingClient({ token, fetch: opts.fetch, signal }, state)
  const session: ProfileSession = {
    octokit,
    state,
    typed,
    subject: typed,
    token,
    signal,
    now: opts.now ?? Date.now(),
    emit: (stage, done, total, message) => {
      if (!opts.onProgress) return
      opts.onProgress({
        stage,
        done,
        total,
        message,
        requestsUsed: state.requestsUsed,
        rateLimitRemaining: state.remaining,
        rateLimitResetAt: state.resetAt,
      })
    },
    throwIfAborted: () => {
      if (signal?.aborted) throw new GitHubFetchError('Fetch aborted', 'aborted')
    },
    ctx: (what) => ({ what, signal, token, subject: { login: session.subject } }),
  }
  return session
}

/**
 * The identity call both tiers start with (1 core request): it settles not_found and not_a_user
 * (an organization or a bot) before any other request, so no GraphQL refusal or limit can hide them.
 */
export async function fetchIdentity(session: ProfileSession): Promise<ProfileIdentity> {
  session.throwIfAborted()
  let user: RawUser
  try {
    user = (await session.octokit.users.getByUsername({ username: session.typed })).data
  } catch (err) {
    throw toFetchError(err, session.ctx(`looking up ${session.typed}`))
  }
  if (user.type !== 'User') {
    const message = `${user.login} is a GitHub ${String(user.type)} account, not a user.`
    throw new GitHubFetchError(scrub(message, session.token), 'not_a_user')
  }
  session.subject = user.login
  session.emit('user', 1, 1, `Found ${user.login}, on GitHub since ${user.created_at.slice(0, 10)}`)
  return { login: user.login, name: user.name ?? null, avatarUrl: user.avatar_url, createdAt: user.created_at }
}

/**
 * Tier 1: a user's profile from REST alone, no token needed. One identity call settles not_found
 * and not_a_user first; then the user's own repos, oldest first (up to 500), and their public
 * push events of about the last 30 days, which are optional: if they fail the profile stands with
 * no recent pushes. Only an abort stops the whole fetch from there.
 */
export async function fetchProfileRest(login: string, opts: ProfileFetchOptions = {}): Promise<ProfileData> {
  const session = openProfileSession(login, opts)
  return restProfile(session, await fetchIdentity(session))
}

/**
 * The profile of a token run: GraphQL (tier 2) when it answers, else REST (tier 1) with the reason
 * in fallback. Without a token, REST alone. The identity call comes first and is made once: an
 * abort, a network error, a core rate limit on it (REST would hit the same wall), not_found and
 * not_a_user end the fetch there. After it, GraphQL falls back to REST on a refusal, a GraphQL rate
 * limit (primary or secondary: the core budget REST spends is separate), a timeout after the
 * halving ladder, a schema error or anything unknown, but never on an abort or a network error.
 */
export async function fetchProfile(login: string, opts: ProfileFetchOptions = {}): Promise<ProfileData> {
  if (!opts.token?.trim()) return fetchProfileRest(login, opts)
  const session = openProfileSession(login, opts)
  const identity = await fetchIdentity(session)
  try {
    return await graphqlProfile(session, identity)
  } catch (err) {
    if (!(err instanceof UseRest)) throw err
    const fallback = describeFallback(err)
    session.emit('repos', 0, 0, `GraphQL failed, reading the public profile over REST: ${fallback.message}`)
    const profile = await restProfile(session, identity)
    return { ...profile, fallback }
  }
}

/**
 * Why REST filled a token run's profile, in describePullsError's shape (hooks/usePulls.ts, which
 * this lazy module does not import): which limit a rate limit hit, read from its message the same
 * way. The GraphQL path's messages never hold the login, so a login cannot flip the reading.
 */
export function describeFallback(err: GitHubFetchError): NonNullable<ProfileData['fallback']> {
  const limit = err.code !== 'rate_limited' ? null : /secondary/i.test(err.message) ? 'secondary' : /GraphQL/i.test(err.message) ? 'graphql' : null
  return { message: err.message, limit, resetAt: err.resetAt ?? null }
}

/** Tier 1 after the identity call: the user's own repos, then their recent public pushes. */
async function restProfile(session: ProfileSession, user: ProfileIdentity): Promise<ProfileData> {
  const { octokit, emit, throwIfAborted, now } = session
  const ctx = session.ctx

  // ---------- own repos, oldest first ----------
  // direction=asc because sort=created defaults to newest first, which would make the cap drop
  // the start of the career rather than its end.
  const repos: ProfileRepo[] = []
  let truncated = false
  try {
    for (let page = 1; ; page++) {
      throwIfAborted()
      const res = await octokit.repos.listForUser({
        username: user.login,
        type: 'owner',
        sort: 'created',
        direction: 'asc',
        per_page: PER_PAGE,
        page,
      })
      for (const raw of res.data) {
        const repo = normaliseRepo(raw)
        if (repo) repos.push(repo)
      }
      emit('repos', repos.length, repos.length, `Listed ${repos.length} repos`)
      if (!hasNextLink(res.headers as HeaderBag, res.data.length) || res.data.length === 0) break
      if (page >= MAX_REPO_PAGES) {
        truncated = true
        const cap = MAX_REPO_PAGES * PER_PAGE
        emit('repos', repos.length, repos.length, `Repo cap of ${cap} reached: more repos exist beyond the fetched pages`)
        break
      }
    }
  } catch (err) {
    throw toFetchError(err, ctx(`listing the repos of ${user.login}`))
  }

  // ---------- recent pushes (optional) ----------
  // Until the events come back whole, recent stays empty and recentFrom says 30 days ago.
  let recent: ProfileData['recent'] = []
  let recentFrom = pacificDay(now - EVENT_DAYS * DAY_MS)
  try {
    const events: RawEvent[] = []
    // The feed is newest first and pages are read one after another, so a page can repeat events
    // the one before it ended with (new events shifted the list, or a page came from the browser's
    // cache): each is counted once.
    const seen = new Set<string>()
    let pages = 0
    for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
      throwIfAborted()
      const res = await octokit.activity.listPublicEventsForUser({ username: user.login, per_page: PER_PAGE, page })
      for (const event of res.data as RawEvent[]) {
        if (event.id !== undefined) {
          if (seen.has(event.id)) continue
          seen.add(event.id)
        }
        events.push(event)
      }
      pages = page
      emit('events', page, MAX_EVENT_PAGES, `Read ${events.length} recent events`)
      if (!hasNextLink(res.headers as HeaderBag, res.data.length) || res.data.length === 0) break
    }
    // Having served all three pages, GitHub may have dropped older events to its 300 cap, so
    // what came back covers only the days from the oldest one on. Pages can hold fewer than 100
    // events even then (a live recording had pages of 99, 100 and 80), so the count cannot tell.
    if (pages === MAX_EVENT_PAGES) recentFrom = oldestDay(events) ?? recentFrom
    recent = pushDays(events, recentFrom)
  } catch (err) {
    const failure = toFetchError(err, ctx(`reading the recent pushes of ${user.login}`))
    if (failure.code === 'aborted') throw failure
    emit('events', MAX_EVENT_PAGES, MAX_EVENT_PAGES, `Skipped recent pushes: ${failure.message}`)
  }

  emit('done', 1, 1, `Done: ${repos.length} repos, ${session.state.requestsUsed} requests`)

  return {
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    source: 'rest',
    repos,
    days: [],
    recent,
    recentFrom,
    landed: [],
    milestones: [{ kind: 'joined', date: user.createdAt, label: 'Joined GitHub' }],
    restrictedContributions: 0,
    truncated,
    lostWindows: [],
    fallback: null,
  }
}

/**
 * A profile from the cache when a fresh one of this run's tier is there (a token run reads only
 * what GraphQL filled, a tokenless one only what REST filled), otherwise from GitHub, remembered
 * under that tier. live skips the cache read, as Refresh does. cachedAt is when the cached copy
 * was fetched, null for a fetch.
 */
export async function loadProfile(
  login: string,
  opts: ProfileFetchOptions & { store: ProfileStore | null; live?: boolean },
): Promise<{ profile: ProfileData; cachedAt: string | null }> {
  const { store, live, ...fetchOpts } = opts
  const tier: ProfileTier = opts.token?.trim() ? 'graphql' : 'rest'
  if (store && !live) {
    // A storage failure is a cache miss: the app then simply fetches.
    const hit = await readProfile(store, login, tier, opts.now ?? Date.now()).catch(() => null)
    if (hit) return { profile: hit.data, cachedAt: hit.savedAt }
  }
  // With a token GraphQL fills the profile, or REST after a fallback; rememberProfile stores a
  // profile only under the tier that filled it, and never one with a fallback.
  const profile = await fetchProfile(login, fetchOpts)
  if (store) {
    // The profile is in hand: failing to remember it must not lose it.
    await rememberProfile(store, profile, tier, opts.now ?? Date.now()).catch(() => undefined)
  }
  return { profile, cachedAt: null }
}

// ---------- helpers ----------

let pacificFormat: Intl.DateTimeFormat | null = null

/** GitHub's day for an instant (ms since the epoch): its date in US Pacific time, as 'YYYY-MM-DD'. */
export function pacificDay(ms: number): string {
  pacificFormat ??= new Intl.DateTimeFormat('en-US', {
    timeZone: GITHUB_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = pacificFormat.formatToParts(ms)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** A tier 1 repo: one span from its birth to its last push. */
function normaliseRepo(raw: RawRepo): ProfileRepo | null {
  const createdAt = raw.created_at
  // GitHub always sends created_at; a repo without one would have no place on the timeline.
  if (!createdAt) return null
  return {
    nameWithOwner: raw.full_name,
    createdAt,
    firstActiveAt: createdAt,
    // pushed_at may be null, and a fork's can predate its created_at (it keeps the parent's).
    lastActiveAt: laterOf(createdAt, raw.pushed_at ?? createdAt),
    isOwn: true,
    language: raw.language ?? null,
    languageColor: null,
    stars: raw.stargazers_count ?? 0,
    forks: raw.forks_count ?? 0,
    isFork: raw.fork,
    isArchived: raw.archived ?? false,
    isPrivate: raw.private,
    activity: [],
  }
}

/** The later of two ISO times; a when b does not parse or is not later. */
export function laterOf(a: string, b: string): string {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return Number.isFinite(tb) && (!Number.isFinite(ta) || tb > ta) ? b : a
}

function eventDay(event: RawEvent): string | null {
  const t = Date.parse(event.created_at ?? '')
  return Number.isFinite(t) ? pacificDay(t) : null
}

/** The day of the oldest event of any kind, or null when there is none. */
function oldestDay(events: ReadonlyArray<RawEvent>): string | null {
  let oldest: string | null = null
  for (const event of events) {
    const day = eventDay(event)
    if (day !== null && (oldest === null || day < oldest)) oldest = day
  }
  return oldest
}

/**
 * Pushes per repo per day from `from` on, by date then repo. Since 2025-10-07 a PushEvent carries
 * no commit list or count, so a push is all that can be counted.
 */
function pushDays(events: ReadonlyArray<RawEvent>, from: string): ProfileData['recent'] {
  const counts = new Map<string, { date: string; repo: string; pushes: number }>()
  for (const event of events) {
    if (event.type !== 'PushEvent') continue
    const date = eventDay(event)
    if (date === null || date < from) continue
    const key = `${date} ${event.repo.name}`
    const entry = counts.get(key)
    if (entry) entry.pushes += 1
    else counts.set(key, { date, repo: event.repo.name, pushes: 1 })
  }
  return [...counts.values()].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0,
  )
}
