import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIFE_MAX_K,
  clampLifeCamera,
  fitLifeCamera,
  panLifeCamera,
  resizeLifeCamera,
  revealLifeCamera,
  screenToWorldX,
  zoomLifeCamera,
} from '../src/profile/lifeCamera'
import type { LifeCamera, LifeViewport } from '../src/profile/lifeTypes'
import { CanvasLoop, glideCamera, resizeGlide } from '../src/profile/useLifeCanvas'

const VIEW: LifeViewport = { width: 1280, height: 800, top: 72, ground: 44, side: 28 }
/** About 13 years. */
const DAYS = 4800
const PLOT = VIEW.width - 2 * VIEW.side

/** The screen x of world x. */
const sx = (c: LifeCamera, x: number) => c.tx + x * c.k

describe('life camera', () => {
  it('fits the whole life across the plot, margin to margin', () => {
    const c = fitLifeCamera(DAYS, VIEW)
    expect(sx(c, 0)).toBeCloseTo(VIEW.side, 9)
    expect(sx(c, DAYS)).toBeCloseTo(VIEW.width - VIEW.side, 9)
    expect(c.k).toBeCloseTo(PLOT / DAYS, 12)
  })

  it('centres a life too short to fill the plot at the closest zoom, and holds it there', () => {
    // a 10-day-old account: 240 px at 24 px a day
    const c = fitLifeCamera(10, VIEW)
    expect(c.k).toBe(LIFE_MAX_K)
    expect(sx(c, 0) - VIEW.side).toBeCloseTo(VIEW.width - VIEW.side - sx(c, 10), 9)
    expect(zoomLifeCamera(c, 3, 400, 10, VIEW)).toEqual(c)
    expect(zoomLifeCamera(c, 0.2, 400, 10, VIEW)).toEqual(c)
    expect(panLifeCamera(c, 300, 10, VIEW)).toEqual(c)
    expect(clampLifeCamera({ k: 3, tx: -9000 }, 10, VIEW)).toEqual(c)
    // one day, as an account made today has
    const one = fitLifeCamera(1, VIEW)
    expect(one.k).toBe(LIFE_MAX_K)
    expect(sx(one, 0.5)).toBeCloseTo(VIEW.width / 2, 9)
  })

  it('zooms around the pointer: the day under it stays under it', () => {
    const c = fitLifeCamera(DAYS, VIEW)
    const at = 700
    const before = screenToWorldX(c, at)
    const z = zoomLifeCamera(c, 4, at, DAYS, VIEW)
    expect(z.k).toBeCloseTo(c.k * 4, 12)
    expect(screenToWorldX(z, at)).toBeCloseTo(before, 9)
    const back = zoomLifeCamera(z, 0.25, at, DAYS, VIEW)
    expect(back.k).toBeCloseTo(c.k, 12)
    expect(back.tx).toBeCloseTo(c.tx, 9)
  })

  it(`zooms no closer than ${LIFE_MAX_K} px a day and no wider than the whole life`, () => {
    const c = fitLifeCamera(DAYS, VIEW)
    expect(zoomLifeCamera(c, 1e6, 600, DAYS, VIEW).k).toBe(LIFE_MAX_K)
    expect(zoomLifeCamera(c, 1e-6, 600, DAYS, VIEW)).toEqual(c)
    expect(clampLifeCamera({ k: 1e9, tx: 0 }, DAYS, VIEW).k).toBe(LIFE_MAX_K)
    expect(clampLifeCamera({ k: 0, tx: 0 }, DAYS, VIEW)).toEqual(c)
  })

  it('pans no further than the life reaches at either end', () => {
    const z = zoomLifeCamera(fitLifeCamera(DAYS, VIEW), 10, 640, DAYS, VIEW)
    const left = panLifeCamera(z, 1e7, DAYS, VIEW)
    expect(sx(left, 0)).toBeCloseTo(VIEW.side, 9)
    const right = panLifeCamera(z, -1e7, DAYS, VIEW)
    expect(sx(right, DAYS)).toBeCloseTo(VIEW.width - VIEW.side, 9)
    const step = panLifeCamera(z, 50, DAYS, VIEW)
    expect(step.tx).toBeCloseTo(z.tx + 50, 9)
    expect(step.k).toBe(z.k)
  })

  it('keeps the middle day and the stretch of days when the canvas changes size, and a fitted camera fitted', () => {
    const z = zoomLifeCamera(fitLifeCamera(DAYS, VIEW), 6, 500, DAYS, VIEW)
    const middle = screenToWorldX(z, VIEW.width / 2)
    const shown = (VIEW.width - 2 * VIEW.side) / z.k
    const to: LifeViewport = { ...VIEW, width: 700 }
    const r = resizeLifeCamera(z, VIEW, to, DAYS)
    expect(screenToWorldX(r, to.width / 2)).toBeCloseTo(middle, 9)
    expect((to.width - 2 * to.side) / r.k).toBeCloseTo(shown, 9)
    const fitted = resizeLifeCamera(fitLifeCamera(DAYS, VIEW), VIEW, to, DAYS)
    expect(fitted.k).toBeCloseTo(fitLifeCamera(DAYS, to).k, 12)
    expect(fitted.tx).toBeCloseTo(fitLifeCamera(DAYS, to).tx, 9)
  })

  it('reveals a day off screen by centring it, and leaves one on screen where it is', () => {
    const z = zoomLifeCamera(fitLifeCamera(DAYS, VIEW), 20, 28, DAYS, VIEW)
    // on screen: unchanged
    const visible = screenToWorldX(z, 600)
    expect(revealLifeCamera(z, visible, DAYS, VIEW)).toEqual(z)
    // off screen: centred
    const r = revealLifeCamera(z, 3000, DAYS, VIEW)
    expect(sx(r, 3000)).toBeCloseTo(VIEW.width / 2, 9)
    expect(r.k).toBe(z.k)
    // near the end it stops at the life's edge rather than centring past it
    const end = revealLifeCamera(z, DAYS - 1, DAYS, VIEW)
    expect(sx(end, DAYS)).toBeCloseTo(VIEW.width - VIEW.side, 9)
  })

  it('reads the day under a screen x back', () => {
    const c: LifeCamera = { k: 3, tx: 100 }
    expect(screenToWorldX(c, 100)).toBe(0)
    expect(screenToWorldX(c, sx(c, 1234.5))).toBeCloseTo(1234.5, 9)
  })

  it('stays finite on a canvas narrower than its margins and on a bad camera', () => {
    const tiny: LifeViewport = { ...VIEW, width: 40 }
    for (const c of [fitLifeCamera(DAYS, tiny), clampLifeCamera({ k: NaN, tx: NaN }, DAYS, VIEW), fitLifeCamera(0, VIEW)]) {
      expect(Number.isFinite(c.k) && c.k > 0).toBe(true)
      expect(Number.isFinite(c.tx)).toBe(true)
    }
  })
})

