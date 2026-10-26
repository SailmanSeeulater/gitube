/**
 * Person mode's tier 2 fetcher: a user's contributions over GraphQL, with a token (PROFILE_SPEC.md
 * section 2, "Tier 2"). After the REST identity call it shares with tier 1 (api/profile.ts), one
 * query lists the years the user contributed in and their own repos (up to 500, oldest first); then
 * their contributions are read in calendar quarters, each quarter its own `user(login)` alias, 4 to
 * a query (about one query per year of account age), one query after another. Modelled on the pull
 * request client (api/pulls.ts): a slow or 5xx query is retried in halves, and a partial answer
 * keeps the quarters that came back.
 *
 * Days are GitHub's: the calendar's dates as GitHub sends them, and a contribution's occurredAt
 * (midnight US Pacific time) read in America/Los_Angeles.
 */
import { GitHubFetchError } from '../types'
import type { ProfileData, ProfileMilestone, ProfileRepo } from '../types'
import { GRAPHQL_TIMEOUT_MS, withTimeout } from './graphql'
import { errorStatus, hasHttpResponse, parseResetAt, readHeader, scrub, toFetchError, type HeaderBag } from './http'
import {
  MAX_REPO_PAGES,
  fetchIdentity,
  laterOf,
  openProfileSession,
  pacificDay,
  type ProfileFetchOptions,
  type ProfileIdentity,
  type ProfileSession,
} from './profile'

/** Quarter windows per query: a year. */
export const WINDOWS_PER_QUERY = 4
/** Repos per page of the repositories query; also the most repos, and contributions per repo, a window reads. */
const PAGE = 100
/** A window's alias: w, the year, q and the quarter (w2019q1). */
const WINDOW_ALIAS = /^w\d{4}q[1-4]$/

/**
 * A GraphQL failure REST may still answer: a refusal, a GraphQL rate limit (primary or secondary),
 * a timeout after the halving ladder, a schema error or anything unknown. fetchProfile falls back
 * to tier 1 on it; any other error (an abort, a network error) ends the fetch.
 */
export class UseRest extends GitHubFetchError {}

/**
 * One window alone still got no answer (a timeout or a 5xx) at the bottom of the halving ladder.
 * fetchProfile falls back on it like any UseRest; readBatch's solo retry of a window that errored
 * loses only that window to it.
 */
class WindowTimeout extends UseRest {}

// ---------- queries ----------

const REPO_FIELDS =
  'nameWithOwner createdAt pushedAt isFork isArchived isPrivate stargazerCount forkCount primaryLanguage { name color }'

/** The years the user contributed in, and a page of their own repos, oldest first ($after reads on). */
export const REPOS_QUERY =
  'query($login: String!, $after: String) { rateLimit { cost remaining resetAt } user(login: $login) { ' +
  'contributionsCollection { contributionYears } ' +
  `repositories(ownerAffiliations: OWNER, first: ${PAGE}, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) { ` +
  'nodes { ...RepoFields } pageInfo { hasNextPage endCursor } } } }\n' +
  `fragment RepoFields on Repository { ${REPO_FIELDS} }`

/**
 * What one window reads. The first* fields are unions: a contribution GitHub may show in full, or a
 * RestrictedContribution (a private repo the viewer cannot see) with its date alone.
 */
const WINDOW_FIELDS =
  'contributionCalendar { weeks { contributionDays { date contributionCount } } } ' +
  `commitContributionsByRepository(maxRepositories: ${PAGE}) { repository { ...RepoFields } ` +
  `contributions(first: ${PAGE}) { nodes { occurredAt commitCount } pageInfo { hasNextPage } } } ` +
  'firstPullRequestContribution { ... on CreatedPullRequestContribution { occurredAt pullRequest { repository { nameWithOwner isPrivate } } } ' +
  '... on RestrictedContribution { occurredAt } } ' +
  'firstIssueContribution { ... on CreatedIssueContribution { occurredAt issue { repository { nameWithOwner isPrivate } } } ' +
  '... on RestrictedContribution { occurredAt } } ' +
  'firstRepositoryContribution { ... on CreatedRepositoryContribution { occurredAt repository { nameWithOwner isPrivate } } ' +
  '... on RestrictedContribution { occurredAt } } ' +
  'joinedGitHubContribution { occurredAt } restrictedContributionsCount'

