/**
 * The open pull requests of a repo, for the overlay: which branch has one, its review decision and
 * its checks. Loaded lazily (pullsChunk in lazy/parts.ts) once the graph is in, and never stored.
 *
 * With a token: GraphQL, one query per 40 branches run one after another (vite's 97 branches cost
 * 3 POSTs and no core requests), each branch asked as an aliased ref whose name only travels in the
 * variables. Without one: the REST listing (1 request per 100 open pull requests, at most 3 pages),
 * with review and checks left 'unknown' until a pull request is looked up (lookupPull, 2 or 3
 * requests) because the 60-request hourly budget cannot pay for all of them.
 *
 * Pull requests from forks are dropped: their head branch is not a branch of this repo, even when it
 * shares a name with one (forks of express open dozens from their own "master").
 */
import { Octokit } from '@octokit/rest'
import { GitHubFetchError } from '../types'
import type { Branch, CheckCounts, ChecksState, PullIndex, PullSummary, RepoData, ReviewState } from '../types'
import type { RepoRef } from './parseRepoUrl'
import {
  PER_PAGE,
  coreRateFromHeaders,
  errorStatus,
  hasHttpResponse,
  hasNextLink,
  lastPageFromLink,
  parseResetAt,
  runPool,
  toFetchError,
  type HeaderBag,
  type RateInfo,
} from './http'

/** Branches per GraphQL query. */
export const GRAPHQL_BATCH = 40
/** Pull requests per branch the GraphQL query asks for. */
const PRS_PER_REF = 5
/** A GraphQL query slower than this is given up on (then retried in halves). */
export const GRAPHQL_TIMEOUT_MS = 15_000
/** Pages of 100 the REST listing reads at most (the most recently updated first). */
export const REST_MAX_PAGES = 3
/** Without a token the listing is skipped, or stops paging, below this many core requests left. */
export const REST_MIN_REMAINING = 5
/** Requests one lookupPull costs at most (check runs, commit statuses, reviews). */
export const LOOKUP_COST = 3
/** With a token on the REST path (GraphQL refused), every mapped pull request is looked up, up to this many. */
export const BULK_LOOKUP_MAX = 60
const BULK_LOOKUP_CONCURRENCY = 4

export interface PullFetchOptions {
  token?: string
  signal?: AbortSignal
  /** Fetch implementation handed to Octokit; defaults to globalThis.fetch. Tests and the replay page inject one. */
  fetch?: typeof globalThis.fetch
  /** The core (REST) budget after every response that reports it. GraphQL points never arrive here. */
  onRate?: (rate: RateInfo) => void
  /** Core requests left, when known. An anonymous listing is skipped below REST_MIN_REMAINING. */
  remaining?: number | null
  /** When that budget refills (ISO), when known: carried by the error of a skipped listing. */
  resetAt?: string | null
}

/** An Octokit for pull request requests, reporting the core budget of every response (also failed ones). */
function createClient(opts: PullFetchOptions): { octokit: Octokit; state: { remaining: number | null } } {
  const token = opts.token?.trim() || undefined
  const octokit = new Octokit({ auth: token, request: { fetch: opts.fetch, signal: opts.signal } })
  const state = { remaining: opts.remaining ?? null }
  const note = (headers: HeaderBag | undefined) => {
    const rate = coreRateFromHeaders(headers)
    if (!rate) return
    state.remaining = rate.remaining
    opts.onRate?.(rate)
  }
  octokit.hook.wrap('request', async (request, options) => {
    try {
      const response = await request(options)
      note(response.headers as HeaderBag)
      return response
    } catch (err) {
      note((err as { response?: { headers?: HeaderBag } }).response?.headers)
      throw err
    }
  })
  return { octokit, state }
}

// ---------- status mapping ----------

/** GraphQL reviewDecision -> ReviewState. null means no review rule applies: nothing to wait for but people. */
export function mapReviewDecision(decision: string | null | undefined): ReviewState {
  if (decision === 'APPROVED') return 'approved'
  if (decision === 'CHANGES_REQUESTED') return 'changes'
  return 'waiting'
}

