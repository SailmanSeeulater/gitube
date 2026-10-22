/**
 * The overlay adds no persistent control, and nothing at all to a repo without pull requests: the
 * side panel, its legend and the status strip rendered to HTML (react-dom/server) with and without
 * pull request data.
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import Panel from '../src/components/Panel'
import Legend from '../src/components/Legend'
import StatusStrip from '../src/components/StatusStrip'
import NodeInspector from '../src/components/NodeInspector'
import PrBlock from '../src/components/PrBlock'
import WeedsTab from '../src/components/WeedsTab'
import { buildContributors, buildGraph } from '../src/graph'
import { findWeeds } from '../src/graph/weeds'
import type { PullsView } from '../src/hooks/usePulls'
import { useGardenStore } from '../src/store/useGardenStore'
import { GitHubFetchError, type PullIndex, type PullSummary, type RepoData } from '../src/types'
import { makeRepo, singleFork } from './fixtures/repos'

const noop = () => {}

function view(over: Partial<PullsView> = {}): PullsView {
  return {
    index: null,
    status: 'ready',
    error: null,
    retry: noop,
    invalidate: noop,
    lookup: noop,
    autoLookup: () => noop,
    lookingUp: new Set(),
    lookupErrors: new Map(),
    canAutoLookup: true,
    hasToken: false,
    rate: null,
    ...over,
  }
}

function index(prs: PullSummary[]): PullIndex {
  const byBranch = new Map<string, PullSummary[]>()
  for (const p of prs) byBranch.set(p.head, [p])
  return { byBranch, intoBase: 3, total: 4, fromForks: 4 - prs.length, notOnGraph: 0, truncated: false, listed: 0, source: 'graphql', fetchedAt: '' }
}

const PR: PullSummary = {
  number: 42,
  title: 'feature work',
  url: 'https://github.com/octo/garden/pull/42',
  head: 'feature',
  headSha: 'f2',
  base: 'main',
  draft: false,
  author: 'dev',
  review: 'waiting',
  checks: 'failing',
  checkCounts: { failing: 2, running: 0, passing: 28, skipped: 0, total: 30 },
  reviewersAsked: 1,
  conflict: false,
  updatedAt: '2024-01-01T00:00:00Z',
}

const data: RepoData = singleFork()

function panel(pulls: PullsView | null, hasPrMarks = false): string {
  return renderToStaticMarkup(
    h(Panel, {
      data,
      palette: { main: 'var(--a)', feature: 'var(--b)' },
      contributors: buildContributors(data),
      weeds: findWeeds(data),
      onBattle: () => true,
      pulls,
      hasPrMarks,
    }),
  )
}

/** The buttons (and button-like rows) in the panel's header, its view and layout switches and its tabs. */
function chromeButtons(html: string): number {
  const chrome = html.slice(0, html.indexOf('type="search"'))
  return (chrome.match(/<button/g) ?? []).length
}

/**
 * Server rendering reads a store's initial state (useSyncExternalStore's server snapshot), so the
 * state a test sets goes into both. (Each test file has its own copy of the store.)
 */
function setStore(partial: Partial<ReturnType<typeof useGardenStore.getState>>): void {
  useGardenStore.setState(partial)
  Object.assign(useGardenStore.getInitialState(), partial)
}

beforeEach(() => {
  setStore({ layoutMode: 'organic', search: '', selectedBranch: null, panelOpen: true, panelTab: 'branches', hiddenBranches: new Set(), rate: null })
})

describe('no pull requests, no change', () => {
  it('a repo without pull requests renders the panel as when the overlay is off', () => {
    expect(panel(view({ index: index([]) }))).toBe(panel(null))
    // and as while nothing is known (a saved file, the overlay idle)
    expect(panel(view({ status: 'off' }))).toBe(panel(null))
  })

  it('keeps today’s 10 px row dots and the plain search until a pull request exists', () => {
    const html = panel(view({ index: index([]) }))
    expect(html).toContain('h-2.5 w-2.5 shrink-0 rounded-full')
    expect(html).toContain('placeholder="find a branch"')
    expect(html).not.toContain('viewBox="0 0 14 14"')
  })
})