/** One calendar quarter of contributions, asked as its own user(login) alias. */
export interface QuarterWindow {
  /** the alias it is asked under: 'w2019q1' */
  alias: string
  /** how lostWindows names it: '2019q1' */
  key: string
  /** ISO, inclusive: the quarter's first instant (UTC) */
  from: string
  /** ISO, inclusive: 1 ms before the next quarter starts, or now for the current quarter */
  to: string
}

/**
 * The calendar quarters from January 1 of firstYear up to now. A quarter that starts after now is
 * not asked for, and the current one ends at now: GitHub would otherwise send zero-count days up
 * to the quarter's end.
 */
export function quarterWindows(firstYear: number, now: number): QuarterWindow[] {
  const windows: QuarterWindow[] = []
  for (let year = firstYear; ; year++) {
    for (let q = 0; q < 4; q++) {
      const start = Date.UTC(year, q * 3, 1)
      if (start > now) return windows
      // `to` is inclusive, so a window ends 1 ms before the next one starts.
      const end = Math.min(Date.UTC(year, q * 3 + 3, 1) - 1, now)
      windows.push({
        alias: `w${year}q${q + 1}`,
        key: `${year}q${q + 1}`,
        from: new Date(start).toISOString(),
        to: new Date(end).toISOString(),
      })
    }
  }
}

/**
 * One query for these windows. Each is its own user(login) alias, because everything below user is
 * non-null: an error anywhere in a window nulls its enclosing user, so windows sharing one user
 * would all be lost together. Its bounds travel as variables named after the alias.
 */
export function buildWindowQuery(login: string, windows: ReadonlyArray<QuarterWindow>): { query: string; variables: Record<string, string> } {
  const decls = ['$login: String!']
  const variables: Record<string, string> = { login }
  const aliases = windows.map((w) => {
    decls.push(`$${w.alias}_from: DateTime!`, `$${w.alias}_to: DateTime!`)
    variables[`${w.alias}_from`] = w.from
    variables[`${w.alias}_to`] = w.to
    return `${w.alias}: user(login: $login) { contributionsCollection(from: $${w.alias}_from, to: $${w.alias}_to) { ...Window } }`
  })
  const query =
    `query(${decls.join(', ')}) { rateLimit { cost remaining resetAt } ${aliases.join(' ')} }\n` +
    `fragment Window on ContributionsCollection { ${WINDOW_FIELDS} }\n` +
    `fragment RepoFields on Repository { ${REPO_FIELDS} }`
  return { query, variables }
}

// ---------- answers ----------

interface GqlRateLimit {
  cost?: number | null
  remaining?: number | null
  resetAt?: string | null
}

interface GqlRepo {
  nameWithOwner: string
  createdAt: string
  pushedAt?: string | null
  isFork?: boolean | null
  isArchived?: boolean | null
  isPrivate?: boolean | null
  stargazerCount?: number | null
  forkCount?: number | null
  primaryLanguage?: { name?: string | null; color?: string | null } | null
}

interface GqlRepoRef {
  nameWithOwner?: string | null
  isPrivate?: boolean | null
}

/** A first*Contribution: the created kind carries its repository, a RestrictedContribution only its date. */
interface GqlFirst {
  occurredAt?: string | null
  pullRequest?: { repository?: GqlRepoRef | null } | null
  issue?: { repository?: GqlRepoRef | null } | null
  repository?: GqlRepoRef | null
}

interface GqlCollection {
  contributionCalendar?: {
    weeks?: Array<{ contributionDays?: Array<{ date: string; contributionCount?: number | null } | null> | null } | null> | null
  } | null
  commitContributionsByRepository?: Array<{
    repository?: GqlRepo | null
    contributions?: {
      nodes?: Array<{ occurredAt?: string | null; commitCount?: number | null } | null> | null
      pageInfo?: { hasNextPage?: boolean | null } | null
    } | null
  } | null> | null
  firstPullRequestContribution?: GqlFirst | null
  firstIssueContribution?: GqlFirst | null
  firstRepositoryContribution?: GqlFirst | null
  joinedGitHubContribution?: { occurredAt?: string | null } | null
  restrictedContributionsCount?: number | null
}

interface GqlReposData {
  rateLimit?: GqlRateLimit | null
  user?: {
    contributionsCollection?: { contributionYears?: number[] | null } | null
    repositories?: {
      nodes?: Array<GqlRepo | null> | null
      pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null
    } | null
  } | null
}