/** GraphQL StatusState of a head commit's rollup -> ChecksState; null = no checks at all. */
export function mapRollupState(state: string | null | undefined): ChecksState {
  switch (state) {
    case 'SUCCESS':
      return 'passing'
    case 'PENDING':
    case 'EXPECTED':
      return 'running'
    case 'FAILURE':
    case 'ERROR':
      return 'failing'
    default:
      return 'none'
  }
}

/** GraphQL MergeableState -> conflict: CONFLICTING true, MERGEABLE false, UNKNOWN (still computing) null. */
export function mapMergeable(state: string | null | undefined): boolean | null {
  if (state === 'CONFLICTING') return true
  if (state === 'MERGEABLE') return false
  return null
}

type CheckBucket = 'failing' | 'running' | 'passing' | 'skipped'

/** A check run's (status, conclusion) or a commit status's state, as a bucket. Upper or lower case. */
export function checkBucket(state: string | null | undefined, conclusion?: string | null): CheckBucket {
  const s = (state ?? '').toLowerCase()
  const c = (conclusion ?? '').toLowerCase()
  // a check run that has not completed is running whatever its (absent) conclusion
  if (s === 'queued' || s === 'in_progress' || s === 'waiting' || s === 'requested' || s === 'pending' || s === 'expected') {
    return 'running'
  }
  const outcome = s === 'completed' || s === '' ? c : s
  switch (outcome) {
    case 'failure':
    case 'timed_out':
    case 'cancelled':
    case 'action_required':
    case 'startup_failure':
    case 'error':
      return 'failing'
    case 'skipped':
    case 'stale':
      return 'skipped'
    case 'success':
    case 'neutral':
    case 'completed':
      return 'passing'
    default:
      return 'running'
  }
}

/** The worst bucket wins: failing, then running, then passing; none when there is nothing (or only skipped). */
function checksFromCounts(counts: CheckCounts): ChecksState {
  if (counts.failing > 0) return 'failing'
  if (counts.running > 0) return 'running'
  // neutral and skipped runs pass, as in GitHub's own rollup
  if (counts.passing > 0 || counts.skipped > 0) return 'passing'
  return 'none'
}

export interface RawCheckRun {
  status?: string | null
  conclusion?: string | null
}

export interface RawCommitStatus {
  state?: string | null
}

/**
 * A head commit's checks from the REST check runs and the legacy commit statuses (both may be
 * absent). Neutral and skipped runs count as passing for the state, as GitHub's rollup does.
 */
export function rollupChecks(
  checkRuns: ReadonlyArray<RawCheckRun>,
  statuses: ReadonlyArray<RawCommitStatus>,
): { checks: ChecksState; counts: CheckCounts | null } {
  const counts: CheckCounts = { failing: 0, running: 0, passing: 0, skipped: 0, total: 0 }
  for (const run of checkRuns) counts[checkBucket(run.status, run.conclusion)] += 1
  for (const status of statuses) counts[checkBucket(status.state)] += 1
  counts.total = counts.failing + counts.running + counts.passing + counts.skipped
  if (counts.total === 0) return { checks: 'none', counts: null }
  return { checks: checksFromCounts(counts), counts }
}

export interface RawReview {
  state?: string | null
  user?: { login?: string | null } | null
  submitted_at?: string | null
}

/**
 * The review decision from the REST reviews (oldest first, as GitHub lists them): each reviewer's
 * latest approval or change request stands, a dismissal clears theirs, comments do not count.
 * Anyone asking for changes wins over approvals.
 */
export function reduceReviews(reviews: ReadonlyArray<RawReview>): ReviewState {
  const latest = new Map<string, string>()
  for (const review of reviews) {
    const login = review.user?.login ?? ''
    const state = (review.state ?? '').toUpperCase()
    if (state === 'DISMISSED') latest.delete(login)
    else if (state === 'APPROVED' || state === 'CHANGES_REQUESTED') latest.set(login, state)
  }
  const states = [...latest.values()]
  if (states.includes('CHANGES_REQUESTED')) return 'changes'
  if (states.includes('APPROVED')) return 'approved'
  return 'waiting'
}

// ---------- GraphQL ----------

const COUNTS_FIELDS =
  'contexts(first: 0) { totalCount checkRunCountsByState { state count } statusContextCountsByState { state count } }'

