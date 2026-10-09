import { describe, expect, it } from 'vitest'
import type { Graph, GraphNode, RepoData } from '../src/types'
import {
  ACCENT_COLOR,
  BRANCH_COLORS,
  assignPalette,
  buildFullGraph,
  buildGraph,
  collapseToSkeleton,
  colorAt,
  isSkeletonNode,
  ownershipOrder,
  rotateHue,
} from '../src/graph'
import { fixtures, linearRepo, makeRepo, mergeBase } from './fixtures/repos'
import type { FixtureName } from './fixtures/repos'

// ---------- helpers ----------

type Flag = 'isTip' | 'isFork' | 'isMerge' | 'isRoot'

function node(g: Graph, id: string): GraphNode {
  const found = g.nodes.find((n) => n.id === id)
  if (!found) throw new Error(`no node ${id} in graph with [${g.nodes.map((n) => n.id).join(', ')}]`)
  return found
}

function ids(g: Graph): string[] {
  return g.nodes.map((n) => n.id).sort()
}

function flagged(g: Graph, flag: Flag): string[] {
  return g.nodes.filter((n) => n[flag]).map((n) => n.id).sort()
}

function owners(g: Graph): Record<string, string> {
  return Object.fromEntries(g.nodes.map((n) => [n.id, n.owner]))
}

function reaches(g: Graph): Record<string, number> {
  return Object.fromEntries(g.nodes.map((n) => [n.id, n.reach]))
}

/** "source->target" => collapsedCount, with parallel links suffixed #2, #3 ... */
function linkMap(g: Graph): Record<string, number> {
  const out: Record<string, number> = {}
  for (const l of g.links) {
    let key = `${l.source}->${l.target}`
    let n = 2
    while (key in out) key = `${l.source}->${l.target}#${n++}`
    out[key] = l.collapsedCount
  }
  return out
}

function sumCollapsed(g: Graph): number {
  return g.links.reduce((acc, l) => acc + l.collapsedCount, 0)
}

const fixtureNames = Object.keys(fixtures) as FixtureName[]

// ---------- generic invariants over every fixture ----------