type GqlWindowData = { rateLimit?: GqlRateLimit | null } & Record<string, unknown>

/** One entry of a GraphQL answer's errors. */
export interface GqlError {
  type?: string
  message?: string
  path?: ReadonlyArray<string | number>
  extensions?: { code?: string } | null
}

/**
 * The windows a partial answer's errors name, the way gqlErrorMarks (api/pulls.ts) reads branches:
 * an error whose path starts at one of this query's window aliases belongs to that window, wherever
 * below it it struck (GitHub nulls a failed field and, through non-null fields, its parents up to
 * the alias). An error with no such path (rateLimit, a validation error under 'query', none at all)
 * names no window.
 */
export function windowErrorMarks(errors: ReadonlyArray<GqlError>, aliases: ReadonlyArray<string>): Set<string> {
  const asked = new Set(aliases)
  const marked = new Set<string>()
  for (const error of errors) {
    const head = error.path?.[0]
    if (typeof head === 'string' && WINDOW_ALIAS.test(head) && asked.has(head)) marked.add(head)
  }
  return marked
}

type GqlAnswer<T> = { kind: 'data'; data: T | null; errors: GqlError[] } | { kind: 'transient'; reason: string }

/** A GraphQL rate limit as the failure fetchProfile falls back on. The message names no login. */
function limitError(secondary: boolean, what: string, resetAt: string | null): UseRest {
  const when = resetAt ? ` Retry after ${resetAt}.` : ''
  return secondary
    ? new UseRest(`GitHub secondary rate limit hit while ${what}.${when}`, 'rate_limited', resetAt)
    : new UseRest(`GitHub GraphQL rate limit exceeded while ${what}.${when}`, 'rate_limited', resetAt)
}

/**
 * One GraphQL query under its own timeout. An answer comes back as data, with any errors it carried
 * (the caller reads them per window); a slow or 5xx one as transient, for the halving ladder.
 * Throws a UseRest for a GraphQL rate limit (an HTTP 403/429, or a RATE_LIMITED error), a refusal
 * (any other 401/403) or another HTTP failure, and a plain GitHubFetchError for an abort or a
 * network error. GitHub sends x-ratelimit-resource: graphql on every /graphql answer, so that
 * header alone says nothing: x-ratelimit-remaining and retry-after tell the limits apart, as
 * toFetchError reads them.
 */
async function runQuery<T extends { rateLimit?: GqlRateLimit | null }>(
  session: ProfileSession,
  query: string,
  variables: Record<string, string>,
  what: string,
): Promise<GqlAnswer<T>> {
  const timer = withTimeout(session.signal, GRAPHQL_TIMEOUT_MS)
  try {
    const data = await session.octokit.graphql<T>(query, { ...variables, request: { signal: timer.signal } })
    return { kind: 'data', data, errors: [] }
  } catch (err) {
    if (session.signal?.aborted) throw new GitHubFetchError(`Fetch aborted while ${what}`, 'aborted')
    if (timer.timedOut()) return { kind: 'transient', reason: `no answer within ${GRAPHQL_TIMEOUT_MS / 1000} s` }
    const e = err as { name?: string; errors?: GqlError[]; data?: T | null; headers?: HeaderBag }
    if (e.name === 'GraphqlResponseError' && Array.isArray(e.errors)) {
      const limited = e.errors.find((x) => (x.type ?? '').toUpperCase() === 'RATE_LIMITED')
      if (limited) {
        const resetAt = e.data?.rateLimit?.resetAt ?? parseResetAt(e.headers)
        throw limitError(/secondary/i.test(limited.message ?? ''), what, resetAt ?? null)
      }
      return { kind: 'data', data: e.data ?? null, errors: e.errors }
    }
    const status = errorStatus(err)
    if (status === 401 || status === 403 || status === 429) {
      const failure = toFetchError(err, session.ctx(what))
      if (failure.code === 'rate_limited') {
        const headers = (err as { response?: { headers?: HeaderBag } }).response?.headers
        const primary = readHeader(headers, 'x-ratelimit-remaining') === '0'
        throw limitError(!primary, what, failure.resetAt ?? null)
      }
      throw new UseRest(failure.message, 'unauthorized')
    }
    if (hasHttpResponse(err) && status !== undefined && status >= 500) return { kind: 'transient', reason: `HTTP ${status}` }
    const failure = toFetchError(err, session.ctx(what))
    if (failure.code === 'aborted' || failure.code === 'network') throw failure
    // Any other answer from /graphql is not about the user (the identity call settled that).
    if (hasHttpResponse(err) && status !== undefined) {
      throw new UseRest(`GitHub's GraphQL API answered HTTP ${status} while ${what}.`, 'unknown')
    }
    throw new UseRest(failure.message, 'unknown')
  }
}

