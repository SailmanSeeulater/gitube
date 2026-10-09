import { describe, expect, it } from 'vitest'
import type { Branch } from '../types'
import { buildGraph } from '../graph'
import { fixtures } from '../../tests/fixtures/repos'
import {
  assignLinkCurvature,
  buildBranchReach,
  buildNeighbourIndex,
  createTimeForce,
  formatClock,
  hexToRgba,
  isStale,
  linkEndId,
  nodeRadius,
  parseWhen,
  relativeTime,
  selectedReach,
  shortSha,
  staleBranchNames,
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