function prFragment(counts: boolean): string {
  return (
    'fragment OpenPrs on Ref { associatedPullRequests(states: OPEN, first: ' +
    PRS_PER_REF +
    ', orderBy: {field: UPDATED_AT, direction: DESC}) { totalCount nodes { ' +
    'number title url isDraft isCrossRepository headRepository { nameWithOwner } ' +
    'headRefName headRefOid baseRefName reviewDecision mergeable updatedAt ' +
    'author { login } reviewRequests { totalCount } ' +
    `commits(last: 1) { nodes { commit { oid statusCheckRollup { state${counts ? ' ' + COUNTS_FIELDS : ''} } } } } } } }`
  )
}

/**
 * One GraphQL query for these branches: each an aliased ref (b0, b1, ...) whose qualified name is a
 * variable, so a branch name never enters the query text. The first query of a fetch also asks for
 * the rate limit and the repo's open pull request counts (all, and into the default branch).
 * counts: false leaves out the per-state check counts (a fallback should the API reject them).
 */
export function buildPullQuery(
  ref: RepoRef,
  names: ReadonlyArray<string>,
  base: string,
  opts: { first: boolean; counts: boolean },
): { query: string; variables: Record<string, string> } {
  const decls = ['$owner: String!', '$repo: String!']
  const variables: Record<string, string> = { owner: ref.owner, repo: ref.repo }
  if (opts.first) {
    decls.push('$base: String!')
    variables.base = base
  }
  const aliases: string[] = []
  names.forEach((name, i) => {
    decls.push(`$b${i}: String!`)
    variables[`b${i}`] = `refs/heads/${name}`
    aliases.push(`b${i}: ref(qualifiedName: $b${i}) { ...OpenPrs }`)
  })
  const head = opts.first ? 'rateLimit { cost remaining resetAt } ' : ''
  const counts = opts.first
    ? 'open: pullRequests(states: OPEN) { totalCount } intoDefault: pullRequests(states: OPEN, baseRefName: $base) { totalCount } '
    : ''
  const query =
    `query(${decls.join(', ')}) { ${head}repository(owner: $owner, name: $repo) { nameWithOwner ${counts}` +
    `${aliases.join(' ')} } }\n${prFragment(opts.counts)}`
  return { query, variables }
}

interface GqlCount {
  state?: string | null
  count?: number | null
}

interface GqlContexts {
  totalCount?: number | null
  checkRunCountsByState?: GqlCount[] | null
  statusContextCountsByState?: GqlCount[] | null
}

interface GqlPull {
  number: number
  title: string
  url: string
  isDraft?: boolean | null
  isCrossRepository?: boolean | null
  headRepository?: { nameWithOwner?: string | null } | null
  headRefName: string
  headRefOid: string
  baseRefName: string
  reviewDecision?: string | null
  mergeable?: string | null
  updatedAt: string
  author?: { login?: string | null } | null
  reviewRequests?: { totalCount?: number | null } | null
  commits?: {
    nodes?: Array<{
      commit?: {
        oid?: string
        statusCheckRollup?: { state?: string | null; contexts?: GqlContexts | null } | null
      } | null
    } | null> | null
  } | null
}

interface GqlRef {
  associatedPullRequests?: { totalCount?: number | null; nodes?: Array<GqlPull | null> | null } | null
}

export interface GqlPullData {
  rateLimit?: { cost?: number; remaining?: number; resetAt?: string } | null
  repository?:
    | ({
        nameWithOwner?: string | null
        open?: { totalCount?: number | null } | null
        intoDefault?: { totalCount?: number | null } | null
      } & Record<string, unknown>)
    | null
}

function countsFromGraphql(contexts: GqlContexts | null | undefined): CheckCounts | null {
  if (!contexts) return null
  const counts: CheckCounts = { failing: 0, running: 0, passing: 0, skipped: 0, total: 0 }
  let any = false
  for (const list of [contexts.checkRunCountsByState, contexts.statusContextCountsByState]) {
    for (const entry of list ?? []) {
      const n = entry.count ?? 0
      if (n <= 0) continue
      any = true
      counts[checkBucket(entry.state)] += n
    }
  }
  counts.total = contexts.totalCount ?? counts.failing + counts.running + counts.passing + counts.skipped
  return any || counts.total > 0 ? counts : null
}