describe('a glide across a change of size', () => {
  const NARROW: LifeViewport = { ...VIEW, width: 700 }
  const fitted = fitLifeCamera(DAYS, VIEW)
  // a focus request's glide: zoomed in on day 3000
  const target = revealLifeCamera(zoomLifeCamera(fitted, 12, 640, DAYS, VIEW), 3000, DAYS, VIEW)

  it('lands where it would have on the new size, its ends keeping their stretch of days', () => {
    const moved = resizeGlide({ from: fitted, to: target }, VIEW, NARROW, DAYS)
    expect(moved.from).toEqual(resizeLifeCamera(fitted, VIEW, NARROW, DAYS))
    expect(moved.to).toEqual(resizeLifeCamera(target, VIEW, NARROW, DAYS))
    const end = glideCamera(moved, 1, DAYS, NARROW)
    expect(screenToWorldX(end, NARROW.width / 2)).toBeCloseTo(screenToWorldX(target, VIEW.width / 2), 9)
    expect((NARROW.width - 2 * NARROW.side) / end.k).toBeCloseTo((VIEW.width - 2 * VIEW.side) / target.k, 9)
    // the fitted end stays fitted
    expect(glideCamera(moved, 0, DAYS, NARROW).k).toBeCloseTo(fitLifeCamera(DAYS, NARROW).k, 12)
  })

  it('ends clamped to the life in the view as it is now', () => {
    // an end at the life's last day on the narrow canvas leaves a gap after it on the wide one
    const narrowEnd = panLifeCamera(zoomLifeCamera(fitLifeCamera(DAYS, NARROW), 4, 350, DAYS, NARROW), -1e7, DAYS, NARROW)
    expect(sx(narrowEnd, DAYS)).toBeCloseTo(NARROW.width - NARROW.side, 9)
    const end = glideCamera({ from: fitted, to: narrowEnd }, 1, DAYS, VIEW)
    expect(end).toEqual(clampLifeCamera(narrowEnd, DAYS, VIEW))
    expect(end.k).toBe(narrowEnd.k)
    expect(sx(end, DAYS)).toBeCloseTo(VIEW.width - VIEW.side, 9)
    // halfway it is between its ends
    const half = glideCamera({ from: fitted, to: target }, 0.5, DAYS, VIEW)
    expect(half.k).toBeGreaterThan(fitted.k)
    expect(half.k).toBeLessThan(target.k)
  })
})

