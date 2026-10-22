/**
 * The pull request ring's geometry (components/prMark.ts): it takes the place of what each layout
 * already draws round a tip and reaches no further than the label placer allows for, and its halves,
 * gaps, breaks and dots say what they should at every zoom.
 */
import { describe, expect, it } from 'vitest'
import { DOT_PITCH, DOT_WIDTH, PR_RING_MIN_DETAIL_PX, drawPrRing, prRingArcs, prRingFor, prRingOuterEdge } from './prMark'
import { TIP_RING_PX } from './useLabelPlacer'
import { LABEL_PLACER_DEFAULTS } from './labelPlacement'
import { METRO_MIN_ZOOM, metroStationRadius } from './metroView'
import { BLOOM_SCALE } from './gardenPaint'
import { nodeRadius } from './gardenUtils'
import type { PrMark } from '../types'

const ZOOMS = [METRO_MIN_ZOOM, 0.7, 1, 1.5, 2.5, 4, 8]
const mark = (over: Partial<PrMark> = {}): Pick<PrMark, 'review' | 'checks' | 'draft'> => ({ review: 'waiting', checks: 'passing', draft: false, ...over })
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9)

describe('where the ring goes', () => {
  it('organic: its outer edge is the old tip ring’s, outer + TIP_RING_PX + 0.75 px', () => {
    for (const zoom of [0.3, ...ZOOMS]) {
      const px = 1 / zoom
      for (const reach of [1, 3, 12]) {
        const outer = nodeRadius(reach) + 2
        const { R, w } = prRingFor('organic', outer, px)
        close(prRingOuterEdge(R, w), outer + (TIP_RING_PX + 0.75) * px)
        // the old ring: outer + 2.5 px, 1.5 px wide
        close(prRingOuterEdge(R, w), outer + 2.5 * px + (1.5 * px) / 2)
      }
    }
  })

  it('garden: its outer edge is the petals’ reach', () => {
    for (const zoom of [0.3, ...ZOOMS]) {
      const px = 1 / zoom
      const reach = (nodeRadius(4) + 2) * BLOOM_SCALE
      const { R, w } = prRingFor('garden', reach, px)
      close(prRingOuterEdge(R, w), reach)
    }
  })

  it('metro: at most 1.3 px past the station outline at every zoom metro allows, inside the placer’s gap', () => {
    const r = metroStationRadius(undefined, true)
    for (const zoom of [METRO_MIN_ZOOM, 0.9, 1, 1.5, 2.5, 4, 8, 16]) {
      expect(zoom).toBeGreaterThanOrEqual(METRO_MIN_ZOOM)
      const px = 1 / zoom
      const today = r + Math.max(1.5, 1.2 * px) / 2
      const { R, w } = prRingFor('metro', r, px)
      const beyondPx = (prRingOuterEdge(R, w) - today) * zoom
      expect(beyondPx).toBeLessThanOrEqual(1.3 + 1e-9)
      expect((prRingOuterEdge(R, w) - r) * zoom).toBeLessThan(LABEL_PLACER_DEFAULTS.gap)
    }
  })
})

describe('prRingArcs', () => {
  const R = 10
  const px = 1

  it('splits the ring at 12 and 6 o’clock: review on the left, checks on the right', () => {
    const arcs = prRingArcs(R, 2.5, mark(), px)
    expect(arcs.map((a) => a.side)).toEqual(['review', 'checks'])
    const gap = Math.min(3 / R, 0.35)
    const [review, checks] = arcs
    // checks: from just past 12 o'clock (-pi/2) round through 3 to just before 6 (pi/2)
    close(checks.a0, -Math.PI / 2 + gap / 2)
    close(checks.a1, Math.PI / 2 - gap / 2)
    // review: from just past 6 round through 9 to just before 12
    close(review.a0, Math.PI / 2 + gap / 2)
    close(review.a1, (3 * Math.PI) / 2 - gap / 2)
    expect(review.tone).toBe('muted')
    expect(checks.tone).toBe('success')
  })

  it('breaks a danger half in its middle, so failing and changes requested read without colour', () => {
    const arcs = prRingArcs(R, 2.5, mark({ review: 'changes', checks: 'failing' }), px)
    expect(arcs).toHaveLength(4)
    const breakAngle = Math.min(3.6 / R, 0.45)
    const checks = arcs.filter((a) => a.side === 'checks')
    close(checks[1].a0 - checks[0].a1, breakAngle)
    // the break sits at 3 o'clock
    close((checks[0].a1 + checks[1].a0) / 2, 0)
    expect(arcs.every((a) => a.tone === 'danger')).toBe(true)
    expect(prRingArcs(R, 2.5, mark({ checks: 'running' }), px)).toHaveLength(2)
  })

  it('dots a draft (no break), and draws a half not looked up yet faint', () => {
    const draft = prRingArcs(R, 2.5, mark({ draft: true, checks: 'failing' }), px)
    expect(draft).toHaveLength(2)
    expect(draft.every((a) => a.dotted)).toBe(true)
    const unknown = prRingArcs(R, 2.5, mark({ review: 'unknown', checks: 'unknown' }), px)
    expect(unknown.every((a) => a.faint && a.tone === 'muted')).toBe(true)
    // waiting is muted too, but at full strength: lighter than unknown
    expect(prRingArcs(R, 2.5, mark(), px)[0]).toMatchObject({ tone: 'muted', faint: false })
  })

  it('draws two plain halves when the ring is under 3 px on screen', () => {
    const tiny = prRingArcs(PR_RING_MIN_DETAIL_PX - 0.5, 1, mark({ draft: true, checks: 'failing', review: 'changes' }), 1)
    expect(tiny).toHaveLength(2)
    expect(tiny.every((a) => !a.dotted)).toBe(true)
    close(tiny[0].a0, Math.PI / 2)
    close(tiny[1].a1 - tiny[1].a0, Math.PI)
  })
})

describe('drawPrRing', () => {
  it('strokes each arc and leaves alpha, cap and dash as it found them', () => {
    const log: string[] = []
    const ctx = {
      globalAlpha: 0.4,
      lineCap: 'square' as CanvasLineCap,
      lineWidth: 1,
      strokeStyle: '',
      beginPath: () => log.push('begin'),
      arc: (_x: number, _y: number, r: number) => log.push(`arc ${r}`),
      stroke() {
        log.push(`stroke ${this.strokeStyle} a=${this.globalAlpha.toFixed(2)} w=${this.lineWidth} cap=${this.lineCap}`)
      },
      setLineDash: (d: number[]) => log.push(`dash ${d.join(',')}`),
    }
    const theme = { success: 'S', warn: 'W', danger: 'D', muted: 'M' }
    drawPrRing(ctx as unknown as CanvasRenderingContext2D, 0, 0, 10, 2, { review: 'unknown', checks: 'passing', draft: true }, theme, 1)
    const strokes = log.filter((l) => l.startsWith('stroke'))
    expect(strokes).toEqual([`stroke M a=0.20 w=${2 * DOT_WIDTH} cap=round`, `stroke S a=0.40 w=${2 * DOT_WIDTH} cap=round`])
    expect(log).toContain(`dash 0,${2 * DOT_PITCH}`)
    expect(log[log.length - 1]).toBe('dash ')
    expect(ctx.globalAlpha).toBe(0.4)
    expect(ctx.lineCap).toBe('square')
  })
})
