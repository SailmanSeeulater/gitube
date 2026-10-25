import { describe, expect, it } from 'vitest'
import { BLOOM_SCALE } from '../src/components/gardenPaint'
import { hitLifeGarden } from '../src/profile/lifeGardenHit'
import { horizonY, plantGeom, pointAt } from '../src/profile/lifeGeometry'
import { layoutLifeGarden } from '../src/profile/lifeGardenLayout'
import { buildLifeTimeline } from '../src/profile/timeline'
import type { LifeCamera, LifeGardenLayout, LifePlant, LifeViewport } from '../src/profile/lifeTypes'
import type { ProfileData } from '../src/types'

const VIEW: LifeViewport = { width: 1000, height: 600, top: 72, ground: 44, side: 28 }
const CAMERA: LifeCamera = { k: 2, tx: 30 }
const NONE: ReadonlySet<string> = new Set()
const START = 19_000
const GROUND = horizonY(VIEW)

function makePlant(over: Partial<LifePlant> = {}): LifePlant {
  return {
    lane: 0,
    key: 'me/a',
    x: 100.5,
    row: 0,
    height: 0.5,
    reach: 8.5,
    bend: 0,
    lean: 0,
    turn: 0.3,
    tip: 'bud',
    bloom: 0,
    dry: false,
    cutting: false,
    visiting: false,
    backDays: 0,
    seedling: false,
    parts: [{ kind: 'active', t0: 0, t1: 1 }],
    leaves: [],
    language: null,
    startDay: START + 100,
    endDay: START + 399,
    appearAt: 0,
    ...over,
  }
}

/** A layout of these plants (already in paint order) over 400 days, with these milestones. */
function makeLayout(plants: LifePlant[], milestones: LifeGardenLayout['milestones'] = []): LifeGardenLayout {
  return {
    startDay: START,
    todayDay: START + 399,
    days: 400,
    rows: 4,
    plants,
    byKey: new Map(plants.map((p, i) => [p.key, i])),
    years: [],
    languages: [],
    milestones,
  }
}

const geomsOf = (layout: LifeGardenLayout, camera = CAMERA) => layout.plants.map((p) => plantGeom(p, camera, VIEW))
const hit = (layout: LifeGardenLayout, x: number, y: number, hidden = NONE, camera = CAMERA) => hitLifeGarden(layout, geomsOf(layout, camera), camera, VIEW, x, y, hidden)

