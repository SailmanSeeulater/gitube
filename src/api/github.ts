import { Octokit } from '@octokit/rest'
import { GitHubFetchError } from '../types'
import type { Branch, Commit, FetchOptions, FetchProgress, FetchStage, RepoData } from '../types'
import type { RepoRef } from './parseRepoUrl'

/** Hard caps and defaults for one fetchRepoData call. */
const DEFAULT_TRUNK_LIMIT = 500
const DEFAULT_BRANCH_LIMIT = 250
const DEFAULT_MAX_BRANCHES = 200
const COMPARE_CONCURRENCY = 6
const PER_PAGE = 100
/**
 * Minimum trunk commits to fetch before the "all merge-bases covered" early stop may kick in.
 * Only applies when at least one merge base is known; with none (trunk-only repo, or every
 * compare skipped) the walk runs to trunkLimit, as FetchOptions.trunkLimit promises.
 */
const TRUNK_MIN_COMMITS = 100
/** GitHub returns at most this many commits in a single (unpaged) compare response. */
const GITHUB_COMPARE_CAP = 250
/** Pause before the single retry of a compare that GitHub answered with a real 5xx. */
const COMPARE_RETRY_DELAY_MS = 500

/**
 * Structural view of a GitHub commit object as returned by compare, listCommits and
 * merge_base_commit. Kept minimal so both octokit's generated types and plain fixtures fit.
 */
interface RawCommit {
  sha: string
  html_url: string
  parents: ReadonlyArray<{ sha: string }>
  commit: {
    message: string
    author?: { name?: string; date?: string } | null
    committer?: { name?: string; date?: string } | null
  }
  author?: { login?: string } | null
}

type HeaderBag = Record<string, string | number | undefined>

interface RateState {
  requestsUsed: number
  remaining: number | null
  resetAt: string | null
}

interface ErrorContext {
  what: string
  signal?: AbortSignal
  token?: string
  owner: string
  repo: string
}

/**
 * Fetch everything needed to draw the branch graph for a repo using the GitHub REST API
 * from the browser (no clone). See PLAN.md section 3 for the request plan.
 *
 * Request budget: 1 (repo) + ceil(branches / 100) (listing) + 1 per non-default branch
 * (compare) + 1..ceil(trunkLimit / 100) (trunk pages). A repo with 80 branches costs
 * roughly 85 requests.
 */
