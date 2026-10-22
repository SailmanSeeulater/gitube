/**
 * The overlay's pure logic: which tip gets which mark (graph/pulls), the branch search's pull
 * request qualifiers (components/branchQuery), the weeds tab's ticks, and the query plumbing of
 * usePulls (its key, retry rule and error summary).
 */
import { describe, expect, it } from 'vitest'
import { buildGraph } from '../src/graph'
import {
  branchPrs,
  branchSignature,
  branchUnchecked,
  combineMarks,
  countPulls,
  defaultTipSummary,
  headMoved,
  lookupPlan,
  needsLookup,
  nodePrs,
  prMarks,
  withLookup,
  worstChecks,
  worstReview,
} from '../src/graph/pulls'
import { defaultWeedPicks } from '../src/graph/weeds'
import { branchQueryText, hasIsPr, matchesBranchQuery, parseBranchQuery, toggleIsPr } from '../src/components/branchQuery'
import { checksWords, checksWordsShort, prMeta, prPhrase, prRowSuffix, reviewWords } from '../src/components/prMark'
import { describePullsError, pullsQueryKey, shouldRetryPulls } from '../src/hooks/usePulls'
import { GitHubFetchError, type ChecksState, type PullIndex, type PullSummary, type RepoData, type ReviewState } from '../src/types'
import { linear, singleFork as withFeatureBranch } from './fixtures/repos'

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
    review: 'waiting',
    reviewRequired: null,
    checks: 'passing',
    checkCounts: null,
    reviewersAsked: 0,
    conflict: false,
    updatedAt: '2026-10-20T00:00:00Z',
    ...over,
  }
}

function index(prs: PullSummary[], over: Partial<PullIndex> = {}): PullIndex {
  const byBranch = new Map<string, PullSummary[]>()
  for (const p of prs) byBranch.set(p.head, [...(byBranch.get(p.head) ?? []), p])
  return {
    byBranch,
    intoBase: 10,
    total: 12,
    fromForks: 12 - prs.length,
    notOnGraph: 0,
    truncated: false,
    unchecked: [],
    listed: 0,
    source: 'graphql',
    fetchedAt: '2026-10-21T00:00:00Z',
    ...over,
  }
}

describe('worst-of', () => {
  it('orders review changes > waiting > approved > unknown and checks failing > running > passing > none > unknown', () => {
    const reviews: ReviewState[] = ['approved', 'unknown', 'changes', 'waiting']
    expect(reviews.reduce(worstReview, 'unknown')).toBe('changes')
    expect(worstReview('waiting', 'approved')).toBe('waiting')
    expect(worstReview('approved', 'unknown')).toBe('approved')
    const checks: ChecksState[] = ['none', 'passing', 'running', 'unknown']
    expect(checks.reduce(worstChecks, 'unknown')).toBe('running')
    expect(worstChecks('failing', 'running')).toBe('failing')
    expect(worstChecks('passing', 'none')).toBe('passing')
    expect(worstChecks('none', 'unknown')).toBe('none')
  })

  it('combines a tip of several pull requests: worst of each half, dotted only when all are drafts', () => {
    const mark = combineMarks([
      pr('a', 1, { review: 'approved', checks: 'passing', draft: true }),
      pr('b', 2, { review: 'changes', checks: 'running', draft: false, conflict: true }),
    ])
    expect(mark).toEqual({ review: 'changes', checks: 'running', draft: false, conflict: true, count: 2 })
    expect(combineMarks([pr('a', 1, { draft: true }), pr('b', 2, { draft: true })])?.draft).toBe(true)
    expect(combineMarks([])).toBeNull()
  })
})