/** True for an error saying the query does not fit GitHub's schema (a field or argument it does not know). */
function isSchemaError(error: GqlError): boolean {
  const code = error.extensions?.code ?? ''
  return /^(undefinedField|undefinedType|argumentNotAccepted|missingRequiredArguments|fieldsWontMerge)$/.test(code) ||
    /doesn't exist on type|doesn't accept argument/i.test(error.message ?? '')
}

/** Why an answer that carried errors and no usable data failed, as the failure fetchProfile falls back on. */
function answerFailure(errors: ReadonlyArray<GqlError>, what: string, token: string | undefined): UseRest {
  const types = errors.map((x) => (x.type ?? '').toUpperCase())
  const messages = scrub(errors.map((x) => x.message ?? '').filter((m) => m !== '').join(' '), token)
  if (types.includes('FORBIDDEN') || /saml/i.test(messages)) {
    return new UseRest(`GitHub refused the GraphQL query while ${what}: ${messages || 'forbidden'}`, 'unauthorized')
  }
  if (errors.some(isSchemaError)) {
    return new UseRest(`GitHub did not accept the GraphQL query while ${what}: ${messages}`, 'unknown')
  }
  return new UseRest(`GitHub could not answer the GraphQL query while ${what}: ${messages || 'no data came back'}`, 'unknown')
}

// ---------- the fetch ----------

/** One page of the repositories query: one page cannot be halved, so a slow or 5xx one is asked once more. */
async function askRepos(session: ProfileSession, login: string, after: string | null): Promise<NonNullable<GqlReposData['user']>> {
  const variables: Record<string, string> = { login }
  if (after !== null) variables.after = after
  let answer = await runQuery<GqlReposData>(session, REPOS_QUERY, variables, 'listing repos')
  if (answer.kind === 'transient') {
    session.throwIfAborted()
    answer = await runQuery<GqlReposData>(session, REPOS_QUERY, variables, 'listing repos')
  }
  if (answer.kind === 'transient') {
    throw new UseRest(`GitHub did not answer the repositories query in time (${answer.reason}, twice).`, 'network')
  }
  const user = answer.data?.user
  // A partial answer with the user in it is read as it is: a repo that errored is a null node.
  if (!user) throw answerFailure(answer.errors, 'listing repos', session.token)
  return user
}

/** The user's contribution years and own repos, oldest first, up to MAX_REPO_PAGES pages. */
async function readRepos(session: ProfileSession, login: string): Promise<{ years: number[]; repos: GqlRepo[]; truncated: boolean }> {
  const repos: GqlRepo[] = []
  let years: number[] = []
  let truncated = false
  let after: string | null = null
  for (let page = 1; ; page++) {
    session.throwIfAborted()
    const user = await askRepos(session, login, after)
    if (page === 1) years = (user.contributionsCollection?.contributionYears ?? []).filter((y) => Number.isInteger(y))
    for (const node of user.repositories?.nodes ?? []) if (node?.nameWithOwner && node.createdAt) repos.push(node)
    session.emit('repos', repos.length, repos.length, `Listed ${repos.length} repos`)
    const info = user.repositories?.pageInfo
    if (!info?.hasNextPage || !info.endCursor) break
    if (page >= MAX_REPO_PAGES) {
      truncated = true
      const cap = MAX_REPO_PAGES * PAGE
      session.emit('repos', repos.length, repos.length, `Repo cap of ${cap} reached: more repos exist beyond the fetched pages`)
      break
    }
    after = info.endCursor
  }
  return { years, repos, truncated }
}

/** What one window's answer held. */
interface WindowAnswer {
  /** null when GitHub sent no collection for the window */
  collection: GqlCollection | null
  /** an error's path starts at this window: whatever came back for it is missing a part */
  errored: boolean
}

/**
 * These windows in one query, with the halving ladder: a slow or 5xx answer is asked again in two
 * halves, and so on down to one window, which failing that fails the fetch with a WindowTimeout
 * (GitHub stops a query after 10 s, and a busy year can take that long). Each window maps to what
 * came back for it and whether an error named it.
 */
