/**
 * The open pull requests of a repo, for the overlay: which branch has one, its review decision and
 * its checks. Loaded lazily (pullsChunk in lazy/parts.ts) once the graph is in, and never stored.
 *
 * With a token: GraphQL, one query per 40 branches run one after another (vite's 97 branches cost
 * 3 POSTs and no core requests), each branch asked as an aliased ref whose name only travels in the
 * variables; a branch with more than 5 open pull requests (most often a default branch that bots
 * sync into forks) is read on in one more POST per page. Without one: the REST listing (1 request
 * per 100 open pull requests, at most 3 pages), with review and checks left 'unknown' until a pull
 * request is looked up (lookupPull, 3 requests) because the 60-request hourly budget cannot pay for
 * all of them.
 *
 * Pull requests from forks are dropped: their head branch is not a branch of this repo, even when it
 * shares a name with one (forks of express open dozens from their own "master").
 */
import { Octokit } from '@octokit/rest'
import { GitHubFetchError } from '../types'
import type { Branch, CheckCounts, ChecksState, PullIndex, PullSummary, RepoData, ReviewState } from '../types'
import type { RepoRef } from './parseRepoUrl'
import { GRAPHQL_TIMEOUT_MS, withTimeout } from './graphql'
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
/** Pull requests per follow-up page, for a branch with more than PRS_PER_REF. */
const PRS_PER_PAGE = 100
/** Follow-up pages read per branch at most; past that the index is marked truncated. */
export const GRAPHQL_MAX_ROUNDS = 3
/** Branches a partial answer left unchecked are asked again in one query up to this many, else in halves. */
const UNCHECKED_RETRY_MAX = 20
// The query timeout is defined in api/graphql.ts, which person mode imports without loading this
// module; it is re-exported here so importers of pulls.ts keep finding it.
export { GRAPHQL_TIMEOUT_MS }
/** Pages of 100 the REST listing reads at most (the most recently updated first). */
export const REST_MAX_PAGES = 3
/** Without a token the listing is skipped, or stops paging, below this many core requests left. */
export const REST_MIN_REMAINING = 5
/**
 * Requests one lookupPull costs (check runs, commit statuses, reviews); more only for a pull request
 * with over 100 check runs or reviews (see LOOKUP_MAX_PAGES).
 */
export const LOOKUP_COST = 3
/** Pages of 100 a lookup reads at most of a head commit's check runs, and of a pull request's reviews. */
export const LOOKUP_MAX_PAGES = 3
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

/**
 * GraphQL reviewDecision -> ReviewState. GitHub fills it only where a branch rule asks for reviews:
 * null means no review rule, and normaliseGraphql derives the review from latestOpinionatedReviews
 * instead (as reduceReviews does for REST); it maps to 'waiting' here only for completeness.
 */
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

/**
 * What is read of each pull request, in the first query and the follow-up pages alike. Reviews:
 * reviewDecision is only filled where a branch rule asks for reviews, so each reviewer's latest
 * approval or change request comes too (as the REST lookup reads them).
 */
function prNodeFields(counts: boolean): string {
  return (
    'number title url isDraft isCrossRepository headRepository { nameWithOwner } ' +
    'headRefName headRefOid baseRefName reviewDecision latestOpinionatedReviews(first: 10) { nodes { state author { login } } } ' +
    'mergeable updatedAt author { login } reviewRequests { totalCount } ' +
    `commits(last: 1) { nodes { commit { oid statusCheckRollup { state${counts ? ' ' + COUNTS_FIELDS : ''} } } } }`
  )
}