describe('the canvas loop', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** A loop on a stand-in canvas, its frames run by hand at the times given, each painted camera kept. */
  function loop() {
    const queued: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queued.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const l = new CanvasLoop()
    const painted: Array<{ view: LifeViewport; camera: LifeCamera }> = []
    l.canvas = { getContext: () => ({ setTransform: () => undefined }) } as unknown as HTMLCanvasElement
    l.paint = (_ctx, view, camera) => {
      painted.push({ view, camera })
      return false
    }
    l.days = DAYS
    const run = (now: number) => {
      for (const cb of queued.splice(0)) cb(now)
      return painted[painted.length - 1]
    }
    return { l, run, queued }
  }

  it('fits the life on its first size, and keeps the middle day on the next', () => {
    const { l, run } = loop()
    l.resize(VIEW)
    expect(run(0).camera).toEqual(fitLifeCamera(DAYS, VIEW))
    l.set(zoomLifeCamera(fitLifeCamera(DAYS, VIEW), 5, 400, DAYS, VIEW))
    const before = l.camera!
    const to: LifeViewport = { ...VIEW, width: 900 }
    l.resize(to)
    expect(run(16)).toEqual({ view: to, camera: resizeLifeCamera(before, VIEW, to, DAYS) })
  })

  // the canvas narrows (the side panel opens) or widens (it closes) a quarter of the way through
  it.each([
    ['narrows', VIEW, { ...VIEW, width: 700 }],
    ['widens', { ...VIEW, width: 700 }, VIEW],
  ] as const)('carries a glide under way over when the canvas %s, and lands it there', (_how, a: LifeViewport, b: LifeViewport) => {
    const { l, run, queued } = loop()
    l.resize(a)
    run(0)
    const from = l.camera!
    // a focus request: zoomed in, towards the life's last days
    const target = revealLifeCamera(zoomLifeCamera(from, 12, a.width / 2, DAYS, a), DAYS - 200, DAYS, a)
    l.set(target, 400)
    run(1000)
    expect(run(1100).camera).toEqual(glideCamera({ from, to: target }, 0.25, DAYS, a))
    l.resize(b)
    const moved = resizeGlide({ from, to: target }, a, b, DAYS)
    expect(run(1200)).toEqual({ view: b, camera: glideCamera(moved, 0.5, DAYS, b) })
    // it lands on its end as the new canvas shows it: the middle day and the stretch of days kept, within the life
    const end = run(1400).camera
    expect(end).toEqual(resizeLifeCamera(target, a, b, DAYS))
    expect(end).toEqual(clampLifeCamera(end, DAYS, b))
    expect((b.width - 2 * b.side) / end.k).toBeCloseTo((a.width - 2 * a.side) / target.k, 9)
    expect(sx(end, DAYS)).toBeGreaterThanOrEqual(b.width - b.side - 1e-9)
    // and asks for no more frames
    expect(queued).toHaveLength(0)
  })
})
