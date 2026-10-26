/**
 * The life garden's frame and how tall its plants stand: the horizon and everything painted under
 * it (the ribbon, the year labels, today, the milestones and the roots) stay above the status strip
 * at the canvas's foot, and an archived (dry) plant reaches as high as a live one of the same
 * weight, only its head drooping. (The rest of the geometry is tested in lifeGardenLayout.test.ts.)
 */
import { describe, expect, it } from 'vitest'
import { DROOP } from '../src/components/gardenLook'
import { getTheme } from '../src/theme/themes'
import {
  GROUND_MARKS_PX,
  ROW_LIFT_PX,
  STRIP_CLEARANCE,
  VIEW_GROUND,
  VIEW_SIDE,
  VIEW_TOP,
  horizonY,
  plantGeom,
  pointAt,
  rowScale,
  tangentAt,
} from '../src/profile/lifeGeometry'
import type { LifeCamera, LifePlant, LifeViewport, PlantGeom } from '../src/profile/lifeTypes'
import { KEPANO_NOW, grow, kepanoProfile, paint } from './helpers/personScene'
import type { CtxEntry } from './helpers/recordingCtx'

/** How far down a call draws: the lowest y it reaches (a curve within its control points, text a font size under its y). */
function lowestY(e: Extract<CtxEntry, { kind: 'call' }>): number {
  const n = e.args.map(Number)
  switch (e.name) {
    case 'moveTo':
    case 'lineTo':
      return n[1]
    case 'quadraticCurveTo':
      return Math.max(n[1], n[3])
    case 'bezierCurveTo':
      return Math.max(n[1], n[3], n[5])
    case 'arc':
      return n[1] + n[2]
    case 'ellipse':
      return n[1] + Math.max(n[2], n[3])
    case 'rect':
    case 'roundRect':
    case 'fillRect':
      return n[1] + n[3]
    case 'fillText':
    case 'strokeText': {
      const px = /(\d+(?:\.\d+)?)px/.exec(String(e.style.font))
      return n[2] + (px ? Number(px[1]) : 16)
    }
    default:
      return -Infinity
  }
}

describe('the life garden frame', () => {
  it('keeps the horizon and everything painted under it above the status strip', async () => {
    const profile = await kepanoProfile()
    const dark = getTheme('obsidian')
    expect(VIEW_GROUND).toBeGreaterThanOrEqual(GROUND_MARKS_PX + STRIP_CLEARANCE)
    for (const height of [560, 800, 1200]) {
      const view: LifeViewport = { width: 1280, height, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }
      const horizon = horizonY(view)
      // the strip takes the canvas's foot: the horizon and the ground's marks end above it
      expect(horizon + GROUND_MARKS_PX).toBeLessThanOrEqual(height - STRIP_CLEARANCE)

      const g = grow(profile, KEPANO_NOW, dark, null, view)
      const milestone = g.layout.milestones[0]
      expect(milestone).toBeDefined()
      const key = g.layout.plants[0].key
      for (const over of [{}, { hover: { kind: 'day' as const, day: g.layout.startDay + Math.floor(milestone.x), milestone: milestone.index } }, { hover: { kind: 'repo' as const, key }, selected: key }]) {
        const { rec } = paint(g, over)
        const calls = rec.log.filter((e): e is Extract<CtxEntry, { kind: 'call' }> => e.kind === 'call')
        // the canvas colour over the whole backing store comes first, without the pixel transform
        expect(calls.find((e) => e.name === 'fillRect')?.args).toEqual([0, 0, view.width * 2, view.height * 2])
        const drawn = calls.filter((e) => e.name !== 'fillRect' || e.args[1] !== 0 || e.args[3] !== view.height * 2)
        const texts = drawn.filter((e) => e.name === 'fillText')
        // the year labels and today are there to keep clear
        expect(texts.some((e) => e.args[0] === 'today')).toBe(true)
        expect(texts.some((e) => /^\d{4}$/.test(String(e.args[0])) && Number(e.args[2]) > horizon)).toBe(true)
        const lowest = Math.max(...drawn.map(lowestY))
        expect(lowest).toBeGreaterThan(horizon + 20)
        expect(lowest).toBeLessThanOrEqual(horizon + GROUND_MARKS_PX)
      }
    }
  })
})

const VIEW: LifeViewport = { width: 1000, height: 600, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }
const CAMERA: LifeCamera = { k: 2, tx: 30 }

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
    tip: 'bloom',
    bloom: 0.5,
    dry: false,
    cutting: false,
    visiting: false,
    backDays: 0,
    seedling: false,
    parts: [{ kind: 'active', t0: 0, t1: 1 }],
    leaves: [],
    language: null,
    startDay: 0,
    endDay: 10,
    appearAt: 0,
    ...over,
  }
}

/** The stem's highest point: its smallest y, at an end or where the curve turns. */
function peakY(g: PlantGeom): number {
  const a = g.y0 - 2 * g.cy + g.y2
  const ends = Math.min(g.y0, g.y2)
  if (a === 0) return ends
  const t = (g.y0 - g.cy) / a
  return t > 0 && t < 1 ? Math.min(ends, pointAt(g, t)[1]) : ends
}

describe('a dry plant', () => {
  it('stands as tall as a live one of the same height, and only its head droops', () => {
    for (const height of [0.001, 0.1, 0.5, 1]) {
      for (const row of [0, 2]) {
        for (const lean of [-1, -0.3, 0, 0.6, 1]) {
          const live = plantGeom(makePlant({ height, row, lean, bend: 0.8 }), CAMERA, VIEW)
          const dry = plantGeom(makePlant({ height, row, lean, bend: 0.8, dry: true, tip: 'wilted' }), CAMERA, VIEW)
          const ground = horizonY(VIEW) - ROW_LIFT_PX * row
          const h = Math.max(8, (horizonY(VIEW) - VIEW.top) * height * rowScale(row))
          expect(live.y0).toBe(ground)
          expect(dry.y0).toBe(ground)
          // the same peak: the plant's height above its root
          expect(peakY(live)).toBeCloseTo(ground - h, 9)
          expect(peakY(dry)).toBeCloseTo(ground - h, 9)
          // the head hangs DROOP of the height below that peak, to the side the plant leans, pointing down
          expect(dry.y2).toBeCloseTo(ground - h * (1 - DROOP), 9)
          expect(Math.sign(dry.x2 - dry.cx)).toBe(lean < 0 ? -1 : 1)
          expect(Math.sin(tangentAt(dry, 1))).toBeGreaterThan(0)
        }
      }
    }
  })
})
