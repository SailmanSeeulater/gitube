import { describe, expect, it } from 'vitest'
import type { Branch } from '../types'
import { buildGraph } from '../graph'
import { fixtures } from '../../tests/fixtures/repos'
import {
  LABEL_COMPACT_MIN_SAVING,
  LABEL_COMPACT_W,
  LABEL_MAX_W,
  MAX_PINNED_SEARCH_HITS,
  assignLinkCurvature,
  buildBranchReach,
  buildLabelSpecs,
  buildLinkColours,
  buildNeighbourIndex,
  createTimeForce,
  ellipsizeAround,
  endEllipsis,
  fitTransform,
  formatClock,
  hexToRgba,
  isBotBranch,
  isDimmed,
  isStale,
  labelTier,
  linkEndId,
  matchLabelTexts,
  middleEllipsis,
  nameCandidates,
  nodeRadius,
  parseWhen,
  rankLabels,
  relativeTime,
  searchLabelTexts,
  selectedReach,
  shortLabels,
  shortSha,
  staleBranchNames,
  type LabelMeta,
} from './gardenUtils'

const DAY = 86_400_000

describe('nodeRadius', () => {
  it('clamps between 2 and 9', () => {
    expect(nodeRadius(0)).toBe(2)
    expect(nodeRadius(-3)).toBe(2)
    expect(nodeRadius(Number.NaN)).toBe(2)
    expect(nodeRadius(1)).toBeCloseTo(3.2)
    expect(nodeRadius(4)).toBeCloseTo(4.4)
    expect(nodeRadius(1000)).toBe(9)
  })
})

describe('hexToRgba', () => {
  it('expands 3/6/8 digit hex', () => {
    expect(hexToRgba('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)')
    expect(hexToRgba('#a78bfa', 0.35)).toBe('rgba(167, 139, 250, 0.35)')
    expect(hexToRgba('a78bfaff', 1)).toBe('rgba(167, 139, 250, 1)')
  })
  it('clamps alpha and passes through non-hex input', () => {
    expect(hexToRgba('#000', 7)).toBe('rgba(0, 0, 0, 1)')
    expect(hexToRgba('rgb(1, 2, 3)', 0.2)).toBe('rgb(1, 2, 3)')
  })
})

describe('buildLinkColours', () => {
  it('gives every branch its colour at the theme link alphas', () => {
    const { full, dim } = buildLinkColours({ main: '#a78bfa', dev: '#34d399' }, { linkAlpha: 0.35, linkDimAlpha: 0.07 })
    expect([...full]).toEqual([
      ['main', 'rgba(167, 139, 250, 0.35)'],
      ['dev', 'rgba(52, 211, 153, 0.35)'],
    ])
    expect(dim.get('main')).toBe('rgba(167, 139, 250, 0.07)')
    expect(dim.get('dev')).toBe('rgba(52, 211, 153, 0.07)')
    expect(buildLinkColours({}, { linkAlpha: 0.5, linkDimAlpha: 0.1 }).full.size).toBe(0)
  })
})

describe('linkEndId', () => {
  it('reads ids from strings, numbers and node objects', () => {
    expect(linkEndId('abc')).toBe('abc')
    expect(linkEndId(7)).toBe('7')
    expect(linkEndId({ id: 'xyz' })).toBe('xyz')
    expect(linkEndId({})).toBe('')
    expect(linkEndId(undefined)).toBe('')
    expect(linkEndId(null)).toBe('')
  })
})

// a -> b -> c (trunk), d -> b (feature forks at b), m -> a, m -> d (merge)
const LINKS = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
  { source: 'd', target: 'b' },
  { source: 'm', target: 'a' },
  { source: 'm', target: 'd' },
]
const NODES = [
  { id: 'a', tips: ['main'] },
  { id: 'b', tips: [] },
  { id: 'c', tips: [] },
  { id: 'd', tips: ['feature'] },
  { id: 'm', tips: ['merge-branch', 'alias'] },
]

describe('buildNeighbourIndex', () => {
  it('is undirected and 1-hop', () => {
    const index = buildNeighbourIndex(LINKS)
    expect([...(index.get('b') ?? [])].sort()).toEqual(['a', 'c', 'd'])
    expect([...(index.get('c') ?? [])]).toEqual(['b'])
    expect([...(index.get('m') ?? [])].sort()).toEqual(['a', 'd'])
    expect(index.get('a')?.has('c')).toBe(false)
  })
  it('accepts links whose ends were replaced by node objects', () => {
    const index = buildNeighbourIndex([{ source: { id: 'x' }, target: { id: 'y' } }])
    expect(index.get('x')?.has('y')).toBe(true)
    expect(index.get('y')?.has('x')).toBe(true)
  })
})

