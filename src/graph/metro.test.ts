import { describe, expect, it } from 'vitest'
import type { Branch, Commit, Graph, GraphLink, RepoData, ViewMode } from '../types'
import { buildGraph } from './index'
import {
  laneRunColumns,
  metroLayout,
  shortBranchName,
  skeletonRunColumns,
  uniqueShortNames,
  type MetroLayout,
  type MetroOptions,
} from './metro'
import { fixtures, makeRepo } from '../../tests/fixtures/repos'
import type { FixtureName } from '../../tests/fixtures/repos'

// ---------- helpers ----------

const EPS = 1e-6

function layout(
  data: RepoData,
  mode: ViewMode,
  opts: MetroOptions = {},
  hidden?: string[],
): { graph: Graph; L: MetroLayout } {
  const graph = buildGraph(data, mode, hidden ? { hiddenBranches: new Set(hidden) } : {})
  return { graph, L: metroLayout(graph, data, opts) }
}

function pos(L: MetroLayout, id: string): { x: number; y: number } {
  const p = L.positions.get(id)
  if (!p) throw new Error(`no position for ${id}`)
  return p
}

/** Every structural promise the layout makes, checked on one graph. */
function expectValid(graph: Graph, L: MetroLayout): void {
  // every node placed, finite, and no two on one spot
  const spots = new Set<string>()
  for (const node of graph.nodes) {
    const p = pos(L, node.id)
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    const key = `${Math.round(p.x * 1000)}|${Math.round(p.y * 1000)}`
    expect(spots.has(key), `two nodes at ${key}`).toBe(false)
    spots.add(key)
    expect(L.stations.has(node.id)).toBe(true)
  }
  // exactly one route per link, in linkIndex order
  expect(L.routes.length).toBe(graph.links.length)
  L.routes.forEach((r, k) => {
    expect(r.linkIndex).toBe(k)
    expect(r.source).toBe(graph.links[k].source)
    expect(r.target).toBe(graph.links[k].target)
  })
  // per-lane node index for the "runs through a foreign node" check
  const byLane = new Map<number, Array<[number, string]>>()
  for (const [id, p] of L.positions) {
    const list = byLane.get(p.y)
    if (list) list.push([p.x, id])
    else byLane.set(p.y, [[p.x, id]])
  }
  for (const r of L.routes) {
    const P = pos(L, r.target)
    const C = pos(L, r.source)
    const first = r.points[0]
    const last = r.points[r.points.length - 1]
    expect(Math.abs(first.x - P.x) < EPS && Math.abs(first.y - P.y) < EPS, 'route starts at the parent').toBe(true)
    expect(Math.abs(last.x - C.x) < EPS && Math.abs(last.y - C.y) < EPS, 'route ends at the child').toBe(true)
    expect(C.x, 'child right of parent').toBeGreaterThan(P.x + EPS)
    for (let k = 0; k + 1 < r.points.length; k += 1) {
      const a = r.points[k]
      const b = r.points[k + 1]
      const dx = b.x - a.x
      const dy = Math.abs(b.y - a.y)
      expect(dx, 'no backwards segment').toBeGreaterThanOrEqual(-EPS)
      const octilinear = Math.abs(dx) < EPS || dy < EPS || Math.abs(Math.abs(dx) - dy) < EPS
      expect(octilinear, `octilinear segment ${dx}x${dy}`).toBe(true)
      // no segment runs within 0.15 lane of a node other than its own two ends
      const len2 = dx * dx + dy * dy
      if (len2 < EPS) continue
      for (const [y, list] of byLane) {
        if (y < Math.min(a.y, b.y) - 0.2 || y > Math.max(a.y, b.y) + 0.2) continue
        for (const [x, id] of list) {
          if (id === r.source || id === r.target) continue
          if (x < Math.min(a.x, b.x) - 0.2 || x > Math.max(a.x, b.x) + 0.2) continue
          const t = ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / len2
          if (t <= 0.02 || t >= 0.98) continue
          const d = Math.hypot(a.x + t * (b.x - a.x) - x, a.y + t * (b.y - a.y) - y)
          expect(d, `route ${r.linkIndex} runs through ${id}`).toBeGreaterThanOrEqual(0.15)
        }
      }
    }
  }
  // every visible tip has a lane and a label; labels lie inside boundsWithLabels
  for (const node of graph.nodes) for (const tip of node.tips) expect(L.lanes.has(tip)).toBe(true)
  const tipped = graph.nodes.filter((nd) => nd.tips.length > 0)
  expect(L.labels.length).toBe(tipped.length)
  const bl = L.boundsWithLabels
  for (const label of L.labels) {
    expect(label.text.length).toBeGreaterThan(0)
    expect(label.tx).toBeGreaterThanOrEqual(bl.minX - EPS)
    expect(label.tx).toBeLessThanOrEqual(bl.maxX + EPS)
  }
  const b = L.bounds
  for (const p of L.positions.values()) {
    expect(p.x).toBeGreaterThanOrEqual(b.minX - EPS)
    expect(p.x).toBeLessThanOrEqual(b.maxX + EPS)
    expect(p.y).toBeGreaterThanOrEqual(b.minY - EPS)
    expect(p.y).toBeLessThanOrEqual(b.maxY + EPS)
  }
  expect(bl.minX).toBeLessThanOrEqual(b.minX + EPS)
  expect(bl.maxX).toBeGreaterThanOrEqual(b.maxX - EPS)
}