describe('prMarks', () => {
  it('marks the tips of branches with a pull request, and nothing else', () => {
    const data = withFeatureBranch()
    const graph = buildGraph(data, 'full')
    const feature = data.branches.find((b) => !b.isDefault) as RepoData['branches'][number]
    const marks = prMarks(graph, index([pr(feature.name, 7)]))
    expect([...marks.keys()]).toEqual([feature.tipSha])
    expect(marks.get(feature.tipSha)).toMatchObject({ review: 'waiting', checks: 'passing', count: 1 })
  })

  it('gives a hidden branch no mark (its tip is not drawn)', () => {
    const data = withFeatureBranch()
    const feature = data.branches.find((b) => !b.isDefault) as RepoData['branches'][number]
    const graph = buildGraph(data, 'full', { hiddenBranches: new Set([feature.name]) })
    expect(prMarks(graph, index([pr(feature.name, 7)])).size).toBe(0)
  })

  it('is empty without an index, without pull requests, or without a graph', () => {
    const graph = buildGraph(linear(), 'full')
    expect(prMarks(graph, null).size).toBe(0)
    expect(prMarks(graph, index([])).size).toBe(0)
    expect(prMarks(null, index([pr('main', 1)])).size).toBe(0)
  })

  it('lists a node’s pull requests over all its tips', () => {
    const idx = index([pr('a', 1), pr('b', 2), pr('b', 3)])
    expect(nodePrs(idx, ['a', 'b']).map((p) => p.number)).toEqual([1, 2, 3])
    expect(branchPrs(idx, 'c')).toEqual([])
    expect(branchPrs(null, 'a')).toEqual([])
    expect(countPulls(idx)).toBe(3)
  })
})

describe('lookups and the index', () => {
  it('lays a looked-up pull request into a new index, leaving the old one alone', () => {
    const old = index([pr('a', 1, { review: 'unknown', checks: 'unknown' }), pr('b', 2, { review: 'unknown', checks: 'unknown' })], { source: 'rest' })
    const next = withLookup(old, 'a', 1, { review: 'approved', checks: 'failing', checkCounts: { failing: 1, running: 0, passing: 3, skipped: 0, total: 4 } })
    expect(next).not.toBe(old)
    expect(branchPrs(next, 'a')[0]).toMatchObject({ review: 'approved', checks: 'failing' })
    expect(branchPrs(old, 'a')[0]).toMatchObject({ review: 'unknown', checks: 'unknown' })
    // untouched branches keep their arrays
    expect(branchPrs(next, 'b')).toBe(branchPrs(old, 'b'))
    // an unknown pull request changes nothing
    expect(withLookup(old, 'a', 99, { review: 'approved', checks: 'passing', checkCounts: null })).toBe(old)
  })

  it('plans a lookup: none needed, under way, failed, by itself, or offered as a link', () => {
    const state = { lookingUp: new Set<number>(), lookupErrors: new Map<number, string>(), canAutoLookup: true }
    const unknown = pr('a', 1, { review: 'unknown', checks: 'unknown' })
    expect(needsLookup(unknown)).toBe(true)
    expect(lookupPlan(pr('a', 1), state)).toBe('done')
    expect(lookupPlan(unknown, state)).toBe('auto')
    expect(lookupPlan(unknown, { ...state, canAutoLookup: false })).toBe('ask')
    expect(lookupPlan(unknown, { ...state, lookingUp: new Set([1]) })).toBe('running')
    expect(lookupPlan(unknown, { ...state, lookupErrors: new Map([[1, 'nope']]) })).toBe('failed')
  })

  it('sees a branch that moved on since the graph was fetched', () => {
    expect(headMoved({ tipSha: 'abc' }, { headSha: 'abc' })).toBe(false)
    expect(headMoved({ tipSha: 'abc' }, { headSha: 'def' })).toBe(true)
    expect(headMoved({ tipSha: 'abc' }, { headSha: '' })).toBe(false)
  })

  it('sums up the default branch: into it, not drawn, from branches here', () => {
    const idx = index([pr('a', 1, { checks: 'failing' }), pr('b', 2, { draft: true }), pr('c', 3)], { intoBase: 127, total: 133, fromForks: 130 })
    expect(defaultTipSummary(idx)).toEqual({ into: 127, total: 133, notDrawn: 130, onlyForks: false, unchecked: 0, mapped: 3, failing: 1, drafts: 1 })
    // branches GitHub did not answer for are counted, so the line can say their pull requests are among those not drawn
    expect(defaultTipSummary(index([pr('a', 1)], { unchecked: ['b', 'c'] })).unchecked).toBe(2)
    expect(branchUnchecked(index([], { unchecked: ['b'] }), 'b')).toBe(true)
    expect(branchUnchecked(index([], { unchecked: ['b'] }), 'a')).toBe(false)
    expect(branchUnchecked(null, 'b')).toBe(false)
    expect(defaultTipSummary(index([pr('a', 1)], { source: 'rest', fromForks: 5, notOnGraph: 0 })).onlyForks).toBe(true)
    expect(defaultTipSummary(index([pr('a', 1)], { source: 'rest', fromForks: 5, notOnGraph: 2 })).notDrawn).toBe(7)
  })

  it('hashes the branch list for the query key: same list, same key; a moved tip, a new key', () => {
    const branches = [
      { name: 'main', tipSha: 'a1' },
      { name: 'feat', tipSha: 'b1' },
    ]
    expect(branchSignature(branches)).toBe(branchSignature(structuredClone(branches)))
    expect(branchSignature(branches)).toMatch(/^[0-9a-f]{8}$/)
    expect(branchSignature([branches[0], { name: 'feat', tipSha: 'b2' }])).not.toBe(branchSignature(branches))
    expect(branchSignature([...branches].reverse())).not.toBe(branchSignature(branches))
  })
})

