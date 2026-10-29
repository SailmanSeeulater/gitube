import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fetchRepoData } from '../src/api/github'
import StatusStrip from '../src/components/StatusStrip'
import { normaliseGraphql, type GqlPullData } from '../src/api/pulls'
import { buildContributors, buildGraph } from '../src/graph'
import { HEALTH_STALE_DAYS, healthItems, healthLine, repoHealth, type RepoHealth } from '../src/graph/health'
import { findWeeds } from '../src/graph/weeds'
import type { Branch, Commit, PullIndex, PullSummary, RepoData } from '../src/types'
import { makeRepo } from './fixtures/repos'
import repoFixture from './fixtures/github/repo.json'
import branchesFixture from './fixtures/github/branches.json'
import compareFeatureX from './fixtures/github/compare-feature-x.json'
import compareOld from './fixtures/github/compare-old.json'
import commitsPage1 from './fixtures/github/commits-page1.json'
import commitsPage2 from './fixtures/github/commits-page2.json'
import gqlExpress from './fixtures/github/graphql-pulls-express.json'

const NOW = Date.parse('2026-10-28T00:00:00Z')
const DAY_MS = 86_400_000

function commit(sha: string, date: string, author = 'Ann', login: string | undefined = 'ann'): Commit {
  return { sha, parents: [], message: sha, author, login, date, url: `https://github.com/o/r/commit/${sha}` }
}

function branch(name: string, over: Partial<Branch> = {}): Branch {
  return { name, tipSha: `${name}-tip`, isDefault: false, mergeBaseSha: 'm0', aheadBy: 1, behindBy: 0, tipDate: '2026-10-27T00:00:00Z', ...over }
}

function repo(branches: Branch[], commits: Commit[]): RepoData {
  return { owner: 'o', repo: 'r', defaultBranch: 'main', branches, commits: Object.fromEntries(commits.map((c) => [c.sha, c])), truncated: false, truncatedAt: [] }
}

/** The whole thing from a RepoData alone (no pull requests), at NOW. */
function healthOf(data: RepoData, pulls: PullIndex | null = null): RepoHealth {
  return repoHealth(data, buildContributors(data), findWeeds(data), pulls, NOW)
}