describe('with pull requests', () => {
  it('adds no button to the header, the view and layout switches or the tabs', () => {
    const before = chromeButtons(panel(null))
    expect(chromeButtons(panel(view({ index: index([PR]) }), true))).toBe(before)
  })

  it('rings the rows in 14 px swatches, labels the pull request row, and hints the qualifiers', () => {
    const html = panel(view({ index: index([PR]) }), true)
    expect((html.match(/viewBox="0 0 14 14"/g) ?? []).length).toBe(data.branches.length)
    expect(html).toContain('aria-label="feature, open PR #42: review required, 2 of 30 checks failing"')
    expect(html).toContain('placeholder="find a branch or is:pr"')
    expect(html).toMatch(/title="Find a branch by name\. Pull request filters: is:pr/)
  })

  it('says how many branches have one in the count line, as a toggle of is:pr', () => {
    const html = panel(view({ index: index([PR]) }), true)
    expect(html).toMatch(/aria-pressed="false"[^>]*>1 with PRs<\/button>/)
    setStore({ search: 'is:pr' })
    const filtered = panel(view({ index: index([PR]) }), true)
    expect(filtered).toMatch(/aria-pressed="true"[^>]*>1 with PRs<\/button>/)
    expect(filtered).toContain('1 of 2 branches')
  })

  it('says it is checking, or that it could not, in the same place', () => {
    expect(panel(view({ status: 'loading' }))).toContain('checking PRs…')
    const failed = panel(view({ status: 'error', error: { message: 'x', code: 'rate_limited', resetAt: null, retriable: false } }))
    expect(failed).toContain('PRs not checked')
    expect(failed).not.toMatch(/<button[^>]*>PRs not checked/)
    const retriable = panel(view({ status: 'error', error: { message: 'offline', code: 'network', resetAt: null, retriable: true } }))
    expect(retriable).toMatch(/<button[^>]*>PRs not checked<\/button>/)
  })

  it('shows the selected pull request row’s status in one line under it', () => {
    setStore({ selectedBranch: 'feature' })
    const html = panel(view({ index: index([PR]) }), true)
    expect(html).toContain('review required')
    expect(html).toContain('2/30 failing')
    expect(html).toContain('#42 ↗')
  })
})

describe('legend', () => {
  const items = (html: string) => (html.match(/<li /g) ?? []).length

  it('adds one item, only with pull requests on the canvas: organic fills its sixth cell, metro and garden a seventh', () => {
    for (const [layout, base] of [
      ['organic', 5],
      ['metro', 6],
      ['garden', 6],
    ] as const) {
      setStore({ layoutMode: layout })
      expect(items(renderToStaticMarkup(h(Legend))), layout).toBe(base)
      expect(renderToStaticMarkup(h(Legend, { hasPrs: false }))).toBe(renderToStaticMarkup(h(Legend)))
      const withPrs = renderToStaticMarkup(h(Legend, { hasPrs: true }))
      expect(items(withPrs), layout).toBe(base + 1)
      expect(withPrs).toContain('pull request')
      expect(withPrs).toContain('left arc: review')
    }
  })
})

describe('status strip and inspector', () => {
  it('the strip has the same buttons; its cached chip says pull requests are checked live', () => {
    const graph = buildGraph(data, 'skeleton')
    const html = renderToStaticMarkup(h(StatusStrip, { data, graph, isFetching: false, cachedAt: '2024-01-01T00:00:00Z', onRefresh: noop, onTimelapse: noop }))
    expect((html.match(/<button/g) ?? []).length).toBe(2)
    expect(html).toContain('pull requests are checked live')
  })

  it('the strip counts down the core budget the overlay spends too', () => {
    setStore({ rate: { remaining: 37, limit: 60, resetAt: null }, progress: null })
    const html = renderToStaticMarkup(h(StatusStrip, { data, graph: buildGraph(data, 'skeleton'), isFetching: false }))
    expect(html).toContain('37 requests left')
  })

  it('an inspected tip without pull requests looks as it always did', () => {
    const graph = buildGraph(data, 'skeleton')
    const main = graph.nodes.find((n) => n.tips.includes('main')) as (typeof graph.nodes)[number]
    const pulls = { view: view({ index: index([PR]) }), data, graphAt: null, onAddToken: noop, onRefresh: noop }
    const props = { node: main, palette: {}, onClose: noop }
    // main is the default branch: its tip sums the repo up instead (total 4 > 0)
    expect(renderToStaticMarkup(h(NodeInspector, { ...props, pulls }))).not.toBe(renderToStaticMarkup(h(NodeInspector, props)))
    const other = graph.nodes.find((n) => !n.isTip) as (typeof graph.nodes)[number]
    expect(renderToStaticMarkup(h(NodeInspector, { ...props, node: other, pulls }))).toBe(renderToStaticMarkup(h(NodeInspector, { ...props, node: other })))
    expect(GitHubFetchError).toBeDefined()
  })
})

describe('weeds', () => {
  it('leaves a weed with an open pull request unticked, saying deleting it closes the pull request', () => {
    const repo = makeRepo({
      commits: [['c1'], ['c2', 'c1'], ['c3', 'c2']],
      branches: [
        { name: 'main', tip: 'c3', isDefault: true },
        { name: 'old', tip: 'c2' },
        { name: 'older', tip: 'c1' },
      ],
    })
    const report = findWeeds(repo)
    expect(report.weeds.map((w) => w.name).sort()).toEqual(['old', 'older'])
    const props = { report, owner: 'octo', repo: 'garden', defaultBranch: 'main', palette: {}, now: Date.parse('2024-02-01T00:00:00Z') }
    const without = renderToStaticMarkup(h(WeedsTab, props))
    expect((without.match(/checked=""/g) ?? []).length).toBe(2)
    const html = renderToStaticMarkup(h(WeedsTab, { ...props, prs: new Map([['old', [{ ...PR, head: 'old' }]]]) }))
    expect((html.match(/checked=""/g) ?? []).length).toBe(1)
    expect(html).toContain('title="deleting this branch closes PR #42"')
    expect(html).toContain('#42 open')
    expect(html).not.toContain('origin old')
  })
})

describe('inspector pull request block', () => {
  const graph = buildGraph(data, 'skeleton')
  const tip = graph.nodes.find((n) => n.tips.includes('feature')) as (typeof graph.nodes)[number]
  const block = (pr: PullSummary, over: Partial<PullsView> = {}, graphData: RepoData = data) =>
    renderToStaticMarkup(
      h(PrBlock, {
        node: tip,
        prs: [pr],
        pulls: { view: view({ index: index([pr]), ...over }), data: graphData, graphAt: null, onAddToken: noop, onRefresh: noop },
        palette: {},
        fallback: 'currentColor',
      }),
    )

  it('reads review, checks and the rest of a pull request', () => {
    const html = block({ ...PR, headSha: tip.id, base: 'feat/x', draft: true, conflict: true })
    expect(html).toContain('#42')
    expect(html).toContain('feature work')
    expect(html).toContain('review required')
    expect(html).toContain('2 of 30 checks failing')
    expect(html).toContain('draft · conflicts with feat/x · into feat/x · by dev')
    expect(html).not.toContain('PR head is newer')
  })

  it('says when the branch moved on since the graph was fetched', () => {
    expect(block({ ...PR, headSha: 'f'.repeat(40) })).toContain('PR head is newer than this tip')
  })

  it('without budget for a lookup, offers it as a link beside how many requests are left, and a token', () => {
    const unknown = { ...PR, headSha: tip.id, review: 'unknown' as const, checks: 'unknown' as const, checkCounts: null }
    const html = block(unknown, { canAutoLookup: false, rate: { remaining: 12, limit: 60, resetAt: null } })
    expect(html).toMatch(/<button[^>]*>load review and checks \(3 requests\)<\/button>/)
    expect(html).toContain('12 left this hour')
    expect(html).toMatch(/<button[^>]*>add a token<\/button>/)
    const broke = block(unknown, { canAutoLookup: false, rate: { remaining: 2, limit: 60, resetAt: null } })
    expect(broke).not.toContain('load review and checks')
    expect(broke).toContain('3 requests to look up')
    // with budget it looks the pull request up by itself: no link
    expect(block(unknown, { canAutoLookup: true })).not.toContain('load review and checks')
    expect(block(unknown, { lookingUp: new Set([42]) })).toContain('checking review and checks…')
  })
})