describe('words', () => {
  it('says each half', () => {
    // "review required" only where GitHub says a branch rule still wants approvals
    expect(reviewWords({ review: 'waiting', reviewRequired: true })).toBe('review required')
    expect(reviewWords({ review: 'waiting', reviewRequired: false })).toBe('no review yet')
    expect(reviewWords({ review: 'waiting', reviewRequired: null })).toBe('no review yet')
    expect(reviewWords({ review: 'changes', reviewRequired: null })).toBe('changes requested')
    expect(reviewWords({ review: 'unknown', reviewRequired: null })).toBe('review ?')
    const counts = { failing: 2, running: 1, passing: 27, skipped: 0, total: 30 }
    expect(checksWords({ checks: 'failing', checkCounts: counts })).toBe('2 of 30 checks failing')
    expect(checksWords({ checks: 'running', checkCounts: counts })).toBe('1 of 30 checks running')
    expect(checksWords({ checks: 'passing', checkCounts: { ...counts, failing: 0, running: 0 } })).toBe('30 checks passing')
    expect(checksWords({ checks: 'passing', checkCounts: null })).toBe('checks passing')
    expect(checksWords({ checks: 'none', checkCounts: null })).toBe('no checks')
    expect(checksWords({ checks: 'unknown', checkCounts: null })).toBe('checks ?')
    expect(checksWordsShort({ checks: 'failing', checkCounts: counts })).toBe('2/30 failing')
    expect(checksWordsShort({ checks: 'unknown', checkCounts: null })).toBe('checks ?')
  })

  it('gives a branch row its suffix and the inspector its meta line', () => {
    const one = pr('feat', 12345, { reviewRequired: true, checks: 'failing', checkCounts: { failing: 2, running: 0, passing: 28, skipped: 0, total: 30 } })
    expect(prPhrase(one)).toBe('open PR #12345: review required, 2 of 30 checks failing')
    expect(prPhrase({ ...one, reviewRequired: false })).toBe('open PR #12345: no review yet, 2 of 30 checks failing')
    expect(prRowSuffix([one])).toBe(', open PR #12345: review required, 2 of 30 checks failing')
    expect(prRowSuffix([{ ...one, draft: true }, one])).toBe(', open PR #12345: review required, 2 of 30 checks failing, draft (+1 more)')
    expect(prRowSuffix([])).toBe('')
    const now = Date.parse('2026-10-21T00:00:00Z')
    expect(prMeta({ draft: true, conflict: true, base: 'feat/x', author: 'me', updatedAt: '2026-10-20T00:00:00Z' }, 'main', now)).toEqual([
      'draft',
      'conflicts with feat/x',
      'into feat/x',
      'by me',
      'updated 1d ago',
    ])
    expect(prMeta({ draft: false, conflict: null, base: 'main', author: null, updatedAt: '' }, 'main', now)).toEqual([])
  })
})