/** true when the pull request's head lives in this repo (fork heads have no branch here) */
function sameRepoHead(pr: GqlPull, canonical: string): boolean {
  if (pr.isCrossRepository === true) return false
  const head = pr.headRepository?.nameWithOwner
  if (head === undefined) return pr.isCrossRepository === false
  return head !== null && head.toLowerCase() === canonical
}

/**
 * One query's answer as pull requests by branch (the names in query order). A ref that is gone
 * (null: deleted since the graph was fetched) or errored has no entry.
 */
export function normaliseGraphql(
  data: GqlPullData | null | undefined,
  names: ReadonlyArray<string>,
  ref: RepoRef,
): { byBranch: Map<string, PullSummary[]>; total: number | null; intoBase: number | null } {
  const byBranch = new Map<string, PullSummary[]>()
  const repo = data?.repository
  const canonical = (repo?.nameWithOwner ?? `${ref.owner}/${ref.repo}`).toLowerCase()
  names.forEach((name, i) => {
    const node = repo?.[`b${i}`] as GqlRef | null | undefined
    const nodes = node?.associatedPullRequests?.nodes ?? []
    const prs: PullSummary[] = []
    for (const pr of nodes) {
      if (!pr || pr.headRefName !== name || !sameRepoHead(pr, canonical)) continue
      const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null
      prs.push({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        head: pr.headRefName,
        headSha: pr.headRefOid,
        base: pr.baseRefName,
        draft: pr.isDraft === true,
        author: pr.author?.login ?? null,
        review: mapReviewDecision(pr.reviewDecision),
        checks: mapRollupState(rollup?.state),
        checkCounts: countsFromGraphql(rollup?.contexts),
        reviewersAsked: pr.reviewRequests?.totalCount ?? null,
        conflict: mapMergeable(pr.mergeable),
        updatedAt: pr.updatedAt,
      })
    }
    if (prs.length > 0) byBranch.set(name, sortPulls(prs))
  })
  return {
    byBranch,
    total: repo?.open?.totalCount ?? null,
    intoBase: repo?.intoDefault?.totalCount ?? null,
  }
}

function sortPulls(prs: PullSummary[]): PullSummary[] {
  return prs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : b.number - a.number))
}

/** Thrown inside the GraphQL path when GitHub refuses GraphQL for this visitor: the REST path takes over. */
class UseRest extends Error {
  constructor(public readonly reason: string) {
    super(reason)
  }
}

interface GqlErrorEntry {
  type?: string
  message?: string
  path?: ReadonlyArray<string | number>
}

type GqlOutcome =
  | { kind: 'data'; data: GqlPullData }
  | { kind: 'schema' }
  | { kind: 'transient' }
  | { kind: 'rest'; reason: string }
  | { kind: 'fail'; error: GitHubFetchError }

/** The caller's signal joined with a timeout; the timeout half tells the two apart. */
function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal | undefined; timedOut: () => boolean } {
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any
  const timeoutFn = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout
  if (!timeoutFn) return { signal, timedOut: () => false }
  const timeout = timeoutFn(ms)
  const joined = signal && anyFn ? anyFn([signal, timeout]) : signal ? signal : timeout
  return { signal: joined, timedOut: () => timeout.aborted && !signal?.aborted }
}