function prFragment(counts: boolean): string {
  return (
    'fragment OpenPrs on Ref { associatedPullRequests(states: OPEN, first: ' +
    PRS_PER_REF +
    ', orderBy: {field: UPDATED_AT, direction: DESC}) { totalCount pageInfo { hasNextPage endCursor } nodes { ' +
    prNodeFields(counts) +
    ' } } }'
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

/**
 * The next page of each of these branches' open pull requests (after the cursor its last page
 * ended on): a branch whose first PRS_PER_REF were not all of them. Names and cursors travel as
 * variables, as in buildPullQuery.
 */
export function buildMoreQuery(
  ref: RepoRef,
  items: ReadonlyArray<{ name: string; cursor: string }>,
  opts: { counts: boolean },
): { query: string; variables: Record<string, string> } {
  const decls = ['$owner: String!', '$repo: String!']
  const variables: Record<string, string> = { owner: ref.owner, repo: ref.repo }
  const aliases: string[] = []
  items.forEach((item, i) => {
    decls.push(`$b${i}: String!`, `$c${i}: String`)
    variables[`b${i}`] = `refs/heads/${item.name}`
    variables[`c${i}`] = item.cursor
    aliases.push(
      `b${i}: ref(qualifiedName: $b${i}) { associatedPullRequests(states: OPEN, first: ${PRS_PER_PAGE}, after: $c${i}, ` +
        'orderBy: {field: UPDATED_AT, direction: DESC}) { totalCount pageInfo { hasNextPage endCursor } nodes { ...PrFields } } }',
    )
  })
  const query =
    `query(${decls.join(', ')}) { repository(owner: $owner, name: $repo) { nameWithOwner ${aliases.join(' ')} } }\n` +
    `fragment PrFields on PullRequest { ${prNodeFields(opts.counts)} }`
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
  latestOpinionatedReviews?: { nodes?: Array<{ state?: string | null; author?: { login?: string | null } | null } | null> | null } | null
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
  associatedPullRequests?: {
    totalCount?: number | null
    pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null
    nodes?: Array<GqlPull | null> | null
  } | null
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

/** One entry of a GraphQL answer's errors. */
export interface GqlErrorEntry {
  type?: string
  message?: string
  path?: ReadonlyArray<string | number>
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

/** What one pull request of a partial answer lost to errors. */
export interface GqlNodeLoss {
  /** its head commit's rollup (or the commit) errored: the checks are not known */
  checks: boolean
  /** only the per-state counts errored (the rollup state may still stand) */
  counts: boolean
  /** reviewDecision or the latest reviews errored: the review is not known */
  review: boolean
}

/** What the errors of a partial GraphQL answer cost, by alias index (b0, b1, ... in query order). */
export interface GqlLosses {
  /** aliases whose pull requests are not known at all: the ref, its connection or one of its nodes came back null */
  unchecked: Set<number>
  /** `${alias}:${node}` -> what that pull request lost */
  nodes: Map<string, GqlNodeLoss>
}

/**
 * Reads a partial answer's error paths. GitHub nulls a field that failed and, through non-null
 * fields, its parents up to the nearest nullable one, so a null in the data can mean "failed" as
 * well as "none": these marks say which. A path under node k of alias i
 * (repository.bI.associatedPullRequests.nodes.K...) costs that pull request its checks (commits,
 * statusCheckRollup), just its counts (contexts) or its review (reviewDecision, the latest
 * reviews); mergeable and reviewRequests are read as unknown when null anyway. A shorter path under
 * an alias (the ref, its connection, its node list, a node) leaves the whole alias unchecked. An
 * error with no path under an alias (rateLimit, the open counts, none at all) marks no alias: the
 * rest of the answer stands.
 */
export function gqlErrorMarks(errors: ReadonlyArray<GqlErrorEntry>, names: ReadonlyArray<string>): GqlLosses {
  const unchecked = new Set<number>()
  const nodes = new Map<string, GqlNodeLoss>()
  for (const error of errors) {
    const path = error.path ?? []
    const alias = path[0] === 'repository' && typeof path[1] === 'string' ? /^b(\d+)$/.exec(path[1]) : null
    if (!alias) continue
    const i = Number(alias[1])
    if (i >= names.length) continue
    const k = path[2] === 'associatedPullRequests' && path[3] === 'nodes' && typeof path[4] === 'number' ? path[4] : null
    if (k === null || path.length === 5) {
      unchecked.add(i)
      continue
    }
    const rest = path.slice(5)
    const key = `${i}:${k}`
    const loss = nodes.get(key) ?? { checks: false, counts: false, review: false }
    if (rest.includes('contexts')) loss.counts = true
    else if (rest.includes('commits') || rest.includes('statusCheckRollup')) loss.checks = true
    else if (rest.includes('reviewDecision') || rest.includes('latestOpinionatedReviews')) loss.review = true
    nodes.set(key, loss)
  }
  return { unchecked, nodes }
}

/** One GraphQL answer read: pull requests by branch, and what is left to ask. */
export interface GqlRead {
  byBranch: Map<string, PullSummary[]>
  total: number | null
  intoBase: number | null
  /** branches GitHub did not answer for (partial errors): not known, unlike a gone ref */
  unchecked: string[]
  /** branches with more open pull requests than came back, and the cursor to read on from */
  more: Array<{ name: string; cursor: string }>
}

/**
 * One query's answer as pull requests by branch (the names in query order). A ref that is gone
 * (null with no error: deleted since the graph was fetched) has no entry; one GitHub did not answer
 * for (see gqlErrorMarks) has none either, and is listed in unchecked. A pull request that lost its
 * rollup or review to an error reads 'unknown' there (a lookup can fill it in), never 'none' or
 * 'waiting'.
 */
export function normaliseGraphql(
  data: GqlPullData | null | undefined,
  names: ReadonlyArray<string>,
  ref: RepoRef,
  errors: ReadonlyArray<GqlErrorEntry> = [],
): GqlRead {
  const byBranch = new Map<string, PullSummary[]>()
  const unchecked: string[] = []
  const more: Array<{ name: string; cursor: string }> = []
  const repo = data?.repository
  const canonical = (repo?.nameWithOwner ?? `${ref.owner}/${ref.repo}`).toLowerCase()
  const losses = gqlErrorMarks(errors, names)
  names.forEach((name, i) => {
    const node = repo?.[`b${i}`] as GqlRef | null | undefined
    const nodes = node?.associatedPullRequests?.nodes ?? []
    // an errored node nulled through a non-null field leaves its branch unchecked as well
    const lostNode = nodes.some((pr, k) => pr === null && losses.nodes.has(`${i}:${k}`))
    if (losses.unchecked.has(i) || lostNode) {
      unchecked.push(name)
      return
    }
    const prs: PullSummary[] = []
    nodes.forEach((pr, k) => {
      if (!pr || pr.headRefName !== name || !sameRepoHead(pr, canonical)) return
      const loss = losses.nodes.get(`${i}:${k}`)
      const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null
      const checksLost = loss !== undefined && (loss.checks || (loss.counts && rollup === null))
      const reviews = (pr.latestOpinionatedReviews?.nodes ?? []).flatMap((r) => (r ? [{ state: r.state, user: r.author }] : []))
      prs.push({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        head: pr.headRefName,
        headSha: pr.headRefOid,
        base: pr.baseRefName,
        draft: pr.isDraft === true,
        author: pr.author?.login ?? null,
        // reviewDecision is only set where a branch rule asks for reviews; elsewhere the reviews say
        review: loss?.review ? 'unknown' : pr.reviewDecision ? mapReviewDecision(pr.reviewDecision) : reduceReviews(reviews),
        reviewRequired: loss?.review ? null : pr.reviewDecision === 'REVIEW_REQUIRED',
        checks: checksLost ? 'unknown' : mapRollupState(rollup?.state),
        checkCounts: checksLost || loss?.counts ? null : countsFromGraphql(rollup?.contexts),
        reviewersAsked: pr.reviewRequests?.totalCount ?? null,
        conflict: mapMergeable(pr.mergeable),
        updatedAt: pr.updatedAt,
      })
    })
    if (prs.length > 0) byBranch.set(name, sortPulls(prs))
    const page = node?.associatedPullRequests?.pageInfo
    if (page?.hasNextPage && page.endCursor) more.push({ name, cursor: page.endCursor })
  })
  return {
    byBranch,
    total: repo?.open?.totalCount ?? null,
    intoBase: repo?.intoDefault?.totalCount ?? null,
    unchecked,
    more,
  }
}

function sortPulls(prs: PullSummary[]): PullSummary[] {
  return prs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : b.number - a.number))
}

/** Two lists of one branch's pull requests as one, each pull request once (the later copy wins), most recently updated first. */
function mergePulls(a: ReadonlyArray<PullSummary>, b: ReadonlyArray<PullSummary>): PullSummary[] {
  const byNumber = new Map<number, PullSummary>()
  for (const pr of [...a, ...b]) byNumber.set(pr.number, pr)
  return sortPulls([...byNumber.values()])
}

/** Thrown inside the GraphQL path when GitHub refuses GraphQL for this visitor: the REST path takes over. */
class UseRest extends Error {
  constructor(public readonly reason: string) {
    super(reason)
  }
}

type GqlOutcome =
  | { kind: 'data'; data: GqlPullData; errors: GqlErrorEntry[] }
  | { kind: 'schema' }
  | { kind: 'transient' }
  | { kind: 'rest'; reason: string }
  | { kind: 'fail'; error: GitHubFetchError }

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
    return { kind: 'data', data, errors: [] }
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
      // partial data: use what came back; the errors say which nulls are failures (gqlErrorMarks)
      if (repoData) return { kind: 'data', data: e.data as GqlPullData, errors: e.errors }
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
      const failure = toFetchError(err, { what: 'reading pull requests', signal: opts.signal, token: opts.token, subject: ref })
      if (failure.code === 'rate_limited') return { kind: 'fail', error: failure }
      return { kind: 'rest', reason: `HTTP ${status}` }
    }
    if (status === 502 || status === 504 || (hasHttpResponse(err) && status !== undefined && status >= 500)) return { kind: 'transient' }
    return {
      kind: 'fail',
      error: toFetchError(err, { what: 'reading pull requests', signal: opts.signal, token: opts.token, subject: ref }),
    }
  }
}