describe('assignLinkCurvature', () => {
  it('leaves lone links straight and fans out parallel links symmetrically', () => {
    expect(assignLinkCurvature(LINKS)).toEqual([0, 0, 0, 0, 0])
    const parallel = [
      { source: 'c2', target: 'c1' },
      { source: 'm', target: 'c2' },
      { source: 'm', target: 'c2' },
    ]
    expect(assignLinkCurvature(parallel)).toEqual([0, -0.125, 0.125])
    const triple = [
      { source: 'o', target: 'c2' },
      { source: 'o', target: 'c2' },
      { source: 'o', target: 'c2' },
    ]
    expect(assignLinkCurvature(triple)).toEqual([-0.25, 0, 0.25])
  })

  it('treats direction as significant and accepts node-object ends', () => {
    expect(assignLinkCurvature([{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }])).toEqual([0, 0])
    expect(assignLinkCurvature([{ source: { id: 'a' }, target: 'b' }, { source: 'a', target: { id: 'b' } }])).toEqual([-0.125, 0.125])
  })

  it('gives the skeleton of a merge whose side ref was deleted two distinct arcs back to the fork point', () => {
    const graph = buildGraph(fixtures.mergedDeleted(), 'skeleton')
    expect(graph.links.map((l) => `${l.source}->${l.target}+${l.collapsedCount}`)).toEqual(['c2->c1+0', 'm->c2+1', 'm->c2+2'])
    expect(assignLinkCurvature(graph.links)).toEqual([0, -0.125, 0.125])
  })
})

describe('buildBranchReach', () => {
  it('walks child -> parent from each tip', () => {
    const reach = buildBranchReach(NODES, LINKS)
    expect([...(reach.get('main') ?? [])].sort()).toEqual(['a', 'b', 'c'])
    expect([...(reach.get('feature') ?? [])].sort()).toEqual(['b', 'c', 'd'])
    expect([...(reach.get('merge-branch') ?? [])].sort()).toEqual(['a', 'b', 'c', 'd', 'm'])
  })
  it('gives every tip on a shared node the same reach', () => {
    const reach = buildBranchReach(NODES, LINKS)
    expect(reach.get('alias')).toBe(reach.get('merge-branch'))
  })
  it('has no entry for branches without a tip node', () => {
    const reach = buildBranchReach(NODES, LINKS)
    expect(reach.has('ghost')).toBe(false)
  })
})

describe('selectedReach', () => {
  const reach = buildBranchReach(NODES, LINKS)
  it('returns null when nothing is selected', () => {
    expect(selectedReach(reach, null)).toBeNull()
  })
  it('returns the reach set of a selected branch that has a tip node', () => {
    expect(selectedReach(reach, 'feature')).toBe(reach.get('feature'))
  })
  it('returns null, not an empty set, for a selected branch without a reach entry', () => {
    // An empty set would make every node fail `reachSet.has(id)` and dim the whole canvas.
    expect(selectedReach(reach, 'ghost')).toBeNull()
    expect(selectedReach(new Map(), 'main')).toBeNull()
  })
})

