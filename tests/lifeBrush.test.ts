import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIFE_MAX_K, fitLifeCamera, isZoomedLifeCamera, screenToWorldX, windowLifeCamera, zoomLifeCamera } from '../src/profile/lifeCamera'
import type { LifeCamera, LifeViewport } from '../src/profile/lifeTypes'
import { lifeWindowLabel } from '../src/profile/LifeViewCanvas'
import { dayNumber } from '../src/profile/timeline'
import { BRUSH_MIN_PX, CanvasLoop, brushSpan, paintBrush, type LifeBrushStyle } from '../src/profile/useLifeCanvas'
import canvasSource from '../src/profile/useLifeCanvas.ts?raw'

// Drag across the view to zoom into that stretch of time (as a price chart does): the camera the
// drag ends on, the band drawn while it is dragged, and what the stretch is called.

const VIEW: LifeViewport = { width: 1280, height: 800, top: 72, ground: 44, side: 28 }
/** About 13 years. */
const DAYS = 4800
const PLOT = VIEW.width - 2 * VIEW.side
const sx = (c: LifeCamera, x: number) => c.tx + x * c.k

describe('zooming into a stretch of time', () => {
  const fit = fitLifeCamera(DAYS, VIEW)

  it('spreads the days between the two ends across the plot, whichever way the drag went', () => {
    const c = windowLifeCamera(fit, 400, 700, DAYS, VIEW)
    const [from, to] = [screenToWorldX(fit, 400), screenToWorldX(fit, 700)]
    expect(sx(c, from)).toBeCloseTo(VIEW.side, 6)
    expect(sx(c, to)).toBeCloseTo(VIEW.width - VIEW.side, 6)
    expect(c.k).toBeCloseTo(PLOT / (to - from), 9)
    expect(windowLifeCamera(fit, 700, 400, DAYS, VIEW)).toEqual(c)
  })

  it('zooms again from a zoomed camera, into the days under the drag', () => {
    const once = windowLifeCamera(fit, 400, 700, DAYS, VIEW)
    const [from, to] = [screenToWorldX(once, 200), screenToWorldX(once, 500)]
    const twice = windowLifeCamera(once, 200, 500, DAYS, VIEW)
    expect(sx(twice, from)).toBeCloseTo(VIEW.side, 6)
    expect(sx(twice, to)).toBeCloseTo(VIEW.width - VIEW.side, 6)
    expect(twice.k).toBeGreaterThan(once.k)
  })

  it('stops at the closest zoom, with the stretch in the middle of the plot', () => {
    const near = zoomLifeCamera(fit, 40, 640, DAYS, VIEW)
    const [from, to] = [screenToWorldX(near, 600), screenToWorldX(near, 620)]
    const c = windowLifeCamera(near, 600, 620, DAYS, VIEW)
    expect(c.k).toBe(LIFE_MAX_K)
    expect((sx(c, from) + sx(c, to)) / 2).toBeCloseTo(VIEW.width / 2, 6)
  })

  it('keeps to the life: a drag past either end takes the life up to that end', () => {
    const c = windowLifeCamera(fit, -500, 300, DAYS, VIEW)
    expect(sx(c, 0)).toBeCloseTo(VIEW.side, 6)
    expect(sx(c, screenToWorldX(fit, 300))).toBeCloseTo(VIEW.width - VIEW.side, 6)
    const end = windowLifeCamera(fit, 1000, 5000, DAYS, VIEW)
    expect(sx(end, DAYS)).toBeCloseTo(VIEW.width - VIEW.side, 6)
    // the whole life, or nothing at all, changes nothing
    expect(windowLifeCamera(fit, -100, 9000, DAYS, VIEW)).toEqual(fit)
    expect(windowLifeCamera(fit, 300, 300, DAYS, VIEW)).toEqual(fit)
    expect(windowLifeCamera(fit, Number.NaN, 300, DAYS, VIEW)).toEqual(fit)
  })

  it('knows a part of the life from the whole of it', () => {
    expect(isZoomedLifeCamera(fit, DAYS, VIEW)).toBe(false)
    expect(isZoomedLifeCamera(windowLifeCamera(fit, 400, 700, DAYS, VIEW), DAYS, VIEW)).toBe(true)
    // a life too short to fill the plot has nothing to zoom out of
    expect(isZoomedLifeCamera(fitLifeCamera(10, VIEW), 10, VIEW)).toBe(false)
  })
})