function serialise(L: MetroLayout): string {
  return JSON.stringify({
    positions: [...L.positions],
    lanes: [...L.lanes],
    hints: [...L.laneHints],
    routes: L.routes,
    stations: [...L.stations],
    labels: L.labels,
    runs: L.runs,
    stubs: L.stubs,
    bounds: L.bounds,
    boundsWithLabels: L.boundsWithLabels,
  })
}

/** Deterministic PRNG for the stress repos. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A random but realistic repo: a truncated trunk, branches forking from the trunk or from other
 * branches, merges back (ref kept or deleted), sync merges of main into branches, octopus merges,
 * shared tips, old truncated release lines and a fast-forwarded stale tip.
 */
function stress(seed: number, trunkLen = 500, branchCount = 200): RepoData {
  const R = rng(seed)
  const commits: Record<string, Commit> = {}
  let t = 0
  let id = 0
  const mk = (parents: string[]): string => {
    const sha = (id++).toString(16).padStart(8, '0') + 'x'.repeat(32)
    t += 1 + Math.floor(R() * 5)
    commits[sha] = { sha, parents, message: sha, author: 'a', date: new Date(Date.UTC(2024, 0, 1) + t * 60000).toISOString(), url: '' }
    return sha
  }
  const ref = (name: string, tipSha: string, aheadBy = 0): Branch => ({
    name,
    tipSha,
    isDefault: false,
    mergeBaseSha: null,
    aheadBy,
    behindBy: 0,
    tipDate: '',
  })
  const trunk: string[] = [mk(['deadbeef'.repeat(5)])]
  const branches: Branch[] = []
  const live: Array<{ name: string; head: string }> = []
  const truncatedAt: string[] = [trunk[0]]
  let bn = 0
  for (let k = 0; k < 6; k += 1) {
    let h = mk(['cafebabe'.repeat(4) + String(k).padStart(8, '0')])
    truncatedAt.push(h)
    const len = 2 + Math.floor(R() * 6)
    for (let i = 0; i < len; i += 1) h = mk([h])
    branches.push(ref(`release/v${k}`, h, len + 1))
  }
  for (let i = 1; i < trunkLen; i += 1) {
    const prev = trunk[trunk.length - 1]
    if (R() < branchCount / trunkLen && bn < branchCount) {
      const base = live.length > 0 && R() < 0.2 ? live[Math.floor(R() * live.length)].head : prev
      live.push({ name: `feat/b${bn++}-${Math.floor(R() * 1e6).toString(36)}`, head: mk([base]) })
    }
    for (const b of live) if (R() < 0.15) b.head = mk([b.head])
    if (live.length > 0 && R() < 0.05) {
      const b = live[Math.floor(R() * live.length)]
      b.head = mk([b.head, prev]) // sync merge
    }
    if (live.length > 0 && R() < 0.25) {
      const k = Math.floor(R() * live.length)
      const b = live[k]
      if (R() < 0.08 && live.length > 2) {
        const k2 = (k + 1) % live.length
        const k3 = (k + 2) % live.length
        trunk.push(mk([prev, b.head, live[k2].head, live[k3].head])) // octopus
        for (const kk of [k, k2, k3]) if (R() < 0.5) branches.push(ref(live[kk].name, live[kk].head))
        const drop = new Set([b.name, live[k2].name, live[k3].name])
        for (let j = live.length - 1; j >= 0; j -= 1) if (drop.has(live[j].name)) live.splice(j, 1)
        continue
      }
      trunk.push(mk([prev, b.head]))
      if (R() < 0.5) branches.push(ref(b.name, b.head)) // ref kept, else deleted
      live.splice(k, 1)
      continue
    }
    trunk.push(mk([prev]))
  }
  for (const b of live) branches.push(ref(b.name, b.head, 1 + Math.floor(R() * 30)))
  const head = trunk[trunk.length - 1]
  branches.push(ref('staging', head), ref('release', head))
  if (branches.length > 8) branches.push(ref(branches[7].name + '-copy', branches[7].tipSha, branches[7].aheadBy))
  branches.push(ref('old-ff', trunk[Math.floor(trunk.length / 2)]))
  branches.unshift({ ...ref('main', head), isDefault: true })
  for (const b of branches) b.tipDate = commits[b.tipSha].date
  const seen = new Set<string>()
  const unique = branches.filter((b) => (seen.has(b.name) ? false : (seen.add(b.name), true)))
  return { owner: 's', repo: `stress${seed}`, defaultBranch: 'main', branches: unique, commits, truncated: true, truncatedAt }
}