describe('stale filtering', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  const branch = (name: string, daysAgo: number, isDefault = false): Branch => ({
    name,
    tipSha: name,
    isDefault,
    mergeBaseSha: null,
    aheadBy: 0,
    behindBy: 0,
    tipDate: new Date(now - daysAgo * DAY).toISOString(),
  })

  it('isStale respects the cutoff and treats 0 as never', () => {
    expect(isStale(branch('x', 40).tipDate, 30, now)).toBe(true)
    expect(isStale(branch('x', 10).tipDate, 30, now)).toBe(false)
    expect(isStale(branch('x', 400).tipDate, 0, now)).toBe(false)
    expect(isStale('not a date', 30, now)).toBe(false)
  })

  it('staleBranchNames never hides the default branch', () => {
    const branches = [branch('main', 500, true), branch('old', 100), branch('fresh', 2)]
    expect(staleBranchNames(branches, 30, now)).toEqual(['old'])
    expect(staleBranchNames(branches, 0, now)).toEqual([])
    expect(staleBranchNames(branches, 365, now)).toEqual([])
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()
  it('formats buckets', () => {
    expect(relativeTime(ago(10_000), now)).toBe('just now')
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5m ago')
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3h ago')
    expect(relativeTime(ago(3 * DAY), now)).toBe('3d ago')
    expect(relativeTime(ago(45 * DAY), now)).toBe('1mo ago')
    expect(relativeTime(ago(800 * DAY), now)).toBe('2y ago')
  })
  it('handles future and invalid dates', () => {
    expect(relativeTime(new Date(now + DAY).toISOString(), now)).toBe('just now')
    expect(relativeTime('garbage', now)).toBe('')
  })
})

describe('parseWhen / formatClock', () => {
  it('parses ISO and epoch seconds', () => {
    const iso = '2026-10-09T12:34:00Z'
    expect(parseWhen(iso)).toBe(Date.parse(iso))
    expect(parseWhen('1760000000')).toBe(1_760_000_000_000)
    expect(parseWhen('')).toBeNaN()
    expect(parseWhen(null)).toBeNaN()
  })
  it('formats HH:MM and returns empty for invalid input', () => {
    expect(formatClock(null)).toBe('')
    expect(formatClock('nope')).toBe('')
    expect(formatClock('2026-10-09T12:34:00Z')).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('shortSha', () => {
  it('takes the first 7 characters', () => {
    expect(shortSha('0123456789abcdef')).toBe('0123456')
    expect(shortSha('abc')).toBe('abc')
  })
})

describe('createTimeForce', () => {
  it('pushes older commits left and newer commits right', () => {
    const force = createTimeForce(() => 1000, 0.03)
    const nodes = [
      { x: 0, vx: 0, commit: { date: '2026-01-01T00:00:00Z' } },
      { x: 0, vx: 0, commit: { date: '2026-06-01T00:00:00Z' } },
      { x: 0, vx: 0, commit: { date: '2026-03-01T00:00:00Z' } },
    ]
    force.initialize(nodes)
    force(1)
    expect(nodes[0].vx).toBeCloseTo(-500 * 0.03)
    expect(nodes[2].vx).toBeCloseTo(0)
    expect(nodes[1].vx).toBeCloseTo(500 * 0.03)
  })

  it('uses rank, so a long-tail history still spreads evenly', () => {
    const force = createTimeForce(() => 100, 1)
    const nodes = [
      { x: 0, vx: 0, commit: { date: '2000-01-01T00:00:00Z' } },
      { x: 0, vx: 0, commit: { date: '2026-10-01T00:00:00Z' } },
      { x: 0, vx: 0, commit: { date: '2026-10-02T00:00:00Z' } },
    ]
    force.initialize(nodes)
    force(1)
    expect(nodes[0].vx).toBeCloseTo(-50)
    expect(nodes[1].vx).toBeCloseTo(0)
    expect(nodes[2].vx).toBeCloseTo(50)
  })

  it('centres nodes with invalid dates and is a no-op with no width', () => {
    const force = createTimeForce(() => 0)
    const nodes = [{ x: 10, vx: 0, commit: { date: 'bad' } }]
    force.initialize(nodes)
    force(1)
    expect(nodes[0].vx).toBe(0)
    const wide = createTimeForce(() => 200, 1)
    wide.initialize(nodes)
    wide(1)
    expect(nodes[0].vx).toBeCloseTo(-10)
  })

  it('scales with alpha and the strength setter', () => {
    const force = createTimeForce(() => 100, 0.5)
    const nodes = [
      { x: 0, vx: 0, commit: { date: '2026-01-01T00:00:00Z' } },
      { x: 0, vx: 0, commit: { date: '2026-02-01T00:00:00Z' } },
    ]
    force.initialize(nodes)
    force(0.5)
    expect(nodes[1].vx).toBeCloseTo(50 * 0.5 * 0.5)
    nodes[1].vx = 0
    force.strength(1)(1)
    expect(nodes[1].vx).toBeCloseTo(50)
  })

  it('skips nodes without a position', () => {
    const force = createTimeForce(() => 100, 1)
    const nodes = [{ commit: { date: '2026-01-01T00:00:00Z' } } as { x?: number; vx?: number; commit: { date: string } }]
    force.initialize(nodes)
    expect(() => force(1)).not.toThrow()
    expect(nodes[0].vx).toBeUndefined()
  })
})

describe('isDimmed', () => {
  const neighbours = new Map<string, Set<string>>([
    ['a', new Set(['b'])],
    ['b', new Set(['a', 'c'])],
    ['c', new Set(['b'])],
  ])
  it('dims nothing when nothing is hovered or selected', () => {
    for (const id of ['a', 'b', 'c', 'zz']) expect(isDimmed(id, null, neighbours, null)).toBe(false)
  })
  it('keeps the hovered node and its 1-hop neighbours, dims the rest', () => {
    expect(isDimmed('a', 'a', neighbours, null)).toBe(false)
    expect(isDimmed('b', 'a', neighbours, null)).toBe(false)
    expect(isDimmed('c', 'a', neighbours, null)).toBe(true)
    expect(isDimmed('a', 'unknown', neighbours, null)).toBe(true)
  })
  it('dims nodes outside the selected reach, also when they neighbour the hovered node', () => {
    const reach = new Set(['a', 'b'])
    expect(isDimmed('c', null, neighbours, reach)).toBe(true)
    expect(isDimmed('a', null, neighbours, reach)).toBe(false)
    expect(isDimmed('c', 'b', neighbours, reach)).toBe(true)
    expect(isDimmed('b', 'b', neighbours, reach)).toBe(false)
  })
})

describe('fitTransform', () => {
  // handleEngineStop's arithmetic before it moved into fitTransform
  const legacy = (bbox: { x: number[]; y: number[] }, width: number, height: number) => {
    const [x0, x1] = bbox.x
    const [y0, y1] = bbox.y
    const bw = Math.max(x1 - x0, 1)
    const bh = Math.max(y1 - y0, 1)
    const availW = Math.max(width - 48 - 150, 50)
    const availH = Math.max(height - 72 - 72, 50)
    const k = Math.min(availW / bw, availH / bh, 2.5)
    return { k, cx: (x0 + x1) / 2 - (48 - 150) / (2 * k), cy: (y0 + y1) / 2 - (72 - 72) / (2 * k) }
  }
  const OLD_PAD = { left: 48, right: 150, top: 72, bottom: 72 }

  it('reproduces the old fit numbers', () => {
    for (const [bbox, w, h] of [
      [{ x: [-300, 420], y: [-120, 260] }, 1042, 768],
      [{ x: [-40, 35], y: [-10, 12] }, 1366, 650],
      [{ x: [0, 2000], y: [-900, 900] }, 800, 600],
    ] as const) {
      const got = fitTransform(bbox, { width: w, height: h }, OLD_PAD, 2.5)
      const want = legacy({ x: [...bbox.x], y: [...bbox.y] }, w, h)
      expect(got.k).toBeCloseTo(want.k, 10)
      expect(got.cx).toBeCloseTo(want.cx, 10)
      expect(got.cy).toBeCloseTo(want.cy, 10)
    }
  })

  it('centres the bbox with symmetric padding', () => {
    const fit = fitTransform({ x: [-300, 500], y: [-100, 300] }, { width: 1042, height: 768 }, { left: 96, right: 96, top: 72, bottom: 72 }, 2.5)
    expect(fit.cx).toBeCloseTo(100)
    expect(fit.cy).toBeCloseTo(100)
    expect(fit.k).toBeCloseTo(Math.min((1042 - 192) / 800, (768 - 144) / 400))
  })

  it('caps the zoom for a small graph', () => {
    const fit = fitTransform({ x: [-10, 10], y: [-5, 5] }, { width: 1042, height: 768 }, OLD_PAD, 2.5)
    expect(fit.k).toBe(2.5)
  })

  it('handles a zero-size bbox (one node) and a canvas smaller than its padding', () => {
    const one = fitTransform({ x: [7, 7], y: [-3, -3] }, { width: 1042, height: 768 }, OLD_PAD, 2.5)
    expect(one.k).toBe(2.5)
    expect(one.cx).toBeCloseTo(7 + 102 / 5)
    expect(one.cy).toBeCloseTo(-3)
    const tiny = fitTransform({ x: [0, 1000], y: [0, 1000] }, { width: 100, height: 80 }, OLD_PAD, 2.5)
    expect(tiny.k).toBeCloseTo(50 / 1000)
    expect(Number.isFinite(tiny.cx) && Number.isFinite(tiny.cy)).toBe(true)
  })
})

// ---------- branch labels ----------

/** Fake text measure: 6.5 px per character. */
const measure = (text: string) => text.length * 6.5
const SEPS = '-_/.'
const DEPENDABOT = [
  'dependabot/github_actions/minor-and-patch-a8937717ac',
  'dependabot/maven/backend/minor-and-patch-52403679ed',
  'dependabot/npm_and_yarn/frontend/minor-and-patch-5296e42069',
]

/** Splits an ellipsized string back into the kept head and tail of `text`. */
function cutsOf(text: string, shortened: string): { p: number; q: number } {
  const at = shortened.indexOf('…')
  const head = shortened.slice(0, at)
  const tail = shortened.slice(at + 1)
  expect(text.startsWith(head)).toBe(true)
  expect(text.endsWith(tail)).toBe(true)
  return { p: head.length, q: text.length - tail.length }
}

/** Length of the separator-delimited token that a cut at position c splits, or 0 if it splits none. */
function splitToken(text: string, c: number): number {
  if (c <= 0 || c >= text.length || SEPS.includes(text[c - 1]) || SEPS.includes(text[c])) return 0
  let a = c
  while (a > 0 && !SEPS.includes(text[a - 1])) a--
  let b = c
  while (b < text.length && !SEPS.includes(text[b])) b++
  return b - a
}

describe('middleEllipsis', () => {
  const names = [
    'fix/app-url-mordi-subdomain',
    'refactor/dev-separate-import-resolution-from-transform',
    'feat/show-running-process-for-the-same-project',
    'dependabot/npm_and_yarn/frontend/minor-and-patch-5296e42069',
    'appmod/java-upgrade-20260826215117',
    'v6.2',
    'averyveryverylongbranchnamewithoutanyseparatorsatall',
  ]

  it('returns the text when it fits', () => {
    expect(middleEllipsis('main', 100, measure)).toBe('main')
    expect(middleEllipsis('fix/app-url-mordi-subdomain', 176, measure)).toBe('fix/app-url-mordi-subdomain')
  })

  it('never exceeds maxW and keeps the first and last characters', () => {
    for (const name of names) {
      for (let w = 20; w <= 260; w += 3) {
        const out = middleEllipsis(name, w, measure)
        if (out === name) {
          expect(measure(name)).toBeLessThanOrEqual(w)
          continue
        }
        expect(measure(out)).toBeLessThanOrEqual(w)
        expect(out[0]).toBe(name[0])
        if (w >= measure(name[0] + '…' + name[name.length - 1])) expect(out[out.length - 1]).toBe(name[name.length - 1])
      }
    }
  })

  it('cuts at separators: fix/app-…-subdomain, then fix/…-subdomain, never …ubdomain', () => {
    const name = 'fix/app-url-mordi-subdomain'
    expect(middleEllipsis(name, 150, measure)).toBe('fix/app-url-…-subdomain')
    expect(middleEllipsis(name, LABEL_COMPACT_W, measure)).toBe('fix/app-…-subdomain')
    expect(middleEllipsis(name, 110, measure)).toBe('fix/…-subdomain')
    for (let w = 20; w <= 180; w++) expect(middleEllipsis(name, w, measure)).not.toMatch(/…u?b?domain$/)
  })

  it('never splits a separator-delimited token shorter than 5 characters', () => {
    for (const name of names) {
      for (let w = 100; w <= 220; w += 2) {
        const out = middleEllipsis(name, w, measure)
        if (out === name) continue
        const { p, q } = cutsOf(name, out)
        const a = splitToken(name, p)
        const b = splitToken(name, q)
        expect(a === 0 || a >= 5, `${name} at ${w}: ${out}`).toBe(true)
        expect(b === 0 || b >= 5, `${name} at ${w}: ${out}`).toBe(true)
      }
    }
  })

  it('falls back to a character cut when no separator is near', () => {
    const name = 'averyveryverylongbranchnamewithoutanyseparatorsatall'
    const out = middleEllipsis(name, 100, measure)
    expect(out).toContain('…')
    expect(out.length).toBe(Math.floor(100 / 6.5))
  })

  it('weights the kept part towards the head by default and towards the tail on request', () => {
    const name = 'averyveryverylongbranchnamewithoutanyseparatorsatall'
    const head = middleEllipsis(name, 130, measure)
    const tail = middleEllipsis(name, 130, measure, 0.3)
    expect(head.indexOf('…')).toBeGreaterThan(head.length / 2)
    expect(tail.indexOf('…')).toBeLessThan(tail.length / 2)
  })
})

describe('endEllipsis', () => {
  it('keeps the start, cut at a separator', () => {
    expect(endEllipsis('dependabot/github_actions/minor-and-patch', 130, measure)).toBe('dependabot/github_…')
    expect(endEllipsis('short', 130, measure)).toBe('short')
  })
})

describe('ellipsizeAround', () => {
  const name = 'feat/module-runner-align-stacktrace-with-v8'
  const at = name.indexOf('stacktrace')

  it('never cuts into the match and stays within the width', () => {
    for (const w of [LABEL_MAX_W, LABEL_COMPACT_W, 100, 80]) {
      const out = ellipsizeAround(name, at, at + 'stacktrace'.length, w, measure)
      expect(out, `${w}`).not.toBeNull()
      expect(out!).toContain('stacktrace')
      expect(measure(out!)).toBeLessThanOrEqual(w)
    }
    expect(ellipsizeAround(name, at, at + 'stacktrace'.length, LABEL_COMPACT_W, measure)).toBe('…-stacktrace-with-v8')
  })

  it('returns the text when it fits and null when not even the match fits', () => {
    expect(ellipsizeAround('fix/short', 4, 9, 100, measure)).toBe('fix/short')
    expect(ellipsizeAround(name, at, at + 'stacktrace'.length, measure('…stacktrace…') - 1, measure)).toBeNull()
  })

  it('cuts between words when a cut there keeps about as much', () => {
    const n = 'test/bundled-dev-skip-tags-object-hooks'
    const a = n.indexOf('skip-tags')
    expect(ellipsizeAround(n, a, a + 'skip-tags'.length, LABEL_MAX_W, measure)).toBe('test/…-dev-skip-tags-object-hooks')
  })
})

describe('matchLabelTexts / searchLabelTexts', () => {
  const node = (id: string, tips: string[]) => ({ id, tips, commit: { date: '2026-01-01T00:00:00Z' } })

  it('gives a hit whose compact form drops the match forms that keep it', () => {
    const { specs } = buildLabelSpecs([node('a', ['fix/hostname-host-header-injection'])], 'main', measure)
    expect(specs[0].texts[1]).not.toContain('hostname')
    const forms = matchLabelTexts(specs[0], 'hostname', measure)!
    expect(forms.texts[0]).toBe(specs[0].texts[0])
    expect(forms.texts).toHaveLength(2)
    expect(forms.texts[1]).toContain('hostname')
    expect(forms.widths[1]).toBeLessThanOrEqual(LABEL_COMPACT_W)
    expect(forms.widths).toEqual(forms.texts.map(measure))
  })

  it('leads a multi-tip label with the name that matches', () => {
    const { specs } = buildLabelSpecs([node('n', ['main', 'dev', 'feat/payments-hostname-check'])], 'main', measure)
    expect(specs[0].texts[0]).not.toContain('hostname')
    const forms = matchLabelTexts(specs[0], 'hostname', measure)!
    for (const t of forms.texts) {
      expect(t).toContain('hostname')
      expect(t.endsWith(' +2')).toBe(true)
    }
    expect(forms.texts[0]).toBe('feat/payments-hostname-check +2')
  })

  it('returns null when every stored form already shows the match', () => {
    const { specs } = buildLabelSpecs([node('a', ['fix/hostname-host-header-injection'])], 'main', measure)
    expect(matchLabelTexts(specs[0], 'fix/', measure)).toBeNull()
    expect(matchLabelTexts(specs[0], 'nowhere', measure)).toBeNull()
  })

  it('only gives forms to the hits of a search that pins them', () => {
    const names = Array.from({ length: MAX_PINNED_SEARCH_HITS + 1 }, (_, k) => `fix/hostname-host-header-injection-${k}`)
    const { specs } = buildLabelSpecs(names.map((t, k) => node(`n${k}`, [t])), 'main', measure)
    const few = new Set([0, 1])
    // every stored form drops 'header'
    expect(specs.every((sp) => sp.texts.every((t) => !t.includes('header')))).toBe(true)
    const out = searchLabelTexts(specs, few, 'header', measure)
    expect([...out.keys()].sort()).toEqual([0, 1])
    for (const forms of out.values()) for (const t of forms.texts) expect(t).toContain('header')
    expect(searchLabelTexts(specs, new Set(names.map((_, k) => k)), 'header', measure).size).toBe(0)
    expect(searchLabelTexts(specs, few, '', measure).size).toBe(0)
  })
})

describe('nameCandidates', () => {
  it('strips hash and timestamp suffixes and builds a/…/z and a/b/…', () => {
    expect(nameCandidates('dependabot/maven/backend/minor-and-patch-52403679ed')).toEqual([
      'dependabot/maven/backend/minor-and-patch-52403679ed',
      'dependabot/maven/backend/minor-and-patch',
      'dependabot/…/minor-and-patch',
      'dependabot/maven/…',
    ])
    expect(nameCandidates('appmod/java-upgrade-20260826215117')).toEqual(['appmod/java-upgrade-20260826215117', 'appmod/java-upgrade'])
    expect(nameCandidates('main')).toEqual(['main'])
    expect(nameCandidates('feat/x')).toEqual(['feat/x'])
  })
})

describe('shortLabels', () => {
  it('shortens the Mordi dependabot names to distinct path forms at 220 px', () => {
    expect(shortLabels(DEPENDABOT, LABEL_MAX_W, measure)).toEqual([
      'dependabot/github_actions/…',
      'dependabot/maven/…',
      'dependabot/npm_and_yarn/…',
    ])
  })

  it('keeps them distinct and readable at the compact width, deterministically', () => {
    const out = shortLabels(DEPENDABOT, LABEL_COMPACT_W, measure)
    expect(new Set(out).size).toBe(3)
    for (const t of out) expect(measure(t)).toBeLessThanOrEqual(LABEL_COMPACT_W)
    expect(out[0].startsWith('dependabot/github')).toBe(true)
    expect(out[1].startsWith('dependabot/maven')).toBe(true)
    expect(out[2].startsWith('dependabot/npm')).toBe(true)
    expect(shortLabels(DEPENDABOT, LABEL_COMPACT_W, measure)).toEqual(out)
  })

  it('returns names that fit unchanged and moves to a later candidate when two would read the same', () => {
    expect(shortLabels(['main', 'dev'], 100, measure)).toEqual(['main', 'dev'])
    const out = shortLabels(['team/alpha/feature-end', 'team/beta/feature-end'], 120, measure)
    expect(out).toEqual(['team/alpha/…', 'team/beta/…'])
  })

  it('accepts one width per name', () => {
    const out = shortLabels(['fix/app-url-mordi-subdomain', 'fix/app-url-mordi-subdomain-two'], [500, 110], measure)
    expect(out[0]).toBe('fix/app-url-mordi-subdomain')
    expect(measure(out[1])).toBeLessThanOrEqual(110)
  })

  // same first segment and last token, different middle: every snapped cut drops the difference
  const SAME_ENDS = [
    ['feature/improve-rollup-support', 'feature/improve-esbuild-support'],
    ['feature/add-support-for-esbuild-in-dev-server', 'feature/add-support-for-rollup-in-dev-server'],
  ]

  it('keeps names that share both ends apart by showing where they differ', () => {
    expect(shortLabels(SAME_ENDS[0], LABEL_COMPACT_W, measure)).toEqual(['feature/…rollup-…', 'feature/…esbuild-…'])
    expect(shortLabels(SAME_ENDS[1], LABEL_COMPACT_W, measure)).toEqual(['feature/…esbuild-…', 'feature/…rollup-in-…'])
    for (const pair of SAME_ENDS) {
      for (const w of [LABEL_COMPACT_W, LABEL_MAX_W]) {
        const out = shortLabels(pair, w, measure)
        expect(new Set(out).size, `${pair.join(' / ')} at ${w}: ${out.join(' / ')}`).toBe(2)
        for (const t of out) expect(measure(t)).toBeLessThanOrEqual(w)
      }
    }
  })

  it('separates the members it can when one member of a group cannot be told apart', () => {
    // a third name equal to the first apart from a hash suffix reads the same as it in every form
    const names = [...SAME_ENDS[0], 'feature/improve-rollup-support-0123abcd']
    const out = shortLabels(names, LABEL_COMPACT_W, measure)
    for (const t of out) expect(measure(t)).toBeLessThanOrEqual(LABEL_COMPACT_W)
    expect(out[1]).toBe('feature/…esbuild-…')
    expect(out[0]).not.toBe(out[1])
    expect(out[2]).not.toBe(out[1])
  })
})

describe('isBotBranch / labelTier', () => {
  it('recognises dependency-bot branches', () => {
    for (const name of ['dependabot/npm_and_yarn/x-1.2', 'renovate/react-19.x', 'snyk-fix-123', 'pre-commit-ci-update-config', 'imgbot/optimise', 'some-branch[bot]']) {
      expect(isBotBranch(name), name).toBe(true)
    }
    for (const name of ['feat/bot-ui', 'robot', 'main', 'renovated-landing']) expect(isBotBranch(name), name).toBe(false)
  })
  it('ranks the default branch, then humans, then bots', () => {
    expect(labelTier('main', 'main')).toBe(0)
    expect(labelTier('feat/x', 'main')).toBe(1)
    expect(labelTier('renovate/x', 'main')).toBe(2)
  })
})

describe('buildLabelSpecs', () => {
  const node = (id: string, tips: string[], date = '2026-01-01T00:00:00Z') => ({ id, tips, commit: { date } })

  it('makes one spec per tip node, leading with the default branch, then humans, then bots', () => {
    const nodes = [node('n0', []), node('n1', ['dev', 'main', 'renovate/x']), node('n2', ['feature'], '2026-03-01T00:00:00Z')]
    const { specs, meta } = buildLabelSpecs(nodes, 'main', measure)
    expect(specs.map((s) => s.node)).toEqual([1, 2])
    expect(specs[0].names).toEqual(['main', 'dev', 'renovate/x'])
    expect(specs[0].texts[0]).toBe('main, dev, renovate/x')
    expect(specs[0].fullText).toBe('main, dev, renovate/x')
    expect(specs[0].widths[0]).toBe(measure('main, dev, renovate/x'))
    expect(meta[0]).toMatchObject({ tier: 0, name: 'main', nodeId: 'n1' })
    expect(meta[1]).toMatchObject({ tier: 1, name: 'feature', nodeId: 'n2', date: Date.parse('2026-03-01T00:00:00Z') })
  })

  it("joins the names when they fit and falls back to 'main +3' when they do not", () => {
    const tips = ['main', 'feature/one-rather-long-name', 'feature/two-rather-long-name', 'feature/three-rather-long-name']
    const { specs } = buildLabelSpecs([node('n', tips)], 'main', measure)
    expect(specs[0].texts[0]).toBe('main +3')
    // names after the default branch are sorted
    expect(specs[0].fullText).toBe('main, feature/one-rather-long-name, feature/three-rather-long-name, feature/two-rather-long-name')
    expect(specs[0].names).toHaveLength(4)
    expect(specs[0].texts).toHaveLength(1)
  })

  it('keeps the compact form only when it is at least 8 px narrower', () => {
    const long = buildLabelSpecs([node('n', ['feature/a-long-branch-name-here'])], 'main', measure).specs[0]
    expect(long.texts).toHaveLength(2)
    expect(long.widths[1]).toBeLessThanOrEqual(long.widths[0] - LABEL_COMPACT_MIN_SAVING)
    expect(long.widths[1]).toBeLessThanOrEqual(LABEL_COMPACT_W)
    const short = buildLabelSpecs([node('n', ['feature/short'])], 'main', measure).specs[0]
    expect(short.texts).toEqual(['feature/short'])
    // 21 characters and no separator: the compact form would only save one character (6.5 px)
    const nearly = buildLabelSpecs([node('n', ['abcdefghijklmnopqrstu'])], 'main', measure).specs[0]
    expect(measure('abcdefghijklmnopqrstu')).toBeGreaterThan(LABEL_COMPACT_W)
    expect(nearly.texts).toEqual(['abcdefghijklmnopqrstu'])
  })

  it('never gives two labels the same text', () => {
    const pairs = [
      ['feature/improve-rollup-support', 'feature/improve-esbuild-support'],
      ['feature/add-support-for-esbuild-in-dev-server', 'feature/add-support-for-rollup-in-dev-server'],
    ]
    for (const pair of pairs) {
      const { specs } = buildLabelSpecs(
        pair.map((name, k) => node(`n${k}`, [name])),
        'main',
        measure,
      )
      const texts = specs.flatMap((s) => s.texts)
      expect(new Set(texts).size, texts.join(' / ')).toBe(texts.length)
    }
  })

  it('drops a compact form that reads like another label', () => {
    // a and b differ only by a hash suffix, so no compact form tells them apart: both shorten to
    // 'feature/…-support', which is also c's whole name. Their wide forms differ and stay.
    const nodes = [node('a', ['feature/improve-rollup-support']), node('b', ['feature/improve-rollup-support-0123abcd']), node('c', ['feature/…-support'])]
    expect(shortLabels(nodes.map((n) => n.tips[0]), LABEL_COMPACT_W, measure)).toEqual(['feature/…-support', 'feature/…-support', 'feature/…-support'])
    const { specs } = buildLabelSpecs(nodes, 'main', measure)
    expect(specs.map((s) => s.texts.length)).toEqual([1, 1, 1])
    const texts = specs.flatMap((s) => s.texts)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('reads an unparsable date as 0', () => {
    expect(buildLabelSpecs([node('n', ['x'], 'not a date')], 'main', measure).meta[0].date).toBe(0)
  })
})

describe('rankLabels', () => {
  const day = (d: number) => Date.UTC(2026, 0, d)
  const meta: LabelMeta[] = [
    { tier: 2, date: day(30), name: 'dependabot/x', nodeId: 'n0', tips: ['dependabot/x'] },
    { tier: 1, date: day(10), name: 'feat/old', nodeId: 'n1', tips: ['feat/old'] },
    { tier: 0, date: day(1), name: 'main', nodeId: 'n2', tips: ['main'] },
    { tier: 1, date: day(20), name: 'feat/new', nodeId: 'n3', tips: ['feat/new'] },
    { tier: 1, date: day(20), name: 'feat/also-new', nodeId: 'n4', tips: ['feat/also-new'] },
    { tier: 1, date: day(5), name: 'feat/older', nodeId: 'n5', tips: ['feat/older'] },
  ]
  const none = { reach: null, searchHits: new Set<number>(), selectedTip: -1 }

  it('orders by tier, then newest first, then name', () => {
    const { order } = rankLabels(meta, none)
    expect(Array.from(order)).toEqual([2, 4, 3, 1, 5, 0])
  })

  it('pins the default branch and the three most recent non-bot tips', () => {
    const { pinned, softPinned } = rankLabels(meta, none)
    expect(pinned).toEqual([2, 4, 3, 1])
    expect(softPinned).toEqual([4, 3, 1])
  })

  it('puts the selected tip first, then its reach, and sorts dimmed tips last', () => {
    const reach = new Set(['n1', 'n2', 'n5'])
    const { order, pinned } = rankLabels(meta, { reach, searchHits: new Set(), selectedTip: 5 })
    expect(Array.from(order)).toEqual([5, 2, 1, 4, 3, 0])
    // selected and default pinned; the recent pins skip dimmed tips
    expect(pinned).toEqual([5, 2, 1])
  })

  it('pins up to 8 search hits and only ranks more of them first', () => {
    const few = rankLabels(meta, { reach: null, searchHits: new Set([0, 5]), selectedTip: -1 })
    expect(Array.from(few.order).slice(0, 2)).toEqual([5, 0])
    expect(few.pinned).toContain(0)
    expect(few.pinned).toContain(5)
    const many = Array.from({ length: 12 }, (_, i): LabelMeta => ({ tier: 2, date: day(i + 1), name: `bot/${i}`, nodeId: `b${i}`, tips: [`bot/${i}`] }))
    const hits = new Set(Array.from({ length: 9 }, (_, i) => i))
    const r = rankLabels(many, { reach: null, searchHits: hits, selectedTip: -1 })
    expect(r.pinned).toEqual([])
    expect(Array.from(r.order).slice(0, 9).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
})
