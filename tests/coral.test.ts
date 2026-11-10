import { describe, expect, it } from 'vitest'
import { buildGraph } from '../src/graph'
import { BLEACH_DAYS, FRESH_DAYS, TAPER_MAX, TAPER_MIN, coralLayout, type CoralOptions } from '../src/graph/coral'
import { CORAL_SPECIES, coralSpecies } from '../src/graph/coralSpecies'
import type { MetroLayout, MetroPoint, MetroRoute } from '../src/graph/metro'
import { buildMetroView } from '../src/components/metroView'
import type { Graph, RepoData } from '../src/types'
import { makeRepo, type BranchSpec, type CommitSpec } from './fixtures/repos'

// The coral layout (graph/coral): the repo grown upward as a sea fan, answered in metro's terms so
// the canvas draws it with the metro painter.

/**
 * main: m0..m9. Forks at three heights on it, a fork off a fork, a live branch merged back (m6 has
 * `a2` as its second parent), a merged branch whose ref is gone (m8 merges `g1`, which no branch
 * names), and a branch that merged main into itself (`s2` has m5 as its second parent).
 */
function reef(): RepoData {
  const commits: CommitSpec[] = [
    ['m0'],
    ['m1', 'm0'],
    ['a1', 'm1'],
    ['a2', 'a1'],
    ['m2', 'm1'],
    ['b1', 'm2'],
    ['b2', 'b1'],
    ['bb1', 'b1'],
    ['m3', 'm2'],
    ['m4', 'm3'],
    ['s1', 'm3'],
    ['m5', 'm4'],
    ['s2', 's1', 'm5'],
    ['c1', 'm5'],
    ['m6', 'm5', 'a2'],
    ['g1', 'm6'],
    ['m7', 'm6'],
    ['d1', 'm7'],
    ['m8', 'm7', 'g1'],
    ['m9', 'm8'],
  ]
  const branches: BranchSpec[] = [
    { name: 'main', tip: 'm9', isDefault: true },
    { name: 'feat/a', tip: 'a2' },
    { name: 'feat/b', tip: 'b2' },
    { name: 'feat/bb', tip: 'bb1' },
    { name: 'sync', tip: 's2' },
    { name: 'feat/c', tip: 'c1' },
    { name: 'feat/d', tip: 'd1' },
  ]
  return makeRepo({ commits, branches })
}

const lay = (data: RepoData, mode: 'skeleton' | 'full' = 'skeleton', opts: CoralOptions = {}): { graph: Graph; layout: MetroLayout } => {
  const graph = buildGraph(data, mode)
  return { graph, layout: coralLayout(graph, data, opts) }
}

/** an arm drifts at most this far off its ray, in lanes (SWAY_DRIFT, with room for rounding) */
const DRIFT = 0.14

const at = (layout: MetroLayout, id: string): MetroPoint => {
  const p = layout.positions.get(id)
  if (!p) throw new Error(`no position for ${id}`)
  return p
}