export async function fetchRepoData(ref: RepoRef, opts: FetchOptions = {}): Promise<RepoData> {
  const { owner, repo } = ref
  const trunkLimit = Math.max(1, Math.floor(opts.trunkLimit ?? DEFAULT_TRUNK_LIMIT))
  const branchLimit = Math.min(GITHUB_COMPARE_CAP, Math.max(1, Math.floor(opts.branchLimit ?? DEFAULT_BRANCH_LIMIT)))
  const maxBranches = Math.max(1, Math.floor(opts.maxBranches ?? DEFAULT_MAX_BRANCHES))
  const signal = opts.signal
  const token = opts.token?.trim() || undefined

  const octokit = new Octokit({
    auth: token,
    request: { fetch: opts.fetch, signal },
  })

  const state: RateState = { requestsUsed: 0, remaining: null, resetAt: null }

  // Count every HTTP request and remember the most recent rate-limit headers, including
  // on failed responses (a 403 rate-limit response carries the headers we want).
  octokit.hook.wrap('request', async (request, options) => {
    try {
      const response = await request(options)
      state.requestsUsed += 1
      noteRateLimit(state, response.headers as HeaderBag)
      return response
    } catch (err) {
      state.requestsUsed += 1
      const headers = (err as { response?: { headers?: HeaderBag } }).response?.headers
      if (headers) noteRateLimit(state, headers)
      throw err
    }
  })

  const emit = (stage: FetchStage, done: number, total: number, message: string): void => {
    if (!opts.onProgress) return
    const progress: FetchProgress = {
      stage,
      done,
      total,
      message,
      requestsUsed: state.requestsUsed,
      rateLimitRemaining: state.remaining,
      rateLimitResetAt: state.resetAt,
    }
    opts.onProgress(progress)
  }

  const throwIfAborted = (): void => {
    if (signal?.aborted) throw new GitHubFetchError('Fetch aborted', 'aborted')
  }

  const commitMap = new Map<string, Commit>()
  const truncatedAt = new Set<string>()
  let truncated = false

  const addCommit = (raw: RawCommit): Commit => {
    const existing = commitMap.get(raw.sha)
    if (existing) return existing
    const normalised = normaliseCommit(raw)
    commitMap.set(normalised.sha, normalised)
    return normalised
  }

  const ctx = (what: string): ErrorContext => ({ what, signal, token, owner, repo })

  // ---------- 1. repo ----------
  throwIfAborted()
  let defaultBranch: string
  try {
    const repoRes = await octokit.repos.get({ owner, repo })
    defaultBranch = repoRes.data.default_branch
  } catch (err) {
    throw toFetchError(err, ctx(`looking up ${owner}/${repo}`))
  }
  emit('repo', 1, 1, `Found ${owner}/${repo}; default branch is ${defaultBranch}`)

  // ---------- 2. branches ----------
  const listed: Array<{ name: string; sha: string }> = []
  let moreBranchesExist = false
  try {
    for await (const page of octokit.paginate.iterator(octokit.repos.listBranches, {
      owner,
      repo,
      per_page: PER_PAGE,
    })) {
      throwIfAborted()
      for (const b of page.data) listed.push({ name: b.name, sha: b.commit.sha })
      const hasNext = hasNextLink(page.headers as HeaderBag, page.data.length)
      emit('branches', listed.length, listed.length, `Listed ${listed.length} branches`)
      if (listed.length >= maxBranches) {
        moreBranchesExist = hasNext
        break
      }
    }
  } catch (err) {
    throw toFetchError(err, ctx(`listing branches of ${owner}/${repo}`))
  }

  let kept = listed
  if (listed.length > maxBranches || moreBranchesExist) {
    truncated = true
    kept = listed.slice(0, maxBranches)
    // Never let the cap drop the default branch itself.
    const defaultEntry = listed.find((b) => b.name === defaultBranch)
    if (defaultEntry && !kept.some((b) => b.name === defaultBranch)) {
      kept = [defaultEntry, ...kept.slice(0, maxBranches - 1)]
    }
    const dropped = listed.length - kept.length
    const suffix = moreBranchesExist ? ' (more exist beyond the fetched pages)' : ''
    emit(
      'branches',
      kept.length,
      listed.length,
      `Branch cap of ${maxBranches} reached: dropped ${dropped} branch${dropped === 1 ? '' : 'es'}${suffix}`,
    )
  }

  // ---------- 3. compare every non-default branch against the default branch ----------
  const others = kept.filter((b) => b.name !== defaultBranch)
  const compared: Array<Branch | null> = others.map(() => null)
  const mergeBases = new Set<string>()
  let compareDone = 0

  /**
   * One compare request, retried exactly once after a short pause when GitHub answered with
   * a real 5xx response (transient 502/503s are routine on a burst of ~200 compares). Every
   * attempt passes through the request hook, so requestsUsed stays accurate.
   */
  const compareWithOneRetry = async (basehead: string) => {
    try {
      return await octokit.repos.compareCommitsWithBasehead({ owner, repo, basehead })
    } catch (err) {
      if (!isServerErrorResponse(err) || signal?.aborted) throw err
      await sleep(COMPARE_RETRY_DELAY_MS, signal)
      throwIfAborted()
      return octokit.repos.compareCommitsWithBasehead({ owner, repo, basehead })
    }
  }

  await runPool(others, COMPARE_CONCURRENCY, async (branch, index) => {
    throwIfAborted()
    const basehead = `${defaultBranch}...${branch.name}`
    let data
    try {
      // Octokit percent-encodes {basehead} with encodeURIComponent ('/' -> %2F, '#' -> %23,
      // ' ' -> %20, unicode -> UTF-8 escapes) and leaves '...' alone, so pass it raw.
      // No per_page/page here on purpose: unpaged compare returns the NEWEST <=250 commits
      // with the tip last; paged compare would instead start from the oldest.
      const res = await compareWithOneRetry(basehead)
      data = res.data
    } catch (err) {
      const status = errorStatus(err)
      const name = (err as { name?: string } | null)?.name
      // An abort stays fatal whatever the status says.
      if (name === 'AbortError' || signal?.aborted) throw toFetchError(err, ctx(`comparing ${basehead}`))
      if (status === 404) {
        compareDone += 1
        emit(
          'compare',
          compareDone,
          others.length,
          `Skipped ${branch.name}: it no longer exists or shares no history with ${defaultBranch}`,
        )
        return
      }
      // A branch GitHub cannot diff (5xx on a huge comparison, 422) must not throw away every
      // other branch's compare. Its history is missing from the result, so flag truncation.
      // Only a real HTTP response qualifies: Octokit synthesises status 500 with no response
      // for a thrown fetch failure, which must still surface as a 'network' error below.
      if (isSkippableCompareStatus(err)) {
        compareDone += 1
        truncated = true
        const tooLarge = status !== undefined && status >= 500 ? ' (the comparison may be too large)' : ''
        emit('compare', compareDone, others.length, `Skipped ${branch.name}: GitHub returned HTTP ${status}${tooLarge}`)
        return
      }
      // 401/403/429, network failures and anything unexpected still fail the whole fetch.
      throw toFetchError(err, ctx(`comparing ${basehead}`))
    }

    const mergeBase = addCommit(data.merge_base_commit)
    mergeBases.add(mergeBase.sha)

    let unique: ReadonlyArray<RawCommit> = data.commits
    if (unique.length > branchLimit) unique = unique.slice(unique.length - branchLimit)
    for (const c of unique) addCommit(c)

    // Cap hit: remember that history was cut. Which sha is a root is decided in step 5, once
    // every compare and the trunk walk have merged into commitMap: if unique[0]'s parent
    // arrives through another branch's compare or the trunk, it is not a root at all.
    if (data.ahead_by > unique.length && unique.length > 0) truncated = true

    const tipRaw: RawCommit = data.ahead_by > 0 && unique.length > 0 ? unique[unique.length - 1] : data.merge_base_commit
    const tip = addCommit(tipRaw)
    // Prefer the listing's sha when it is in the map (normal case); fall back to the compare
    // tip if the branch moved between the listing and the compare.
    const tipSha = commitMap.has(branch.sha) ? branch.sha : tip.sha

    compared[index] = {
      name: branch.name,
      tipSha,
      isDefault: false,
      mergeBaseSha: mergeBase.sha,
      aheadBy: data.ahead_by,
      behindBy: data.behind_by,
      tipDate: commitMap.get(tipSha)?.date ?? tip.date,
    }
    compareDone += 1
    emit(
      'compare',
      compareDone,
      others.length,
      `Compared ${branch.name}: ${data.ahead_by} ahead, ${data.behind_by} behind`,
    )
  })

  // ---------- 4. trunk ----------
  const trunkSeen = new Set<string>()
  let trunkCount = 0
  let page = 1
  let trunkCutShort = false
  let firstTrunkSha: string | null = null

  while (trunkCount < trunkLimit) {
    throwIfAborted()
    let data: RawCommit[]
    let headers: HeaderBag
    try {
      const res = await octokit.repos.listCommits({ owner, repo, sha: defaultBranch, per_page: PER_PAGE, page })
      data = res.data
      headers = res.headers as HeaderBag
    } catch (err) {
      throw toFetchError(err, ctx(`reading commits on ${defaultBranch}`))
    }

    const room = trunkLimit - trunkCount
    const slice = data.length > room ? data.slice(0, room) : data
    for (const c of slice) {
      const normalised = addCommit(c)
      trunkSeen.add(normalised.sha)
      if (firstTrunkSha === null) firstTrunkSha = normalised.sha
    }
    trunkCount += slice.length
    emit('trunk', trunkCount, trunkLimit, `Fetched ${trunkCount} commits on ${defaultBranch}`)

    const hasNext = hasNextLink(headers, data.length)
    if (slice.length < data.length) {
      trunkCutShort = true
      break
    }
    if (!hasNext || data.length === 0) break
    if (trunkCount >= trunkLimit) {
      trunkCutShort = true
      break
    }
    let allCovered = true
    for (const sha of mergeBases) {
      if (!trunkSeen.has(sha)) {
        allCovered = false
        break
      }
    }
    if (mergeBases.size > 0 && trunkCount >= TRUNK_MIN_COMMITS && allCovered) {
      trunkCutShort = true
      break
    }
    page += 1
  }
  if (trunkCutShort) truncated = true

  const defaultListed = listed.find((b) => b.name === defaultBranch)
  // Prefer the listing's sha when it was fetched (normal case, mirroring the non-default path
  // above). If the default branch was rewritten between the listing and the trunk walk, the
  // first trunk commit is the tip that GET /commits?sha=<default> (and every compare, both
  // resolved by name) actually describe; it is always in commitMap when non-null, so the
  // invariant "every tipSha is in commits" holds whenever the walk returned anything.
  const defaultTipSha =
    defaultListed && commitMap.has(defaultListed.sha) ? defaultListed.sha : (firstTrunkSha ?? defaultListed?.sha ?? '')
  const defaultBranchEntry: Branch = {
    name: defaultBranch,
    tipSha: defaultTipSha,
    isDefault: true,
    mergeBaseSha: null,
    aheadBy: 0,
    behindBy: 0,
    tipDate: commitMap.get(defaultTipSha)?.date ?? '',
  }

  // ---------- 5. make graph roots explicit ----------
  for (const commit of commitMap.values()) {
    for (const parent of commit.parents) {
      if (!commitMap.has(parent)) {
        truncatedAt.add(commit.sha)
        break
      }
    }
  }

  const branches: Branch[] = [defaultBranchEntry]
  for (const b of compared) if (b) branches.push(b)

  emit(
    'done',
    1,
    1,
    `Done: ${branches.length} branches, ${commitMap.size} commits, ${state.requestsUsed} requests`,
  )

  const commits: Record<string, Commit> = {}
  for (const [sha, commit] of commitMap) commits[sha] = commit

  return {
    owner,
    repo,
    defaultBranch,
    branches,
    commits,
    truncated,
    truncatedAt: [...truncatedAt],
  }
}