/** A branch asked about: its name, and for a follow-up page the cursor to read on from. */
type GqlItem = { name: string; cursor?: string }
/** Builds the query for some items (first: also the budget and the open counts; counts: the per-state check counts). */
type GqlBuild = (items: ReadonlyArray<GqlItem>, first: boolean, counts: boolean) => { query: string; variables: Record<string, string> }

/** Reads of disjoint branches as one. */
function joinReads(reads: ReadonlyArray<GqlRead>): GqlRead {
  const out: GqlRead = { byBranch: new Map(), total: null, intoBase: null, unchecked: [], more: [] }
  for (const read of reads) {
    for (const [name, prs] of read.byBranch) out.byBranch.set(name, prs)
    out.total = out.total ?? read.total
    out.intoBase = out.intoBase ?? read.intoBase
    out.unchecked.push(...read.unchecked)
    out.more.push(...read.more)
  }
  return out
}

/**
 * One batch with the failure ladder: partial data is used; a slow or 5xx answer is retried once in
 * two halves; failing that (or on a schema error) without the per-state counts; then it gives up.
 * Branches a partial answer left unchecked are asked once more on their own (in halves above
 * UNCHECKED_RETRY_MAX), and whatever is still unchecked after that is returned as such.
 */
async function graphqlBatch(
  octokit: Octokit,
  ref: RepoRef,
  items: ReadonlyArray<GqlItem>,
  first: boolean,
  opts: PullFetchOptions,
  build: GqlBuild,
): Promise<GqlRead> {
  const ask = async (subset: ReadonlyArray<GqlItem>, isFirst: boolean, counts: boolean) => {
    const { query, variables } = build(subset, isFirst, counts)
    return runGraphql(octokit, query, variables, opts, ref)
  }
  const read = (outcome: Extract<GqlOutcome, { kind: 'data' }>, subset: ReadonlyArray<GqlItem>) =>
    normaliseGraphql(outcome.data, subset.map((item) => item.name), ref, outcome.errors)
  const settle = (outcome: GqlOutcome): void => {
    if (outcome.kind === 'rest') throw new UseRest(outcome.reason)
    if (outcome.kind === 'fail') throw outcome.error
  }
  const halve = <T>(list: ReadonlyArray<T>): T[][] => {
    const mid = Math.ceil(list.length / 2)
    return [list.slice(0, mid), list.slice(mid)]
  }

  let got: { read: GqlRead; counts: boolean } | null = null
  const whole = await ask(items, first, true)
  if (whole.kind === 'data') got = { read: read(whole, items), counts: true }
  else {
    settle(whole)
    if (whole.kind === 'transient' && items.length > 1) {
      const halves = halve(items)
      const reads: GqlRead[] = []
      for (let h = 0; h < halves.length; h++) {
        const part = await ask(halves[h], first && h === 0, true)
        if (part.kind !== 'data') {
          settle(part)
          break
        }
        reads.push(read(part, halves[h]))
      }
      if (reads.length === halves.length) got = { read: joinReads(reads), counts: true }
    }
    if (!got) {
      if (opts.signal?.aborted) throw new GitHubFetchError('Fetch aborted while reading pull requests', 'aborted')
      const lean = await ask(items, first, false)
      if (lean.kind !== 'data') {
        settle(lean)
        throw new GitHubFetchError('GitHub did not answer the pull request query in time (tried in halves and without check counts).', 'network')
      }
      got = { read: read(lean, items), counts: false }
    }
  }

  // branches GitHub did not answer for: once more, on their own (the query that worked, without the extras)
  const result = got.read
  if (result.unchecked.length === 0) return result
  const lost = new Set(result.unchecked)
  const redo = items.filter((item) => lost.has(item.name))
  for (const chunk of redo.length > UNCHECKED_RETRY_MAX ? halve(redo) : [redo]) {
    const again = await ask(chunk, false, got.counts)
    // a retry that fails as a whole leaves them unchecked (an abort throws)
    if (again.kind !== 'data') continue
    const answer = read(again, chunk)
    const stillLost = new Set(answer.unchecked)
    for (const item of chunk) {
      if (stillLost.has(item.name)) continue
      lost.delete(item.name)
      const prs = answer.byBranch.get(item.name)
      if (prs) result.byBranch.set(item.name, prs)
      const page = answer.more.find((m) => m.name === item.name)
      if (page) result.more.push(page)
    }
  }
  result.unchecked = result.unchecked.filter((name) => lost.has(name))
  return result
}