async function askWindows(
  session: ProfileSession,
  login: string,
  windows: ReadonlyArray<QuarterWindow>,
): Promise<Map<string, WindowAnswer>> {
  const { query, variables } = buildWindowQuery(login, windows)
  const answer = await runQuery<GqlWindowData>(session, query, variables, 'reading contributions')
  if (answer.kind === 'transient') {
    if (windows.length === 1) {
      throw new WindowTimeout(`GitHub did not answer the contributions query in time, even one quarter at a time (${answer.reason}).`, 'network')
    }
    session.throwIfAborted()
    const mid = Math.ceil(windows.length / 2)
    const first = await askWindows(session, login, windows.slice(0, mid))
    const second = await askWindows(session, login, windows.slice(mid))
    return new Map([...first, ...second])
  }
  const marks = windowErrorMarks(answer.errors, windows.map((w) => w.alias))
  const answered = new Map<string, WindowAnswer>()
  for (const w of windows) {
    const user = answer.data?.[w.alias] as { contributionsCollection?: GqlCollection | null } | null | undefined
    answered.set(w.alias, { collection: user?.contributionsCollection ?? null, errored: marks.has(w.alias) })
  }
  // Nothing came back and no error names a window: the query failed as a whole (a refusal for the
  // whole query, a schema error), which is not a matter of these windows.
  if (answer.errors.length > 0 && marks.size === 0 && [...answered.values()].every((a) => a.collection === null)) {
    throw answerFailure(answer.errors, 'reading contributions', session.token)
  }
  return answered
}

/**
 * One batch of windows. A window that came back whole is kept. One that did not (its alias null,
 * or data with an error on its path, which GitHub sends when the failed field is nullable, such as
 * a first* contribution) is asked once more on its own, and stands if that answers whole.
 *
 * Otherwise the window is counted in lostWindows, so truncated is set, but whatever data it did
 * bring is kept, the retry's or else the first answer's: the calendar and commits GitHub sent are
 * still its own, and only the field it nulled for the error is missing. The legend then names the
 * quarter as incomplete rather than the profile dropping days it has.
 *
 * Only a retry that gets no answer at all (a timeout or a 5xx, after which the window is lost) is
 * given up on here. Anything else it meets ends the batch as it would any query: a GraphQL rate
 * limit or a refusal (fetchProfile falls back), a network error or an abort (the fetch ends).
 */
async function readBatch(
  session: ProfileSession,
  login: string,
  windows: ReadonlyArray<QuarterWindow>,
): Promise<{ answered: Array<{ window: QuarterWindow; collection: GqlCollection }>; lost: QuarterWindow[] }> {
  const first = await askWindows(session, login, windows)
  const answered: Array<{ window: QuarterWindow; collection: GqlCollection }> = []
  const lost: QuarterWindow[] = []
  for (const window of windows) {
    let got = first.get(window.alias) ?? { collection: null, errored: false }
    let whole = got.collection !== null && !got.errored
    if (!whole) {
      session.throwIfAborted()
      try {
        const retry = (await askWindows(session, login, [window])).get(window.alias)
        if (retry && retry.collection !== null) {
          got = retry
          whole = !retry.errored
        }
      } catch (err) {
        if (!(err instanceof WindowTimeout)) throw err
      }
    }
    if (got.collection !== null) answered.push({ window, collection: got.collection })
    if (!whole) lost.push(window)
  }
  return { answered, lost }
}

/**
 * Tier 2: a user's profile over GraphQL. The REST identity call first (shared with tier 1, so
 * not_found and not_a_user are settled before GraphQL can hide them), then the GraphQL plan. Throws
 * a UseRest for a failure REST may still answer (fetchProfile falls back on it).
 */
export async function fetchProfileGraphql(login: string, opts: ProfileFetchOptions & { token: string }): Promise<ProfileData> {
  const session = openProfileSession(login, opts)
  if (!session.token) throw new UseRest("GitHub's GraphQL API needs a token", 'unauthorized')
  return graphqlProfile(session, await fetchIdentity(session))
}