async function runGraphql(
  octokit: Octokit,
  query: string,
  variables: Record<string, string>,
  opts: PullFetchOptions,
  ref: RepoRef,
): Promise<GqlOutcome> {
  const timer = withTimeout(opts.signal, GRAPHQL_TIMEOUT_MS)
  try {
    const data = await octokit.graphql<GqlPullData>(query, { ...variables, request: { signal: timer.signal } })
    return { kind: 'data', data }
  } catch (err) {
    if (opts.signal?.aborted) throw new GitHubFetchError('Fetch aborted while reading pull requests', 'aborted')
    if (timer.timedOut()) return { kind: 'transient' }
    const e = err as { name?: string; errors?: GqlErrorEntry[]; data?: GqlPullData | null; headers?: HeaderBag }
    if (e.name === 'GraphqlResponseError' && Array.isArray(e.errors)) {
      const types = e.errors.map((x) => (x.type ?? '').toUpperCase())
      const messages = e.errors.map((x) => x.message ?? '').join(' ')
      if (types.includes('RATE_LIMITED')) {
        const resetAt = e.data?.rateLimit?.resetAt ?? parseResetAt(e.headers)
        return {
          kind: 'fail',
          error: new GitHubFetchError('GitHub GraphQL rate limit exceeded while reading pull requests.', 'rate_limited', resetAt ?? null),
        }
      }
      const repoData = e.data?.repository
      // partial data: use what came back (refs with errors are null and get no mark)
      if (repoData) return { kind: 'data', data: e.data as GqlPullData }
      if (types.includes('FORBIDDEN') || /saml/i.test(messages)) return { kind: 'rest', reason: messages || 'GraphQL refused' }
      if (types.includes('NOT_FOUND')) {
        return { kind: 'fail', error: new GitHubFetchError(`${ref.owner}/${ref.repo} was not found while reading pull requests.`, 'not_found') }
      }
      // a schema the API does not know (no type, a field error): try without the per-state counts
      if (/CountsByState|contexts|doesn't exist|undefinedField/i.test(messages)) return { kind: 'schema' }
      return { kind: 'fail', error: new GitHubFetchError(`GitHub could not answer the pull request query: ${messages}`, 'unknown') }
    }
    const status = errorStatus(err)
    if (status === 401 || status === 403) {
      const failure = toFetchError(err, { what: 'reading pull requests', signal: opts.signal, token: opts.token, owner: ref.owner, repo: ref.repo })
      if (failure.code === 'rate_limited') return { kind: 'fail', error: failure }
      return { kind: 'rest', reason: `HTTP ${status}` }
    }
    if (status === 502 || status === 504 || (hasHttpResponse(err) && status !== undefined && status >= 500)) return { kind: 'transient' }
    return {
      kind: 'fail',
      error: toFetchError(err, { what: 'reading pull requests', signal: opts.signal, token: opts.token, owner: ref.owner, repo: ref.repo }),
    }
  }
}

/**
 * One batch with the failure ladder: partial data is used; a slow or 5xx answer is retried once in
 * two halves; failing that (or on a schema error) without the per-state counts; then it gives up.
 */
async function graphqlBatch(
  octokit: Octokit,
  ref: RepoRef,
  names: ReadonlyArray<string>,
  base: string,
  first: boolean,
  opts: PullFetchOptions,
): Promise<{ data: GqlPullData; names: ReadonlyArray<string> }[]> {
  const ask = async (subset: ReadonlyArray<string>, isFirst: boolean, counts: boolean) => {
    const { query, variables } = buildPullQuery(ref, subset, base, { first: isFirst, counts })
    return runGraphql(octokit, query, variables, opts, ref)
  }
  const settle = (outcome: GqlOutcome): void => {
    if (outcome.kind === 'rest') throw new UseRest(outcome.reason)
    if (outcome.kind === 'fail') throw outcome.error
  }

  const whole = await ask(names, first, true)
  if (whole.kind === 'data') return [{ data: whole.data, names }]
  settle(whole)

  if (whole.kind === 'transient' && names.length > 1) {
    const mid = Math.ceil(names.length / 2)
    const halves = [names.slice(0, mid), names.slice(mid)]
    const out: { data: GqlPullData; names: ReadonlyArray<string> }[] = []
    let ok = true
    for (let h = 0; h < halves.length; h++) {
      const part = await ask(halves[h], first && h === 0, true)
      if (part.kind === 'data') out.push({ data: part.data, names: halves[h] })
      else {
        settle(part)
        ok = false
        break
      }
    }
    if (ok) return out
  }

  if (opts.signal?.aborted) throw new GitHubFetchError('Fetch aborted while reading pull requests', 'aborted')
  const lean = await ask(names, first, false)
  if (lean.kind === 'data') return [{ data: lean.data, names }]
  settle(lean)
  throw new GitHubFetchError('GitHub did not answer the pull request query in time (tried in halves and without check counts).', 'network')
}

async function graphqlIndex(octokit: Octokit, ref: RepoRef, data: RepoData, opts: PullFetchOptions): Promise<PullIndex> {
  const names = data.branches.map((b) => b.name)
  const byBranch = new Map<string, PullSummary[]>()
  let total: number | null = null
  let intoBase: number | null = null
  // serially, in branch order: deterministic request bodies, and never a burst at the API
  for (let start = 0, batch = 0; start < names.length; start += GRAPHQL_BATCH, batch++) {
    const slice = names.slice(start, start + GRAPHQL_BATCH)
    for (const part of await graphqlBatch(octokit, ref, slice, data.defaultBranch, batch === 0, opts)) {
      const result = normaliseGraphql(part.data, part.names, ref)
      for (const [name, prs] of result.byBranch) byBranch.set(name, prs)
      total = total ?? result.total
      intoBase = intoBase ?? result.intoBase
    }
  }
  const mapped = countPulls(byBranch)
  return {
    byBranch,
    intoBase,
    total,
    // everything open that is not drawn: fork heads (and any branch the graph did not load)
    fromForks: total === null ? 0 : Math.max(0, total - mapped),
    notOnGraph: 0,
    truncated: false,
    listed: 0,
    source: 'graphql',
    fetchedAt: new Date().toISOString(),
  }
}

function countPulls(byBranch: ReadonlyMap<string, ReadonlyArray<PullSummary>>): number {
  const seen = new Set<number>()
  for (const prs of byBranch.values()) for (const pr of prs) seen.add(pr.number)
  return seen.size
}

// ---------- REST ----------

/** The fields of a REST pull request the overlay keeps (raw pages run to 1.6 MB; only these survive the page loop). */
export interface SlimRestPull {
  number: number
  title: string
  html_url: string
  draft: boolean
  updated_at: string
  user: { login: string } | null
  head: { ref: string; sha: string; repo: { id: number | null; full_name: string } | null }
  base: { ref: string; repo: { id: number | null; full_name: string } | null }
  requested: number
}

interface RawRestPull {
  number: number
  title?: string
  html_url?: string
  draft?: boolean | null
  updated_at?: string
  user?: { login?: string | null } | null
  head?: { ref?: string; sha?: string; repo?: { id?: number; full_name?: string } | null } | null
  base?: { ref?: string; repo?: { id?: number; full_name?: string } | null } | null
  requested_reviewers?: ReadonlyArray<unknown> | null
  requested_teams?: ReadonlyArray<unknown> | null
}

export function slimRestPull(raw: RawRestPull): SlimRestPull {
  const repoOf = (r: { id?: number; full_name?: string } | null | undefined) =>
    r && typeof r.full_name === 'string' ? { id: typeof r.id === 'number' ? r.id : null, full_name: r.full_name } : null
  return {
    number: raw.number,
    title: raw.title ?? '',
    html_url: raw.html_url ?? '',
    draft: raw.draft === true,
    updated_at: raw.updated_at ?? '',
    user: raw.user?.login ? { login: raw.user.login } : null,
    head: { ref: raw.head?.ref ?? '', sha: raw.head?.sha ?? '', repo: repoOf(raw.head?.repo) },
    base: { ref: raw.base?.ref ?? '', repo: repoOf(raw.base?.repo) },
    requested: (raw.requested_reviewers?.length ?? 0) + (raw.requested_teams?.length ?? 0),
  }
}

export interface RestListing {
  pulls: SlimRestPull[]
  /** a next page was left unread */
  truncated: boolean
  /** open pull requests in the repo: exact when every page was read, else estimated from rel="last" */
  total: number
}

/**
 * The open pull requests, most recently updated first, up to REST_MAX_PAGES pages. Stops before a
 * page when fewer than REST_MIN_REMAINING core requests are left (only when the budget is known).
 */
export async function listOpenPulls(octokit: Octokit, ref: RepoRef, budget: { remaining: number | null }, opts: PullFetchOptions): Promise<RestListing> {
  const pulls: SlimRestPull[] = []
  let truncated = false
  let lastPage: number | null = null
  for (let page = 1; page <= REST_MAX_PAGES; page++) {
    if (page > 1 && budget.remaining !== null && budget.remaining < REST_MIN_REMAINING && !opts.token) {
      truncated = true
      break
    }
    let res
    try {
      res = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
        owner: ref.owner,
        repo: ref.repo,
        state: 'open',
        per_page: PER_PAGE,
        sort: 'updated',
        direction: 'desc',
        page,
      })
    } catch (err) {
      throw toFetchError(err, { what: 'listing pull requests', signal: opts.signal, token: opts.token, owner: ref.owner, repo: ref.repo })
    }
    const headers = res.headers as HeaderBag
    for (const raw of res.data as unknown as RawRestPull[]) pulls.push(slimRestPull(raw))
    if (page === 1) lastPage = lastPageFromLink(headers)
    const more = hasNextLink(headers, res.data.length)
    if (!more) break
    if (page === REST_MAX_PAGES) truncated = true
  }
  const total = truncated && lastPage !== null ? Math.max(pulls.length, lastPage * PER_PAGE) : pulls.length
  return { pulls, truncated, total }
}

