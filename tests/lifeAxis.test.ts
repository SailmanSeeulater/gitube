/**
 * The time axis every person-mode view shares (lifeView.ts, lifeAxis.ts): axisOf gives life lines'
 * years, language eras and milestones exactly; the year bands are drawn only when a view asks; the
 * clock hides milestones it has not reached; and axisHover finds a milestone marker, the day under
 * the pointer, or nothing off the life and off the canvas.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { getTheme } from '../src/theme/themes'
import { LIFE_YEAR_FONT, paintAxisBackdrop, paintAxisMilestones, paintCanvasFill, paintDayGuide, type LifeAxisPaint } from '../src/profile/lifeAxis'
import { MONO_FONT } from '../src/components/graphUtils'
import { axisHover, axisOf, onCanvas, MILESTONE_HIT_PX } from '../src/profile/lifeView'
import { horizonY } from '../src/profile/lifeGeometry'
import { dayAt, dayNumber } from '../src/profile/timeline'
import type { LifeHover } from '../src/profile/lifeTypes'
import { KEPANO_NOW, VIEW, load, kepanoProfile, type Loaded } from './helpers/personScene'
import { recordingCtx, type RecordingCtx } from './helpers/recordingCtx'

const theme = getTheme('obsidian')
let g: Loaded

beforeAll(async () => {
  g = load(await kepanoProfile(), KEPANO_NOW, theme)
})

/** The axis as a view paints it, for g. */
function axisPaint(over: Partial<LifeAxisPaint> = {}): LifeAxisPaint {
  return { axis: axisOf(g.timeline), timeline: g.timeline, camera: g.camera, view: g.view, ink: g.ink, colourOf: g.colourOf, hover: null, at: null, ...over }
}

describe('axisOf', () => {
  it("is life lines' axis, field for field", () => {
    const axis = axisOf(g.timeline)
    const { startDay, todayDay, days, years, languages, milestones } = g.layout
    expect(axis).toEqual({ startDay, todayDay, days, years, languages, milestones })
    expect(axis.days).toBe(g.timeline.todayDay - g.timeline.startDay + 1)
  })

  it('keeps every band inside the life and every milestone in its day, inside the life', () => {
    const axis = axisOf(g.timeline)
    for (const band of [...axis.years, ...axis.languages]) {
      expect(band.x0).toBeGreaterThanOrEqual(0)
      expect(band.x1).toBeLessThanOrEqual(axis.days)
      expect(band.x1).toBeGreaterThan(band.x0)
    }
    expect(axis.milestones.length).toBeGreaterThan(0)
    for (const m of axis.milestones) {
      expect(m.x).toBeGreaterThanOrEqual(0.5)
      expect(m.x).toBeLessThanOrEqual(axis.days - 0.5)
      expect(m.x).toBe(Math.min(axis.days - 0.5, Math.max(0.5, dayNumber(g.timeline.milestones[m.index].day) - axis.startDay + 0.5)))
    }
  })
})