describe('life garden hit testing', () => {
  it('hits a plant along its stem and at its head', () => {
    const layout = makeLayout([makePlant()])
    const g = geomsOf(layout)[0]
    const [mx, my] = pointAt(g, 0.5)
    expect(hit(layout, mx + 3, my)).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, g.x2, g.y2)).toEqual({ kind: 'repo', key: 'me/a' })
    // well off the stem it is the day under the pointer
    expect(hit(layout, mx + 40, my)).toMatchObject({ kind: 'day' })
  })

  it('reaches a head as far as its flower spreads, and a little beyond', () => {
    const plant = makePlant({ tip: 'bloom', bloom: 1, height: 0.3 })
    const layout = makeLayout([plant])
    const g = geomsOf(layout)[0]
    const reach = g.tipR * BLOOM_SCALE
    // straight up from the head, away from the stem
    expect(hit(layout, g.x2, g.y2 - reach - 2)).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, g.x2, g.y2 - reach - 4)).toMatchObject({ kind: 'day' })
  })

  it('lets the front row win where plants overlap', () => {
    // paint order: the back row first
    const back = makePlant({ key: 'me/back', row: 1, lane: 1 })
    const front = makePlant({ key: 'me/front', row: 0, lane: 0 })
    const layout = makeLayout([back, front])
    expect(hit(layout, 30 + 100.5 * 2, GROUND - 20)).toEqual({ kind: 'repo', key: 'me/front' })
  })

  it('skips hidden plants', () => {
    const back = makePlant({ key: 'me/back', row: 1, lane: 1 })
    const front = makePlant({ key: 'me/front', row: 0, lane: 0 })
    const layout = makeLayout([back, front])
    expect(hit(layout, 30 + 100.5 * 2, GROUND - 20, new Set(['me/front']))).toEqual({ kind: 'repo', key: 'me/back' })
    expect(hit(layout, 30 + 100.5 * 2, GROUND - 20, new Set(['me/front', 'me/back']))).toEqual({ kind: 'day', day: START + 100, milestone: null })
  })

  it('snaps to a milestone marker within 6 px, the nearest winning', () => {
    const layout = makeLayout([], [
      { index: 0, kind: 'joined', x: 50.5, x1: null },
      { index: 1, kind: 'first-repo', x: 56.5, x1: null },
    ])
    const at = (x: number) => 30 + x * 2
    expect(hit(layout, at(50.5) + 5, GROUND)).toEqual({ kind: 'day', day: START + 50, milestone: 0 })
    expect(hit(layout, at(50.5), GROUND - 5)).toEqual({ kind: 'day', day: START + 50, milestone: 0 })
    // between the two, nearer the second
    expect(hit(layout, at(54), GROUND)).toEqual({ kind: 'day', day: START + 56, milestone: 1 })
    expect(hit(layout, at(50.5), GROUND - 7)).toEqual({ kind: 'day', day: START + 50, milestone: null })
  })

  it('reads the day under the pointer in the sky and on the ground', () => {
    const layout = makeLayout([])
    expect(hit(layout, 30 + 0.2 * 2, 100)).toEqual({ kind: 'day', day: START, milestone: null })
    expect(hit(layout, 30 + 250.9 * 2, 590)).toEqual({ kind: 'day', day: START + 250, milestone: null })
    expect(hit(layout, 30 + 399.99 * 2, 300)).toEqual({ kind: 'day', day: START + 399, milestone: null })
  })

  it('hits nothing outside the life or off the canvas', () => {
    const layout = makeLayout([makePlant()])
    // the life spans screen x 30..830
    expect(hit(layout, 20, 300)).toBeNull()
    expect(hit(layout, 831, 300)).toBeNull()
    expect(hit(layout, 400, -1)).toBeNull()
    expect(hit(layout, 400, 601)).toBeNull()
    expect(hit(layout, NaN, 300)).toBeNull()
  })

  it('hits every visible plant of a real layout at its head', () => {
    const p: ProfileData = {
      login: 'me',
      name: null,
      avatarUrl: '',
      createdAt: '2019-01-10T20:00:00Z',
      source: 'rest',
      repos: ['2019-02-01', '2020-05-01', '2021-08-01'].map((day, i) => ({
        nameWithOwner: `me/r${i}`,
        createdAt: `${day}T20:00:00Z`,
        firstActiveAt: `${day}T20:00:00Z`,
        lastActiveAt: `${day}T20:00:00Z`,
        isOwn: true,
        language: null,
        languageColor: null,
        stars: i * 10,
        forks: 0,
        isFork: false,
        isArchived: i === 2,
        isPrivate: false,
        activity: [],
      })),
      days: [],
      recent: [],
      recentFrom: '2024-05-16',
      milestones: [],
      restrictedContributions: 0,
      truncated: false,
      lostWindows: [],
      fallback: null,
    }
    const layout = layoutLifeGarden(buildLifeTimeline(p, Date.parse('2024-06-15T19:00:00Z')), 'rest')
    const camera: LifeCamera = { k: (VIEW.width - 56) / layout.days, tx: 28 }
    const geoms = geomsOf(layout, camera)
    layout.plants.forEach((plant, i) => {
      expect(hitLifeGarden(layout, geoms, camera, VIEW, geoms[i].x2, geoms[i].y2, NONE)).toEqual({ kind: 'repo', key: plant.key })
    })
  })
})