/** Tier 2 after the identity call: the repositories query, then the contribution windows, year by year. */
export async function graphqlProfile(session: ProfileSession, user: ProfileIdentity): Promise<ProfileData> {
  const listing = await readRepos(session, user.login)

  // Quarters from January 1 of the earliest contribution year, which can precede the account
  // (backdated commits count). A user who never contributed has no windows to read.
  const windows = listing.years.length > 0 ? quarterWindows(Math.min(...listing.years), session.now) : []
  const answered: Array<{ window: QuarterWindow; collection: GqlCollection }> = []
  const lost: QuarterWindow[] = []
  // Serially, in date order: deterministic request bodies, and never a burst at the API.
  for (let start = 0; start < windows.length; start += WINDOWS_PER_QUERY) {
    session.throwIfAborted()
    const batch = windows.slice(start, start + WINDOWS_PER_QUERY)
    const read = await readBatch(session, user.login, batch)
    answered.push(...read.answered)
    lost.push(...read.lost)
    const last = batch[batch.length - 1].key.replace('q', ' Q')
    const lostNote = read.lost.length > 0 ? ` (${read.lost.length} lost)` : ''
    session.emit('windows', start + batch.length, windows.length, `Read contributions through ${last}${lostNote}`)
  }

  const profile = mergeProfile(user, listing, answered, lost, session.now)
  session.emit('done', 1, 1, `Done: ${profile.repos.length} repos, ${profile.days.length} days, ${session.state.requestsUsed} requests`)
  return profile
}

// ---------- merging ----------

/** One repo's counted commits across the windows. */
interface Counted {
  repo: GqlRepo
  byDay: Map<string, number>
  /** ISO: the earliest and latest occurredAt counted (midnight Pacific of those days) */
  firstAt: string | null
  lastAt: string | null
}

/** The earlier of two first*Contributions; a null or undated one never wins. */
function earlierFirst(a: GqlFirst | null, b: GqlFirst | null | undefined): GqlFirst | null {
  const tb = Date.parse(b?.occurredAt ?? '')
  if (!b || !Number.isFinite(tb)) return a
  const ta = Date.parse(a?.occurredAt ?? '')
  return a && Number.isFinite(ta) && ta <= tb ? a : b
}

function byDate(a: { date: string }, b: { date: string }): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
}

/** A repo as ProfileData holds it, with this person's counted commits (none for an own repo they never committed to). */
function profileRepo(raw: GqlRepo, counted: Counted | null, isOwn: boolean): ProfileRepo {
  const createdAt = raw.createdAt
  const activity = counted ? [...counted.byDay].map(([date, commits]) => ({ date, commits })).sort(byDate) : []
  // An own repo starts at its birth; one they only contributed to where they arrived.
  const firstActiveAt = isOwn || !counted?.firstAt ? createdAt : counted.firstAt
  // An own repo runs to its last push (a fork's can predate its creation) or counted day, whichever
  // is later. A repo they only contributed to runs to their last counted day: its pushes are other
  // people's and say nothing of this person's part in it.
  let lastActiveAt = isOwn ? laterOf(createdAt, raw.pushedAt ?? createdAt) : firstActiveAt
  if (counted?.lastAt) lastActiveAt = laterOf(lastActiveAt, counted.lastAt)
  return {
    nameWithOwner: raw.nameWithOwner,
    createdAt,
    firstActiveAt,
    lastActiveAt,
    isOwn,
    language: raw.primaryLanguage?.name ?? null,
    languageColor: raw.primaryLanguage?.color ?? null,
    stars: raw.stargazerCount ?? 0,
    forks: raw.forkCount ?? 0,
    isFork: raw.isFork === true,
    isArchived: raw.isArchived === true,
    isPrivate: raw.isPrivate === true,
    activity,
  }
}

/**
 * The windows that came back as one profile: the calendar's days (never after today's Pacific
 * day), commits per repo per Pacific day, the own repos merged with the ones only contributed to,
 * restricted contributions summed, and the milestones GitHub states.
 */