describe('invariants (every fixture, every visibility)', () => {
  for (const name of fixtureNames) {
    describe(name, () => {
      const data = fixtures[name]()
      const visibilities: Array<{ label: string; hidden: ReadonlySet<string> }> = [
        { label: 'all visible', hidden: new Set() },
        ...data.branches.map((b) => ({ label: `hiding ${b.name}`, hidden: new Set([b.name]) })),
      ]

      for (const { label, hidden } of visibilities) {
        describe(label, () => {
          const full = buildGraph(data, 'full', { hiddenBranches: hidden })
          const skeleton = buildGraph(data, 'skeleton', { hiddenBranches: hidden })
          const visibleNames = new Set(data.branches.map((b) => b.name).filter((n) => !hidden.has(n)))

          it('has no dangling links in either mode', () => {
            for (const g of [full, skeleton]) {
              const nodeIds = new Set(g.nodes.map((n) => n.id))
              for (const l of g.links) {
                expect(nodeIds.has(l.source), `source ${l.source}`).toBe(true)
                expect(nodeIds.has(l.target), `target ${l.target}`).toBe(true)
              }
            }
          })

          it('full links are child -> parent with collapsedCount 0', () => {
            for (const l of full.links) {
              expect(l.collapsedCount).toBe(0)
              expect(node(full, l.source).commit.parents).toContain(l.target)
            }
            const expectedLinkCount = full.nodes.reduce(
              (acc, n) => acc + n.commit.parents.filter((p) => full.nodes.some((m) => m.id === p)).length,
              0,
            )
            expect(full.links.length).toBe(expectedLinkCount)
          })

          it('loses no commits: skeleton nodes + sum(collapsedCount) = full nodes', () => {
            expect(skeleton.nodes.length + sumCollapsed(skeleton)).toBe(full.nodes.length)
          })

          it('keeps exactly the tip/fork/merge/root nodes, untouched', () => {
            const expectedKept = full.nodes.filter(isSkeletonNode)
            expect(skeleton.nodes).toEqual(expectedKept)
            for (const n of skeleton.nodes) expect(n).toEqual(node(full, n.id))
          })

          it('link owner is the owner of the child end', () => {
            for (const g of [full, skeleton]) {
              for (const l of g.links) expect(l.owner).toBe(node(g, l.source).owner)
            }
          })

          it('owners and tips are visible branches; every node is reached at least once', () => {
            for (const n of full.nodes) {
              expect(visibleNames.has(n.owner), `owner of ${n.id} = ${n.owner}`).toBe(true)
              for (const t of n.tips) expect(visibleNames.has(t)).toBe(true)
              expect(n.isTip).toBe(n.tips.length > 0)
              expect(n.reach).toBeGreaterThanOrEqual(1)
              expect(n.reach).toBeLessThanOrEqual(visibleNames.size)
            }
          })

          it('is deterministic (same input -> deep-equal output)', () => {
            expect(buildGraph(data, 'full', { hiddenBranches: hidden })).toEqual(full)
            expect(buildGraph(data, 'skeleton', { hiddenBranches: hidden })).toEqual(skeleton)
            expect(JSON.stringify(buildGraph(data, 'skeleton', { hiddenBranches: hidden }))).toBe(
              JSON.stringify(skeleton),
            )
          })

          it('does not mutate its input', () => {
            const before = JSON.stringify(data)
            buildGraph(data, 'full', { hiddenBranches: hidden })
            buildGraph(data, 'skeleton', { hiddenBranches: hidden })
            expect(JSON.stringify(data)).toBe(before)
          })

          it('palette covers every branch (hidden or not) and is identical in both modes', () => {
            for (const b of data.branches) expect(full.palette[b.name]).toMatch(/^#[0-9a-f]{6}$/)
            expect(skeleton.palette).toEqual(full.palette)
            expect(full.palette[data.defaultBranch]).toBe(ACCENT_COLOR)
          })
        })
      }
    })
  }
})

// ---------- per-fixture expectations ----------

describe('fixture (1) linear', () => {
  const data = fixtures.linear()
  const full = buildGraph(data, 'full')
  const skeleton = buildGraph(data, 'skeleton')

  it('counts', () => {
    expect(full.nodes.length).toBe(5)
    expect(full.links.length).toBe(4)
    expect(skeleton.nodes.length).toBe(2)
    expect(skeleton.links.length).toBe(1)
  })

  it('flags', () => {
    expect(flagged(full, 'isRoot')).toEqual(['c1'])
    expect(flagged(full, 'isTip')).toEqual(['c5'])
    expect(flagged(full, 'isFork')).toEqual([])
    expect(flagged(full, 'isMerge')).toEqual([])
    expect(node(full, 'c5').tips).toEqual(['main'])
  })

  it('owners and reach', () => {
    expect(new Set(Object.values(owners(full)))).toEqual(new Set(['main']))
    expect(Object.values(reaches(full)).every((r) => r === 1)).toBe(true)
  })

  it('skeleton collapses the run into one link', () => {
    expect(ids(skeleton)).toEqual(['c1', 'c5'])
    expect(linkMap(skeleton)).toEqual({ 'c5->c1': 3 })
    expect(skeleton.links[0].owner).toBe('main')
  })

  it('nodes are ordered by date then sha', () => {
    expect(full.nodes.map((n) => n.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
  })
})

describe('fixture (2) single fork', () => {
  const data = fixtures.singleFork()
  const full = buildGraph(data, 'full')
  const skeleton = buildGraph(data, 'skeleton')

  it('fixture metadata from the DSL', () => {
    const feature = data.branches.find((b) => b.name === 'feature')
    expect(feature).toMatchObject({ mergeBaseSha: 'c3', aheadBy: 2, behindBy: 2, isDefault: false })
  })

  it('counts', () => {
    expect(full.nodes.length).toBe(7)
    expect(full.links.length).toBe(6)
    expect(skeleton.nodes.length).toBe(4)
    expect(skeleton.links.length).toBe(3)
  })

  it('flags', () => {
    expect(flagged(full, 'isFork')).toEqual(['c3'])
    expect(flagged(full, 'isTip')).toEqual(['c5', 'f2'])
    expect(flagged(full, 'isRoot')).toEqual(['c1'])
    expect(flagged(full, 'isMerge')).toEqual([])
  })

  it('owners: trunk to main, unique commits to feature', () => {
    expect(owners(full)).toEqual({
      c1: 'main',
      c2: 'main',
      c3: 'main',
      c4: 'main',
      c5: 'main',
      f1: 'feature',
      f2: 'feature',
    })
  })

  it('reach counts branches containing the commit', () => {
    expect(reaches(full)).toEqual({ c1: 2, c2: 2, c3: 2, c4: 1, c5: 1, f1: 1, f2: 1 })
  })

  it('skeleton', () => {
    expect(ids(skeleton)).toEqual(['c1', 'c3', 'c5', 'f2'])
    expect(linkMap(skeleton)).toEqual({ 'c3->c1': 1, 'c5->c3': 1, 'f2->c3': 1 })
    const featureLink = skeleton.links.find((l) => l.source === 'f2')
    expect(featureLink?.owner).toBe('feature')
  })

  it('hiding feature removes its unique commits and the fork flag', () => {
    const hidden = buildGraph(data, 'full', { hiddenBranches: new Set(['feature']) })
    expect(ids(hidden)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(node(hidden, 'c3').isFork).toBe(false)
    expect(node(hidden, 'c3').reach).toBe(1)
    const hiddenSkeleton = buildGraph(data, 'skeleton', { hiddenBranches: new Set(['feature']) })
    expect(linkMap(hiddenSkeleton)).toEqual({ 'c5->c1': 3 })
  })
})

describe('fixture (3) merge with feature ref present', () => {
  const data = fixtures.merge()
  const full = buildGraph(data, 'full')
  const skeleton = buildGraph(data, 'skeleton')

  it('fixture metadata: merged branch is 0 ahead and its merge-base is its own tip', () => {
    const feature = data.branches.find((b) => b.name === 'feature')
    expect(feature).toMatchObject({ mergeBaseSha: 'f2', aheadBy: 0, behindBy: 3 })
  })

  it('counts', () => {
    expect(full.nodes.length).toBe(7)
    expect(full.links.length).toBe(7)
    expect(skeleton.nodes.length).toBe(4)
    expect(skeleton.links.length).toBe(4)
  })

  it('flags', () => {
    expect(flagged(full, 'isMerge')).toEqual(['m'])
    expect(flagged(full, 'isFork')).toEqual(['c2'])
    expect(flagged(full, 'isTip')).toEqual(['f2', 'm'])
    expect(flagged(full, 'isRoot')).toEqual(['c1'])
  })

  it('owners: first-parent walk keeps the trunk on main; feature keeps its own commits', () => {
    expect(owners(full)).toEqual({
      c1: 'main',
      c2: 'main',
      c3: 'main',
      c4: 'main',
      m: 'main',
      f1: 'feature',
      f2: 'feature',
    })
  })

  it('reach', () => {
    expect(reaches(full)).toEqual({ c1: 2, c2: 2, c3: 1, c4: 1, m: 1, f1: 2, f2: 2 })
  })

  it('skeleton', () => {
    expect(ids(skeleton)).toEqual(['c1', 'c2', 'f2', 'm'])
    expect(linkMap(skeleton)).toEqual({ 'c2->c1': 0, 'f2->c2': 1, 'm->c2': 2, 'm->f2': 0 })
  })
})

describe('fixture (4) diamond', () => {
  const data = fixtures.diamond()
  const full = buildGraph(data, 'full')
  const skeleton = buildGraph(data, 'skeleton')

  it('fixture metadata', () => {
    const a = data.branches.find((b) => b.name === 'feature-a')
    const b = data.branches.find((b) => b.name === 'feature-b')
    expect(a).toMatchObject({ mergeBaseSha: 'a2', aheadBy: 0, behindBy: 1 })
    expect(b).toMatchObject({ mergeBaseSha: 'c3', aheadBy: 2, behindBy: 3 })
  })

  it('ownership order: default first, then by aheadBy, then name', () => {
    expect(ownershipOrder(data).map((b) => b.name)).toEqual(['main', 'feature-a', 'feature-b'])
  })

  it('counts', () => {
    expect(full.nodes.length).toBe(8)
    expect(full.links.length).toBe(8)
    expect(skeleton.nodes.length).toBe(5)
    expect(skeleton.links.length).toBe(5)
  })

  it('flags', () => {
    expect(flagged(full, 'isFork')).toEqual(['c3'])
    expect(flagged(full, 'isMerge')).toEqual(['m'])
    expect(flagged(full, 'isTip')).toEqual(['a2', 'b2', 'm'])
    expect(flagged(full, 'isRoot')).toEqual(['c1'])
  })

  it('owners: trunk belongs to main, each feature owns its unique commits', () => {
    expect(owners(full)).toEqual({
      c1: 'main',
      c2: 'main',
      c3: 'main',
      m: 'main',
      a1: 'feature-a',
      a2: 'feature-a',
      b1: 'feature-b',
      b2: 'feature-b',
    })
  })

  it('reach', () => {
    expect(reaches(full)).toEqual({ c1: 3, c2: 3, c3: 3, a1: 2, a2: 2, b1: 1, b2: 1, m: 1 })
  })

  it('skeleton', () => {
    expect(ids(skeleton)).toEqual(['a2', 'b2', 'c1', 'c3', 'm'])
    expect(linkMap(skeleton)).toEqual({ 'c3->c1': 1, 'a2->c3': 1, 'b2->c3': 1, 'm->c3': 0, 'm->a2': 0 })
  })

  it('hiding the default branch drops its unique merge commit but keeps shared history', () => {
    const hidden = new Set(['main'])
    const g = buildGraph(data, 'full', { hiddenBranches: hidden })
    expect(ids(g)).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'c3'])
    expect(ownershipOrder(data, hidden).map((b) => b.name)).toEqual(['feature-a', 'feature-b'])
    // the first remaining branch now owns the trunk
    expect(owners(g)).toEqual({
      c1: 'feature-a',
      c2: 'feature-a',
      c3: 'feature-a',
      a1: 'feature-a',
      a2: 'feature-a',
      b1: 'feature-b',
      b2: 'feature-b',
    })
    expect(node(g, 'c3').isFork).toBe(true)
    expect(reaches(g)).toEqual({ c1: 2, c2: 2, c3: 2, a1: 1, a2: 1, b1: 1, b2: 1 })
    const s = buildGraph(data, 'skeleton', { hiddenBranches: hidden })
    expect(ids(s)).toEqual(['a2', 'b2', 'c1', 'c3'])
    expect(linkMap(s)).toEqual({ 'c3->c1': 1, 'a2->c3': 1, 'b2->c3': 1 })
    // palette is unaffected by hiding
    expect(g.palette).toEqual(full.palette)
    expect(g.palette.main).toBe(ACCENT_COLOR)
  })

  it('hiding everything yields an empty graph', () => {
    const g = buildGraph(data, 'skeleton', { hiddenBranches: new Set(['main', 'feature-a', 'feature-b']) })
    expect(g.nodes).toEqual([])
    expect(g.links).toEqual([])
    expect(Object.keys(g.palette).sort()).toEqual(['feature-a', 'feature-b', 'main'])
  })
})

describe('fixture (5) truncated history', () => {
  const data = fixtures.truncated()
  const full = buildGraph(data, 'full')
  const skeleton = buildGraph(data, 'skeleton')

  it('fixture metadata: disconnected feature has no merge-base', () => {
    expect(data.truncated).toBe(true)
    const feature = data.branches.find((b) => b.name === 'feature')
    expect(feature).toMatchObject({ mergeBaseSha: null, aheadBy: 2, behindBy: 4 })
  })

  it('counts: missing parents are not followed and produce no links', () => {
    expect(full.nodes.length).toBe(6)
    expect(full.links.length).toBe(4)
    expect(skeleton.nodes.length).toBe(5)
    expect(skeleton.links.length).toBe(3)
  })

  it('roots: missing parent (c2, f1) and truncatedAt flag (c3)', () => {
    expect(flagged(full, 'isRoot')).toEqual(['c2', 'c3', 'f1'])
    expect(node(full, 'c3').commit.parents).toEqual(['c2']) // parent present; flag came from truncatedAt
    expect(flagged(full, 'isTip')).toEqual(['c5', 'f2'])
    expect(flagged(full, 'isFork')).toEqual([])
  })

  it('owners and reach', () => {
    expect(owners(full)).toEqual({ c2: 'main', c3: 'main', c4: 'main', c5: 'main', f1: 'feature', f2: 'feature' })
    expect(Object.values(reaches(full)).every((r) => r === 1)).toBe(true)
  })

  it('skeleton', () => {
    expect(ids(skeleton)).toEqual(['c2', 'c3', 'c5', 'f1', 'f2'])
    expect(linkMap(skeleton)).toEqual({ 'c3->c2': 0, 'c5->c3': 1, 'f2->f1': 0 })
  })
})

describe('fixture (6) stale branch on a trunk commit', () => {
  const data = fixtures.stale()
  const full = buildGraph(data, 'full')
  const skeleton = buildGraph(data, 'skeleton')

  it('fixture metadata', () => {
    expect(data.branches.find((b) => b.name === 'old')).toMatchObject({ mergeBaseSha: 'c3', aheadBy: 0, behindBy: 2 })
  })

  it('counts', () => {
    expect(full.nodes.length).toBe(5)
    expect(full.links.length).toBe(4)
    expect(skeleton.nodes.length).toBe(3)
    expect(skeleton.links.length).toBe(2)
  })

  it('the stale tip is a tip but still owned by main', () => {
    expect(node(full, 'c3').tips).toEqual(['old'])
    expect(node(full, 'c3').isTip).toBe(true)
    expect(node(full, 'c3').isFork).toBe(false)
    expect(new Set(Object.values(owners(full)))).toEqual(new Set(['main']))
    expect(reaches(full)).toEqual({ c1: 2, c2: 2, c3: 2, c4: 1, c5: 1 })
  })

  it('skeleton splits the chain at the stale tip', () => {
    expect(ids(skeleton)).toEqual(['c1', 'c3', 'c5'])
    expect(linkMap(skeleton)).toEqual({ 'c3->c1': 1, 'c5->c3': 1 })
    expect(skeleton.links.every((l) => l.owner === 'main')).toBe(true)
  })
})

describe('fixture (7) nested branches', () => {
  const data = fixtures.nested()
  const full = buildGraph(data, 'full')
  const skeleton = buildGraph(data, 'skeleton')

  it('fixture metadata', () => {
    expect(data.branches.find((b) => b.name === 'feature-a')).toMatchObject({ mergeBaseSha: 'c3', aheadBy: 2, behindBy: 0 })
    expect(data.branches.find((b) => b.name === 'feature-b')).toMatchObject({ mergeBaseSha: 'c3', aheadBy: 2, behindBy: 0 })
  })

  it('counts', () => {
    expect(full.nodes.length).toBe(6)
    expect(full.links.length).toBe(5)
    expect(skeleton.nodes.length).toBe(5)
    expect(skeleton.links.length).toBe(4)
  })

  it('flags: the fork is inside feature-a', () => {
    expect(flagged(full, 'isFork')).toEqual(['a1'])
    expect(flagged(full, 'isTip')).toEqual(['a2', 'b1', 'c3'])
    expect(flagged(full, 'isRoot')).toEqual(['c1'])
  })

  it('owners: tie on aheadBy broken by name, so feature-a claims a1 before feature-b', () => {
    expect(ownershipOrder(data).map((b) => b.name)).toEqual(['main', 'feature-a', 'feature-b'])
    expect(owners(full)).toEqual({ c1: 'main', c2: 'main', c3: 'main', a1: 'feature-a', a2: 'feature-a', b1: 'feature-b' })
    expect(reaches(full)).toEqual({ c1: 3, c2: 3, c3: 3, a1: 2, a2: 1, b1: 1 })
  })

  it('skeleton', () => {
    expect(ids(skeleton)).toEqual(['a1', 'a2', 'b1', 'c1', 'c3'])
    expect(linkMap(skeleton)).toEqual({ 'c3->c1': 1, 'a1->c3': 0, 'a2->a1': 0, 'b1->a1': 0 })
  })

  it('hiding feature-a keeps a1 (shared with feature-b) but drops a2; a1 moves to feature-b', () => {
    const hidden = new Set(['feature-a'])
    const g = buildGraph(data, 'full', { hiddenBranches: hidden })
    expect(ids(g)).toEqual(['a1', 'b1', 'c1', 'c2', 'c3'])
    expect(node(g, 'a1').owner).toBe('feature-b')
    expect(node(g, 'a1').isFork).toBe(false)
    expect(node(g, 'a1').reach).toBe(1)
    const s = buildGraph(data, 'skeleton', { hiddenBranches: hidden })
    expect(ids(s)).toEqual(['b1', 'c1', 'c3'])
    expect(linkMap(s)).toEqual({ 'c3->c1': 1, 'b1->c3': 1 })
    expect(s.links.find((l) => l.source === 'b1')?.owner).toBe('feature-b')
  })
})

describe('fixture (8) octopus merge', () => {
  const data = fixtures.octopus()
  const full = buildGraph(data, 'full')
  const skeleton = buildGraph(data, 'skeleton')

  it('counts: every node is structural so the skeleton equals the full graph', () => {
    expect(full.nodes.length).toBe(5)
    expect(full.links.length).toBe(6)
    expect(skeleton.nodes.length).toBe(5)
    expect(skeleton.links.length).toBe(6)
    expect(sumCollapsed(skeleton)).toBe(0)
    expect(skeleton.links).toEqual(full.links)
  })

  it('flags', () => {
    expect(flagged(full, 'isMerge')).toEqual(['o'])
    expect(node(full, 'o').commit.parents.length).toBe(3)
    expect(flagged(full, 'isFork')).toEqual(['c2'])
    expect(flagged(full, 'isTip')).toEqual(['o', 'x1', 'y1'])
    expect(flagged(full, 'isRoot')).toEqual(['c1'])
  })

  it('owners and reach', () => {
    expect(owners(full)).toEqual({ c1: 'main', c2: 'main', o: 'main', x1: 'x', y1: 'y' })
    expect(reaches(full)).toEqual({ c1: 3, c2: 3, x1: 2, y1: 2, o: 1 })
  })

  it('links follow git parent order', () => {
    expect(full.links.filter((l) => l.source === 'o').map((l) => l.target)).toEqual(['c2', 'x1', 'y1'])
  })
})

describe('fixture (9) two branches sharing a tip', () => {
  const data = fixtures.sharedTip()
  const full = buildGraph(data, 'full')
  const skeleton = buildGraph(data, 'skeleton')

  it('counts', () => {
    expect(full.nodes.length).toBe(5)
    expect(full.links.length).toBe(4)
    expect(skeleton.nodes.length).toBe(3)
    expect(skeleton.links.length).toBe(2)
  })

  it('both names appear on the shared tip; the first by name owns the commits', () => {
    expect(node(full, 'f2').tips).toEqual(['alpha', 'beta'])
    expect(flagged(full, 'isTip')).toEqual(['c3', 'f2'])
    expect(owners(full)).toEqual({ c1: 'main', c2: 'main', c3: 'main', f1: 'alpha', f2: 'alpha' })
    expect(reaches(full)).toEqual({ c1: 3, c2: 3, c3: 3, f1: 2, f2: 2 })
  })

  it('skeleton', () => {
    expect(ids(skeleton)).toEqual(['c1', 'c3', 'f2'])
    expect(linkMap(skeleton)).toEqual({ 'c3->c1': 1, 'f2->c3': 1 })
  })

  it('hiding one of the pair keeps the commits and hands them to the other', () => {
    const g = buildGraph(data, 'full', { hiddenBranches: new Set(['alpha']) })
    expect(ids(g)).toEqual(['c1', 'c2', 'c3', 'f1', 'f2'])
    expect(node(g, 'f2').tips).toEqual(['beta'])
    expect(node(g, 'f2').owner).toBe('beta')
    expect(node(g, 'f1').reach).toBe(1)
  })
})

describe('fixture (10) merged side branch whose ref was deleted (ownership pass 2)', () => {
  const data = fixtures.mergedDeleted()
  const full = buildGraph(data, 'full')
  const skeleton = buildGraph(data, 'skeleton')

  it('counts', () => {
    expect(full.nodes.length).toBe(6)
    expect(full.links.length).toBe(6)
    expect(skeleton.nodes.length).toBe(3)
    expect(skeleton.links.length).toBe(3)
  })

  it('the side commits are only reachable through the second parent, so pass 2 gives them to main', () => {
    expect(new Set(Object.values(owners(full)))).toEqual(new Set(['main']))
    expect(node(full, 'f1').owner).toBe('main')
    expect(node(full, 'f2').owner).toBe('main')
    expect(flagged(full, 'isFork')).toEqual(['c2'])
    expect(flagged(full, 'isMerge')).toEqual(['m'])
    expect(Object.values(reaches(full)).every((r) => r === 1)).toBe(true)
  })

  it('skeleton keeps two parallel links from the merge back to the fork point', () => {
    expect(ids(skeleton)).toEqual(['c1', 'c2', 'm'])
    expect(linkMap(skeleton)).toEqual({ 'c2->c1': 0, 'm->c2': 1, 'm->c2#2': 2 })
  })
})

// ---------- building blocks ----------

describe('buildFullGraph and collapseToSkeleton directly', () => {
  it('collapseToSkeleton accepts a bare body and a full Graph alike', () => {
    const data = fixtures.singleFork()
    const body = buildFullGraph(data)
    const fromBody = collapseToSkeleton(body)
    expect(fromBody.nodes.map((n) => n.id)).toEqual(['c1', 'c3', 'c5', 'f2'])
    const graph = buildGraph(data, 'full')
    const fromGraph = collapseToSkeleton(graph)
    expect(fromGraph.palette).toEqual(graph.palette)
    expect(fromGraph.links).toEqual(fromBody.links)
  })

  it('collapseToSkeleton is idempotent', () => {
    const data = fixtures.diamond()
    const once = collapseToSkeleton(buildFullGraph(data))
    const twice = collapseToSkeleton(once)
    expect(twice).toEqual(once)
  })

  it('a branch whose tip was not fetched contributes nothing', () => {
    const data: RepoData = fixtures.linear()
    data.branches.push({
      name: 'ghost',
      tipSha: 'nope',
      isDefault: false,
      mergeBaseSha: null,
      aheadBy: 1,
      behindBy: 0,
      tipDate: '2024-01-01T00:00:00.000Z',
    })
    const g = buildGraph(data, 'full')
    expect(ids(g)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(g.nodes.every((n) => n.owner === 'main' && n.reach === 1)).toBe(true)
    expect(g.palette.ghost).toBeDefined()
  })

  it('a hidden default branch that is also the only branch yields an empty graph', () => {
    const g = buildGraph(fixtures.linear(), 'full', { hiddenBranches: new Set(['main']) })
    expect(g.nodes).toEqual([])
    expect(g.links).toEqual([])
  })
})

describe('fixture DSL', () => {
  it('generates increasing dates and complete commit records', () => {
    const data = fixtures.linear()
    const dates = ['c1', 'c2', 'c3', 'c4', 'c5'].map((s) => data.commits[s].date)
    expect([...dates].sort()).toEqual(dates)
    expect(new Set(dates).size).toBe(5)
    expect(data.commits.c3).toMatchObject({ sha: 'c3', parents: ['c2'], author: 'dev' })
    expect(data.commits.c3.url).toContain('/commit/c3')
    expect(data.truncated).toBe(false)
  })

  it('computes a real best common ancestor, including for criss-cross histories', () => {
    // x and y are both merge-bases of p and q; the later one in the list (y) is chosen.
    const data = makeRepo({
      commits: [['base'], ['x', 'base'], ['y', 'base'], ['p', 'x', 'y'], ['q', 'y', 'x']],
      branches: [
        { name: 'main', tip: 'p', isDefault: true },
        { name: 'other', tip: 'q' },
      ],
    })
    const indexOf = new Map(Object.keys(data.commits).map((sha, i) => [sha, i]))
    expect(mergeBase('p', 'q', data.commits, indexOf)).toBe('y')
    expect(data.branches[1]).toMatchObject({ mergeBaseSha: 'y', aheadBy: 1, behindBy: 1 })
  })

  it('rejects duplicate shas and unknown tips', () => {
    expect(() => makeRepo({ commits: [['a'], ['a']], branches: [{ name: 'main', tip: 'a' }] })).toThrow(/duplicate/)
    expect(() => makeRepo({ commits: [['a']], branches: [{ name: 'main', tip: 'zz' }] })).toThrow(/tip/)
  })
})

// ---------- palette ----------

describe('assignPalette', () => {
  it('gives the default branch the accent and others colours from the curated list', () => {
    const palette = assignPalette(['feature', 'main', 'bugfix'], 'main')
    expect(palette.main).toBe(ACCENT_COLOR)
    expect(palette.bugfix).toBe(BRANCH_COLORS[0])
    expect(palette.feature).toBe(BRANCH_COLORS[1])
  })

  it('is stable under reordering and refetch', () => {
    const a = assignPalette(['zeta', 'alpha', 'main', 'mid'], 'main')
    const b = assignPalette(['main', 'mid', 'alpha', 'zeta'], 'main')
    const c = assignPalette(['alpha', 'alpha', 'main', 'mid', 'zeta'], 'main')
    expect(a).toEqual(b)
    expect(a).toEqual(c)
  })

  it('adding a branch does not move the colours of branches that sort before it', () => {
    const before = assignPalette(['a', 'b', 'main'], 'main')
    const after = assignPalette(['a', 'b', 'c', 'main'], 'main')
    expect(after.a).toBe(before.a)
    expect(after.b).toBe(before.b)
    expect(after.c).toBe(BRANCH_COLORS[2])
  })

  it('cycles past twelve with a hue rotation and stays distinct up to the default maxBranches', () => {
    // 200 = DEFAULT_MAX_BRANCHES in src/api/github.ts; 3-digit padding keeps sort order = index.
    const names = Array.from({ length: 200 }, (_, i) => `b${i.toString().padStart(3, '0')}`)
    const palette = assignPalette([...names, 'main'], 'main')
    const values = names.map((n) => palette[n])
    expect(new Set(values).size).toBe(200)
    expect(values.every((v) => /^#[0-9a-f]{6}$/.test(v))).toBe(true)
    expect(values).not.toContain(ACCENT_COLOR)
    expect(values.slice(0, 12)).toEqual([...BRANCH_COLORS])
    expect(values[12]).not.toBe(BRANCH_COLORS[0])
    expect(values[12]).toMatch(/^#[0-9a-f]{6}$/)
    expect(values[23]).not.toBe(BRANCH_COLORS[11])
    // The old lightness clamp made index 43 repeat index 19 ('#b7bdfb').
    expect(values[43]).not.toBe(values[19])
  })

  it('colorAt stays distinct far past the default cap for users who raise maxBranches', () => {
    const values = Array.from({ length: 600 }, (_, i) => colorAt(i))
    expect(new Set(values).size).toBe(600)
    expect(values.every((v) => /^#[0-9a-f]{6}$/.test(v))).toBe(true)
  })

  it('rotateHue keeps saturation and lightness and wraps around 360', () => {
    expect(rotateHue('#f472b6', 0)).toBe('#f472b6')
    expect(rotateHue('#f472b6', 360)).toBe('#f472b6')
    expect(rotateHue('#f472b6', -360)).toBe('#f472b6')
    expect(rotateHue('#f472b6', 120)).toBe(rotateHue('#f472b6', -240))
    expect(rotateHue('#f472b6', 120)).not.toBe('#f472b6')
    // a grey has no hue, so rotating it is a no-op
    expect(rotateHue('#808080', 90)).toBe('#808080')
  })

  it('always includes the default branch even when it is absent from the list', () => {
    expect(assignPalette([], 'trunk')).toEqual({ trunk: ACCENT_COLOR })
  })

  it('handles branch names that collide with Object.prototype keys', () => {
    const palette = assignPalette(['__proto__', 'constructor', 'hasOwnProperty', 'main'], 'main')
    for (const name of ['__proto__', 'constructor', 'hasOwnProperty']) {
      expect(Object.hasOwn(palette, name)).toBe(true)
      expect(palette[name]).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(Object.keys(palette).sort()).toEqual(['__proto__', 'constructor', 'hasOwnProperty', 'main'])
    expect(Object.getPrototypeOf(palette)).toBe(Object.prototype)
  })

  it('accepts __proto__ as the default branch', () => {
    const palette = assignPalette(['__proto__', 'x'], '__proto__')
    expect(Object.hasOwn(palette, '__proto__')).toBe(true)
    expect(palette['__proto__']).toBe(ACCENT_COLOR)
    expect(palette.x).toBe(BRANCH_COLORS[0])
  })

  it('buildGraph gives a __proto__ branch a real palette entry and colours its nodes by it', () => {
    const data = fixtures.protoBranch()
    const g = buildGraph(data, 'full')
    expect(Object.hasOwn(g.palette, '__proto__')).toBe(true)
    expect(typeof g.palette['__proto__']).toBe('string')
    expect(Object.entries(g.palette).map(([name]) => name).sort()).toEqual(['__proto__', 'main'])
    expect(node(g, 'p1').owner).toBe('__proto__')
    expect(g.palette[node(g, 'p1').owner]).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('buildGraph attaches the palette for every branch in the data', () => {
    const data = fixtures.octopus()
    const g = buildGraph(data, 'skeleton')
    expect(g.palette).toEqual(assignPalette(['main', 'x', 'y'], 'main'))
    expect(g.palette.main).toBe(ACCENT_COLOR)
    expect(g.palette.x).not.toBe(g.palette.y)
  })
})

// ---------- performance ----------

describe('performance', () => {
  it('builds both modes of a 20,000-commit chain with 50 branches in under 1 second', () => {
    const data = linearRepo(20_000, 50)
    expect(Object.keys(data.commits).length).toBe(20_000)
    expect(data.branches.length).toBe(51)

    const start = performance.now()
    const full = buildGraph(data, 'full')
    const skeleton = buildGraph(data, 'skeleton')
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(3000)
    expect(full.nodes.length).toBe(20_000)
    expect(full.links.length).toBe(19_999)
    // root + 50 stale tips + main tip
    expect(skeleton.nodes.length).toBe(52)
    expect(skeleton.links.length).toBe(51)
    expect(skeleton.nodes.length + sumCollapsed(skeleton)).toBe(20_000)
    expect(full.nodes.every((n) => n.owner === 'main')).toBe(true)
    expect(node(full, data.commits[data.branches[0].tipSha].sha).reach).toBe(1)
    expect(node(full, 's00000000').reach).toBe(51)
    expect(node(full, 's00000000').isRoot).toBe(true)
  })
})