/** The REST listing as pull requests by loaded branch; fork heads and heads not on the graph are counted, not kept. */
export function normaliseRest(
  pulls: ReadonlyArray<SlimRestPull>,
  ref: RepoRef,
  branches: ReadonlyArray<Pick<Branch, 'name'>>,
  defaultBranch: string,
): { byBranch: Map<string, PullSummary[]>; fromForks: number; notOnGraph: number; intoBase: number } {
  const loaded = new Set(branches.map((b) => b.name))
  const own = `${ref.owner}/${ref.repo}`.toLowerCase()
  const byBranch = new Map<string, PullSummary[]>()
  let fromForks = 0
  let notOnGraph = 0
  let intoBase = 0
  for (const pr of pulls) {
    if (pr.base.ref === defaultBranch) intoBase += 1
    const head = pr.head.repo
    const baseRepo = pr.base.repo
    // a deleted fork leaves head.repo null: a fork all the same
    const same =
      head !== null &&
      ((head.id !== null && baseRepo !== null && head.id === baseRepo.id) ||
        head.full_name.toLowerCase() === own ||
        (baseRepo !== null && head.full_name.toLowerCase() === baseRepo.full_name.toLowerCase()))
    if (!same) {
      fromForks += 1
      continue
    }
    if (!loaded.has(pr.head.ref)) {
      notOnGraph += 1
      continue
    }
    const summary: PullSummary = {
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      head: pr.head.ref,
      headSha: pr.head.sha,
      base: pr.base.ref,
      draft: pr.draft,
      author: pr.user?.login ?? null,
      review: 'unknown',
      checks: 'unknown',
      checkCounts: null,
      reviewersAsked: pr.requested,
      conflict: null,
      updatedAt: pr.updated_at,
    }
    const list = byBranch.get(pr.head.ref)
    if (list) list.push(summary)
    else byBranch.set(pr.head.ref, [summary])
  }
  for (const list of byBranch.values()) sortPulls(list)
  return { byBranch, fromForks, notOnGraph, intoBase }
}