/** Whether two segments cross somewhere other than at an end they share. */
function crosses(a: MetroPoint, b: MetroPoint, c: MetroPoint, d: MetroPoint): boolean {
  const side = (p: MetroPoint, q: MetroPoint, r: MetroPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = side(c, d, a)
  const d2 = side(c, d, b)
  const d3 = side(a, b, c)
  const d4 = side(a, b, d)
  const eps = 1e-9
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
}

/** Every pair of growth routes (the tree: lines and arms, not the merge bridges) that cross. */
function crossings(layout: MetroLayout): string[] {
  const tree = layout.routes.filter((r) => r.kind !== 'cross')
  const out: string[] = []
  for (let i = 0; i < tree.length; i++) {
    for (let j = i + 1; j < tree.length; j++) {
      const p = tree[i].points
      const q = tree[j].points
      let hit = false
      for (let a = 1; a < p.length && !hit; a++) for (let b = 1; b < q.length && !hit; b++) hit = crosses(p[a - 1], p[a], q[b - 1], q[b])
      if (hit) out.push(`${tree[i].source}>${tree[i].target} x ${tree[j].source}>${tree[j].target}`)
    }
  }
  return out
}

const routeOf = (layout: MetroLayout, source: string, target: string): MetroRoute => {
  const route = layout.routes.find((r) => r.source === source && r.target === target)
  if (!route) throw new Error(`no route ${source} > ${target}`)
  return route
}

describe('coral layout', () => {
  it('answers in metro terms: a place for every commit and a route for every link, parent to child', () => {
    const { graph, layout } = lay(reef())
    expect(layout.positions.size).toBe(graph.nodes.length)
    expect(layout.routes).toHaveLength(graph.links.length)
    layout.routes.forEach((route, k) => {
      expect(route.linkIndex).toBe(k)
      expect(route.source).toBe(graph.links[k].source)
      expect(route.target).toBe(graph.links[k].target)
      const first = route.points[0]
      const last = route.points[route.points.length - 1]
      expect(first.x).toBeCloseTo(at(layout, route.target).x, 9)
      expect(first.y).toBeCloseTo(at(layout, route.target).y, 9)
      expect(last.x).toBeCloseTo(at(layout, route.source).x, 9)
      expect(last.y).toBeCloseTo(at(layout, route.source).y, 9)
    })
    expect(layout.stations.size).toBe(graph.nodes.length)
    expect(layout.fit).toBe('whole')
    expect(layout.mode).toBe('skeleton')
    for (const p of layout.positions.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
  })

  it('grows the default branch straight up from the seabed, as the stalk', () => {
    const { graph, layout } = lay(reef())
    const main = graph.nodes.filter((node) => node.owner === 'main' && node.id.startsWith('m')).map((node) => node.id)
    expect(main.length).toBeGreaterThan(4)
    // rooted dead centre, then swaying gently, never more than its drift
    expect(at(layout, 'm0').x).toBeCloseTo(0, 9)
    for (const id of main) expect(Math.abs(at(layout, id).x), id).toBeLessThanOrEqual(DRIFT)
    // newer is higher (y grows downward on the canvas)
    const ys = ['m0', 'm1', 'm2', 'm3', 'm5', 'm6', 'm7', 'm8', 'm9'].filter((id) => layout.positions.has(id)).map((id) => at(layout, id).y)
    for (let k = 1; k < ys.length; k++) expect(ys[k]).toBeLessThan(ys[k - 1])
    expect(layout.lanes.get('main')).toBe(0)
  })

  it('sends its forks out to both sides, each above the seabed and inside the fan', () => {
    const { graph, layout } = lay(reef())
    const tips = ['a2', 'b2', 'bb1', 's2', 'c1', 'd1'].map((id) => at(layout, id))
    expect(tips.some((p) => p.x < -0.5)).toBe(true)
    expect(tips.some((p) => p.x > 0.5)).toBe(true)
    const root = at(layout, 'm0')
    for (const node of graph.nodes) {
      const p = at(layout, node.id)
      expect(p.y, node.id).toBeLessThanOrEqual(root.y + 1e-9)
      // from the centre under the seabed, no ray leans further than the fan allows
      expect(Math.abs(Math.atan2(p.x, -p.y)), node.id).toBeLessThanOrEqual(CORAL_SPECIES.fan.fan + 0.05)
    }
    // a fork off a fork sits beyond its parent line's side of the stalk or between: it is not on the stalk
    expect(Math.abs(at(layout, 'bb1').x)).toBeGreaterThan(0.5)
  })

  it('never crosses two of its growth lines, and keeps the stations apart', () => {
    for (const mode of ['skeleton', 'full'] as const) {
      const { graph, layout } = lay(reef(), mode)
      expect(crossings(layout), mode).toEqual([])
      const pts = graph.nodes.map((node) => at(layout, node.id))
      let nearest = Infinity
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) nearest = Math.min(nearest, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y))
      // a full view's plain commits sit 0.65 apart along a line; two lines are a lane apart, less the drift of each
      expect(nearest, mode).toBeGreaterThanOrEqual(mode === 'full' ? 0.6 : 0.8)
    }
  })

  it('reaches further with a branch that forks lower', () => {
    // three one-commit branches off main, all dealt out by height: on either side the lower fork ends further from the stalk
    const data = makeRepo({
      commits: [['m0'], ['m1', 'm0'], ['x1', 'm1'], ['m2', 'm1'], ['y1', 'm2'], ['m3', 'm2'], ['z1', 'm3'], ['m4', 'm3'], ['w1', 'm4'], ['m5', 'm4']],
      branches: [
        { name: 'main', tip: 'm5', isDefault: true },
        { name: 'x', tip: 'x1' },
        { name: 'y', tip: 'y1' },
        { name: 'z', tip: 'z1' },
        { name: 'w', tip: 'w1' },
      ],
    })
    const { layout } = lay(data)
    const byHeight = ['x1', 'y1', 'z1', 'w1'].map((id) => at(layout, id))
    for (const side of [1, -1]) {
      const reach = byHeight.filter((p) => Math.sign(p.x) === side).map((p) => Math.abs(p.x))
      expect(reach.length).toBe(2)
      expect(reach[0]).toBeGreaterThan(reach[1])
    }
    expect(crossings(layout)).toEqual([])
  })

  it('draws a merge as a faint dashed bridge, a merged branch whose ref is gone as a faint arm, and live arms in full', () => {
    const { layout } = lay(reef())
    // m6 merges feat/a's tip
    expect(routeOf(layout, 'm6', 'a2')).toMatchObject({ kind: 'cross', dashed: true, muted: true, colorBranch: 'feat/a' })
    // sync merged main into itself
    expect(routeOf(layout, 's2', 'm5')).toMatchObject({ kind: 'cross', dashed: true })
    // g1 is on no branch's own line: it forks off main and is merged back by m8 (a plain commit, so
    // only the full view shows it; the skeleton folds it into m8's second link)
    const full = lay(reef(), 'full').layout
    expect(routeOf(full, 'g1', 'm6')).toMatchObject({ kind: 'fork', dashed: false, muted: true })
    expect(routeOf(full, 'm8', 'g1')).toMatchObject({ kind: 'cross', dashed: true })
    expect(routeOf(layout, 'm8', 'm6')).toBeDefined()
    // live branches
    expect(routeOf(full, 'a1', 'm1')).toMatchObject({ kind: 'fork', dashed: false, muted: false, colorBranch: 'feat/a' })
    expect(routeOf(full, 'a2', 'a1')).toMatchObject({ kind: 'line', dashed: false, muted: false })
    expect(routeOf(layout, 'a2', 'm1')).toMatchObject({ kind: 'fork', muted: false, hidden: 1 })
    expect(routeOf(layout, 'bb1', 'b1')).toMatchObject({ kind: 'fork', muted: false })
    expect(routeOf(layout, 'm9', 'm8')).toMatchObject({ kind: 'line', muted: false, lane: 0 })
  })

  it('names its stations as the metro map does', () => {
    const { layout } = lay(reef())
    expect(layout.stations.get('m0')).toBe('origin')
    expect(layout.stations.get('m1')).toBe('interchange') // feat/a forks here
    expect(layout.stations.get('a2')).toBe('interchange') // merged by m6
    expect(layout.stations.get('m6')).toBe('interchange')
    expect(layout.stations.get('d1')).toBe('terminus')
    const full = lay(reef(), 'full').layout
    expect(full.mode).toBe('full')
    expect(full.stations.get('m4')).toBe('commit')
  })

  it('marks hidden commits halfway along their link, with the count beside the line', () => {
    const data = makeRepo({
      commits: [['m0'], ['m1', 'm0'], ['m2', 'm1'], ['m3', 'm2'], ['m4', 'm3'], ['f1', 'm4'], ['f2', 'f1'], ['f3', 'f2'], ['f4', 'f3'], ['m5', 'm4']],
      branches: [
        { name: 'main', tip: 'm5', isDefault: true },
        { name: 'feature', tip: 'f4' },
      ],
    })
    const { graph, layout } = lay(data)
    const hiding = graph.links.map((link, k) => ({ link, k })).filter(({ link }) => link.collapsedCount > 0)
    expect(hiding.length).toBeGreaterThan(0)
    expect(layout.runs.map((run) => run.linkIndex).sort()).toEqual(hiding.map(({ k }) => k).sort())
    for (const run of layout.runs) {
      expect(run.hidden).toBe(graph.links[run.linkIndex].collapsedCount)
      expect(run.markerX).toBeDefined()
      expect(run.markerY).not.toBeNull()
      // beside the line, not on it
      expect(Math.hypot((run.markerX as number) - run.x, (run.markerY as number) - run.y)).toBeCloseTo(0.5, 6)
    }
    // the canvas gets the text's own place, and frames the whole coral
    const view = buildMetroView(layout, graph.nodes)
    expect(view.wholeFit).toBe(true)
    expect(view.badges).toHaveLength(layout.runs.length)
    for (const badge of view.badges) expect(badge.textX).toBeDefined()
  })

  it('leads a root whose history is cut off in from under the seabed', () => {
    const data = makeRepo({ commits: [['m1', 'gone'], ['m2', 'm1']], branches: [{ name: 'main', tip: 'm2', isDefault: true }] })
    const { layout } = lay(data)
    expect(layout.stubs).toHaveLength(1)
    const [from, to] = layout.stubs[0].points
    expect(to).toEqual(at(layout, 'm1'))
    expect(from.x).toBeCloseTo(0, 9)
    expect(from.y).toBeGreaterThan(to.y)
  })

  it('grows a species by the repo language: the same history, a different coral', () => {
    expect(coralSpecies('Rust').id).toBe('staghorn')
    expect(coralSpecies('c++').id).toBe('staghorn')
    expect(coralSpecies('Java').id).toBe('table')
    expect(coralSpecies('Python').id).toBe('bush')
    expect(coralSpecies('Jupyter Notebook').id).toBe('bush')
    for (const none of ['TypeScript', 'Brainfuck', '', null, undefined, 'constructor', '__proto__']) expect(coralSpecies(none).id).toBe('fan')
    const data = reef()
    const grown = (language: string | undefined) => lay({ ...data, language }).layout
    const width = (layout: MetroLayout) => layout.bounds.maxX - layout.bounds.minX
    const height = (layout: MetroLayout) => layout.bounds.maxY - layout.bounds.minY
    const [fan, staghorn, table, bush] = [grown(undefined), grown('Rust'), grown('Java'), grown('Python')]
    // staghorn: steep and tall; table: flat and wide; bush: short
    expect(height(staghorn) / width(staghorn)).toBeGreaterThan(height(fan) / width(fan))
    expect(height(table) / width(table)).toBeLessThan(height(fan) / width(fan))
    expect(height(bush)).toBeLessThan(height(staghorn))
    for (const layout of [fan, staghorn, table, bush]) {
      expect(crossings(layout)).toEqual([])
      // and none grows down past its own seabed
      const seabed = at(layout, 'm0').y
      for (const route of layout.routes) if (route.kind !== 'cross') for (const p of route.points) expect(p.y).toBeLessThanOrEqual(seabed + 0.3)
    }
    // and thick where the species is: the same link, by its girth
    const trunk = (layout: MetroLayout) => routeOf(layout, 'm1', 'm0').weight as number
    expect(trunk(bush) / trunk(staghorn)).toBeCloseTo(CORAL_SPECIES.bush.girth / CORAL_SPECIES.staghorn.girth, 9)
  })

  it('sways by the repo name: the same coral for the same repo, another for another, and only ever wider', () => {
    const data = reef()
    const a = lay({ ...data, owner: 'octo', repo: 'tracks' }).layout
    const again = lay({ ...data, owner: 'Octo', repo: 'Tracks' }).layout
    const b = lay({ ...data, owner: 'octo', repo: 'reef' }).layout
    expect(again).toEqual(a)
    expect([...b.positions.values()]).not.toEqual([...a.positions.values()])
    // the same arms on the same sides, in the same order across the fan: only their spacing and reach differ
    expect([...b.lanes]).toEqual([...a.lanes])
    for (const layout of [a, b]) expect(crossings(layout)).toEqual([])
  })

  it('tapers: a line is as thick as the history above it, heaviest at the base', () => {
    const { graph, layout } = lay(reef(), 'full')
    const weight = (source: string, target: string) => routeOf(layout, source, target).weight as number
    // up the stalk it only gets finer
    const stalk = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']
    for (let k = 2; k < stalk.length; k++) expect(weight(stalk[k], stalk[k - 1])).toBeLessThanOrEqual(weight(stalk[k - 1], stalk[k - 2]))
    // the first link carries all but the root: nearly the full width; a one-commit arm is the finest
    const girth = CORAL_SPECIES.fan.girth
    expect(weight('m1', 'm0')).toBeGreaterThan(girth * TAPER_MAX * 0.95)
    expect(weight('m1', 'm0')).toBeLessThanOrEqual(girth * TAPER_MAX)
    expect(weight('d1', 'm7')).toBeCloseTo(girth * (TAPER_MIN + (TAPER_MAX - TAPER_MIN) * Math.sqrt(1 / graph.nodes.length)), 9)
    // an arm with an arm of its own is thicker than either twig above their fork
    expect(weight('b1', 'm2')).toBeGreaterThan(weight('b2', 'b1'))
    expect(weight('b1', 'm2')).toBeGreaterThan(weight('bb1', 'b1'))
    for (const route of layout.routes) {
      if (route.kind === 'cross') expect(route.weight).toBeUndefined()
      else expect(route.weight).toBeGreaterThanOrEqual(girth * TAPER_MIN)
    }
    // hidden commits weigh as much as shown ones: the skeleton's stalk is as thick at the base
    const skeleton = lay(reef()).layout
    // (to a hair: a commit folded into a merge's second link is the one thing a skeleton does not weigh)
    expect(routeOf(skeleton, 'm1', 'm0').weight).toBeCloseTo(weight('m1', 'm0'), 1)
  })

  it('keeps a branch that moved lately alive, and bleaches one that has been quiet', () => {
    // fixture commits are an hour apart from 2024-01-01: by this clock every branch moved today
    const data = reef()
    const newest = Math.max(...Object.values(data.commits).map((c) => Date.parse(c.date)))
    const day = 86_400_000
    const fresh = lay(data, 'skeleton', { now: newest + day }).layout
    expect(fresh.bleach?.size).toBe(0)
    expect([...(fresh.polyps ?? [])].sort()).toEqual(['a2', 'b2', 'bb1', 'c1', 'd1', 'm9', 's2'])
    for (const route of fresh.routes) if (route.kind !== 'cross') expect(route.bleach).toBe(0)
    // left out, the clock is the newest commit: the same
    expect(lay(data).layout.polyps).toEqual(fresh.polyps)

    // half way to bleached, and no tip is live any more
    const half = lay(data, 'skeleton', { now: newest + ((FRESH_DAYS + BLEACH_DAYS) / 2) * day }).layout
    expect(half.polyps?.size).toBe(0)
    expect(half.bleach?.get('m9')).toBeGreaterThan(0.45)
    expect(half.bleach?.get('m9')).toBeLessThan(0.55)

    // a dead repo is bleached through
    const dead = lay(data, 'skeleton', { now: newest + 3 * 365 * day }).layout
    expect(dead.polyps?.size).toBe(0)
    for (const route of dead.routes) if (route.kind !== 'cross') expect(route.bleach).toBe(1)
    expect(new Set(dead.bleach?.values())).toEqual(new Set([1]))
  })

  it('keeps an arm alive while anything above it is: only the quiet twig bleaches', () => {
    const day = 86_400_000
    const iso = (t: number) => new Date(t).toISOString()
    const now = Date.UTC(2026, 10, 1)
    const data = makeRepo({
      commits: [['m0'], ['m1', 'm0'], ['old1', 'm1'], ['m2', 'm1'], ['arm1', 'm2'], ['twig1', 'arm1'], ['arm2', 'arm1'], ['m3', 'm2']],
      branches: [
        { name: 'main', tip: 'm3', isDefault: true },
        { name: 'old', tip: 'old1' },
        { name: 'arm', tip: 'arm2' },
        { name: 'twig', tip: 'twig1' },
      ],
    })
    // main and old went quiet two years ago; arm's tip moved yesterday, the twig on it a year and a half ago
    for (const commit of Object.values(data.commits)) commit.date = iso(now - 730 * day)
    data.commits.arm2.date = iso(now - day)
    data.commits.twig1.date = iso(now - 540 * day)
    const { layout } = lay(data, 'full', { now })
    expect([...(layout.polyps ?? [])]).toEqual(['arm2'])
    // the stalk carries a live arm, so it lives; the arm lives; the two quiet tips are bleached
    expect(layout.bleach?.has('m3')).toBe(false)
    expect(layout.bleach?.has('arm1')).toBe(false)
    expect(layout.bleach?.get('old1')).toBe(1)
    expect(layout.bleach?.get('twig1')).toBe(1)
    expect(routeOf(layout, 'twig1', 'arm1').bleach).toBe(1)
    expect(routeOf(layout, 'arm2', 'arm1').bleach).toBe(0)
    // the canvas gets both
    const view = buildMetroView(layout, buildGraph(data, 'full').nodes)
    expect(view.polyps?.has('arm2')).toBe(true)
    expect(view.bleach?.get('old1')).toBe(1)
    expect(view.routes.find((r) => r.source === 'twig1')?.bleach).toBe(1)
    expect(view.routes.find((r) => r.source === 'm1')?.weight).toBeGreaterThan(1)
  })

  it('stands a second root on the seabed beside the stalk', () => {
    const data = makeRepo({
      commits: [['m0'], ['m1', 'm0'], ['o0'], ['o1', 'o0']],
      branches: [
        { name: 'main', tip: 'm1', isDefault: true },
        { name: 'orphan', tip: 'o1' },
      ],
    })
    const { layout } = lay(data)
    expect(at(layout, 'm0').x).toBeCloseTo(0, 9)
    expect(Math.abs(at(layout, 'o0').x)).toBeGreaterThanOrEqual(CORAL_SPECIES.fan.spacing * (1 - CORAL_SPECIES.fan.bend) - 1e-6)
    expect(layout.stations.get('o0')).toBe('origin')
  })

  it('is the same for the same graph, and copes with nothing and with one commit', () => {
    const data = reef()
    const graph = buildGraph(data, 'skeleton')
    expect(coralLayout(graph, data)).toEqual(coralLayout(graph, data))
    const empty = coralLayout({ ...graph, nodes: [], links: [] }, data)
    expect(empty.positions.size).toBe(0)
    expect(empty.bounds).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 })
    const one = lay(makeRepo({ commits: [['m0']], branches: [{ name: 'main', tip: 'm0', isDefault: true }] })).layout
    expect(one.positions.size).toBe(1)
    expect(one.routes).toEqual([])
    // a link naming a commit that is not there is left out, as metro leaves it out
    const broken = coralLayout({ ...graph, links: [...graph.links, { source: 'nope', target: 'm0', collapsedCount: 0, owner: 'main' }] }, data)
    expect(broken.routes).toHaveLength(graph.links.length)
  })

  it('keeps its arms from crossing on any history, in every species', () => {
    const languages = ['TypeScript', 'Rust', 'Java', 'Python']
    // seeded histories: a trunk with branches off it and off each other, some merged back
    let seed = 20261109
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let trial = 0; trial < 40; trial++) {
      const commits: CommitSpec[] = [['c0']]
      const branches: BranchSpec[] = []
      /** open lines: their newest commit */
      const heads: string[] = ['c0']
      const total = 12 + rand(50)
      for (let k = 1; k < total; k++) {
        const sha = `c${k}`
        const roll = rand(10)
        if (roll < 5 || heads.length === 1) {
          // the trunk grows, now and then merging another line
          const parents = [heads[0]]
          if (roll === 0 && heads.length > 1) parents.push(heads[1 + rand(heads.length - 1)])
          commits.push([sha, ...parents])
          heads[0] = sha
        } else if (roll < 8) {
          // a new line off any commit so far
          commits.push([sha, `c${rand(k)}`])
          heads.push(sha)
        } else {
          // a line other than the trunk grows
          const h = 1 + rand(heads.length - 1)
          commits.push([sha, heads[h]])
          heads[h] = sha
        }
      }
      heads.forEach((tip, h) => branches.push({ name: h === 0 ? 'main' : `b${h}`, tip, isDefault: h === 0 }))
      const data = { ...makeRepo({ commits, branches }), repo: `trial-${trial}`, language: languages[trial % languages.length] }
      for (const mode of ['skeleton', 'full'] as const) {
        const { graph, layout } = lay(data, mode)
        expect(layout.routes, `trial ${trial} ${mode}`).toHaveLength(graph.links.length)
        expect(crossings(layout), `trial ${trial} ${mode}`).toEqual([])
      }
    }
  })
})
