/**
 * The pull request overlay's GitHub client (src/api/pulls.ts): status mapping, the GraphQL request
 * plan and its failure ladder, the anonymous REST listing and its budget, and lookups. The fixtures
 * are real answers for expressjs/express, SailmanSeeulater/Mordi and vitejs/vite (recorded
 * 2026-10-21, slimmed to the fields the overlay reads); edge cases are built from them inline.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Octokit } from '@octokit/rest'
import {
  BULK_LOOKUP_MAX,
  GRAPHQL_BATCH,
  REST_MIN_REMAINING,
  buildPullQuery,
  checkBucket,
  fetchPullIndex,
  listOpenPulls,
  lookupCost,
  lookupPull,
  mapMergeable,
  mapReviewDecision,
  mapRollupState,
  normaliseGraphql,
  normaliseRest,
  reduceReviews,
  resetLookupMemory,
  rollupChecks,
  slimRestPull,
  type GqlPullData,
  type SlimRestPull,
} from '../src/api/pulls'
import { coreRateFromHeaders, lastPageFromLink, remainingNow } from '../src/api/http'
import type { RateInfo } from '../src/api/http'
import { checksWords } from '../src/components/prMark'
import { GitHubFetchError, type Branch, type RepoData } from '../src/types'
import gqlExpress from './fixtures/github/graphql-pulls-express.json'
import gqlMordi from './fixtures/github/graphql-pulls-mordi.json'
import gqlVite0 from './fixtures/github/graphql-pulls-vite-batch0.json'
import restExpress1 from './fixtures/github/rest-pulls-express-p1.json'
import restExpress2 from './fixtures/github/rest-pulls-express-p2.json'
import checkRuns7531 from './fixtures/github/check-runs-express-7531.json'
import status7531 from './fixtures/github/status-express-7531.json'
import reviews7531 from './fixtures/github/reviews-express-7531.json'

const EXPRESS = { owner: 'expressjs', repo: 'express' }
const VITE = { owner: 'vitejs', repo: 'vite' }
const MORDI = { owner: 'SailmanSeeulater', repo: 'Mordi' }

interface GqlFixture {
  variables: Record<string, string>
  headers: Record<string, string>
  data: GqlPullData
}

/** The branch names a recorded query asked for, in order (b0, b1, ...). */
function namesOf(fixture: GqlFixture): string[] {
  return Object.keys(fixture.variables)
    .filter((k) => /^b\d+$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((k) => fixture.variables[k].replace(/^refs\/heads\//, ''))
}

function branch(name: string, isDefault = false, tipSha = `${name}-tip`): Branch {
  return { name, tipSha, isDefault, mergeBaseSha: null, aheadBy: 0, behindBy: 0, tipDate: '2026-10-01T00:00:00Z' }
}

function repoData(ref: { owner: string; repo: string }, names: string[], defaultBranch: string): RepoData {
  return {
    owner: ref.owner,
    repo: ref.repo,
    defaultBranch,
    branches: names.map((n) => branch(n, n === defaultBranch)),
    commits: {},
    truncated: false,
    truncatedAt: [],
  }
}

// ---------- a fake GitHub ----------

const CORE = { 'x-ratelimit-resource': 'core', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': '1792636800' }
const GQL = { 'x-ratelimit-resource': 'graphql', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': '1792636800' }

interface Call {
  method: string
  url: string
  body: string | null
}

type Answer = { status?: number; body: unknown; headers?: Record<string, string> }

function fakeGitHub(answer: (call: Call, n: number) => Answer | undefined) {
  const calls: Call[] = []
  let inFlight = 0
  let maxInFlight = 0
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: Call = { method: (init?.method ?? 'GET').toUpperCase(), url, body: typeof init?.body === 'string' ? init.body : null }
    calls.push(call)
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      await new Promise((resolve) => setTimeout(resolve, 1))
      if (init?.signal?.aborted) {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }
      const a = answer(call, calls.length) ?? { status: 404, body: { message: 'Not Found' } }
      return new Response(JSON.stringify(a.body), {
        status: a.status ?? 200,
        headers: { 'content-type': 'application/json; charset=utf-8', ...a.headers },
      })
    } finally {
      inFlight--
    }
  }
  return { fetch, calls, maxInFlight: () => maxInFlight }
}

/** Every recorded ref answer by branch name, across the three repos' fixtures. */
const REF_ANSWERS = new Map<string, unknown>()
for (const fixture of [gqlExpress, gqlMordi, gqlVite0] as GqlFixture[]) {
  namesOf(fixture).forEach((name, i) => REF_ANSWERS.set(`${fixture.variables.repo}:${name}`, (fixture.data.repository as Record<string, unknown>)[`b${i}`]))
}
const NO_PRS = { associatedPullRequests: { totalCount: 0, nodes: [] } }

/** A GraphQL answer to whatever was asked, from the recorded refs (unrecorded branches have no pull requests). */
function graphqlAnswer(call: Call, fixture: GqlFixture): Answer {
  const { query, variables } = JSON.parse(call.body ?? '{}') as { query: string; variables: Record<string, string> }
  const repository: Record<string, unknown> = { nameWithOwner: `${variables.owner}/${variables.repo}` }
  if (query.includes('open: pullRequests')) {
    repository.open = (fixture.data.repository as Record<string, unknown>).open
    repository.intoDefault = (fixture.data.repository as Record<string, unknown>).intoDefault
  }
  for (const [key, value] of Object.entries(variables)) {
    if (!/^b\d+$/.test(key)) continue
    const name = value.replace(/^refs\/heads\//, '')
    const recorded = REF_ANSWERS.get(`${variables.repo}:${name}`)
    repository[key] = recorded === undefined ? NO_PRS : recorded
  }
  const data: Record<string, unknown> = { repository }
  if (query.includes('rateLimit')) data.rateLimit = { cost: 4, remaining: 4990, resetAt: '2026-10-22T02:00:00Z' }
  return { body: { data }, headers: GQL }
}

afterEach(() => resetLookupMemory())

// ---------- status mapping ----------

describe('status mapping', () => {
  it('maps the review decision', () => {
    expect(mapReviewDecision('APPROVED')).toBe('approved')
    expect(mapReviewDecision('CHANGES_REQUESTED')).toBe('changes')
    expect(mapReviewDecision('REVIEW_REQUIRED')).toBe('waiting')
    // no review rule on the base branch: nothing decided yet
    expect(mapReviewDecision(null)).toBe('waiting')
  })

  it('maps the checks rollup', () => {
    expect(mapRollupState('SUCCESS')).toBe('passing')
    expect(mapRollupState('PENDING')).toBe('running')
    expect(mapRollupState('EXPECTED')).toBe('running')
    expect(mapRollupState('FAILURE')).toBe('failing')
    expect(mapRollupState('ERROR')).toBe('failing')
    expect(mapRollupState(null)).toBe('none')
  })

  it('maps mergeability to a conflict flag', () => {
    expect(mapMergeable('CONFLICTING')).toBe(true)
    expect(mapMergeable('MERGEABLE')).toBe(false)
    expect(mapMergeable('UNKNOWN')).toBeNull()
    expect(mapMergeable(undefined)).toBeNull()
  })

  it('buckets check runs and statuses, worst first', () => {
    expect(checkBucket('queued')).toBe('running')
    expect(checkBucket('in_progress')).toBe('running')
    expect(checkBucket('completed', 'failure')).toBe('failing')
    expect(checkBucket('completed', 'timed_out')).toBe('failing')
    expect(checkBucket('completed', 'cancelled')).toBe('failing')
    expect(checkBucket('completed', 'action_required')).toBe('failing')
    expect(checkBucket('completed', 'startup_failure')).toBe('failing')
    expect(checkBucket('completed', 'success')).toBe('passing')
    expect(checkBucket('completed', 'neutral')).toBe('passing')
    expect(checkBucket('completed', 'skipped')).toBe('skipped')
    // commit statuses and the GraphQL CountsByState states
    expect(checkBucket('error')).toBe('failing')
    expect(checkBucket('pending')).toBe('running')
    expect(checkBucket('SUCCESS')).toBe('passing')
    expect(checkBucket('EXPECTED')).toBe('running')
  })

  it('rolls express #7531 up as 2 of 30 failing (a skipped run passes)', () => {
    const rolled = rollupChecks(checkRuns7531.check_runs, [])
    expect(rolled.checks).toBe('failing')
    expect(rolled.counts).toEqual({ failing: 2, running: 0, passing: 27, skipped: 1, total: 30 })
    expect(checksWords({ checks: rolled.checks, checkCounts: rolled.counts })).toBe('2 of 30 checks failing')
    expect(rollupChecks([{ status: 'completed', conclusion: 'skipped' }], []).checks).toBe('passing')
    expect(rollupChecks([], [])).toEqual({ checks: 'none', counts: null })
    expect(rollupChecks([{ status: 'in_progress', conclusion: null }], [{ state: 'success' }]).checks).toBe('running')
  })

  it("reduces reviews to each reviewer's latest decision", () => {
    // express #7531: comments only
    expect(reduceReviews(reviews7531)).toBe('waiting')
    const at = (login: string, state: string) => ({ state, user: { login } })
    expect(reduceReviews([at('a', 'APPROVED')])).toBe('approved')
    expect(reduceReviews([at('a', 'APPROVED'), at('b', 'CHANGES_REQUESTED')])).toBe('changes')
    // the same reviewer approving after asking for changes
    expect(reduceReviews([at('a', 'CHANGES_REQUESTED'), at('a', 'APPROVED')])).toBe('approved')
    // a comment does not undo an approval
    expect(reduceReviews([at('a', 'APPROVED'), at('a', 'COMMENTED')])).toBe('approved')
    // a dismissal clears that reviewer's decision
    expect(reduceReviews([at('a', 'CHANGES_REQUESTED'), at('a', 'DISMISSED'), at('b', 'APPROVED')])).toBe('approved')
    expect(reduceReviews([])).toBe('waiting')
  })
})

// ---------- the GraphQL query ----------

describe('buildPullQuery', () => {
  const names = ['main', 'feat/"quoted" } { evil', 'fix/x']

  it('keeps branch names out of the query text: they travel as variables', () => {
    const { query, variables } = buildPullQuery(VITE, names, 'main', { first: false, counts: true })
    expect(query).not.toContain('quoted')
    expect(query).not.toContain('fix/x')
    expect(variables).toMatchObject({ owner: 'vitejs', repo: 'vite', b0: 'refs/heads/main', b1: 'refs/heads/feat/"quoted" } { evil', b2: 'refs/heads/fix/x' })
    for (let i = 0; i < names.length; i++) expect(query).toContain(`b${i}: ref(qualifiedName: $b${i})`)
    expect(query).toContain('isCrossRepository')
    expect(query).toContain('checkRunCountsByState')
  })

  it('asks the first batch for the budget and the open counts, the others not', () => {
    const first = buildPullQuery(VITE, names, 'main', { first: true, counts: true })
    expect(first.query).toContain('rateLimit { cost remaining resetAt }')
    expect(first.query).toContain('open: pullRequests(states: OPEN)')
    expect(first.query).toContain('intoDefault: pullRequests(states: OPEN, baseRefName: $base)')
    expect(first.variables.base).toBe('main')
    const later = buildPullQuery(VITE, names, 'main', { first: false, counts: true })
    expect(later.query).not.toContain('rateLimit')
    expect(later.query).not.toContain('$base')
    expect(later.variables.base).toBeUndefined()
  })

  it('leaves the per-state counts out on request', () => {
    const lean = buildPullQuery(VITE, names, 'main', { first: false, counts: false })
    expect(lean.query).not.toContain('CountsByState')
    expect(lean.query).toContain('statusCheckRollup { state }')
  })
})

// ---------- GraphQL answers ----------

describe('normaliseGraphql', () => {
  it('express: 8 branches with a pull request, master unmarked though fork heads are named master', () => {
    const fixture = gqlExpress as GqlFixture
    const names = namesOf(fixture)
    // the recorded answer does list cross-repository pull requests on refs/heads/master
    const masterNodes = ((fixture.data.repository as Record<string, { associatedPullRequests: { nodes: Array<{ isCrossRepository: boolean }> } }>).b0)
      .associatedPullRequests.nodes
    expect(names[0]).toBe('master')
    expect(masterNodes.length).toBeGreaterThan(0)
    expect(masterNodes.every((n) => n.isCrossRepository)).toBe(true)

    const result = normaliseGraphql(fixture.data, names, EXPRESS)
    expect(result.byBranch.size).toBe(8)
    expect(result.byBranch.has('master')).toBe(false)
    expect(result.total).toBe(133)
    expect(result.intoBase).toBe(127)
    const pr = result.byBranch.get('feat/list-routes-subapps')?.[0]
    expect(pr).toMatchObject({
      number: 7531,
      head: 'feat/list-routes-subapps',
      base: 'master',
      review: 'waiting',
      checks: 'failing',
      draft: false,
      author: 'bjohansebas',
    })
    expect(pr?.checkCounts?.failing).toBe(2)
    expect(pr?.checkCounts?.total).toBe(30)
    expect(pr?.url).toBe('https://github.com/expressjs/express/pull/7531')
  })

  it('Mordi: a branch deleted since the graph (null ref) gets no entry', () => {
    const fixture = gqlMordi as GqlFixture
    const names = namesOf(fixture)
    const repository = fixture.data.repository as Record<string, unknown>
    const gone = names.findIndex((_, i) => repository[`b${i}`] === null)
    expect(gone).toBeGreaterThanOrEqual(0)
    const result = normaliseGraphql(fixture.data, names, MORDI)
    expect(result.byBranch.size).toBe(2)
    expect(result.byBranch.has(names[gone])).toBe(false)
    for (const prs of result.byBranch.values()) {
      expect(prs[0].author).toBe('dependabot')
      expect(prs[0].headSha).toMatch(/^[0-9a-f]{40}$/)
    }
  })

  it('vite batch 0: stacked pull requests keep their base, drafts their flag; main stays unmarked', () => {
    const fixture = gqlVite0 as GqlFixture
    const names = namesOf(fixture)
    expect(names).toHaveLength(GRAPHQL_BATCH)
    const result = normaliseGraphql(fixture.data, names, VITE)
    expect(result.byBranch.has('main')).toBe(false)
    const all = [...result.byBranch.values()].flat()
    expect(all.some((pr) => pr.base !== 'main')).toBe(true)
    expect(all.some((pr) => pr.draft)).toBe(true)
    for (const pr of all) expect(names).toContain(pr.head)
  })

  it('drops a fork head named like a branch here, and a head repository of another name', () => {
    const fixture = gqlExpress as GqlFixture
    const names = namesOf(fixture)
    const repo = structuredClone(fixture.data.repository) as Record<string, { associatedPullRequests: { nodes: Array<Record<string, unknown>> } } | null>
    const i = names.indexOf('feat/list-routes-subapps')
    const node = repo[`b${i}`]?.associatedPullRequests.nodes[0] as Record<string, unknown>
    node.isCrossRepository = false
    node.headRepository = { nameWithOwner: 'someone/express' }
    const result = normaliseGraphql({ repository: repo as GqlPullData['repository'] }, names, EXPRESS)
    expect(result.byBranch.has('feat/list-routes-subapps')).toBe(false)
    // case does not matter
    node.headRepository = { nameWithOwner: 'ExpressJS/Express' }
    expect(normaliseGraphql({ repository: repo as GqlPullData['repository'] }, names, EXPRESS).byBranch.has('feat/list-routes-subapps')).toBe(true)
  })
})

// ---------- REST ----------

const expressPulls = [...restExpress1.body, ...restExpress2.body].map((raw) => slimRestPull(raw))
const expressNames = namesOf(gqlExpress as GqlFixture)

describe('normaliseRest', () => {
  it('express: 8 same-repo pull requests on loaded branches, 125 from forks', () => {
    const result = normaliseRest(expressPulls, EXPRESS, expressNames.map((n) => ({ name: n })), 'master')
    expect(result.byBranch.size).toBe(8)
    expect(result.byBranch.has('master')).toBe(false)
    expect(result.fromForks).toBe(125)
    expect(result.notOnGraph).toBe(0)
    expect(result.intoBase).toBe(expressPulls.filter((p) => p.base.ref === 'master').length)
    for (const prs of result.byBranch.values()) for (const pr of prs) expect([pr.review, pr.checks]).toEqual(['unknown', 'unknown'])
  })

  it('counts a deleted fork (head.repo null) as a fork, matches the repo name in any case, and counts unloaded heads', () => {
    const own = expressPulls.find((p) => p.number === 7531) as SlimRestPull
    const deletedFork: SlimRestPull = { ...own, number: 900001, head: { ...own.head, repo: null } }
    const shouting: SlimRestPull = {
      ...own,
      number: 900002,
      head: { ...own.head, ref: 'req.is', repo: { id: null, full_name: 'ExpressJS/EXPRESS' } },
      base: { ...own.base, repo: null },
    }
    const unloaded: SlimRestPull = { ...own, number: 900003, head: { ...own.head, ref: 'not-a-loaded-branch' } }
    const result = normaliseRest([deletedFork, shouting, unloaded], EXPRESS, expressNames.map((n) => ({ name: n })), 'master')
    expect(result.fromForks).toBe(1)
    expect(result.notOnGraph).toBe(1)
    expect(result.byBranch.get('req.is')?.map((p) => p.number)).toEqual([900002])
  })

  it('slims a raw pull request to the fields kept', () => {
    const raw = restExpress1.body[0]
    const slim = slimRestPull({ ...raw, body: 'x'.repeat(10_000), labels: [{ name: 'a' }] } as never)
    expect(Object.keys(slim).sort()).toEqual(['base', 'draft', 'head', 'html_url', 'number', 'requested', 'title', 'updated_at', 'user'])
  })
})

describe('listOpenPulls and the anonymous budget', () => {
  const pages: Record<string, typeof restExpress1> = { '1': restExpress1, '2': restExpress2 }
  const restAnswer = (remaining: number) => (call: Call): Answer | undefined => {
    const url = new URL(call.url)
    if (url.pathname !== '/repos/expressjs/express/pulls') return undefined
    const page = pages[url.searchParams.get('page') ?? '1']
    return { body: page.body, headers: { ...CORE, 'x-ratelimit-remaining': String(remaining), ...(page.headers.link ? { link: page.headers.link } : {}) } }
  }

  it('reads express in 2 requests, most recently updated first, and reports the core budget of each', async () => {
    const gh = fakeGitHub(restAnswer(40))
    const rates: RateInfo[] = []
    const index = await fetchPullIndex(EXPRESS, repoData(EXPRESS, expressNames, 'master'), { fetch: gh.fetch, onRate: (r) => rates.push(r), remaining: 42 })
    expect(gh.calls.map((c) => c.method)).toEqual(['GET', 'GET'])
    for (const call of gh.calls) {
      const url = new URL(call.url)
      expect(url.searchParams.get('state')).toBe('open')
      expect(url.searchParams.get('per_page')).toBe('100')
      expect(url.searchParams.get('sort')).toBe('updated')
      expect(url.searchParams.get('direction')).toBe('desc')
    }
    expect(rates).toHaveLength(2)
    expect(rates[0]).toMatchObject({ remaining: 40, limit: 60 })
    expect(index).toMatchObject({ source: 'rest', truncated: false, total: 133, fromForks: 125, notOnGraph: 0, listed: 133, intoBase: 127 })
    expect(index.byBranch.size).toBe(8)
  })

  it('skips the listing below REST_MIN_REMAINING requests left, saying when the budget refills', async () => {
    const gh = fakeGitHub(restAnswer(3))
    const err = await fetchPullIndex(EXPRESS, repoData(EXPRESS, expressNames, 'master'), {
      fetch: gh.fetch,
      remaining: REST_MIN_REMAINING - 1,
      resetAt: '2026-10-22T02:00:00.000Z',
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitHubFetchError)
    expect((err as GitHubFetchError).code).toBe('rate_limited')
    expect((err as GitHubFetchError).resetAt).toBe('2026-10-22T02:00:00.000Z')
    expect(gh.calls).toHaveLength(0)
  })

  it('stops paging when the budget runs low, and marks the listing truncated', async () => {
    const gh = fakeGitHub(restAnswer(REST_MIN_REMAINING - 1))
    // reached through fetchPullIndex in the app; a bare client here
    const listing = await listOpenPulls(new Octokit({ request: { fetch: gh.fetch } }), EXPRESS, { remaining: REST_MIN_REMAINING - 1 }, {})
    expect(gh.calls).toHaveLength(1)
    expect(listing.truncated).toBe(true)
    // estimated from rel="last" (page 2)
    expect(listing.total).toBe(200)
  })

  it('stops after 3 pages, estimating the total from rel="last"', async () => {
    const link = (page: number) =>
      `<https://api.github.com/repositories/1/pulls?state=open&per_page=100&page=${page + 1}>; rel="next", <https://api.github.com/repositories/1/pulls?state=open&per_page=100&page=7>; rel="last"`
    const full = Array.from({ length: 100 }, (_, i) => ({ ...restExpress1.body[i % restExpress1.body.length], number: i + 1 }))
    const gh = fakeGitHub((call) => {
      const page = Number(new URL(call.url).searchParams.get('page'))
      return { body: full, headers: { ...CORE, 'x-ratelimit-remaining': '50', link: link(page) } }
    })
    const index = await fetchPullIndex(EXPRESS, repoData(EXPRESS, expressNames, 'master'), { fetch: gh.fetch })
    expect(gh.calls).toHaveLength(3)
    expect(index.truncated).toBe(true)
    expect(index.listed).toBe(300)
    expect(index.total).toBe(700)
    expect(index.intoBase).toBeNull()
  })
})

// ---------- GraphQL, with a token ----------

/** vite's recorded branch list stands in for 97 branches: batch 0 recorded, the rest unrecorded names. */
function viteData(): RepoData {
  const names = namesOf(gqlVite0 as GqlFixture)
  const more = Array.from({ length: 97 - names.length }, (_, i) => `extra/branch-${i}`)
  return repoData(VITE, [...names, ...more], 'main')
}

describe('fetchPullIndex with a token (GraphQL)', () => {
  it('asks 97 branches in 3 serial POSTs and no core requests; the budget line never hears of GraphQL', async () => {
    const gh = fakeGitHub((call) => (call.method === 'POST' ? graphqlAnswer(call, gqlVite0 as GqlFixture) : undefined))
    const rates: RateInfo[] = []
    const index = await fetchPullIndex(VITE, viteData(), { token: 'ghp_test', fetch: gh.fetch, onRate: (r) => rates.push(r) })
    expect(gh.calls.map((c) => `${c.method} ${c.url}`)).toEqual(Array(3).fill('POST https://api.github.com/graphql'))
    expect(gh.maxInFlight()).toBe(1)
    expect(rates).toEqual([])
    expect(index.source).toBe('graphql')
    expect(index.total).toBe(297)
    expect(index.intoBase).toBe(294)
    expect(index.byBranch.has('main')).toBe(false)
    const batches = gh.calls.map((c) => Object.keys((JSON.parse(c.body ?? '{}') as { variables: Record<string, string> }).variables).filter((k) => /^b\d+$/.test(k)).length)
    expect(batches).toEqual([40, 40, 17])
    // never the token in a body
    for (const call of gh.calls) expect(call.body).not.toContain('ghp_test')
  })

  it('sends the same bodies every time (the replay cache keys POSTs by them)', async () => {
    const bodies = async () => {
      const gh = fakeGitHub((call) => graphqlAnswer(call, gqlVite0 as GqlFixture))
      await fetchPullIndex(VITE, viteData(), { token: 'ghp_test', fetch: gh.fetch })
      return gh.calls.map((c) => c.body)
    }
    expect(await bodies()).toEqual(await bodies())
  })

  it('uses partial data that came with errors: refs with errors get no mark', async () => {
    const fixture = gqlExpress as GqlFixture
    const gh = fakeGitHub((call) => {
      const answer = graphqlAnswer(call, fixture)
      const body = answer.body as { data: { repository: Record<string, unknown> } }
      body.data.repository.b3 = null
      return { ...answer, body: { ...body, errors: [{ type: 'NOT_FOUND', path: ['repository', 'b3'], message: 'Could not resolve' }] } }
    })
    const names = namesOf(fixture)
    const index = await fetchPullIndex(EXPRESS, repoData(EXPRESS, names, 'master'), { token: 't', fetch: gh.fetch })
    expect(gh.calls).toHaveLength(1)
    expect(index.byBranch.has(names[3])).toBe(false)
    const whole = normaliseGraphql(fixture.data, names, EXPRESS).byBranch
    expect(index.byBranch.size).toBe(whole.size - (whole.has(names[3]) ? 1 : 0))
  })

  it('splits a batch GitHub answered 502 to in two, then drops the per-state counts, then gives up', async () => {
    const fixture = gqlExpress as GqlFixture
    const names = namesOf(fixture)
    // the whole batch fails, its halves succeed
    let gh = fakeGitHub((call, n) => (n === 1 ? { status: 502, body: { message: 'Bad Gateway' } } : graphqlAnswer(call, fixture)))
    let index = await fetchPullIndex(EXPRESS, repoData(EXPRESS, names, 'master'), { token: 't', fetch: gh.fetch })
    expect(gh.calls).toHaveLength(3)
    expect(index.byBranch.size).toBe(8)
    const halves = gh.calls.slice(1).map((c) => Object.keys((JSON.parse(c.body ?? '{}') as { variables: object }).variables).filter((k) => /^b\d+$/.test(k)).length)
    expect(halves).toEqual([Math.ceil(names.length / 2), Math.floor(names.length / 2)])
    // halves fail too: the lean query (rollup state only) answers
    gh = fakeGitHub((call, n) => (n <= 2 ? { status: 504, body: { message: 'timeout' } } : graphqlAnswer(call, fixture)))
    index = await fetchPullIndex(EXPRESS, repoData(EXPRESS, names, 'master'), { token: 't', fetch: gh.fetch })
    expect(gh.calls).toHaveLength(3)
    expect(JSON.parse(gh.calls[2].body ?? '{}').query).not.toContain('CountsByState')
    expect(index.byBranch.size).toBe(8)
    // nothing answers
    gh = fakeGitHub(() => ({ status: 502, body: { message: 'Bad Gateway' } }))
    const err = await fetchPullIndex(EXPRESS, repoData(EXPRESS, names, 'master'), { token: 't', fetch: gh.fetch }).catch((e: unknown) => e)
    expect((err as GitHubFetchError).code).toBe('network')
  })

  it('retries without the per-state counts when the API does not know them', async () => {
    const fixture = gqlExpress as GqlFixture
    const gh = fakeGitHub((call) =>
      JSON.parse(call.body ?? '{}').query.includes('checkRunCountsByState')
        ? { body: { errors: [{ message: "Field 'checkRunCountsByState' doesn't exist on type 'StatusCheckRollupContextConnection'" }] }, headers: GQL }
        : graphqlAnswer(call, fixture),
    )
    const index = await fetchPullIndex(EXPRESS, repoData(EXPRESS, namesOf(fixture), 'master'), { token: 't', fetch: gh.fetch })
    expect(gh.calls).toHaveLength(2)
    expect(index.byBranch.size).toBe(8)
  })

  it('reports a GraphQL rate limit with its reset time', async () => {
    const gh = fakeGitHub(() => ({
      body: { data: { rateLimit: { cost: 1, remaining: 0, resetAt: '2026-10-22T03:00:00Z' } }, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] },
      headers: GQL,
    }))
    const err = await fetchPullIndex(EXPRESS, repoData(EXPRESS, ['master'], 'master'), { token: 't', fetch: gh.fetch }).catch((e: unknown) => e)
    expect((err as GitHubFetchError).code).toBe('rate_limited')
    expect((err as GitHubFetchError).resetAt).toBe('2026-10-22T03:00:00Z')
  })

  it('falls back to REST when GitHub refuses GraphQL (403), looking every mapped pull request up at once', async () => {
    const statuses = { ...status7531 }
    const gh = fakeGitHub((call) => {
      if (call.method === 'POST') return { status: 403, body: { message: 'Resource not accessible by personal access token' }, headers: { ...CORE, 'x-ratelimit-remaining': '4000' } }
      const url = new URL(call.url)
      const headers = { ...CORE, 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4000' }
      if (url.pathname === '/repos/expressjs/express/pulls') {
        const page = url.searchParams.get('page') === '2' ? restExpress2 : restExpress1
        return { body: page.body, headers: { ...headers, ...(page.headers.link ? { link: page.headers.link } : {}) } }
      }
      if (url.pathname.endsWith('/check-runs')) return { body: checkRuns7531, headers }
      if (url.pathname.endsWith('/status')) return { body: statuses, headers }
      if (url.pathname.endsWith('/reviews')) return { body: reviews7531, headers }
      return undefined
    })
    const index = await fetchPullIndex(EXPRESS, repoData(EXPRESS, expressNames, 'master'), { token: 't', fetch: gh.fetch })
    expect(index.source).toBe('rest')
    expect(index.byBranch.size).toBe(8)
    const lookups = gh.calls.filter((c) => /check-runs|status|reviews/.test(c.url))
    // 8 pull requests: check runs and reviews each, statuses only until one showed none
    expect(lookups.filter((c) => c.url.includes('/check-runs'))).toHaveLength(8)
    expect(lookups.filter((c) => c.url.includes('/reviews'))).toHaveLength(8)
    expect(lookups.filter((c) => c.url.includes('/status')).length).toBeLessThan(8)
    for (const prs of index.byBranch.values()) for (const pr of prs) expect([pr.review, pr.checks]).toEqual(['waiting', 'failing'])
    expect(BULK_LOOKUP_MAX).toBeGreaterThanOrEqual(8)
  })
})

// ---------- lookups ----------

describe('lookupPull', () => {
  const lookupAnswers = () =>
    fakeGitHub((call) => {
      const url = new URL(call.url)
      const headers = { ...CORE, 'x-ratelimit-remaining': '30' }
      if (url.pathname.endsWith('/check-runs')) return { body: checkRuns7531, headers }
      if (url.pathname.endsWith('/status')) return { body: status7531, headers }
      if (url.pathname.endsWith('/reviews')) return { body: reviews7531, headers }
      return undefined
    })

  it('costs 3 requests, then 2 once the repo turned out to have no commit statuses', async () => {
    expect(lookupCost(EXPRESS)).toBe(3)
    let gh = lookupAnswers()
    const rates: RateInfo[] = []
    const found = await lookupPull(EXPRESS, { number: 7531, headSha: checkRuns7531.headSha }, { fetch: gh.fetch, onRate: (r) => rates.push(r) })
    expect(gh.calls).toHaveLength(3)
    expect(rates).toHaveLength(3)
    expect(found).toMatchObject({ review: 'waiting', checks: 'failing', requests: 3 })
    expect(found.checkCounts).toMatchObject({ failing: 2, total: 30 })
    // a repo without statuses: GitHub's combined state reads 'pending', which must not count
    expect(status7531).toMatchObject({ state: 'pending', total_count: 0 })
    expect(lookupCost(EXPRESS)).toBe(2)
    gh = lookupAnswers()
    const again = await lookupPull(EXPRESS, { number: 7317, headSha: checkRuns7531.headSha }, { fetch: gh.fetch })
    expect(gh.calls).toHaveLength(2)
    expect(gh.calls.some((c) => c.url.includes('/status'))).toBe(false)
    expect(again.requests).toBe(2)
    // another repo still pays for its statuses
    expect(lookupCost(VITE)).toBe(3)
  })

  it('turns a failed lookup into a GitHubFetchError without the token', async () => {
    const gh = fakeGitHub(() => ({ status: 403, body: { message: 'API rate limit exceeded for ghp_secret' }, headers: { ...CORE, 'x-ratelimit-remaining': '0' } }))
    const err = await lookupPull(EXPRESS, { number: 1, headSha: 'a'.repeat(40) }, { fetch: gh.fetch, token: 'ghp_secret' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitHubFetchError)
    expect((err as GitHubFetchError).code).toBe('rate_limited')
    expect((err as GitHubFetchError).message).not.toContain('ghp_secret')
  })
})

// ---------- headers ----------

describe('rate headers', () => {
  it('reads the core budget, ignores GraphQL points', () => {
    expect(coreRateFromHeaders({ 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '41', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': '1792636800' })).toEqual({
      remaining: 41,
      limit: 60,
      resetAt: new Date(1792636800 * 1000).toISOString(),
    })
    // older answers carry no resource header: core
    expect(coreRateFromHeaders({ 'x-ratelimit-remaining': '7' })).toEqual({ remaining: 7, limit: null, resetAt: null })
    expect(coreRateFromHeaders(GQL)).toBeNull()
    expect(coreRateFromHeaders({ 'x-ratelimit-resource': 'search', 'x-ratelimit-remaining': '9' })).toBeNull()
    expect(coreRateFromHeaders({})).toBeNull()
  })

  it('forgets a count once its hour has reset', () => {
    const now = Date.parse('2026-10-22T02:00:00Z')
    expect(remainingNow({ remaining: 3, limit: 60, resetAt: '2026-10-22T02:30:00Z' }, now)).toBe(3)
    expect(remainingNow({ remaining: 3, limit: 60, resetAt: '2026-10-22T01:59:00Z' }, now)).toBeNull()
    expect(remainingNow({ remaining: 3, limit: 60, resetAt: null }, now)).toBe(3)
    expect(remainingNow(null, now)).toBeNull()
  })

  it('reads the last page from a Link header', () => {
    expect(lastPageFromLink({ link: restExpress1.headers.link })).toBe(2)
    expect(lastPageFromLink({})).toBeNull()
  })
})