describe('the shared axis', () => {
  it("draws year labels in repo mode's mono font", () => {
    expect(LIFE_YEAR_FONT).toBe(`10px ${MONO_FONT}`)
  })

  it('fills the whole backing store first, under its own save and restore', () => {
    const rec = recordingCtx(VIEW.width * 2, VIEW.height * 2)
    paintCanvasFill(rec.ctx, g.ink)
    expect(rec.calls('fillRect')).toHaveLength(1)
    expect(rec.calls('fillRect')[0].args).toEqual([0, 0, VIEW.width * 2, VIEW.height * 2])
    expect(rec.calls('fillRect')[0].style.fillStyle).toBe(g.ink.canvas)
    expect(rec.calls('setTransform')[0].args).toEqual([1, 0, 0, 1, 0, 0])
    expect(rec.calls('save')).toHaveLength(1)
    expect(rec.calls('restore')).toHaveLength(1)
  })

  it("bands alternate years only when asked (phosphor's sky), and draws the years, today and the ribbon either way", () => {
    const banded = recordingCtx()
    paintAxisBackdrop(banded.ctx, axisPaint(), { yearBands: true })
    const plain = recordingCtx()
    paintAxisBackdrop(plain.ctx, axisPaint())
    const bands = (rec: RecordingCtx) => rec.calls('fillRect').filter((c) => c.style.fillStyle === g.ink.eraBand)
    expect(bands(banded).length).toBeGreaterThan(0)
    expect(bands(plain)).toHaveLength(0)
    const texts = plain.calls('fillText').map((c) => String(c.args[0]))
    expect(texts).toContain('today')
    expect(texts.filter((t) => /^\d{4}$/.test(t)).length).toBeGreaterThan(3)
    // only years and today: never a repo name
    for (const text of texts) expect(text).toMatch(/^(\d{4}|today)$/)
    const ribbon = plain.calls('fillRect').filter((c) => c.args[1] === horizonY(VIEW) + 2)
    expect(ribbon.length).toBe(axisOf(g.timeline).languages.length)
  })

  it('draws only the milestones the clock has reached, and none at the very start', () => {
    const count = (at: number | null) => {
      const rec = recordingCtx()
      paintAxisMilestones(rec.ctx, axisPaint({ at }))
      return rec.calls('closePath').length
    }
    const all = count(null)
    expect(all).toBeGreaterThan(0)
    expect(count(g.timeline.startDay - 1)).toBe(0)
    const half = count(dayAt(g.timeline.clock, 0.5))
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThanOrEqual(all)
  })

  it('draws the day guide for a hovered day only', () => {
    const guide = (hover: LifeHover) => {
      const rec = recordingCtx()
      paintDayGuide(rec.ctx, axisPaint({ hover }))
      return rec.calls('stroke').length
    }
    expect(guide(null)).toBe(0)
    expect(guide({ kind: 'repo', key: 'kepano/x' })).toBe(0)
    expect(guide({ kind: 'day', day: g.timeline.startDay + 10, milestone: null })).toBe(1)
  })
})

describe('axisHover', () => {
  const sx = (x: number) => g.camera.tx + x * g.camera.k

  it('is null off the canvas, and outside the life away from any marker', () => {
    const axis = axisOf(g.timeline)
    expect(onCanvas(VIEW, -1, 10)).toBe(false)
    expect(onCanvas(VIEW, 10, VIEW.height + 1)).toBe(false)
    expect(onCanvas(VIEW, 0, 0)).toBe(true)
    expect(axisHover(axis, g.camera, VIEW, -5, 100)).toBeNull()
    expect(axisHover(axis, g.camera, VIEW, 100, -5)).toBeNull()
    expect(axisHover(axis, g.camera, VIEW, sx(-2), 100)).toBeNull()
    expect(axisHover(axis, g.camera, VIEW, sx(axis.days + 2), 100)).toBeNull()
  })

  it('snaps to the nearest milestone marker on the horizon, and gives the day under the pointer elsewhere', () => {
    const axis = axisOf(g.timeline)
    const m = axis.milestones[0]
    expect(axisHover(axis, g.camera, VIEW, sx(m.x) + 1, horizonY(VIEW) - 1)).toEqual({ kind: 'day', day: axis.startDay + Math.floor(m.x), milestone: m.index })
    expect(axisHover(axis, g.camera, VIEW, sx(m.x), horizonY(VIEW) - MILESTONE_HIT_PX - 1)).toEqual({
      kind: 'day',
      day: axis.startDay + Math.floor((sx(m.x) - g.camera.tx) / g.camera.k),
      milestone: null,
    })
    const hover = axisHover(axis, g.camera, VIEW, sx(100.5), 200)
    expect(hover).toEqual({ kind: 'day', day: axis.startDay + 100, milestone: null })
  })
})