// ---------- invariants on every fixture ----------

describe('metroLayout invariants', () => {
  const names = Object.keys(fixtures) as FixtureName[]
  for (const name of names) {
    for (const mode of ['skeleton', 'full'] as const) {
      it(`${name} (${mode})`, () => {
        const { graph, L } = layout(fixtures[name](), mode)
        expectValid(graph, L)
        expect(L.lanes.get(fixtures[name]().defaultBranch)).toBe(0)
      })
    }
  }

  for (const seed of [1, 7]) {
    for (const mode of ['skeleton', 'full'] as const) {
      it(`stress repo ${seed} (${mode}), all visible, default hidden and half hidden`, () => {
        const data = stress(seed, 300, 80)
        const names = data.branches.map((b) => b.name)
        for (const hidden of [undefined, [data.defaultBranch], names.filter((_, i) => i % 2 === 1)]) {
          const { graph, L } = layout(data, mode, {}, hidden)
          expectValid(graph, L)
        }
      })
    }
  }

  it('empty graph: nothing visible', () => {
    const data = fixtures.diamond()
    const { graph, L } = layout(data, 'skeleton', {}, data.branches.map((b) => b.name))
    expect(graph.nodes).toHaveLength(0)
    expect(L.positions.size).toBe(0)
    expect(L.routes).toHaveLength(0)
    expect(L.labels).toHaveLength(0)
    expect(L.lanes.size).toBe(0)
    expect(L.bounds).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 })
    expect(L.columns).toBe(0)
  })

  it('a single commit', () => {
    const data = makeRepo({ commits: [['c1']], branches: [{ name: 'main', tip: 'c1', isDefault: true }] })
    const { graph, L } = layout(data, 'full')
    expectValid(graph, L)
    expect(pos(L, 'c1')).toEqual({ x: 0, y: 0 })
  })
})

// ---------- structure ----------