async function graphqlIndex(octokit: Octokit, ref: RepoRef, data: RepoData, opts: PullFetchOptions): Promise<PullIndex> {
  const names = data.branches.map((b) => b.name)
  const byBranch = new Map<string, PullSummary[]>()
  const unchecked: string[] = []
  let total: number | null = null
  let intoBase: number | null = null
  let more: Array<{ name: string; cursor: string }> = []
  const firstPages: GqlBuild = (items, first, counts) => buildPullQuery(ref, items.map((item) => item.name), data.defaultBranch, { first, counts })
  // serially, in branch order: deterministic request bodies, and never a burst at the API
  for (let start = 0, batch = 0; start < names.length; start += GRAPHQL_BATCH, batch++) {
    const slice = names.slice(start, start + GRAPHQL_BATCH).map((name) => ({ name }))
    const got = await graphqlBatch(octokit, ref, slice, batch === 0, opts, firstPages)
    for (const [name, prs] of got.byBranch) byBranch.set(name, prs)
    unchecked.push(...got.unchecked)
    more.push(...got.more)
    total = total ?? got.total
    intoBase = intoBase ?? got.intoBase
  }

  // Branches with more open pull requests than the first PRS_PER_REF: pull requests into forks
  // (bots syncing a default branch into them) can fill those, so read on, every page, since a branch
  // can have several of its own (canary -> main and canary -> release). At most GRAPHQL_MAX_ROUNDS
  // pages each; past that (or if a page cannot be read) the index says it is truncated.
  let truncated = false
  const nextPages: GqlBuild = (items, _first, counts) =>
    buildMoreQuery(ref, items.map((item) => ({ name: item.name, cursor: item.cursor ?? '' })), { counts })
  for (let round = 0; more.length > 0; round++) {
    if (round === GRAPHQL_MAX_ROUNDS) {
      truncated = true
      break
    }
    const next: Array<{ name: string; cursor: string }> = []
    for (let start = 0; start < more.length; start += GRAPHQL_BATCH) {
      const slice = more.slice(start, start + GRAPHQL_BATCH)
      let got: GqlRead
      try {
        got = await graphqlBatch(octokit, ref, slice, false, opts, nextPages)
      } catch (err) {
        if (err instanceof GitHubFetchError && err.code === 'aborted') throw err
        // what the first pages said stands
        truncated = true
        continue
      }
      for (const [name, prs] of got.byBranch) byBranch.set(name, mergePulls(byBranch.get(name) ?? [], prs))
      if (got.unchecked.length > 0) truncated = true
      next.push(...got.more)
    }
    more = next
  }

  const mapped = countPulls(byBranch)
  return {
    byBranch,
    intoBase,
    total,
    // everything open that is not drawn: fork heads, branches not loaded, and the unchecked branches' own
    fromForks: total === null ? 0 : Math.max(0, total - mapped),
    notOnGraph: 0,
    truncated,
    unchecked,
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
      throw toFetchError(err, { what: 'listing pull requests', signal: opts.signal, token: opts.token, subject: ref })
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
      // REST cannot see branch rules
      reviewRequired: null,
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

export interface LookupResult {
  review: ReviewState
  checks: ChecksState
  checkCounts: CheckCounts | null
  /** requests spent */
  requests: number
}

/**
 * One pull request's review and checks: its head commit's check runs and commit statuses, and its
 * reviews, every time (statuses come and go per pull request: deploy previews, coverage, CLA bots).
 * A head with over 100 check runs, or a pull request with over 100 reviews, is read on page by page
 * (LOOKUP_MAX_PAGES at most, and without a token only while REST_MIN_REMAINING requests are left);
 * what could not be read is not guessed: checks read 'unknown' unless a failure was seen, and the
 * review 'unknown'.
 */
async function lookupWith(
  octokit: Octokit,
  ref: RepoRef,
  pr: Pick<PullSummary, 'number' | 'headSha'>,
  opts: PullFetchOptions,
  budget: { remaining: number | null },
): Promise<LookupResult> {
  const base = { owner: ref.owner, repo: ref.repo }
  const canPage = () => !!opts.token?.trim() || budget.remaining === null || budget.remaining >= REST_MIN_REMAINING
  try {
    const [runs, status, reviews] = await Promise.all([
      octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', { ...base, ref: pr.headSha, per_page: PER_PAGE }),
      octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/status', { ...base, ref: pr.headSha, per_page: PER_PAGE }),
      octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', { ...base, pull_number: pr.number, per_page: PER_PAGE }),
    ])
    let requests = 3

    // check runs past the first 100
    const runData = runs.data as { total_count?: number; check_runs?: RawCheckRun[] }
    const runList: RawCheckRun[] = [...(runData.check_runs ?? [])]
    const runTotal = runData.total_count ?? runList.length
    let runHeaders = runs.headers as HeaderBag
    let runLength = runList.length
    for (let page = 2; runList.length < runTotal && page <= LOOKUP_MAX_PAGES && hasNextLink(runHeaders, runLength) && canPage(); page++) {
      const next = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', { ...base, ref: pr.headSha, per_page: PER_PAGE, page })
      requests += 1
      const got = (next.data as { check_runs?: RawCheckRun[] }).check_runs ?? []
      runList.push(...got)
      runHeaders = next.headers as HeaderBag
      runLength = got.length
      if (got.length === 0) break
    }
    const runsUnread = runList.length < runTotal && hasNextLink(runHeaders, runLength)

    const statusData = status.data as { state?: string; total_count?: number; statuses?: RawCommitStatus[] }
    const statusTotal = statusData.total_count ?? 0
    // GitHub reports 'pending' for a commit with no statuses at all: ignore the combined state then
    const statusList: RawCommitStatus[] = statusTotal > 0 ? [...(statusData.statuses ?? [])] : []
    // over 100 statuses: the first page is not all of them, but the combined state covers every one
    const statusesCut = statusTotal > statusList.length
    if (statusesCut && statusData.state) statusList.push({ state: statusData.state })

    const rolled = rollupChecks(runList, statusList)
    let checks = rolled.checks
    let checkCounts = rolled.counts
    if (runsUnread || statusesCut) {
      const counts = checkCounts ?? { failing: 0, running: 0, passing: 0, skipped: 0, total: 0 }
      checkCounts = { ...counts, total: Math.max(counts.total, (runsUnread ? runTotal : runList.length) + statusTotal) }
      // a failure seen stands; anything better is not known while runs went unread
      if (runsUnread && checks !== 'failing') checks = 'unknown'
    }

    // reviews past the first 100, oldest first, as GitHub lists them
    const reviewList: RawReview[] = [...(reviews.data as RawReview[])]
    let reviewHeaders = reviews.headers as HeaderBag
    let reviewLength = reviewList.length
    for (let page = 2; page <= LOOKUP_MAX_PAGES && hasNextLink(reviewHeaders, reviewLength) && canPage(); page++) {
      const next = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', { ...base, pull_number: pr.number, per_page: PER_PAGE, page })
      requests += 1
      const got = next.data as RawReview[]
      reviewList.push(...got)
      reviewHeaders = next.headers as HeaderBag
      reviewLength = got.length
      if (got.length === 0) break
    }
    // the latest reviews may be on a page not read: no partial verdict
    const review = hasNextLink(reviewHeaders, reviewLength) ? 'unknown' : reduceReviews(reviewList)

    return { review, checks, checkCounts, requests }
  } catch (err) {
    throw toFetchError(err, { what: `looking up pull request #${pr.number}`, signal: opts.signal, token: opts.token, subject: ref })
  }
}

/** Review and checks of one pull request over REST: check runs, commit statuses and reviews (3 requests, more past 100 of a kind). */
export async function lookupPull(ref: RepoRef, pr: Pick<PullSummary, 'number' | 'headSha'>, opts: PullFetchOptions = {}): Promise<LookupResult> {
  const { octokit, state } = createClient(opts)
  return lookupWith(octokit, ref, pr, opts, state)
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
        const found = await lookupWith(octokit, ref, pr, opts, budget)
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
    unchecked: [],
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