function mergeProfile(
  user: ProfileIdentity,
  listing: { repos: GqlRepo[]; truncated: boolean },
  answered: ReadonlyArray<{ window: QuarterWindow; collection: GqlCollection }>,
  lost: ReadonlyArray<QuarterWindow>,
  now: number,
): ProfileData {
  const today = pacificDay(now)
  let truncated = listing.truncated || lost.length > 0
  const days = new Map<string, number>()
  const counted = new Map<string, Counted>()
  let restricted = 0
  let joined: GqlFirst | null = null
  let firstPr: GqlFirst | null = null
  let firstIssue: GqlFirst | null = null
  let firstRepo: GqlFirst | null = null

  for (const { collection } of answered) {
    for (const week of collection.contributionCalendar?.weeks ?? []) {
      for (const day of week?.contributionDays ?? []) {
        if (!day || day.date > today) continue
        // Windows do not overlap; should a boundary day come twice, its larger count stands.
        days.set(day.date, Math.max(days.get(day.date) ?? 0, day.contributionCount ?? 0))
      }
    }

    const byRepo = collection.commitContributionsByRepository ?? []
    // maxRepositories is 100: a window that returned that many may have had more.
    if (byRepo.length >= PAGE) truncated = true
    for (const entry of byRepo) {
      const repo = entry?.repository
      if (!entry || !repo?.nameWithOwner) continue
      if (entry.contributions?.pageInfo?.hasNextPage) truncated = true
      const key = repo.nameWithOwner.toLowerCase()
      const seen = counted.get(key) ?? { repo, byDay: new Map<string, number>(), firstAt: null, lastAt: null }
      seen.repo = repo
      for (const node of entry.contributions?.nodes ?? []) {
        const at = node?.occurredAt ?? ''
        const t = Date.parse(at)
        if (!node || !Number.isFinite(t)) continue
        const date = pacificDay(t)
        seen.byDay.set(date, (seen.byDay.get(date) ?? 0) + (node.commitCount ?? 0))
        if (seen.firstAt === null || t < Date.parse(seen.firstAt)) seen.firstAt = at
        if (seen.lastAt === null || t > Date.parse(seen.lastAt)) seen.lastAt = at
      }
      if (seen.firstAt !== null) counted.set(key, seen)
    }

    restricted += collection.restrictedContributionsCount ?? 0
    // Each first* field is null outside the window that holds it: the earliest across windows stands.
    joined = earlierFirst(joined, collection.joinedGitHubContribution)
    firstPr = earlierFirst(firstPr, collection.firstPullRequestContribution)
    firstIssue = earlierFirst(firstIssue, collection.firstIssueContribution)
    firstRepo = earlierFirst(firstRepo, collection.firstRepositoryContribution)
  }

  const repos: ProfileRepo[] = []
  const listed = new Set<string>()
  for (const raw of listing.repos) {
    const key = raw.nameWithOwner.toLowerCase()
    if (listed.has(key)) continue
    listed.add(key)
    repos.push(profileRepo(raw, counted.get(key) ?? null, true))
  }
  // A repo only the windows name is one they contributed to; or their own beyond the 500-repo cap,
  // which the owner in its name tells.
  const owner = `${user.login.toLowerCase()}/`
  for (const [key, seen] of counted) {
    if (listed.has(key)) continue
    repos.push(profileRepo(seen.repo, seen, key.startsWith(owner)))
  }
  repos.sort((a, b) => Date.parse(a.firstActiveAt) - Date.parse(b.firstActiveAt) || (a.nameWithOwner < b.nameWithOwner ? -1 : a.nameWithOwner > b.nameWithOwner ? 1 : 0))

  const milestones: ProfileMilestone[] = [{ kind: 'joined', date: joined?.occurredAt ?? user.createdAt, label: 'Joined GitHub' }]
  const stated: Array<[ProfileMilestone['kind'], string, GqlFirst | null, GqlRepoRef | null | undefined]> = [
    ['first-repo', 'First repository', firstRepo, firstRepo?.repository],
    ['first-pr', 'First pull request', firstPr, firstPr?.pullRequest?.repository],
    ['first-issue', 'First issue', firstIssue, firstIssue?.issue?.repository],
  ]
  for (const [kind, label, contribution, repo] of stated) {
    if (!contribution?.occurredAt) continue
    const milestone: ProfileMilestone = { kind, date: contribution.occurredAt, label }
    // A RestrictedContribution carries no repository, and a private repository keeps its name.
    if (repo?.nameWithOwner && repo.isPrivate === false) milestone.repo = repo.nameWithOwner
    milestones.push(milestone)
  }
  milestones.sort((a, b) => Date.parse(a.date) - Date.parse(b.date))

  return {
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    source: 'graphql',
    repos,
    days: [...days].map(([date, count]) => ({ date, count })).sort(byDate),
    recent: [],
    recentFrom: null,
    milestones,
    restrictedContributions: restricted,
    truncated,
    lostWindows: lost.map((w) => w.key),
    fallback: null,
  }
}