describe('metroLayout structure', () => {
  it('a branch gets its own lane; the trunk is lane 0', () => {
    const { L } = layout(fixtures.singleFork(), 'full')
    expect(L.lanes.get('main')).toBe(0)
    expect(L.lanes.get('feature')).not.toBe(0)
    expect(pos(L, 'f1').y).toBe(pos(L, 'f2').y)
    expect(pos(L, 'c5').y).toBe(0)
    const fork = L.routes.find((r) => r.source === 'f1' && r.target === 'c3')
    expect(fork?.kind).toBe('fork')
    expect(fork?.colorBranch).toBe('feature')
  })

  it('a merge keeps the merged branch colour until it joins', () => {
    const { L } = layout(fixtures.merge(), 'full')
    const merge = L.routes.find((r) => r.source === 'm' && r.target === 'f2')
    expect(merge?.kind).toBe('merge')
    expect(merge?.colorBranch).toBe('feature')
    expect(L.stations.get('m')).toBe('interchange')
  })

  it('octopus merge: every parent link routed, side lines on distinct lanes', () => {
    const { graph, L } = layout(fixtures.octopus(), 'full')
    expectValid(graph, L)
    const x = L.lanes.get('x') as number
    const y = L.lanes.get('y') as number
    expect(x).not.toBe(0)
    expect(y).not.toBe(0)
    expect(x).not.toBe(y)
    const into = L.routes.filter((r) => r.source === 'o')
    expect(into.map((r) => r.kind).sort()).toEqual(['line', 'merge', 'merge'])
    // two lane changes entering o on different sides or fanned: never the same polyline
    const merges = into.filter((r) => r.kind === 'merge')
    expect(JSON.stringify(merges[0].points)).not.toBe(JSON.stringify(merges[1].points))
  })

  it('shared tips on one commit get one label and one lane', () => {
    const { L } = layout(fixtures.sharedTip(), 'skeleton')
    expect(L.lanes.get('alpha')).toBe(L.lanes.get('beta'))
    const label = L.labels.find((l) => l.nodeId === 'f2')
    expect(label?.branches).toEqual(['alpha', 'beta'])
    expect(label?.text).toBe('alpha +1')
    expect(L.labels.filter((l) => l.nodeId === 'f2')).toHaveLength(1)
  })

  it('nested forks: a branch off another branch mid-line gets its own lane', () => {
    const { graph, L } = layout(fixtures.nested(), 'full')
    expectValid(graph, L)
    const a = L.lanes.get('feature-a') as number
    const b = L.lanes.get('feature-b') as number
    expect(a).not.toBe(0)
    expect(b).not.toBe(0)
    expect(b).not.toBe(a)
    expect(L.routes.find((r) => r.source === 'b1' && r.target === 'a1')?.colorBranch).toBe('feature-b')
  })

  it("a branch forked off another branch's tip continues on its lane", () => {
    const data = makeRepo({
      commits: [['c1'], ['c2', 'c1'], ['a1', 'c2'], ['a2', 'a1'], ['c3', 'c2'], ['b1', 'a2'], ['b2', 'b1']],
      branches: [
        { name: 'main', tip: 'c3', isDefault: true },
        { name: 'stack-1', tip: 'a2' },
        { name: 'stack-2', tip: 'b2' },
      ],
    })
    for (const mode of ['skeleton', 'full'] as const) {
      const { graph, L } = layout(data, mode)
      expectValid(graph, L)
      expect(L.lanes.get('stack-1')).not.toBe(0)
      expect(L.lanes.get('stack-2')).toBe(L.lanes.get('stack-1'))
      // the stacked tip is a stop on the line, not a terminus
      expect(L.stations.get('a2')).not.toBe('terminus')
      expect(L.stations.get('b2')).toBe('terminus')
    }
  })

  it('sync merges (main into a live branch) are dashed cross links', () => {
    const data = makeRepo({
      commits: [
        ['c1'],
        ['f1', 'c1'],
        ['c2', 'c1'],
        ['c3', 'c2'],
        ['f2', 'f1', 'c3'], // sync merge of main into feature
        ['c4', 'c3'],
        ['f3', 'f2'],
      ],
      branches: [
        { name: 'main', tip: 'c4', isDefault: true },
        { name: 'feature', tip: 'f3' },
      ],
    })
    for (const mode of ['skeleton', 'full'] as const) {
      const { graph, L } = layout(data, mode)
      expectValid(graph, L)
      const sync = L.routes.find((r) => r.source === 'f2' && r.target === 'c3')
      expect(sync?.kind).toBe('cross')
      expect(sync?.dashed).toBe(true)
      expect(sync?.muted).toBe(false)
      expect(sync?.colorBranch).toBe('main')
    }
  })

  it('truncated roots get a stub and an origin station; a flagged commit with its parent present does not', () => {
    const { graph, L } = layout(fixtures.truncated(), 'full')
    expectValid(graph, L)
    expect(L.stubs.map((s) => s.nodeId).sort()).toEqual(['c2', 'f1'])
    for (const stub of L.stubs) {
      const p = pos(L, stub.nodeId)
      expect(stub.points[1]).toEqual(p)
      expect(stub.points[0].y).toBe(p.y)
      expect(stub.points[0].x).toBeLessThan(p.x)
    }
    expect(L.stations.get('c2')).toBe('origin')
    expect(L.stations.get('f1')).toBe('origin')
    // the stub of a later line never overlaps an earlier line on the same lane
    for (const stub of L.stubs) {
      for (const r of L.routes) {
        if (r.source === stub.nodeId || r.target === stub.nodeId) continue
        for (const q of r.points) {
          const onStub = Math.abs(q.y - stub.points[0].y) < EPS && q.x > stub.points[0].x + EPS && q.x < stub.points[1].x - EPS
          expect(onStub).toBe(false)
        }
      }
    }
  })

  it('the real initial commit is an origin without a stub', () => {
    const { L } = layout(fixtures.linear(), 'full')
    expect(L.stubs).toHaveLength(0)
    expect(L.stations.get('c1')).toBe('origin')
    expect(L.stations.get('c5')).toBe('terminus')
  })

  it('a deleted merged branch gets a muted side lane; its commits sit on it in full view', () => {
    // skeleton: m -> c2 twice, its first parent hiding c3 and its second parent hiding f2, f1
    const data = fixtures.mergedDeleted()
    const sk = layout(data, 'skeleton')
    expectValid(sk.graph, sk.L)
    const pair = sk.L.routes.filter((r) => r.source === 'm' && r.target === 'c2')
    expect(pair.map((r) => [r.kind, r.hidden, r.muted])).toEqual([
      ['line', 1, false],
      ['side', 2, true],
    ])
    const side = pair[1]
    expect(side?.kind).toBe('side')
    expect(side?.muted).toBe(true)
    expect(side?.hidden).toBe(2)
    expect(side?.lane).not.toBe(0)
    expect(sk.L.runs.map((r) => [r.linkIndex, r.hidden])).toContainEqual([side?.linkIndex, 2])

    const full = layout(data, 'full')
    expectValid(full.graph, full.L)
    const lane = side?.lane as number
    expect(pos(full.L, 'f1').y).toBe(lane)
    expect(pos(full.L, 'f2').y).toBe(lane)
    expect(pos(full.L, 'f1').x).toBeLessThan(pos(full.L, 'f2').x)
    for (const [s, t] of [['f1', 'c2'], ['f2', 'f1'], ['m', 'f2']]) {
      const r = full.L.routes.find((x) => x.source === s && x.target === t)
      expect(r?.muted).toBe(true)
    }
    expect(full.L.stations.get('f1')).toBe('commit')
    expect(full.L.runs).toHaveLength(0)
  })

  it('duplicate skeleton link pairs: a line and a muted side route, each routed once', () => {
    // m's first parent is c1 and its second-parent run f2 -> f1 also ends at c1, so the skeleton
    // holds two m -> c1 links
    const data = makeRepo({
      commits: [['c1'], ['f1', 'c1'], ['f2', 'f1'], ['m', 'c1', 'f2']],
      branches: [{ name: 'main', tip: 'm', isDefault: true }],
    })
    const { graph, L } = layout(data, 'skeleton')
    expect(graph.links.map((l) => `${l.source}>${l.target}`)).toEqual(['m>c1', 'm>c1'])
    expectValid(graph, L)
    expect(L.routes[0].linkIndex).toBe(0)
    expect(L.routes[0].kind).toBe('line')
    expect(L.routes[0].muted).toBe(false)
    expect(L.routes[1].linkIndex).toBe(1)
    expect(L.routes[1].kind).toBe('side')
    expect(L.routes[1].muted).toBe(true)
    expect(JSON.stringify(L.routes[0].points)).not.toBe(JSON.stringify(L.routes[1].points))
  })

  it('default branch hidden: the old trunk stays on one line (spine rule)', () => {
    // feat-long forked early and has many commits of its own; feat-late forked from the newest
    // trunk commit and carries the old trunk. The spine must be feat-late.
    const data = makeRepo({
      commits: [
        ['c1'],
        ['c2', 'c1'],
        ['l1', 'c2'],
        ['l2', 'l1'],
        ['l3', 'l2'],
        ['l4', 'l3'],
        ['l5', 'l4'],
        ['l6', 'l5'],
        ['c3', 'c2'],
        ['a1', 'c3'],
        ['c4', 'c3'],
        ['c5', 'c4'],
        ['z1', 'c5'],
        ['c6', 'c5'],
      ],
      branches: [
        { name: 'main', tip: 'c6', isDefault: true },
        { name: 'feat-long', tip: 'l6' },
        { name: 'feat-mid', tip: 'a1' },
        { name: 'feat-late', tip: 'z1' },
      ],
    })
    for (const mode of ['skeleton', 'full'] as const) {
      const { graph, L } = layout(data, mode, {}, ['main'])
      expectValid(graph, L)
      expect(L.lanes.get('feat-late')).toBe(0)
      for (const id of ['c1', 'c2', 'c3', 'c5']) if (L.positions.has(id)) expect(pos(L, id).y).toBe(0)
      expect(L.lanes.get('feat-long')).not.toBe(0)
      expect(L.lanes.get('feat-mid')).not.toBe(0)
      // the spine is coloured by the app's ownership, not by the spine branch
      const owners = new Map(graph.nodes.map((nd) => [nd.id, nd.owner]))
      for (const r of L.routes) if (r.kind === 'line' && pos(L, r.source).y === 0) expect(r.colorBranch).toBe(owners.get(r.source))
    }
  })

  it('station kinds: interchanges where lines meet, commits in full view', () => {
    const { L } = layout(fixtures.diamond(), 'full')
    expect(L.stations.get('c3')).toBe('interchange')
    expect(L.stations.get('m')).toBe('interchange')
    expect(L.stations.get('b2')).toBe('terminus')
    const sk = layout(fixtures.singleFork(), 'full')
    expect(sk.L.stations.get('c4')).toBe('commit')
    expect(sk.L.stations.get('f1')).toBe('commit')
  })
})

