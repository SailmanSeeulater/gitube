import { afterEach, describe, expect, it } from 'vitest'
import { buildGraph } from '../src/graph'
import { buildBranchReach, selectedReach, staleBranchNames } from '../src/components/gardenUtils'
import { useGardenStore } from '../src/store/useGardenStore'
import { fixtures } from './fixtures/repos'

/**
 * Select a branch in the panel, then narrow the stale filter: the branch leaves the graph
 * (its tip loses its label) and has no reach entry any more. The garden must then isolate
 * nothing, not dim everything. This mirrors the exact expression Garden.tsx uses for dimming.
 */
describe('selected branch removed by the stale filter', () => {
  const data = fixtures.stale() // main@c5 (default), old@c3, every date in 2024
  const now = Date.parse('2026-10-09T12:00:00Z')

  afterEach(() => {
    useGardenStore.getState().resetForNewRepo()
    useGardenStore.getState().setStaleDays(0)
  })

  it('the store keeps the selection across a stale-filter change (App prunes it from the hidden set)', () => {
    const store = useGardenStore.getState()
    store.toggleSelectedBranch('old')
    store.setStaleDays(30)
    expect(useGardenStore.getState().selectedBranch).toBe('old')
    expect(staleBranchNames(data.branches, useGardenStore.getState().staleDays, now)).toContain('old')
    // hideBranch (the eye toggle) does clear it, which is why only the stale path needs App.
    store.hideBranch('old')
    expect(useGardenStore.getState().selectedBranch).toBeNull()
  })

  it('with the filter off, the selection isolates exactly the branch lineage', () => {
    const graph = buildGraph(data, 'full', { hiddenBranches: new Set(staleBranchNames(data.branches, 0, now)) })
    const reach = buildBranchReach(graph.nodes, graph.links)
    const lit = selectedReach(reach, 'old')
    expect(lit).not.toBeNull()
    expect([...(lit ?? [])].sort()).toEqual(['c1', 'c2', 'c3'])
    const dimmed = graph.nodes.filter((n) => lit !== null && !lit.has(n.id)).map((n) => n.id)
    expect(dimmed.sort()).toEqual(['c4', 'c5'])
  })

  it('with the stale filter hiding the selected branch, nothing is isolated (not everything dimmed)', () => {
    const hidden = new Set(staleBranchNames(data.branches, 30, now))
    expect(hidden.has('old')).toBe(true)
    const graph = buildGraph(data, 'full', { hiddenBranches: hidden })
    // The commits are still drawn (they are on main); only the tip label is gone.
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(graph.nodes.find((n) => n.id === 'c3')?.tips).toEqual([])
    const reach = buildBranchReach(graph.nodes, graph.links)
    expect(reach.has('old')).toBe(false)
    const lit = selectedReach(reach, 'old')
    expect(lit).toBeNull()
    // Garden dims a node when `reachSet !== null && !reachSet.has(id)`; null dims nothing.
    const dimmedNodes = graph.nodes.filter((n) => lit !== null && !lit.has(n.id))
    const dimmedLinks = graph.links.filter((l) => lit !== null && !(lit.has(l.source) && lit.has(l.target)))
    expect(dimmedNodes).toHaveLength(0)
    expect(dimmedLinks).toHaveLength(0)
  })

  it('a selected branch whose tipSha is not among the commits also isolates nothing', () => {
    const broken = {
      ...data,
      branches: data.branches.map((b) => (b.name === 'old' ? { ...b, tipSha: 'not-fetched' } : b)),
    }
    const graph = buildGraph(broken, 'full')
    const reach = buildBranchReach(graph.nodes, graph.links)
    expect(reach.has('old')).toBe(false)
    expect(selectedReach(reach, 'old')).toBeNull()
  })
})
