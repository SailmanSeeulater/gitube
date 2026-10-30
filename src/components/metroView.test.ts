import { describe, expect, it } from 'vitest'
import { buildGraph } from '../graph'
import { metroLayout } from '../graph/metro'
import { fixtures } from '../../tests/fixtures/repos'
import { loadReplay } from '../../tests/fixtures/replay'
import { THEMES } from '../theme/themes'
import type { RepoData, ViewMode } from '../types'
import { FIT_MAX_ZOOM, FIT_PAD, buildLabelSpecs, rankLabels } from './graphUtils'
import { LabelPlacer } from './labelPlacement'
import {
  METRO_BADGE_MAX_PX,
  METRO_BADGE_MIN_PX,
  METRO_LINE_WIDTH,
  METRO_MIN_LINE_PX,
  METRO_MIN_ZOOM,
  METRO_SCALE,
  RUN_BAR_GAP_PX,
  RUN_BAR_HALF_PX,
  RUN_BAR_HALO_PX,
  RUN_BAR_OVERHANG_PX,
  RUN_BAR_PX,
  buildMetroView,
  easeInOutCubic,
  isLinkDimmed,
  mergeLaneHints,
  metroBadgeFontPx,
  metroCommitGlyph,
  metroFitTransform,
  metroOptionsFor,
  metroRevealTransform,
  metroRunMarker,
  metroStationRadius,
  routeLayer,
  strokeRunBars,
  type RunBarContext,
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
        // every plain commit knows how close its lane neighbours are
        for (const [id, kind] of view.stations) {
          if (kind !== 'commit') continue
          const p = view.targets.get(id)!
          let nearest = Infinity
          for (const [other, q] of view.targets) if (other !== id && Math.abs(q.y - p.y) < 1e-6) nearest = Math.min(nearest, Math.abs(q.x - p.x))
          if (Number.isFinite(nearest)) expect(view.commitGap.get(id)).toBeCloseTo(nearest)
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
    // the names are placed on screen, not by the layout
    expect(metroOptionsFor('skeleton').labels).toBe(false)
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

  it('a plain commit is a bead that reaches past its line on both sides at every zoom', () => {
    for (const k of [0.2, 12 / 28, METRO_MIN_ZOOM, 1, FIT_MAX_ZOOM]) {
      const px = 1 / k
      const linePx = Math.max(METRO_LINE_WIDTH, METRO_MIN_LINE_PX * px) * k
      const { r, core } = metroCommitGlyph(px)
      // >= 1 px of the bead's ring on each side of the line, and a dark core inside it
      expect(2 * r * k - linePx, `k=${k}`).toBeGreaterThanOrEqual(2 - 1e-9)
      expect(core).toBeGreaterThan(0)
      expect(core).toBeLessThan(r)
      expect(metroStationRadius('commit', false, px)).toBe(r)
    }
  })

  it('beads closer than their size shrink apart once that leaves 2 px; denser runs keep their size', () => {
    const gap = 2.5 // graph units, as dense as recorded repos get
    // zoomed in: 0.45 gap is 2.8 px, so neighbours (2r <= 0.9 gap) never touch
    const zin = metroCommitGlyph(1 / FIT_MAX_ZOOM, gap)
    expect(2 * zin.r).toBeLessThanOrEqual(0.9 * gap + 1e-9)
    expect(zin.r * FIT_MAX_ZOOM).toBeGreaterThanOrEqual(2 - 1e-9)
    // the default camera: too dense to separate, the bead keeps its full size (a beaded band)
    expect(metroCommitGlyph(1 / METRO_MIN_ZOOM, gap)).toEqual(metroCommitGlyph(1 / METRO_MIN_ZOOM))
    // a lone commit is not shrunk
    expect(metroCommitGlyph(1, 100)).toEqual(metroCommitGlyph(1))
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

  it('isLinkDimmed: a lit set (a selected contributor) replaces the reach rule, hover still applies', () => {
    const lit = new Set(['a>b'])
    expect(isLinkDimmed('a', 'b', null, new Set<string>(), lit)).toBe(false)
    expect(isLinkDimmed('b', 'c', null, new Set(['b', 'c']), lit)).toBe(true)
    expect(isLinkDimmed('a', 'b', 'z', null, lit)).toBe(true)
    expect(isLinkDimmed('a', 'b', 'a', null, lit)).toBe(false)
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

describe('the default metro camera (RepoGraph: FIT_PAD, METRO_MIN_ZOOM)', () => {
  // 1366x768 window with the side panel open
  const canvas = { width: 1042, height: 768 }
  const expectReadable = (bbox: { x: [number, number]; y: [number, number] }) => {
    const { k, cx } = metroFitTransform(bbox, canvas, FIT_PAD, FIT_MAX_ZOOM, METRO_MIN_ZOOM)
    // lanes stay far enough apart for the 12 px names between them
    expect(k * METRO_SCALE).toBeGreaterThanOrEqual(24 - 1e-9)
    // the newest (right) end sits at the right padding
    expect((bbox.x[1] - cx) * k + canvas.width / 2).toBeCloseTo(canvas.width - FIT_PAD.right)
  }

  it('keeps a long 14:1 map at 24 px between lanes, newest end in view', () => {
    expectReadable({ x: [-980, 980], y: [-70, 70] })
  })

  const mordi = loadReplay('SailmanSeeulater', 'Mordi')
  it.skipIf(!mordi)('the recorded Mordi map opens at 24 px between lanes (replay cache)', () => {
    const data = mordi!
    const graph = buildGraph(data, 'skeleton')
    expectReadable(buildMetroView(metroLayout(graph, data, metroOptionsFor('skeleton'))).bbox)
  })
})

// ---------------- labels on a settled metro map: off other lines and station rings ----------------

/** Length of the segment inside the box (Liang-Barsky), 0 when it misses. */
function clippedLength(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = bx - ax
  const dy = by - ay
  let t0 = 0
  let t1 = 1
  const p = [-dx, dx, -dy, dy]
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay]
  for (let s = 0; s < 4; s++) {
    if (p[s] === 0) {
      if (q[s] < 0) return 0
      continue
    }
    const t = q[s] / p[s]
    if (p[s] < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 >= t1) return 0
  }
  return (t1 - t0) * Math.hypot(dx, dy)
}

/**
 * RepoGraph's metro label pipeline without the canvas: the default camera at a 1366x768 window with
 * the panel open, nodes projected as useLabelPlacer does, 400 still frames of the real placer.
 */
function settleMetroLabels(data: RepoData, mode: ViewMode) {
  const W = 1042
  const H = 768
  const measure = (t: string) => t.length * 6.6 // ~12 px UI font
  const graph = buildGraph(data, mode)
  const view = buildMetroView(metroLayout(graph, data, metroOptionsFor(mode)), graph.nodes)
  const cam = metroFitTransform(view.bbox, { width: W, height: H }, FIT_PAD, FIT_MAX_ZOOM, METRO_MIN_ZOOM)
  const k = cam.k
  const tx = W / 2 - cam.cx * k
  const ty = H / 2 - cam.cy * k
  const nodes = graph.nodes
  const N = nodes.length
  const sx = new Float32Array(N)
  const sy = new Float32Array(N)
  const sr = new Float32Array(N)
  const hardNode = new Uint8Array(N)
  nodes.forEach((node, j) => {
    const p = view.targets.get(node.id)!
    sx[j] = p.x * k + tx
    sy[j] = p.y * k + ty
    const kind = view.stations.get(node.id)
    sr[j] = metroStationRadius(kind, node.isTip, 1 / k) * k
    hardNode[j] = kind !== 'commit' ? 1 : 0
  })
  const lineSegs = Float32Array.from(view.segs, (v, q) => v * k + (q % 2 === 0 ? tx : ty))
  const halfPx = Math.max(METRO_MIN_LINE_PX / 2, (METRO_LINE_WIDTH / 2) * k)
  const { specs, meta } = buildLabelSpecs(nodes, data.defaultBranch, measure)
  const placer = new LabelPlacer(specs, { measure })
  const rank = rankLabels(meta, { reach: null, searchHits: new Set(), selectedTip: -1 })
  placer.setOrder(rank.order, rank.pinned, rank.softPinned)
  const frame = {
    sx,
    sy,
    sr,
    speed: new Float32Array(N),
    nodeCount: N,
    width: W,
    height: H,
    dtMs: 1000 / 60,
    cameraMoving: false,
    lineSegs,
    lineSrc: view.segSrc,
    lineTgt: view.segTgt,
    lineCount: view.segSrc.length,
    lineHalfPx: halfPx,
    hardNode,
  }
  for (let f = 0; f < 400; f++) placer.update(frame)

  const pinned = new Set(rank.pinned)
  const offenders: string[] = []
  let shown = 0
  for (let i = 0; i < placer.n; i++) {
    if (!placer.shown[i] || placer.alpha[i] < 0.5) continue
    shown++
    if (pinned.has(i)) continue
    const j = specs[i].node
    // the text's ink, not the padded box, widened by half the line width
    const x0 = placer.x0[i] + 2 - halfPx
    const y0 = placer.y0[i] + 3 - halfPx
    const x1 = placer.x0[i] + placer.w[i] - 2 + halfPx
    const y1 = placer.y0[i] + placer.h[i] - 3 + halfPx
    let other = 0
    for (let s = 0; s < view.segSrc.length; s++) {
      if (view.segSrc[s] === j || view.segTgt[s] === j) continue
      other += clippedLength(lineSegs[4 * s], lineSegs[4 * s + 1], lineSegs[4 * s + 2], lineSegs[4 * s + 3], x0, y0, x1, y1)
    }
    let rings = 0
    for (let m = 0; m < N; m++) {
      if (m === j || !hardNode[m]) continue
      const cx = Math.min(Math.max(sx[m], placer.x0[i]), placer.x0[i] + placer.w[i])
      const cy = Math.min(Math.max(sy[m], placer.y0[i]), placer.y0[i] + placer.h[i])
      if (Math.hypot(cx - sx[m], cy - sy[m]) < sr[m] - 0.25) rings++
    }
    if (other > 4 || rings > 0) offenders.push(`${placer.textOf(i)}: ${other.toFixed(0)} px of other lines, ${rings} station(s)`)
  }
  return { shown, labels: placer.n, offenders }
}

describe('metro labels keep off other lines and station rings', () => {
  const biggest = Object.entries(fixtures)
    .map(([name, make]) => [name, make()] as const)
    .sort((a, b) => b[1].branches.length - a[1].branches.length)[0]
  for (const mode of ['skeleton', 'full'] as const) {
    it(`fixture ${biggest[0]} (${mode})`, () => {
      const r = settleMetroLabels(biggest[1], mode)
      expect(r.shown).toBeGreaterThan(0)
      expect(r.offenders).toEqual([])
    })
  }
  for (const [owner, repo] of [
    ['SailmanSeeulater', 'Mordi'],
    ['expressjs', 'express'],
  ] as const) {
    const data = loadReplay(owner, repo)
    for (const mode of ['skeleton', 'full'] as const) {
      it.skipIf(!data)(`${owner}/${repo} (${mode}, replay cache)`, () => {
        const r = settleMetroLabels(data!, mode)
        expect(r.shown).toBeGreaterThan(0)
        expect(r.offenders).toEqual([])
      })
    }
  }
})

// ---------------- run markers ('+N' hidden commits) ----------------

/** Distance from (x, y) to a flat x, y polyline. */
function distToPolyline(pts: Float64Array, x: number, y: number): number {
  let best = Infinity
  for (let k = 2; k + 1 < pts.length; k += 2) {
    const ax = pts[k - 2]
    const ay = pts[k - 1]
    const dx = pts[k] - ax
    const dy = pts[k + 1] - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y))
  }
  return best
}

describe('metro run markers', () => {
  const cases: [string, RepoData][] = Object.entries(fixtures).map(([name, make]) => [name, make()])
  for (const [owner, repo] of [
    ['SailmanSeeulater', 'Mordi'],
    ['expressjs', 'express'],
    ['vitejs', 'vite'],
  ] as const) {
    const data = loadReplay(owner, repo)
    if (data) cases.push([`${owner}/${repo}`, data])
  }

  for (const [name, data] of cases) {
    it(`sit on their line, with the text in the layout's free spot: ${name}`, () => {
      const graph = buildGraph(data, 'skeleton')
      const layout = metroLayout(graph, data, metroOptionsFor('skeleton'))
      const view = buildMetroView(layout, graph.nodes)
      const b = layout.bounds
      const cy = (b.minY + b.maxY) / 2
      const runs = new Map(layout.runs.map((r) => [r.linkIndex, r]))
      const routes = new Map(view.routes.map((r) => [r.linkIndex, r]))
      expect(view.badges.length).toBe(layout.runs.filter((r) => r.hidden > 0).length)
      for (const badge of view.badges) {
        const run = runs.get(badge.linkIndex)!
        // the bars cross the drawn line
        expect(distToPolyline(routes.get(badge.linkIndex)!.pts, badge.x, badge.y)).toBeLessThan(1e-6)
        expect(Math.hypot(badge.dx, badge.dy)).toBeCloseTo(1)
        // the text goes where the layout reserved room for it, or nowhere
        if (run.markerY === null) expect(badge.textY).toBeNull()
        else expect(badge.textY).toBeCloseTo((run.markerY - cy) * METRO_SCALE)
        expect(badge.room).toBeCloseTo(run.room * METRO_SCALE)
        expect(badge.hidden).toBe(run.hidden)
      }

      // at the default camera and when zoomed in, every run is marked (bars at least), and the
      // '+N' texts cover no station and no other text
      const fit = metroFitTransform(view.bbox, { width: 1042, height: 768 }, FIT_PAD, FIT_MAX_ZOOM, METRO_MIN_ZOOM).k
      for (const k of [fit, 1, FIT_MAX_ZOOM]) {
        const font = metroBadgeFontPx(k)
        const boxes: number[][] = []
        for (const badge of view.badges) {
          const mark = metroRunMarker(badge, k)
          expect(['badge', 'tick']).toContain(mark)
          if (mark !== 'badge') continue
          // screen px: ~0.57 em per glyph of '+' and digits
          const hw = (badge.text.length * 0.57 * font) / 2
          const hh = font / 2
          boxes.push([badge.x * k - hw, badge.textY! * k - hh, badge.x * k + hw, badge.textY! * k + hh])
        }
        for (const [id, p] of view.targets) {
          const node = graph.nodes.find((n) => n.id === id)!
          const r = metroStationRadius(view.stations.get(id), node.isTip) * k
          for (const [x0, y0, x1, y1] of boxes) {
            const nx = Math.min(Math.max(p.x * k, x0), x1)
            const ny = Math.min(Math.max(p.y * k, y0), y1)
            expect(Math.hypot(nx - p.x * k, ny - p.y * k), `'+N' text over station ${id} at k=${k}`).toBeGreaterThanOrEqual(r - 0.25)
          }
        }
        for (let a = 0; a < boxes.length; a++)
          for (let c = a + 1; c < boxes.length; c++) {
            const A = boxes[a]
            const B = boxes[c]
            expect(Math.min(A[2], B[2]) - Math.max(A[0], B[0]) > 0.5 && Math.min(A[3], B[3]) - Math.max(A[1], B[1]) > 0.5).toBe(false)
          }
      }
    })
  }

  it('the text shows at the default camera of a long map; below a readable size only the bars do', () => {
    expect(metroRunMarker({ textY: 3 }, METRO_MIN_ZOOM)).toBe('badge')
    expect(metroRunMarker({ textY: null }, METRO_MIN_ZOOM)).toBe('tick')
    expect(metroRunMarker({ textY: 3 }, 0.2)).toBe('tick')
    expect(metroBadgeFontPx(METRO_MIN_ZOOM)).toBeGreaterThanOrEqual(METRO_BADGE_MIN_PX)
    expect(metroBadgeFontPx(FIT_MAX_ZOOM)).toBe(METRO_BADGE_MAX_PX)
  })

  it('cut a canvas-coloured break across the whole route under the two bars, at any zoom', () => {
    // the two halos, centred RUN_BAR_GAP_PX apart, meet in the middle, and each one shows past its bar
    expect(RUN_BAR_HALO_PX).toBeGreaterThanOrEqual(RUN_BAR_GAP_PX)
    expect(RUN_BAR_HALO_PX).toBeGreaterThan(RUN_BAR_PX)
    /** a canvas context that records each stroke: its style, width, cap and the segments of its path */
    interface Stroke {
      strokeStyle: unknown
      lineWidth: number
      lineCap: string
      segments: [number, number, number, number][]
    }
    const strokes: Stroke[] = []
    let path: [number, number, number, number][] = []
    let at: [number, number] = [0, 0]
    const ctx: RunBarContext = {
      strokeStyle: '',
      lineWidth: 0,
      lineCap: 'round',
      beginPath: () => void (path = []),
      moveTo: (x: number, y: number) => void (at = [x, y]),
      lineTo: (x: number, y: number) => {
        path.push([at[0], at[1], x, y])
        at = [x, y]
      },
      stroke: () => void strokes.push({ strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth, lineCap: ctx.lineCap, segments: [...path] }),
    }
    for (const theme of THEMES) {
      for (const b of [
        { x: 10, y: -4, dx: 1, dy: 0 },
        { x: -3, y: 7, dx: 0.6, dy: 0.8 },
      ]) {
        for (const k of [0.2, METRO_MIN_ZOOM, 1, FIT_MAX_ZOOM, 4, 8]) {
          const px = 1 / k
          const width = Math.max(METRO_LINE_WIDTH, METRO_MIN_LINE_PX * px) // a full route, as RepoGraph's paintMetro draws it
          strokes.length = 0
          strokeRunBars(ctx, b, px, width, theme)
          const label = `${theme.id} k=${k}`
          // the cut first, in the canvas colour, then the bars on top
          expect(strokes.map((s) => [s.strokeStyle, s.lineCap]), label).toEqual([
            [theme.derived.textHalo, 'butt'],
            [theme.derived.runMark, 'butt'],
          ])
          expect(theme.derived.textHalo).toBe(theme.canvas)
          expect(strokes[0].lineWidth, label).toBeCloseTo(RUN_BAR_HALO_PX * px)
          expect(strokes[1].lineWidth, label).toBeCloseTo(RUN_BAR_PX * px)
          expect(strokes[1].segments).toEqual(strokes[0].segments)
          const bars = strokes[0].segments
          expect(bars).toHaveLength(2)
          for (const [x0, y0, x1, y1] of bars) {
            const len = Math.hypot(x1 - x0, y1 - y0)
            // across the line, as long as it is wide plus the overhang either side, and never shorter than zoomed out
            expect(Math.abs((x1 - x0) * b.dx + (y1 - y0) * b.dy) / len, label).toBeLessThan(1e-9)
            expect(len, label).toBeGreaterThanOrEqual(width + 2 * RUN_BAR_OVERHANG_PX * px - 1e-9)
            expect(len, label).toBeGreaterThanOrEqual(2 * RUN_BAR_HALF_PX * px - 1e-9)
          }
          // centred on the marker, RUN_BAR_GAP_PX apart along the line
          const mid = bars.map(([x0, y0, x1, y1]) => [(x0 + x1) / 2, (y0 + y1) / 2])
          expect((mid[0][0] + mid[1][0]) / 2).toBeCloseTo(b.x)
          expect((mid[0][1] + mid[1][1]) / 2).toBeCloseTo(b.y)
          expect(Math.hypot(mid[1][0] - mid[0][0], mid[1][1] - mid[0][1])).toBeCloseTo(RUN_BAR_GAP_PX * px)
        }
      }
    }
  })
})

// ---------------- bringing a selection or search hits into view ----------------

describe('metroRevealTransform', () => {
  const canvas = { width: 1042, height: 768 }
  // a vite-like map: 30 lanes high, far wider than the view at the readable zoom
  const bbox = { x: [-2200, 2200] as [number, number], y: [-70, 70] as [number, number] }
  const cam = metroFitTransform(bbox, canvas, FIT_PAD, FIT_MAX_ZOOM, METRO_MIN_ZOOM)
  const onScreen = (t: { k: number; cx: number; cy: number }, p: { x: number; y: number }) => {
    const sx = (p.x - t.cx) * t.k + canvas.width / 2
    const sy = (p.y - t.cy) * t.k + canvas.height / 2
    return sx >= FIT_PAD.left - 1e-6 && sx <= canvas.width - FIT_PAD.right + 1e-6 && sy >= FIT_PAD.top - 1e-6 && sy <= canvas.height - FIT_PAD.bottom + 1e-6
  }

  it('the fit leaves the oldest end off-screen (the case this is for)', () => {
    expect(onScreen(cam, { x: bbox.x[0], y: 0 })).toBe(false)
  })

  it('does nothing for points already in view', () => {
    expect(metroRevealTransform([{ x: bbox.x[1], y: 0 }], [], cam, canvas, FIT_PAD, METRO_MIN_ZOOM)).toBeNull()
    expect(metroRevealTransform([], [], cam, canvas, FIT_PAD, METRO_MIN_ZOOM)).toBeNull()
  })

  it('pans to an off-screen tip without zooming in or out', () => {
    const tip = { x: bbox.x[0], y: 40 }
    const t = metroRevealTransform([tip], [], cam, canvas, FIT_PAD, METRO_MIN_ZOOM)!
    expect(t.k).toBeCloseTo(cam.k)
    expect(onScreen(t, tip)).toBe(true)
  })

  it('brings in the whole selected line when it fits, never zooming in', () => {
    const tip = { x: bbox.x[0] + 300, y: 40 }
    const line = [{ x: bbox.x[0], y: 40 }, { x: bbox.x[0] + 150, y: 40 }]
    const t = metroRevealTransform([tip], line, cam, canvas, FIT_PAD, METRO_MIN_ZOOM)!
    expect(t.k).toBeLessThanOrEqual(cam.k + 1e-9)
    for (const p of [tip, ...line]) expect(onScreen(t, p)).toBe(true)
  })

  it('does not zoom out below the readable floor for a long line, but still shows the tip', () => {
    const tip = { x: bbox.x[0], y: 40 }
    const line = [{ x: bbox.x[1], y: 40 }]
    const t = metroRevealTransform([tip], line, cam, canvas, FIT_PAD, METRO_MIN_ZOOM)!
    expect(t.k).toBeCloseTo(cam.k)
    expect(onScreen(t, tip)).toBe(true)
    // a tip already in view with its long line running off-screen: no move at all
    expect(metroRevealTransform([{ x: bbox.x[1], y: 40 }], [{ x: bbox.x[0], y: 40 }], cam, canvas, FIT_PAD, METRO_MIN_ZOOM)).toBeNull()
  })

  it('zooms out just enough to show search hits at both ends', () => {
    const hits = [
      { x: bbox.x[0], y: -40 },
      { x: bbox.x[1], y: 40 },
    ]
    const t = metroRevealTransform(hits, [], cam, canvas, FIT_PAD, METRO_MIN_ZOOM)!
    expect(t.k).toBeLessThan(cam.k)
    expect(t.k).toBeCloseTo((canvas.width - FIT_PAD.left - FIT_PAD.right) / (bbox.x[1] - bbox.x[0]))
    for (const p of hits) expect(onScreen(t, p)).toBe(true)
  })
})