function pr(head: string, number: number, over: Partial<PullSummary> = {}): PullSummary {
  return {
    number,
    title: `pull request ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    head,
    headSha: `${head}-tip`,
    base: 'main',
    draft: false,
    author: 'someone',
    review: 'unknown',
    reviewRequired: null,
    checks: 'unknown',
    checkCounts: null,
    reviewersAsked: null,
    conflict: null,
    updatedAt: '2026-10-20T00:00:00Z',
    ...over,
  }
}

function index(prs: PullSummary[]): PullIndex {
  const byBranch = new Map<string, PullSummary[]>()
  for (const p of prs) byBranch.set(p.head, [...(byBranch.get(p.head) ?? []), p])
  return { byBranch, intoBase: null, total: prs.length, fromForks: 0, notOnGraph: 0, truncated: false, unchecked: [], listed: prs.length, source: 'rest', fetchedAt: '2026-10-21T00:00:00Z' }
}

/** main c1..c5 (Ann 4, Cat 1) with feature f1, f2 by Bob and a dependabot commit on bots. */
function threePeople(): RepoData {
  const data = makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['c3', 'c2'], ['c4', 'c3'], ['c5', 'c4'], ['f1', 'c3'], ['f2', 'f1'], ['b1', 'c5']],
    branches: [
      { name: 'main', tip: 'c5', isDefault: true },
      { name: 'feature', tip: 'f2' },
      { name: 'bots', tip: 'b1' },
    ],
  })
  const authors: Record<string, [string, string]> = {
    c1: ['Ann', 'ann'],
    c2: ['Ann', 'ann'],
    c3: ['Ann', 'ann'],
    c4: ['Cat', 'cat'],
    c5: ['Ann', 'ann'],
    f1: ['Bob', 'bob'],
    f2: ['Bob', 'bob'],
    b1: ['dependabot[bot]', 'dependabot[bot]'],
  }
  for (const [sha, [author, login]] of Object.entries(authors)) Object.assign(data.commits[sha], { author, login })
  return data
}

describe('bus factor', () => {
  it('shares the people’s commits out, top one and top two, bots left out', () => {
    const h = healthOf(threePeople())
    expect(h.busFactor).toEqual({ people: 3, topShare: 4 / 7, topTwoShare: 6 / 7 })
  })

  it('is null with one person, and with no commits', () => {
    const one = makeRepo({ commits: [['c1'], ['c2', 'c1']], branches: [{ name: 'main', tip: 'c2', isDefault: true }] })
    expect(healthOf(one).busFactor).toBeNull()
    expect(healthOf(repo([branch('main', { isDefault: true, mergeBaseSha: null, aheadBy: 0 })], [])).busFactor).toBeNull()
  })

  it('is null when the only other contributor is a bot', () => {
    const data = makeRepo({ commits: [['c1'], ['c2', 'c1']], branches: [{ name: 'main', tip: 'c2', isDefault: true }] })
    Object.assign(data.commits.c2, { author: 'dependabot[bot]', login: 'dependabot[bot]' })
    expect(healthOf(data).busFactor).toBeNull()
  })
})

/**
 * feature and feature2 forked at m0 (2026-10-01) and lived 10 and 4 days. stale forked at old
 * (2026-01-01), lived 31 days and has sat since February; thorny forked there too and is 300 ahead
 * and 100 behind. merged and same are weeds; unknownFork's merge base was never fetched.
 */
function lives(): RepoData {
  const main = branch('main', { isDefault: true, mergeBaseSha: null, aheadBy: 0 })
  return repo(
    [
      main,
      branch('feature', { aheadBy: 2, tipDate: '2026-10-11T00:00:00Z' }),
      branch('feature2', { tipDate: '2026-10-05T00:00:00Z' }),
      branch('merged', { aheadBy: 0, behindBy: 5, tipDate: '2026-01-03T00:00:00Z' }),
      branch('same', { aheadBy: 0, behindBy: 0 }),
      branch('stale', { mergeBaseSha: 'old', tipDate: '2026-02-01T00:00:00Z' }),
      branch('thorny', { mergeBaseSha: 'old', aheadBy: 300, behindBy: 100, tipDate: '2026-10-20T00:00:00Z' }),
      branch('unknownFork', { mergeBaseSha: 'zzzz' }),
    ],
    [commit('old', '2026-01-01T00:00:00Z'), commit('m0', '2026-10-01T00:00:00Z'), commit('m1', '2026-10-27T00:00:00Z', 'Bob', 'bob')],
  )
}

describe('branch lifetime', () => {
  it('takes the median fork-to-tip over branches with work on them, and counts merged and stale ones', () => {
    const h = healthOf(lives())
    // feature 10, feature2 4, stale 31, thorny 292: the median is between 10 and 31
    expect(h.branches).toEqual({ count: 7, medianDays: 20.5, merged: 1, stale: 2 })
  })

  it('leaves out a fork point that was not fetched, and a weed (its fork point is its own tip)', () => {
    const data = repo(
      [branch('main', { isDefault: true, mergeBaseSha: null, aheadBy: 0 }), branch('merged', { aheadBy: 0, behindBy: 5 }), branch('unknownFork', { mergeBaseSha: 'zzzz' })],
      [commit('m0', '2026-01-01T00:00:00Z')],
    )
    expect(healthOf(data).branches).toEqual({ count: 2, medianDays: null, merged: 1, stale: 0 })
  })

  it('is null without a non-default branch', () => {
    const data = makeRepo({ commits: [['c1'], ['c2', 'c1']], branches: [{ name: 'main', tip: 'c2', isDefault: true }] })
    expect(healthOf(data).branches).toBeNull()
  })

  it('reads stale from the stale filter’s cut-off, so now matters', () => {
    const data = repo(
      [branch('main', { isDefault: true, mergeBaseSha: null, aheadBy: 0 }), branch('work', { tipDate: '2026-02-01T00:00:00Z' })],
      [commit('m0', '2026-01-01T00:00:00Z')],
    )
    const at = (now: number) => repoHealth(data, buildContributors(data), findWeeds(data), null, now).branches?.stale
    expect(at(Date.parse('2026-02-01T00:00:00Z') + HEALTH_STALE_DAYS * DAY_MS)).toBe(0)
    expect(at(Date.parse('2026-02-01T00:00:00Z') + (HEALTH_STALE_DAYS + 1) * DAY_MS)).toBe(1)
  })
})

describe('pull request hygiene', () => {
  it('is null without an answer', () => {
    expect(healthOf(threePeople(), null).pulls).toBeNull()
  })

  it('counts the open pull requests, the green and the reviewed', () => {
    const prs = [
      pr('a', 1, { checks: 'passing', review: 'approved' }),
      pr('b', 2, { checks: 'passing', review: 'approved' }),
      pr('c', 3, { checks: 'passing', review: 'changes' }),
      pr('d', 4, { checks: 'failing', review: 'waiting' }),
      pr('e', 5),
    ]
    expect(healthOf(threePeople(), index(prs)).pulls).toEqual({ open: 5, green: 3, reviewed: 2 })
  })

  it('counts a pull request heading two branches once', () => {
    const twice = pr('a', 1, { checks: 'passing' })
    expect(healthOf(threePeople(), index([twice, { ...twice, head: 'b' }])).pulls).toEqual({ open: 1, green: 1, reviewed: null })
  })

  it('leaves green and reviewed null while nothing was looked up, and says so with none open', () => {
    expect(healthOf(threePeople(), index([pr('a', 1), pr('b', 2)])).pulls).toEqual({ open: 2, green: null, reviewed: null })
    expect(healthOf(threePeople(), index([])).pulls).toEqual({ open: 0, green: null, reviewed: null })
  })
})

describe('determinism', () => {
  it('gives the same answer for the same inputs', () => {
    const data = lives()
    const prs = index([pr('feature', 1, { checks: 'passing', review: 'approved' }), pr('stale', 2)])
    const a = healthOf(data, prs)
    const b = healthOf(data, prs)
    expect(a).toEqual(b)
    expect(healthLine(a)).toEqual(healthLine(b))
  })
})

describe('healthLine', () => {
  it('words every signal short, in lower case, with a title each', () => {
    const h: RepoHealth = {
      busFactor: { people: 12, topShare: 0.45, topTwoShare: 0.8 },
      branches: { count: 9, medianDays: 12.4, merged: 5, stale: 3 },
      pulls: { open: 5, green: 3, reviewed: 2 },
    }
    expect(healthLine(h)).toEqual([
      '2 of 12 people hold 80% of commits',
      'branches live 12 days (median)',
      '5 merged, 3 stale branches',
      '3 of 5 open prs green, 2 reviewed',
    ])
    for (const item of healthItems(h)) {
      expect(item.text.length).toBeLessThanOrEqual(40)
      expect(item.text).toBe(item.text.toLowerCase())
      expect(item.title.length).toBeGreaterThan(20)
    }
  })

  it('names one person when they hold a majority', () => {
    expect(healthLine({ busFactor: { people: 3, topShare: 4 / 7, topTwoShare: 6 / 7 }, branches: null, pulls: null })).toEqual(['1 of 3 people holds 57% of commits'])
  })

  it('leaves out what has no data, and counts of zero', () => {
    expect(healthLine({ busFactor: null, branches: null, pulls: null })).toEqual([])
    expect(healthLine({ busFactor: null, branches: { count: 2, medianDays: null, merged: 0, stale: 0 }, pulls: null })).toEqual([])
    expect(healthLine({ busFactor: null, branches: { count: 2, medianDays: 1, merged: 1, stale: 0 }, pulls: null })).toEqual(['branches live 1 day (median)', '1 merged branch'])
    expect(healthLine({ busFactor: null, branches: { count: 1, medianDays: 0.3, merged: 0, stale: 0 }, pulls: null })).toEqual(['branches live under a day (median)'])
    expect(healthLine({ busFactor: null, branches: { count: 2, medianDays: null, merged: 0, stale: 2 }, pulls: null })).toEqual(['2 stale branches'])
  })

  it('says what it knows about pull requests, and when there are none', () => {
    expect(healthLine({ busFactor: null, branches: null, pulls: { open: 5, green: null, reviewed: null } })).toEqual(['5 open prs'])
    expect(healthLine({ busFactor: null, branches: null, pulls: { open: 1, green: null, reviewed: 1 } })).toEqual(['1 open pr, 1 reviewed'])
    expect(healthLine({ busFactor: null, branches: null, pulls: { open: 2, green: 0, reviewed: null } })).toEqual(['0 of 2 open prs green'])
    expect(healthLine({ busFactor: null, branches: null, pulls: { open: 1, green: 1, reviewed: null } })).toEqual(['1 of 1 open pr green'])
    expect(healthLine({ busFactor: null, branches: null, pulls: { open: 0, green: null, reviewed: null } })).toEqual(['no open prs on these branches'])
  })
})

// ---------- the recorded fixtures ----------

const NEXT_LINK = '<https://api.github.com/repos/owner/repo/commits?sha=main&per_page=100&page=2>; rel="next"'

/** fetch answered from tests/fixtures/github, as github.test.ts routes it. */
const fixtureFetch: typeof globalThis.fetch = async (input) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = new URL(href)
  const path = url.pathname
  let body: unknown = { message: 'Not Found' }
  let status = 404
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', 'x-ratelimit-remaining': '4321', 'x-ratelimit-reset': '1760000000' }
  const compare = /^\/repos\/owner\/repo\/compare\/(.+)$/.exec(path)
  if (path === '/repos/owner/repo') [body, status] = [repoFixture, 200]
  else if (path === '/repos/owner/repo/branches') [body, status] = [branchesFixture, 200]
  else if (compare && decodeURIComponent(compare[1]) === 'main...feature/x') [body, status] = [compareFeatureX, 200]
  else if (compare && decodeURIComponent(compare[1]) === 'main...old') [body, status] = [compareOld, 200]
  else if (path === '/repos/owner/repo/commits' && url.searchParams.get('sha') === 'main') {
    if ((url.searchParams.get('page') ?? '1') === '1') {
      ;[body, status] = [commitsPage1, 200]
      headers.link = NEXT_LINK
    } else [body, status] = [commitsPage2, 200]
  }
  return new Response(JSON.stringify(body), { status, headers })
}

/** The express GraphQL recording as the overlay would hold it. */
function expressPulls(): PullIndex {
  const fixture = gqlExpress as { variables: Record<string, string>; data: GqlPullData }
  const names = Object.keys(fixture.variables)
    .filter((k) => /^b\d+$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((k) => fixture.variables[k].replace(/^refs\/heads\//, ''))
  const read = normaliseGraphql(fixture.data, names, { owner: 'expressjs', repo: 'express' })
  return { byBranch: read.byBranch, intoBase: read.intoBase, total: read.total, fromForks: 0, notOnGraph: 0, truncated: false, unchecked: read.unchecked, listed: 0, source: 'graphql', fetchedAt: '2026-10-21T00:00:00Z' }
}

describe('on the recorded fixtures', () => {
  it('reads owner/repo: Alice holds 4 of 7 commits, feature/x lived 4 days, old is merged', async () => {
    const data = await fetchRepoData({ owner: 'owner', repo: 'repo' }, { fetch: fixtureFetch })
    const h = healthOf(data, expressPulls())
    expect(h.busFactor).toEqual({ people: 3, topShare: 4 / 7, topTwoShare: 6 / 7 })
    // feature/x forked at a3 (2026-10-03T10:05) and its tip is 2026-10-07T09:00
    expect(h.branches?.count).toBe(2)
    expect(h.branches?.medianDays).toBeCloseTo(3.95, 2)
    expect(h.branches?.merged).toBe(1)
    expect(h.branches?.stale).toBe(0)
    // express: 8 same-repo pull requests, 2 with SUCCESS rollups, all REVIEW_REQUIRED (none approved)
    expect(h.pulls).toEqual({ open: 8, green: 2, reviewed: 0 })
    expect(healthLine(h)).toEqual([
      '1 of 3 people holds 57% of commits',
      'branches live 4 days (median)',
      '1 merged branch',
      '2 of 8 open prs green, 0 reviewed',
    ])
  })
})

describe('the status strip', () => {
  it('shows the health line under the counts, each item with its title, and nothing without the prop', () => {
    const data = threePeople()
    const graph = buildGraph(data, 'skeleton')
    const items = healthItems(healthOf(data, index([pr('feature', 1, { checks: 'passing', review: 'approved' })])))
    const without = renderToStaticMarkup(h(StatusStrip, { data, graph, isFetching: false }))
    const withHealth = renderToStaticMarkup(h(StatusStrip, { data, graph, isFetching: false, health: items }))
    expect(withHealth).not.toBe(without)
    for (const item of items) {
      expect(without).not.toContain(item.text)
      expect(withHealth).toContain(`title="${item.title.replace(/'/g, '&#x27;')}">${item.text}</span>`)
    }
    // the second line is the muted small one
    expect(withHealth).toContain('w-full flex-wrap items-center gap-x-2 text-[11px] text-garden-muted')
    // an empty list, or null, changes nothing; nor does the prop while fetching
    expect(renderToStaticMarkup(h(StatusStrip, { data, graph, isFetching: false, health: [] }))).toBe(without)
    expect(renderToStaticMarkup(h(StatusStrip, { data, graph, isFetching: false, health: null }))).toBe(without)
    const fetching = renderToStaticMarkup(h(StatusStrip, { data: undefined, graph: null, isFetching: true }))
    expect(renderToStaticMarkup(h(StatusStrip, { data: undefined, graph: null, isFetching: true, health: items }))).toBe(fetching)
  })
})