// ---------- helpers ----------

function normaliseCommit(raw: RawCommit): Commit {
  return {
    sha: raw.sha,
    parents: raw.parents.map((p) => p.sha),
    message: firstLine(raw.commit.message),
    author: raw.commit.author?.name ?? raw.author?.login ?? 'unknown',
    date: raw.commit.committer?.date ?? raw.commit.author?.date ?? '',
    url: raw.html_url,
  }
}

function firstLine(message: string | null | undefined): string {
  if (!message) return ''
  const idx = message.search(/\r?\n/)
  return (idx === -1 ? message : message.slice(0, idx)).trim()
}

function readHeader(headers: HeaderBag | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const lower = name.toLowerCase()
  const direct = headers[lower] ?? headers[name]
  if (direct !== undefined && direct !== null) return String(direct)
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key]
      return value === undefined || value === null ? undefined : String(value)
    }
  }
  return undefined
}

function noteRateLimit(state: RateState, headers: HeaderBag | undefined): void {
  const remaining = readHeader(headers, 'x-ratelimit-remaining')
  if (remaining !== undefined) {
    const n = Number(remaining)
    state.remaining = Number.isFinite(n) ? n : null
  }
  const reset = parseResetAt(headers)
  if (reset !== null) state.resetAt = reset
}