describe('branch search qualifiers', () => {
  it('leaves a plain search exactly as the canvas always saw it', () => {
    for (const search of ['', 'feat', '  Feat/X  ', 'two words', 'is:open', 'review:maybe', '#abc', 'foo:bar']) {
      expect(parseBranchQuery(search)).toEqual({ text: search.trim(), filters: [] })
      expect(branchQueryText(search)).toBe(search.trim())
    }
  })

  it('takes the qualifiers out, case-insensitively, and keeps the rest as text', () => {
    expect(parseBranchQuery('IS:PR feat checks:Failing review:approved #7 is:draft is:conflict')).toEqual({
      text: 'feat',
      filters: [
        { kind: 'pr' },
        { kind: 'checks', value: 'failing' },
        { kind: 'review', value: 'approved' },
        { kind: 'number', value: 7 },
        { kind: 'draft' },
        { kind: 'conflict' },
      ],
    })
    expect(branchQueryText('is:pr')).toBe('')
    expect(branchQueryText('is:pr fix')).toBe('fix')
  })

  it('matches text AND every qualifier against the branch’s pull requests', () => {
    const failing = [pr('fix/a', 7, { checks: 'failing', draft: true })]
    expect(matchesBranchQuery(parseBranchQuery('is:pr'), 'fix/a', failing)).toBe(true)
    expect(matchesBranchQuery(parseBranchQuery('is:pr'), 'fix/b', [])).toBe(false)
    expect(matchesBranchQuery(parseBranchQuery('fix checks:failing'), 'fix/a', failing)).toBe(true)
    expect(matchesBranchQuery(parseBranchQuery('feat checks:failing'), 'fix/a', failing)).toBe(false)
    expect(matchesBranchQuery(parseBranchQuery('checks:passing'), 'fix/a', failing)).toBe(false)
    expect(matchesBranchQuery(parseBranchQuery('is:draft #7'), 'fix/a', failing)).toBe(true)
    expect(matchesBranchQuery(parseBranchQuery('#8'), 'fix/a', failing)).toBe(false)
    expect(matchesBranchQuery(parseBranchQuery('FIX/A'), 'fix/a', [])).toBe(true)
  })

  it('toggles is:pr in the search (the count line’s link)', () => {
    expect(toggleIsPr('')).toBe('is:pr')
    expect(toggleIsPr('fix')).toBe('fix is:pr')
    expect(toggleIsPr('fix IS:PR')).toBe('fix')
    expect(hasIsPr('a is:pr')).toBe(true)
    expect(hasIsPr('a')).toBe(false)
  })
})

describe('weeds and pull requests', () => {
  it('never ticks a weed with an open pull request, nor one kept on purpose', () => {
    const weeds = [
      { name: 'old-fix', keep: false },
      { name: 'release/1.x', keep: true },
      { name: 'merged-but-open', keep: false },
    ]
    expect([...defaultWeedPicks(weeds)].sort()).toEqual(['merged-but-open', 'old-fix'])
    expect([...defaultWeedPicks(weeds, (name) => name === 'merged-but-open')]).toEqual(['old-fix'])
  })
})

describe('the pulls query', () => {
  it('is keyed by repo, token presence and branch list, never the token', () => {
    const data = withFeatureBranch()
    const key = pullsQueryKey(data, 'ghp_secret')
    expect(key[0]).toBe('pulls')
    expect(key[3]).toBe('auth')
    expect(JSON.stringify(key)).not.toContain('ghp_secret')
    expect(pullsQueryKey(data, '')[3]).toBe('anon')
    expect(key[4]).toBe(branchSignature(data.branches))
  })

  it('retries once for a dropped connection, never into a rate limit', () => {
    expect(shouldRetryPulls(0, new GitHubFetchError('x', 'network'))).toBe(true)
    expect(shouldRetryPulls(1, new GitHubFetchError('x', 'network'))).toBe(false)
    expect(shouldRetryPulls(0, new GitHubFetchError('x', 'rate_limited'))).toBe(false)
    expect(shouldRetryPulls(0, new GitHubFetchError('x', 'not_found'))).toBe(false)
  })

  it('offers a retry for what one could fix, and for a rate limit once its reset time has passed', () => {
    const before = Date.parse('2026-10-22T01:00:00Z')
    expect(describePullsError(new GitHubFetchError('limit', 'rate_limited', '2026-10-22T02:00:00Z'), before)).toEqual({
      message: 'limit',
      code: 'rate_limited',
      resetAt: '2026-10-22T02:00:00Z',
      limit: 'core',
      retriable: false,
    })
    expect(describePullsError(new GitHubFetchError('down', 'network'))?.retriable).toBe(true)
    expect(describePullsError(new GitHubFetchError('down', 'network'))?.limit).toBeNull()
    expect(describePullsError(null)).toBeNull()
  })
})
