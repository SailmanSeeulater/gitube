import { describe, expect, it } from 'vitest'
import { buildGraph } from '../graph'
import { metroLayout } from '../graph/metro'
import { fixtures } from '../../tests/fixtures/repos'
import {
  METRO_SCALE,
  buildMetroView,
  easeInOutCubic,
  isLinkDimmed,
  mergeLaneHints,
  metroFitTransform,
  metroOptionsFor,
  metroStationRadius,
  routeLayer,
} from './metroView'

const PAD = { left: 10, right: 10, top: 10, bottom: 10 }

describe('buildMetroView', () => {
  for (const [name, make] of Object.entries(fixtures)) {
    for (const mode of ['skeleton', 'full'] as const) {
      it(`scales and centres the layout: ${name} (${mode})`, () => {
        const data = make()
        const graph = buildGraph(data, mode)
        const layout = metroLayout(graph, data, metroOptionsFor(mode))
        const view = buildMetroView(layout)
        const b = layout.bounds
        const cx = (b.minX + b.maxX) / 2
        const cy = (b.minY + b.maxY) / 2
        // every node has a target, scaled from its layout position around the bounds centre
        expect(view.targets.size).toBe(graph.nodes.length)
        for (const [id, p] of layout.positions) {
          const t = view.targets.get(id)!
          expect(t.x).toBeCloseTo((p.x - cx) * METRO_SCALE)
          expect(t.y).toBeCloseTo((p.y - cy) * METRO_SCALE)
        }
        // one draw route per link, sorted by layer, each ending on its two stations
        expect(view.routes).toHaveLength(graph.links.length)
        expect(new Set(view.routes.map((r) => r.linkIndex)).size).toBe(graph.links.length)
        for (let k = 1; k < view.routes.length; k++) {
          const a = view.routes[k - 1]
          const c = view.routes[k]
          expect(a.layer < c.layer || (a.layer === c.layer && a.linkIndex < c.linkIndex)).toBe(true)
        }
        for (const r of view.routes) {
          const link = graph.links[r.linkIndex]
          expect(r.source).toBe(link.source)
          expect(r.target).toBe(link.target)
          const n = r.pts.length
          const parent = view.targets.get(r.target)!
          const child = view.targets.get(r.source)!
          expect(r.pts[0]).toBeCloseTo(parent.x)
          expect(r.pts[1]).toBeCloseTo(parent.y)
          expect(r.pts[n - 2]).toBeCloseTo(child.x)
          expect(r.pts[n - 1]).toBeCloseTo(child.y)
        }
        // the bbox holds every target
        for (const p of view.targets.values()) {
          expect(p.x).toBeGreaterThanOrEqual(view.bbox.x[0] - 1e-9)
          expect(p.x).toBeLessThanOrEqual(view.bbox.x[1] + 1e-9)
          expect(p.y).toBeGreaterThanOrEqual(view.bbox.y[0] - 1e-9)
          expect(p.y).toBeLessThanOrEqual(view.bbox.y[1] + 1e-9)
        }
        // run markers only in skeleton view, one per collapsed link
        const collapsed = graph.links.filter((l) => l.collapsedCount > 0).length
        expect(view.badges.length).toBe(mode === 'skeleton' ? collapsed : 0)
        for (const badge of view.badges) expect(badge.text).toBe(`+${graph.links[badge.linkIndex].collapsedCount}`)
      })
    }
  }

  it('an empty graph gives an empty view with a zero bbox', () => {
    const d = fixtures.diamond()
    const graph = buildGraph(d, 'skeleton', { hiddenBranches: new Set(d.branches.map((b) => b.name)) })
    const view = buildMetroView(metroLayout(graph, d))
    expect(view.targets.size).toBe(0)
    expect(view.routes).toHaveLength(0)
    expect(view.bbox).toEqual({ x: [0, 0], y: [0, 0] })
  })
})