/**
 * When the caller may retry, from the response headers. retry-after wins: GitHub only sends
 * it for secondary (abuse) limits, which clear within minutes, whereas x-ratelimit-reset is
 * on every response and points at the hourly primary window. GitHub's docs say to honour
 * retry-after first.
 */
function parseResetAt(headers: HeaderBag | undefined): string | null {
  const retryAfter = readHeader(headers, 'retry-after')?.trim()
  if (retryAfter !== undefined && retryAfter !== '') {
    const n = Number(retryAfter)
    if (Number.isFinite(n) && n >= 0) return new Date(Date.now() + n * 1000).toISOString()
    const at = Date.parse(retryAfter) // RFC 7231 also allows an HTTP-date
    if (Number.isFinite(at)) return new Date(at).toISOString()
  }
  const reset = readHeader(headers, 'x-ratelimit-reset')
  if (reset !== undefined) {
    const n = Number(reset)
    if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toISOString()
  }
  return null
}

function errorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

/** True when err carries a real HTTP response (Octokit synthesises status 500 with none for a fetch failure). */
function hasHttpResponse(err: unknown): boolean {
  return (err as { response?: unknown } | null)?.response !== undefined
}

/** A genuine 5xx answer from GitHub: worth exactly one retry. */
function isServerErrorResponse(err: unknown): boolean {
  const status = errorStatus(err)
  return hasHttpResponse(err) && status !== undefined && status >= 500 && status < 600
}

/** A compare answer meaning GitHub could not produce this one diff: skip the branch, keep the rest. */
function isSkippableCompareStatus(err: unknown): boolean {
  const status = errorStatus(err)
  return hasHttpResponse(err) && status !== undefined && (status === 422 || (status >= 500 && status < 600))
}

