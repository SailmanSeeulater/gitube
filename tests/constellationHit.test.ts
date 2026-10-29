/**
 * What the pointer is over in the constellation: a star within its slop (the front-most where stars
 * crowd), never a hidden one or one the time-lapse has not sown, sized as grown by then; else the
 * axis's milestone or day; null off the life or the canvas. Then on the recordings, every visible
 * star is hit at its label anchor.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { hitConstellation } from '../src/profile/constellationHit'
import { constellationGeom, type ConstellationGeom } from '../src/profile/constellationGeometry'
import { layoutConstellation, type ConstellationLayout, type LifeStar } from '../src/profile/constellationLayout'
import { grownRadius, starAnchor, starGrownShare } from '../src/profile/constellationPaint'
import { fitLifeCamera } from '../src/profile/lifeCamera'
import { horizonY } from '../src/profile/lifeGeometry'
import { buildLifeTimeline } from '../src/profile/timeline'
import type { LifeCamera, LifeViewport } from '../src/profile/lifeTypes'
import type { ProfileData } from '../src/types'
import { GAEARON_NOW, KEPANO_NOW, VIEW as LAPTOP, gaearonProfile, kepanoProfile } from './helpers/personScene'

const VIEW: LifeViewport = { width: 1000, height: 600, top: 72, ground: 44, side: 28 }
const CAMERA: LifeCamera = { k: 2, tx: 30 }
const NONE: ReadonlySet<string> = new Set()
const START = 19_000
const GROUND = horizonY(VIEW)

function makeStar(over: Partial<LifeStar> = {}): LifeStar {
  return {
    lane: 0,
    key: 'me/a',
    startDay: START + 100,
    x: 100.5,
    y: 0.5,
    band: 0,
    size: 0.5,
    glow: 0,
    dry: false,
    twin: false,
    visiting: false,
    seedling: false,
    language: null,
    endDay: START + 399,
    landed: [],
    stars: 0,
    growthDays: [START + 100, START + 400],
    growthShares: [0, 1],
    ...over,
  }
}

/** A constellation of these stars (already in paint order) over 400 days in one band, with these milestones. */
function makeLayout(stars: LifeStar[], milestones: ConstellationLayout['milestones'] = []): ConstellationLayout {
  return {
    startDay: START,
    todayDay: START + 399,
    days: 400,
    years: [],
    languages: [],
    milestones,
    byKey: new Map(stars.map((s, i) => [s.key, i])),
    bands: [{ kind: 'none', language: null, label: 'no language', y0: 0, y1: 1, count: stars.length }],
    stars,
    links: [],
  }
}

const geomOf = (layout: ConstellationLayout, camera = CAMERA) => constellationGeom(layout, camera, VIEW)
const hit = (layout: ConstellationLayout, x: number, y: number, notDrawn = NONE, at: number | null = null) =>
  hitConstellation(layout, geomOf(layout), CAMERA, VIEW, x, y, notDrawn, at)