describe('the brush', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const fit = fitLifeCamera(DAYS, VIEW)
  const STYLE: LifeBrushStyle = { accent: 'accent', text: 'text', plateFill: 'plate', plateRing: 'ring', font: '12px sans-serif', label: () => 'Mar 2019' }

  /** A context that records what is filled, in which colour and at which alpha. */
  function recorder() {
    const rects: Array<{ x: number; y: number; w: number; h: number; fill: string; alpha: number }> = []
    const texts: Array<{ text: string; x: number; y: number; fill: string }> = []
    const ctx = {
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textBaseline: '',
      textAlign: '',
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      beginPath: () => undefined,
      rect: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      measureText: (text: string) => ({ width: text.length * 7 }),
      fillRect(x: number, y: number, w: number, h: number) {
        rects.push({ x, y, w, h, fill: this.fillStyle, alpha: this.globalAlpha })
      },
      fillText(text: string, x: number, y: number) {
        texts.push({ text, x, y, fill: this.fillStyle })
      },
    }
    return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, texts }
  }

  it('spans from the day it was pressed on to the pointer, left to right, inside the plot', () => {
    const anchor = screenToWorldX(fit, 500)
    expect(brushSpan({ anchor, x: 800 }, fit, VIEW)).toEqual([500, 800])
    expect(brushSpan({ anchor, x: 200 }, fit, VIEW)).toEqual([200, 500])
    expect(brushSpan({ anchor, x: -90 }, fit, VIEW)).toEqual([VIEW.side, 500])
    expect(brushSpan({ anchor, x: 9000 }, fit, VIEW)).toEqual([500, VIEW.width - VIEW.side])
    // the press keeps its day when the camera moves under it
    const moved = zoomLifeCamera(fit, 2, 640, DAYS, VIEW)
    expect(brushSpan({ anchor, x: 900 }, moved, VIEW)[0]).toBeCloseTo(sx(moved, anchor), 9)
  })

  it('is drawn as a faint band down the whole view with an edge at each end and its label on a plate', () => {
    const { ctx, rects, texts } = recorder()
    const seen: Array<[number, number]> = []
    paintBrush(ctx, VIEW, fit, { anchor: screenToWorldX(fit, 500), x: 800 }, { ...STYLE, label: (from, to) => (seen.push([from, to]), 'Mar 2019') })
    const [band, left, right] = rects
    expect(band).toMatchObject({ x: 500, y: 0, w: 300, h: VIEW.height, fill: 'accent' })
    expect(band.alpha).toBeGreaterThan(0)
    expect(band.alpha).toBeLessThan(0.3)
    expect(left).toMatchObject({ x: 500, w: 1, h: VIEW.height, fill: 'accent', alpha: 1 })
    expect(right).toMatchObject({ x: 799, w: 1, h: VIEW.height, fill: 'accent', alpha: 1 })
    // the label names the days under the band, over its middle, below the bar's row
    expect(seen[0][0]).toBeCloseTo(screenToWorldX(fit, 500), 9)
    expect(seen[0][1]).toBeCloseTo(screenToWorldX(fit, 800), 9)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toMatchObject({ text: 'Mar 2019', x: 650, fill: 'text' })
    expect(texts[0].y).toBeGreaterThan(VIEW.top)
  })

  it('keeps its label inside the canvas, and draws none when the stretch has no name', () => {
    const edge = recorder()
    paintBrush(edge.ctx, VIEW, fit, { anchor: screenToWorldX(fit, VIEW.side), x: VIEW.side + 10 }, { ...STYLE, label: () => '3 Mar – 19 Apr 2019' })
    const half = (edge.texts[0].text.length * 7 + 14) / 2
    expect(edge.texts[0].x - half).toBeGreaterThanOrEqual(0)
    const none = recorder()
    paintBrush(none.ctx, VIEW, fit, { anchor: 100, x: 400 }, { ...STYLE, label: () => '' })
    expect(none.texts).toEqual([])
    expect(none.rects).toHaveLength(3)
  })

  it('is painted over each frame while it is held, and the loop says when there is something to zoom out of', () => {
    const queued: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queued.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const { ctx, rects } = recorder()
    const l = new CanvasLoop()
    const order: string[] = []
    l.canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement
    l.paint = () => (order.push('view'), false)
    l.brushStyle = { ...STYLE, label: () => (order.push('brush'), '') }
    l.days = DAYS
    const heard: boolean[] = []
    l.onZoomed = (zoomed) => heard.push(zoomed)
    const run = (now: number) => {
      for (const cb of queued.splice(0)) cb(now)
    }
    l.resize(VIEW)
    run(0)
    expect(rects).toEqual([])
    expect(heard).toEqual([])

    l.brush = { anchor: screenToWorldX(fit, 400), x: 700 }
    l.invalidate()
    run(16)
    expect(order).toEqual(['view', 'view', 'brush']) // over the view, never under it
    expect(rects).toHaveLength(3)

    // let go: the camera glides into the stretch, and the loop says so as the glide starts
    const target = windowLifeCamera(l.camera!, 400, 700, DAYS, VIEW)
    l.brush = null
    l.set(target, 320)
    run(32)
    expect(heard).toEqual([true])
    run(2000)
    expect(l.camera).toEqual(target)
    expect(rects).toHaveLength(3)

    // and back out to the whole life
    l.fit(320)
    run(3000)
    expect(heard).toEqual([true, false])
    run(9000)
    expect(l.camera).toEqual(fit)
    expect(queued).toHaveLength(0)
  })

  it('belongs to a mouse drag without Shift: a finger, a pen or Shift pans, and a short one zooms nowhere', () => {
    expect(BRUSH_MIN_PX).toBeGreaterThanOrEqual(4)
    expect(canvasSource).toContain("startDrag(e.clientX, e.pointerType === 'mouse' && !e.shiftKey)")
    expect(canvasSource).toContain('if (x1 - x0 >= BRUSH_MIN_PX) loop.set(windowLifeCamera(camera, x0, x1, loop.days, v), FIT_GLIDE_MS)')
    // a cancelled pointer and Escape let go without zooming
    expect(canvasSource).toContain("e.type === 'pointerup'")
    expect(canvasSource).toContain("if (e.key === 'Escape' && loop.brush) {")
  })
})