/**
 * Per repo, what its first lookup learned about legacy commit statuses: false when it had none
 * (total_count 0), and later lookups skip that request. For this page's session only.
 */
const statusesSeen = new Map<string, boolean>()

function repoKey(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`.toLowerCase()
}

/** Forget what lookups learned (tests). */
export function resetLookupMemory(): void {
  statusesSeen.clear()
}

/** Requests the next lookup in this repo will cost. */
export function lookupCost(ref: RepoRef): number {
  return statusesSeen.get(repoKey(ref)) === false ? LOOKUP_COST - 1 : LOOKUP_COST
}

export interface LookupResult {
  review: ReviewState
  checks: ChecksState
  checkCounts: CheckCounts | null
  /** requests spent */
  requests: number
}

async function lookupWith(octokit: Octokit, ref: RepoRef, pr: Pick<PullSummary, 'number' | 'headSha'>, opts: PullFetchOptions): Promise<LookupResult> {
  const key = repoKey(ref)
  const askStatus = statusesSeen.get(key) !== false
  const base = { owner: ref.owner, repo: ref.repo }
  try {
    const [runs, status, reviews] = await Promise.all([
      octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', { ...base, ref: pr.headSha, per_page: PER_PAGE }),
      askStatus ? octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/status', { ...base, ref: pr.headSha, per_page: PER_PAGE }) : null,
      octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', { ...base, pull_number: pr.number, per_page: PER_PAGE }),
    ])
    const statusData = status?.data as { total_count?: number; statuses?: RawCommitStatus[] } | undefined
    // GitHub reports 'pending' for a commit with no statuses at all: ignore the combined state then
    const statusList = statusData && (statusData.total_count ?? 0) > 0 ? (statusData.statuses ?? []) : []
    if (statusData && !statusesSeen.has(key)) statusesSeen.set(key, (statusData.total_count ?? 0) > 0)
    const rolled = rollupChecks((runs.data as { check_runs?: RawCheckRun[] }).check_runs ?? [], statusList)
    return {
      review: reduceReviews(reviews.data as RawReview[]),
      checks: rolled.checks,
      checkCounts: rolled.counts,
      requests: askStatus ? 3 : 2,
    }
  } catch (err) {
    throw toFetchError(err, { what: `looking up pull request #${pr.number}`, signal: opts.signal, token: opts.token, owner: ref.owner, repo: ref.repo })
  }
}

