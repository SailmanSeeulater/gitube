/**
 * Person mode's frame: the horizon and everything painted under it (the ribbon, the year labels,
 * today and the milestones) stay above the status strip at the canvas's foot, in the default view.
 */
import { describe, expect, it } from 'vitest'
import { getTheme } from '../src/theme/themes'
import { GROUND_MARKS_PX, STRIP_CLEARANCE, VIEW_GROUND, VIEW_SIDE, VIEW_TOP, horizonY } from '../src/profile/lifeGeometry'
import type { LifeViewport } from '../src/profile/lifeTypes'
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

describe("person mode's frame", () => {
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
      const key = g.layout.lines[0].key
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
