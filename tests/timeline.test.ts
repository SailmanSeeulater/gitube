import { describe, expect, it } from 'vitest'
import { buildFullGraph, buildGraph } from '../src/graph'
import { GROW_SPAN, buildTimeline, clockAt, growth, runShown, stemGrowth } from '../src/graph/timeline'
import { partialPolyline, partialQuad, popScale } from '../src/components/timelapseDraw'
import { makeRepo } from './fixtures/repos'

/**
 * main: c1..c5 (dates = fixture index hours). feature forks at c3: f1, f2, f3.
 * Commit order by date: c1 c2 c3 c4 c5 f1 f2 f3 (the fixture dates follow list order).
 */
function forked() {
  return makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['c3', 'c2'], ['c4', 'c3'], ['c5', 'c4'], ['f1', 'c3'], ['f2', 'f1'], ['f3', 'f2']],
    branches: [
      { name: 'main', tip: 'c5', isDefault: true },
      { name: 'feature', tip: 'f3' },
    ],
  })
}

const step = (i: number, n = 8) => (i / (n - 1)) * (1 - GROW_SPAN)

describe('time-lapse timeline', () => {
  it('in full view, gives each commit one even step in date order', () => {
    const graph = buildGraph(forked(), 'full')
    const tl = buildTimeline(graph, graph)
    expect(tl.times).toHaveLength(8)
    expect(tl.nodeAt.get('c1')).toBe(0)
    expect(tl.nodeAt.get('c5')).toBeCloseTo(step(4))
    expect(tl.nodeAt.get('f3')).toBeCloseTo(1 - GROW_SPAN)
    expect(tl.runAt.size).toBe(0)
  })

  it('in skeleton view, dates the commits each collapsed link hides', () => {
    const data = forked()
    const skeleton = buildGraph(data, 'skeleton')
    const tl = buildTimeline(skeleton, buildFullGraph(data))
    // shown: c1 (root), c3 (fork), c5 and f3 (tips); c2, c4, f1, f2 hide in runs
    expect([...tl.nodeAt.keys()].sort()).toEqual(['c1', 'c3', 'c5', 'f3'])
    expect(tl.times).toHaveLength(8)
    expect([...tl.runAt.get('f3>c3')!]).toEqual([step(5), step(6)])
    expect([...tl.runAt.get('c5>c3')!]).toEqual([step(3)])
    expect([...tl.runAt.get('c3>c1')!]).toEqual([step(1)])
  })

  it('grows a run stem one hidden commit at a time, then finishes with its child', () => {
    const data = forked()
    const tl = buildTimeline(buildGraph(data, 'skeleton'), buildFullGraph(data))
    // before the fork exists, nothing of feature's stem shows
    expect(stemGrowth(tl, 'f3', 'c3', step(1))).toBe(0)
    // f1 fully grown: one of three shares
    expect(stemGrowth(tl, 'f3', 'c3', step(5) + GROW_SPAN)).toBeCloseTo(1 / 3)
    expect(runShown(tl, 'f3', 'c3', step(5) + GROW_SPAN)).toBe(1)
    // f2 too
    expect(stemGrowth(tl, 'f3', 'c3', step(6) + GROW_SPAN)).toBeCloseTo(2 / 3)
    // the tip itself, at the very end
    expect(stemGrowth(tl, 'f3', 'c3', 1)).toBe(1)
    // monotone along the way
    let prev = 0
    for (let p = 0; p <= 1; p += 0.001) {
      const g = stemGrowth(tl, 'f3', 'c3', p)
      expect(g).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = g
    }
  })

  it('a plain link grows with its child, and only once its parent is there', () => {
    const graph = buildGraph(forked(), 'full')
    const tl = buildTimeline(graph, graph)
    expect(stemGrowth(tl, 'c2', 'c1', step(1))).toBe(0)
    expect(stemGrowth(tl, 'c2', 'c1', step(1) + GROW_SPAN / 2)).toBeCloseTo(0.5)
    expect(stemGrowth(tl, 'c2', 'c1', 1)).toBe(1)
  })

  it('has everything fully grown at the end', () => {
    const data = forked()
    for (const mode of ['full', 'skeleton'] as const) {
      const shown = buildGraph(data, mode)
      const tl = buildTimeline(shown, buildFullGraph(data))
      for (const at of tl.nodeAt.values()) expect(growth(at, 1)).toBe(1)
      for (const link of shown.links) expect(stemGrowth(tl, link.source, link.target, 1)).toBe(1)
    }
  })

  it('shares a step between commits made at the same moment, and puts undated ones first', () => {
    const data = forked()
    data.commits.c5.date = data.commits.c4.date
    data.commits.f1.date = ''
    const graph = buildGraph(data, 'full')
    const tl = buildTimeline(graph, graph)
    expect(tl.nodeAt.get('c5')).toBe(tl.nodeAt.get('c4'))
    expect(tl.nodeAt.get('f1')).toBe(0)
  })

  it('reads the clock: the date on show and the commits so far', () => {
    const data = forked()
    const graph = buildGraph(data, 'full')
    const tl = buildTimeline(graph, graph)
    expect(clockAt(tl, 0)).toEqual({ time: Date.parse(data.commits.c1.date), commits: 1 })
    expect(clockAt(tl, step(4))).toEqual({ time: Date.parse(data.commits.c5.date), commits: 5 })
    expect(clockAt(tl, 1)).toEqual({ time: Date.parse(data.commits.f3.date), commits: 8 })
  })
})

describe('time-lapse drawing helpers', () => {
  it('pops nodes in from nothing to full size', () => {
    expect(popScale(0)).toBe(0)
    expect(popScale(1)).toBe(1)
    expect(popScale(0.7)).toBeGreaterThan(1) // the overshoot
  })

  it('splits a quadratic curve at f', () => {
    // straight "curve": control on the chord
    expect(partialQuad(0, 0, 5, 0, 10, 0, 0.5)).toEqual([2.5, 0, 5, 0])
    expect(partialQuad(0, 0, 5, 5, 10, 0, 1)).toEqual([5, 5, 10, 0])
    const [, , ex, ey] = partialQuad(0, 0, 5, 10, 10, 0, 0.5)
    expect([ex, ey]).toEqual([5, 5]) // B(0.5) of that curve
  })

  it('cuts a polyline at a share of its length', () => {
    const pts = [0, 0, 10, 0, 10, 10] // two legs of 10
    expect(partialPolyline(pts, 0.25)).toEqual([0, 0, 5, 0])
    expect(partialPolyline(pts, 0.75)).toEqual([0, 0, 10, 0, 10, 5])
    expect(partialPolyline(pts, 1)).toEqual(pts)
    expect(partialPolyline(pts, 0)).toEqual([0, 0])
  })
})