/** Review and checks of one pull request over REST: check runs, commit statuses (unless learned empty), reviews. */
export async function lookupPull(ref: RepoRef, pr: Pick<PullSummary, 'number' | 'headSha'>, opts: PullFetchOptions = {}): Promise<LookupResult> {
  const { octokit } = createClient(opts)
  return lookupWith(octokit, ref, pr, opts)
}

async function restIndex(
  octokit: Octokit,
  budget: { remaining: number | null },
  ref: RepoRef,
  data: RepoData,
  opts: PullFetchOptions,
  bulk: boolean,
): Promise<PullIndex> {
  if (!opts.token && budget.remaining !== null && budget.remaining < REST_MIN_REMAINING) {
    throw new GitHubFetchError(`only ${budget.remaining} GitHub requests left this hour`, 'rate_limited', opts.resetAt ?? null)
  }
  const listing = await listOpenPulls(octokit, ref, budget, opts)
  const result = normaliseRest(listing.pulls, ref, data.branches, data.defaultBranch)
  if (bulk) {
    // with a token the core budget is 5000 an hour: look the mapped pull requests up straight away
    const all = [...result.byBranch.values()].flat().slice(0, BULK_LOOKUP_MAX)
    await runPool(all, BULK_LOOKUP_CONCURRENCY, async (pr) => {
      try {
        const found = await lookupWith(octokit, ref, pr, opts)
        pr.review = found.review
        pr.checks = found.checks
        pr.checkCounts = found.checkCounts
      } catch (err) {
        // one pull request that cannot be read stays 'unknown'; giving up the lot is for an abort
        if ((err as GitHubFetchError).code === 'aborted') throw err
      }
    })
  }
  return {
    byBranch: result.byBranch,
    intoBase: listing.truncated ? null : result.intoBase,
    total: listing.total,
    fromForks: result.fromForks,
    notOnGraph: result.notOnGraph,
    truncated: listing.truncated,
    listed: listing.pulls.length,
    source: 'rest',
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * The repo's open pull requests by loaded branch. With a token GraphQL answers review and checks for
 * every branch in ceil(branches / 40) serial POSTs; if GitHub refuses GraphQL (401, 403, SSO) the
 * REST path runs and looks every mapped pull request up. Without a token: the REST listing only.
 */
export async function fetchPullIndex(ref: RepoRef, data: RepoData, opts: PullFetchOptions = {}): Promise<PullIndex> {
  const { octokit, state } = createClient(opts)
  if (opts.token?.trim()) {
    try {
      return await graphqlIndex(octokit, ref, data, opts)
    } catch (err) {
      if (!(err instanceof UseRest)) throw err
      return restIndex(octokit, state, ref, data, opts, true)
    }
  }
  return restIndex(octokit, state, ref, data, opts, false)
}