/** Resolve after ms, or straight away once signal aborts (the caller re-checks the signal). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const done = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

function hasNextLink(headers: HeaderBag | undefined, pageLength: number): boolean {
  const link = readHeader(headers, 'link')
  if (link !== undefined) return /<[^<>]+>;\s*rel="next"/.test(link)
  // No Link header at all: assume more pages only when the page is full.
  return pageLength >= PER_PAGE
}

/** Remove the token from any text that might end up in an error message. */
function scrub(text: string, token: string | undefined): string {
  if (!token) return text
  return text.split(token).join('[REDACTED]')
}

/**
 * Map anything thrown by Octokit (RequestError, AbortError, plain Error) to a GitHubFetchError.
 * Never includes the token.
 */
function toFetchError(err: unknown, ctx: ErrorContext): GitHubFetchError {
  if (err instanceof GitHubFetchError) return err

  const e = (err ?? {}) as {
    name?: string
    status?: number
    message?: string
    response?: { headers?: HeaderBag; data?: unknown }
    cause?: unknown
  }

  if (ctx.signal?.aborted || e.name === 'AbortError') {
    return new GitHubFetchError(`Fetch aborted while ${ctx.what}`, 'aborted')
  }

  const rawMessage = typeof e.message === 'string' ? e.message : String(err)
  const message = scrub(rawMessage, ctx.token)
  const status = typeof e.status === 'number' ? e.status : undefined
  const headers = e.response?.headers

  // Octokit wraps fetch failures in a RequestError with status 500 and no response.
  if (e.name === 'HttpError' && !e.response) {
    return new GitHubFetchError(`Network error while ${ctx.what}: ${message}`, 'network')
  }
  if (status === undefined && (e.name === 'TypeError' || err instanceof TypeError)) {
    return new GitHubFetchError(`Network error while ${ctx.what}: ${message}`, 'network')
  }

  if (status === 404) {
    return new GitHubFetchError(
      `${ctx.owner}/${ctx.repo} was not found while ${ctx.what}. It may be private, renamed or misspelled.`,
      'not_found',
    )
  }

  if (status === 403 || status === 429) {
    const remaining = readHeader(headers, 'x-ratelimit-remaining')
    const retryAfter = readHeader(headers, 'retry-after')
    // The hourly primary quota is exhausted only when remaining is 0; a secondary (abuse)
    // limit arrives with retry-after and plenty of quota left, and a token would not help it.
    const primary = remaining === '0'
    const looksRateLimited = status === 429 || primary || retryAfter !== undefined || /rate limit/i.test(message)
    if (looksRateLimited) {
      const resetAt = parseResetAt(headers)
      const kind = primary ? 'rate limit' : 'secondary rate limit'
      const when = resetAt ? ` Retry after ${resetAt}.` : ''
      const hint =
        primary && !ctx.token ? ' Add a personal access token to raise the limit from 60 to 5000 requests per hour.' : ''
      return new GitHubFetchError(`GitHub API ${kind} exceeded while ${ctx.what}.${when}${hint}`, 'rate_limited', resetAt)
    }
    return new GitHubFetchError(
      `GitHub refused the request (403) while ${ctx.what}: ${message}`,
      'unauthorized',
    )
  }

  if (status === 401) {
    const hint = ctx.token ? 'The token is invalid or expired.' : 'Authentication is required.'
    return new GitHubFetchError(`GitHub rejected the credentials (401) while ${ctx.what}. ${hint}`, 'unauthorized')
  }

  // On the endpoints wrapped here (repos.get, listBranches, compare, listCommits) the only
  // documented 409 is "Git Repository is empty.", a deterministic state no retry can fix.
  if (status === 409) {
    return new GitHubFetchError(
      `${ctx.owner}/${ctx.repo} has no commits yet (GitHub answered 409 while ${ctx.what}).`,
      'empty_repo',
    )
  }

  return new GitHubFetchError(
    `Unexpected error while ${ctx.what}${status !== undefined ? ` (HTTP ${status})` : ''}: ${message}`,
    'unknown',
  )
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight. Stops launching new work after
 * the first failure and rejects with that error once in-flight workers settle.
 */
async function runPool<T>(
  items: ReadonlyArray<T>,
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0
  let failed = false
  let failure: unknown = undefined

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed) {
      const index = next
      next += 1
      if (index >= items.length) return
      try {
        await worker(items[index], index)
      } catch (err) {
        if (!failed) {
          failed = true
          failure = err
        }
        return
      }
    }
  })

  await Promise.all(runners)
  if (failed) throw failure
}