describe('hitConstellation', () => {
  it('hits a star at its centre and within its slop, and the day beyond it', () => {
    const layout = makeLayout([makeStar()])
    const g = geomOf(layout)
    const [x, y, r] = [g.x[0], g.y[0], g.r[0]]
    expect(r).toBeCloseTo(5.1, 12)
    expect(hit(layout, x, y)).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, x + r + 3, y)).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, x, y - r - 2.9)).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, x + r + 3.5, y)).toMatchObject({ kind: 'day', milestone: null })
  })

  it('hits a small star at least 5 px out', () => {
    const layout = makeLayout([makeStar({ seedling: true, size: 0 })])
    const g = geomOf(layout)
    expect(g.r[0]).toBe(1.6)
    expect(hit(layout, g.x[0] + 4.9, g.y[0])).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, g.x[0] + 5.1, g.y[0])).toMatchObject({ kind: 'day' })
  })

  it('picks the star drawn on top where stars crowd', () => {
    const back = makeStar({ key: 'me/back', size: 1 })
    const front = makeStar({ key: 'me/front', size: 0.1, lane: 1, x: 101.5 })
    const layout = makeLayout([back, front])
    const g = geomOf(layout)
    // between their centres, inside both
    expect(hit(layout, (g.x[0] + g.x[1]) / 2, g.y[0])).toEqual({ kind: 'repo', key: 'me/front' })
    // the back star's far side is still the back star
    expect(hit(layout, g.x[0] - g.r[0], g.y[0])).toEqual({ kind: 'repo', key: 'me/back' })
    // the front one not drawn: the back one is hit through it
    expect(hit(layout, g.x[1], g.y[1], new Set(['me/front']))).toEqual({ kind: 'repo', key: 'me/back' })
  })

  it('skips a star not drawn: hidden, or not sown by the time-lapse, and sizes one by how far it has grown', () => {
    const layout = makeLayout([makeStar({ size: 1 })])
    const g = geomOf(layout)
    const [x, y] = [g.x[0], g.y[0]]
    expect(hit(layout, x, y, new Set(['me/a']))).toMatchObject({ kind: 'day' })
    expect(hit(layout, x, y, NONE, START + 99)).toMatchObject({ kind: 'day' })
    expect(hit(layout, x, y, NONE, START + 100)).toEqual({ kind: 'repo', key: 'me/a' })
    // just sown it is a third of its size: its full edge is not it yet
    const star = layout.stars[0]
    expect(grownRadius(g.r[0], starGrownShare(star, START + 100))).toBeCloseTo(8 * 0.35, 12)
    expect(hit(layout, x + 8 + 2, y, NONE, START + 100)).toMatchObject({ kind: 'day' })
    expect(hit(layout, x + 8 + 2, y, NONE, null)).toEqual({ kind: 'repo', key: 'me/a' })
  })

  it('hits a milestone on the horizon, the nearest one, then a day; null off the life or the canvas', () => {
    const layout = makeLayout(
      [makeStar()],
      [
        { index: 0, kind: 'joined', x: 10.5, x1: null },
        { index: 1, kind: 'first-repo', x: 13.5, x1: null },
      ],
    )
    const mx = CAMERA.tx + 13.5 * CAMERA.k
    expect(hit(layout, mx - 1, GROUND + 1)).toEqual({ kind: 'day', day: START + 13, milestone: 1 })
    expect(hit(layout, CAMERA.tx + 10.5 * CAMERA.k, GROUND)).toEqual({ kind: 'day', day: START + 10, milestone: 0 })
    expect(hit(layout, CAMERA.tx + 300.5 * CAMERA.k, 200)).toEqual({ kind: 'day', day: START + 300, milestone: null })
    // left of the life, past today, and off the canvas
    expect(hit(layout, CAMERA.tx - 5, 200)).toBeNull()
    expect(hit(layout, CAMERA.tx + 401 * CAMERA.k, 200)).toBeNull()
    expect(hit(layout, -1, 200)).toBeNull()
    expect(hit(layout, 200, VIEW.height + 1)).toBeNull()
  })
})

describe('hitConstellation on the recordings', () => {
  let kepano: ProfileData
  let gaearon: ProfileData
  beforeAll(async () => {
    ;[kepano, gaearon] = await Promise.all([kepanoProfile(), gaearonProfile()])
  })

  /** Every visible star is hit at its anchor: itself, or a star drawn over that point. */
  function expectAnchorsHit(layout: ConstellationLayout, g: ConstellationGeom, camera: LifeCamera, at: number | null): number {
    const out = new Float32Array(3)
    let self = 0
    layout.stars.forEach((star, i) => {
      if (!starAnchor(layout, g, i, at, out)) return
      const [x, y] = [g.x[i], g.y[i]]
      if (x < 0 || x > LAPTOP.width) return
      const hover = hitConstellation(layout, g, camera, LAPTOP, x, y, NONE, at)
      expect(hover?.kind, star.key).toBe('repo')
      if (hover?.kind !== 'repo') return
      const j = layout.byKey.get(hover.key)!
      if (j === i) {
        self++
        return
      }
      // another star wins only from in front, and only where it reaches
      expect(j, star.key).toBeGreaterThan(i)
      const reach = Math.max(5, grownRadius(g.r[j], starGrownShare(layout.stars[j], at)) + 3)
      expect(Math.hypot(x - g.x[j], y - g.y[j])).toBeLessThanOrEqual(reach)
    })
    return self
  }

  it('hits every visible star of kepano and gaearon at its anchor, fully grown and halfway through', () => {
    for (const [profile, now] of [
      [kepano, KEPANO_NOW],
      [gaearon, GAEARON_NOW],
    ] as const) {
      const timeline = buildLifeTimeline(profile, now)
      const layout = layoutConstellation(timeline, profile.source)
      const camera = fitLifeCamera(layout.days, LAPTOP)
      const g = constellationGeom(layout, camera, LAPTOP)
      expect(expectAnchorsHit(layout, g, camera, null)).toBeGreaterThan(layout.stars.length / 2)
      const at = (layout.startDay + layout.todayDay) / 2
      expectAnchorsHit(layout, g, camera, at)
    }
  })
})