// ---------- views, determinism, stability ----------

describe('metroLayout across views and runs', () => {
  it('is deterministic', () => {
    const data = stress(3, 200, 60)
    for (const mode of ['skeleton', 'full'] as const) {
      const g = buildGraph(data, mode)
      expect(serialise(metroLayout(g, data))).toBe(serialise(metroLayout(g, data)))
    }
  })

  it('accepts link ends swapped for node objects (as react-force-graph does)', () => {
    const data = stress(5, 200, 60)
    for (const mode of ['skeleton', 'full'] as const) {
      const g = buildGraph(data, mode)
      const byId = new Map(g.nodes.map((nd) => [nd.id, nd] as const))
      const swapped: Graph = {
        ...g,
        links: g.links.map((l) => ({ ...l, source: byId.get(l.source), target: byId.get(l.target) }) as unknown as GraphLink),
      }
      expect(serialise(metroLayout(swapped, data))).toBe(serialise(metroLayout(g, data)))
    }
  })

  it('lanes are identical in skeleton and full view; stations keep their lane', () => {
    const datas: RepoData[] = [...(Object.keys(fixtures) as FixtureName[]).map((k) => fixtures[k]()), stress(2, 300, 80), stress(9, 400, 120)]
    for (const data of datas) {
      for (const hidden of [undefined, [data.defaultBranch]]) {
        const sk = layout(data, 'skeleton', {}, hidden)
        const full = layout(data, 'full', {}, hidden)
        expect([...full.L.lanes]).toEqual([...sk.L.lanes])
        for (const node of sk.graph.nodes) expect(pos(full.L, node.id).y).toBe(pos(sk.L, node.id).y)
      }
    }
  })

  it('full view threads plain commits onto lanes between their stations', () => {
    const data = stress(4, 300, 80)
    const full = layout(data, 'full')
    const sk = layout(data, 'skeleton')
    const stations = new Set(sk.graph.nodes.map((nd) => nd.id))
    for (const node of full.graph.nodes) {
      const p = pos(full.L, node.id)
      if (stations.has(node.id)) continue
      expect(full.L.stations.get(node.id)).toBe('commit')
      expect(Number.isInteger(p.y)).toBe(true)
    }
    expect(full.L.mode).toBe('full')
    expect(sk.L.mode).toBe('skeleton')
  })

  it('prevLanes keeps the other lines where they were when a branch is hidden', () => {
    const data = stress(11, 400, 120)
    const base = layout(data, 'skeleton')
    const names = data.branches.map((b) => b.name).filter((nm) => nm !== data.defaultBranch).sort()
    let kept = 0
    let keptWithout = 0
    let total = 0
    for (const victim of names.filter((_, i) => i % 5 === 0)) {
      const withHints = layout(data, 'skeleton', { prevLanes: base.L.laneHints }, [victim])
      const without = layout(data, 'skeleton', {}, [victim])
      expectValid(withHints.graph, withHints.L)
      for (const [b, lane] of base.L.lanes) {
        if (b === victim) continue
        total += 1
        if (withHints.L.lanes.get(b) === lane) kept += 1
        if (without.L.lanes.get(b) === lane) keptWithout += 1
      }
    }
    expect(kept / total).toBeGreaterThanOrEqual(0.9)
    expect(kept).toBeGreaterThanOrEqual(keptWithout)
  })

  it('prevLanes stops one displaced line from pushing every later line to the other side', () => {
    // short branches fork from main and merge back one after another, alternating above and below
    const commits: Array<[string, ...string[]]> = [['c0']]
    const branches: Array<{ name: string; tip: string; isDefault?: boolean }> = []
    let prev = 'c0'
    for (let k = 0; k < 8; k += 1) {
      commits.push([`b${k}a`, prev], [`b${k}b`, `b${k}a`], [`c${k}x`, prev], [`m${k}`, `c${k}x`, `b${k}b`])
      branches.push({ name: `b${k}`, tip: `b${k}b` })
      prev = `m${k}`
    }
    branches.unshift({ name: 'main', tip: prev, isDefault: true })
    const data = makeRepo({ commits, branches })
    const base = layout(data, 'skeleton')
    for (let k = 0; k < 8; k += 1) {
      const hidden = layout(data, 'skeleton', { prevLanes: base.L.laneHints }, [`b${k}`])
      for (const [b, lane] of base.L.lanes) if (b !== `b${k}`) expect(hidden.L.lanes.get(b), `${b} after hiding b${k}`).toBe(lane)
    }
  })
})