describe('metro helpers', () => {
  it('routeLayer puts muted and dashed routes first and plain lines last', () => {
    expect(routeLayer({ muted: true, dashed: false, kind: 'line' })).toBe(0)
    expect(routeLayer({ muted: false, dashed: true, kind: 'cross' })).toBe(0)
    expect(routeLayer({ muted: false, dashed: false, kind: 'fork' })).toBe(1)
    expect(routeLayer({ muted: false, dashed: false, kind: 'line' })).toBe(2)
  })

  it('metroOptionsFor packs full view tighter and passes lane hints through', () => {
    expect(metroOptionsFor('skeleton').colGap).toBe(1)
    expect(metroOptionsFor('full').colGap).toBeLessThan(1)
    expect(metroOptionsFor('skeleton').prevLanes).toBeUndefined()
    const hints = new Map([['a', 1]])
    expect(metroOptionsFor('full', hints).prevLanes).toBe(hints)
  })

  it('mergeLaneHints keeps old lanes and lets the newest layout win', () => {
    const merged = mergeLaneHints(
      new Map([
        ['hidden', 3],
        ['moved', 1],
      ]),
      new Map([
        ['moved', -1],
        ['new', 2],
      ]),
    )
    expect([...merged].sort()).toEqual([
      ['hidden', 3],
      ['moved', -1],
      ['new', 2],
    ])
    expect([...mergeLaneHints(null, new Map([['a', 0]]))]).toEqual([['a', 0]])
  })

  it('hide then show with remembered lanes puts every line back where it was', () => {
    const data = Object.values(fixtures)
      .map((f) => f())
      .sort((a, b) => b.branches.length - a.branches.length)[0]
    const victim = data.branches.find((b) => !b.isDefault)!.name
    const first = metroLayout(buildGraph(data, 'skeleton'), data)
    let hints = mergeLaneHints(null, first.laneHints)
    const hidden = metroLayout(buildGraph(data, 'skeleton', { hiddenBranches: new Set([victim]) }), data, { prevLanes: hints })
    hints = mergeLaneHints(hints, hidden.laneHints)
    for (const [branch, lane] of hidden.lanes) expect(lane, branch).toBe(first.lanes.get(branch))
    const back = metroLayout(buildGraph(data, 'skeleton'), data, { prevLanes: hints })
    expect([...back.lanes].sort()).toEqual([...first.lanes].sort())
  })

  it('station radii: tips largest, plain commits smallest', () => {
    expect(metroStationRadius('stop', true)).toBe(6)
    expect(metroStationRadius('interchange', false)).toBe(5)
    expect(metroStationRadius('origin', false)).toBe(4)
    expect(metroStationRadius('stop', false)).toBe(3.5)
    expect(metroStationRadius(undefined, false)).toBe(3.5)
    expect(metroStationRadius('commit', false)).toBe(2)
  })

  it('easeInOutCubic runs 0 to 1, symmetric, clamped', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1)
    expect(easeInOutCubic(-1)).toBe(0)
    expect(easeInOutCubic(2)).toBe(1)
  })

  it('isLinkDimmed: lit when touching the hovered node and inside the selected reach', () => {
    expect(isLinkDimmed('a', 'b', null, null)).toBe(false)
    expect(isLinkDimmed('a', 'b', 'a', null)).toBe(false)
    expect(isLinkDimmed('a', 'b', 'c', null)).toBe(true)
    expect(isLinkDimmed('a', 'b', null, new Set(['a', 'b']))).toBe(false)
    expect(isLinkDimmed('a', 'b', null, new Set(['a']))).toBe(true)
  })
})

describe('metroFitTransform', () => {
  const size = { width: 520, height: 320 }

  it('fits a small map whole and centred', () => {
    const { k, cx, cy } = metroFitTransform({ x: [-100, 100], y: [-20, 20] }, size, PAD, 2.5, 0.4)
    expect(k).toBeCloseTo(500 / 200)
    expect(cx).toBeCloseTo(0)
    expect(cy).toBeCloseTo(0)
  })

  it('caps the zoom of a tiny map', () => {
    expect(metroFitTransform({ x: [0, 4], y: [0, 0] }, size, PAD, 2.5, 0.4).k).toBe(2.5)
  })

  it('does not shrink a long map below minZoom; shows its newest (right) end instead', () => {
    const bbox = { x: [-5000, 5000], y: [-50, 50] }
    const { k, cx } = metroFitTransform(bbox, size, PAD, 2.5, 0.4)
    expect(k).toBe(0.4)
    // the right edge of the map lands at the right padding
    const screenRight = (5000 - cx) * k + size.width / 2
    expect(screenRight).toBeCloseTo(size.width - PAD.right)
  })

  it('a map too tall for minZoom is fitted to its height', () => {
    const { k } = metroFitTransform({ x: [-5000, 5000], y: [-1000, 1000] }, size, PAD, 2.5, 0.4)
    expect(k).toBeCloseTo(300 / 2000)
  })
})