describe('what a stretch of the life is called', () => {
  const start = dayNumber('2011-01-01')
  const at = (key: string) => dayNumber(key) - start

  it('names a long stretch by its months', () => {
    expect(lifeWindowLabel(start, at('2019-03-05'), at('2021-08-20') + 1)).toBe('Mar 2019 – Aug 2021')
    expect(lifeWindowLabel(start, at('2019-03-05'), at('2019-11-20') + 1)).toBe('Mar – Nov 2019')
  })

  it('names a short one by its days, and a single day by itself', () => {
    expect(lifeWindowLabel(start, at('2019-03-03'), at('2019-04-19') + 1)).toBe('3 Mar – 19 Apr 2019')
    expect(lifeWindowLabel(start, at('2019-12-20'), at('2020-01-05') + 1)).toBe('20 Dec 2019 – 5 Jan 2020')
    expect(lifeWindowLabel(start, at('2019-03-03') + 0.2, at('2019-03-03') + 0.9)).toBe('3 Mar 2019')
  })

  it('counts a day the stretch only touches the edge of as outside it', () => {
    // from the start of 3 March to the start of 5 March: the 3rd and the 4th
    expect(lifeWindowLabel(start, at('2019-03-03'), at('2019-03-05'))).toBe('3 Mar – 4 Mar 2019')
  })

  it('has no name for no stretch', () => {
    expect(lifeWindowLabel(start, 10, 10)).toBe('')
    expect(lifeWindowLabel(start, 20, 10)).toBe('')
    expect(lifeWindowLabel(start, Number.NaN, 10)).toBe('')
  })
})