// ---------- labels and names ----------

describe('labels', () => {
  it('shortBranchName keeps short names, the prefix and the distinctive tail', () => {
    expect(shortBranchName('main', 30)).toBe('main')
    const s = shortBranchName('feat/register-more-references-to-safe-modules', 30)
    expect(s).toHaveLength(30)
    expect(s.startsWith('feat/…')).toBe(true)
    expect(s.endsWith('to-safe-modules')).toBe(true)
    expect(shortBranchName('abcdefghijklmnopqrstuvwxyz', 10)).toHaveLength(10)
  })

  it('uniqueShortNames lengthens names that would shorten alike', () => {
    const a = 'feat/register-more-references-to-safe-modules'
    const b = 'feat/register-references-in-html-to-safe-modules'
    const m = uniqueShortNames([a, b], 22)
    expect(m.get(a)).not.toBe(m.get(b))
  })

  it('labels: false skips the labels and changes nothing else that is drawn', () => {
    for (const mode of ['skeleton', 'full'] as const) {
      const data = stress(6, 300, 100)
      const { L: on } = layout(data, mode)
      const { L: off } = layout(data, mode, { labels: false })
      expect(on.labels.length).toBeGreaterThan(0)
      expect(off.labels).toEqual([])
      expect([...off.positions]).toEqual([...on.positions])
      expect(off.routes).toEqual(on.routes)
      expect([...off.stations]).toEqual([...on.stations])
      expect(off.bounds).toEqual(on.bounds)
      expect(off.runs.map((r) => [r.linkIndex, r.hidden, r.x, r.y, r.room])).toEqual(on.runs.map((r) => [r.linkIndex, r.hidden, r.x, r.y, r.room]))
      // the marker spots still keep clear of each other and are inside boundsWithLabels
      for (const r of off.runs) if (r.markerY !== null) expect(r.markerY).toBeGreaterThanOrEqual(off.boundsWithLabels.minY - EPS)
    }
  })

  it('label length is capped at 30 characters with a middle ellipsis', () => {
    const long = 'feature/an-extremely-long-branch-name-that-goes-on-and-on'
    const data = makeRepo({
      commits: [['c1'], ['c2', 'c1'], ['f1', 'c1']],
      branches: [
        { name: 'main', tip: 'c2', isDefault: true },
        { name: long, tip: 'f1' },
      ],
    })
    const { L } = layout(data, 'skeleton')
    const label = L.labels.find((l) => l.nodeId === 'f1')
    expect(label?.branches).toEqual([long])
    expect(label?.text.length).toBeLessThanOrEqual(30)
    expect(label?.text).toContain('…')
  })

  it('labels never overlap each other', () => {
    const { L } = layout(stress(6, 300, 100), 'skeleton')
    const f = 0.375
    const boxes = L.labels.map((l) => {
      const r = (l.angle * Math.PI) / 180
      const ux = Math.cos(r)
      const uy = Math.sin(r)
      return { cx: l.tx + (ux * l.width) / 2 + uy * 0.25 * f, cy: l.ty + (uy * l.width) / 2 - ux * 0.25 * f, ux, uy, hw: l.width / 2, hh: 0.5 * f, crowded: l.crowded }
    })
    const overlap = (a: (typeof boxes)[number], b: (typeof boxes)[number]): boolean => {
      const axes = [a.ux, a.uy, -a.uy, a.ux, b.ux, b.uy, -b.uy, b.ux]
      for (let k = 0; k < 8; k += 2) {
        const ax = axes[k]
        const ay = axes[k + 1]
        const ra = a.hw * Math.abs(a.ux * ax + a.uy * ay) + a.hh * Math.abs(-a.uy * ax + a.ux * ay)
        const rb = b.hw * Math.abs(b.ux * ax + b.uy * ay) + b.hh * Math.abs(-b.uy * ax + b.ux * ay)
        if (Math.abs((b.cx - a.cx) * ax + (b.cy - a.cy) * ay) > ra + rb - 1e-6) return false
      }
      return true
    }
    for (let i = 0; i < boxes.length; i += 1)
      for (let j = i + 1; j < boxes.length; j += 1) if (!boxes[i].crowded && !boxes[j].crowded) expect(overlap(boxes[i], boxes[j])).toBe(false)
  })

  it('run markers count the hidden commits of skeleton links', () => {
    const { graph, L } = layout(stress(8, 200, 40), 'skeleton')
    for (const run of L.runs) {
      expect(run.hidden).toBe(graph.links[run.linkIndex].collapsedCount)
      expect(run.hidden).toBeGreaterThan(0)
      if (run.markerY !== null) expect(Math.abs(run.markerY - run.y)).toBeGreaterThan(0.2)
    }
    expect(L.runs.length).toBe(graph.links.filter((l) => l.collapsedCount > 0).length)
  })

  it('run lengths are compressed', () => {
    expect(skeletonRunColumns(0)).toBe(1)
    expect(skeletonRunColumns(5)).toBeLessThan(skeletonRunColumns(100))
    expect(laneRunColumns(0)).toBe(1)
    expect(laneRunColumns(4)).toBe(2)
    expect(laneRunColumns(400)).toBe(18)
  })
})

// ---------- performance ----------

describe('performance', () => {
  // Typically 15-40 ms per layout on a desktop (2845 nodes in full view). The bound is a guard
  // against accidental quadratic work, loose enough for a busy CI machine.
  it('lays out a 500-commit trunk with 200 branches quickly in both views', () => {
    const data = stress(42, 500, 200)
    for (const mode of ['skeleton', 'full'] as const) {
      const g = buildGraph(data, mode)
      metroLayout(g, data) // warm up
      let best = Number.POSITIVE_INFINITY
      for (let k = 0; k < 5; k += 1) {
        const start = performance.now()
        metroLayout(g, data)
        best = Math.min(best, performance.now() - start)
      }
      expect(best).toBeLessThan(150)
    }
  })
})
