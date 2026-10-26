/**
 * The canvas host person mode's views share: a canvas that fills its box at the device's pixel
 * ratio, an x-only camera over the life's days (lifeCamera.ts) that the wheel, a drag, a pinch and
 * the keyboard move, and frames painted on demand. A frame is painted only when something asks for
 * one (invalidate, a camera move, a new size, a new paint function); frames keep coming only while
 * the camera glides or the paint asks for more (labels settling, the time-lapse playing).
 *
 * The camera lives outside React: a pan or a zoom repaints without rendering anything.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { LifeCamera, LifeViewport } from './lifeTypes'
import { clampLifeCamera, fitLifeCamera, panLifeCamera, resizeLifeCamera, zoomLifeCamera } from './lifeCamera'

/** Paints one frame (the context has the device pixel transform set); true asks for another. */
export type LifePaint = (ctx: CanvasRenderingContext2D, view: LifeViewport, camera: LifeCamera, dtMs: number) => boolean

export interface LifeCanvasOptions {
  /** the world's width: the life's days */
  days: number
  /** the viewport's frame in CSS px (LifeViewport) */
  top: number
  ground: number
  side: number
  paint: LifePaint
  /** a new value fits the camera to the whole life again (a new profile) */
  fitKey?: unknown
}

export interface LifeCanvasHandle {
  hostRef: RefObject<HTMLDivElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  /** null until the host has a size */
  view: LifeViewport | null
  getView: () => LifeViewport | null
  getCamera: () => LifeCamera | null
  /** moves the camera (clamped to the life), gliding there over glideMs */
  setCamera: (camera: LifeCamera, glideMs?: number) => void
  fit: (glideMs?: number) => void
  invalidate: () => void
  /** the last press dragged or pinched the camera, so the click that ends it is not a click */
  wasDrag: () => boolean
}

/** a refit's glide, and a key's */
const FIT_GLIDE_MS = 320
const KEY_GLIDE_MS = 160
/** a key pans this share of the width, and zooms by this factor */
const KEY_PAN = 0.2
const KEY_ZOOM = 1.5
/** zoom per wheel px, and per px of a trackpad pinch (which arrives as a wheel with ctrlKey) */
const WHEEL_ZOOM = 0.0015
const PINCH_WHEEL_ZOOM = 0.01
/** a press moving less than this is a click, not a drag */
const DRAG_PX = 4

/** The camera on its way from one place to another. */
export interface LifeGlide {
  from: LifeCamera
  to: LifeCamera
  /** performance time of its first frame; -1 before it */
  start: number
  ms: number
}

function ease(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2
}

/** The camera u of the way from a to b: the zoom on a log scale, the day in the middle of the view evenly. */
function between(a: LifeCamera, b: LifeCamera, u: number, width: number): LifeCamera {
  const k = Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * u)
  const ca = (width / 2 - a.tx) / a.k
  const cb = (width / 2 - b.tx) / b.k
  return { k, tx: width / 2 - (ca + (cb - ca) * u) * k }
}

/**
 * The camera u (0..1) of the way through a glide, eased; at the end, the glide's end clamped to
 * the life in the view as it is now.
 */
export function glideCamera(glide: Pick<LifeGlide, 'from' | 'to'>, u: number, days: number, view: LifeViewport): LifeCamera {
  return u >= 1 ? clampLifeCamera(glide.to, days, view) : between(glide.from, glide.to, ease(Math.max(0, u)), view.width)
}

/**
 * A glide carried over to a new size: both ends keep their stretch of days and the day in their
 * middle (resizeLifeCamera), so it lands where it would have landed had the canvas been this size.
 */
export function resizeGlide<G extends Pick<LifeGlide, 'from' | 'to'>>(glide: G, from: LifeViewport, to: LifeViewport, days: number): G {
  return { ...glide, from: resizeLifeCamera(glide.from, from, to, days), to: resizeLifeCamera(glide.to, from, to, days) }
}

/** The camera, the frame loop and the canvas they paint, outside React. Exported for its tests. */
export class CanvasLoop {
  canvas: HTMLCanvasElement | null = null
  view: LifeViewport | null = null
  camera: LifeCamera | null = null
  days = 1
  dpr = 1
  paint: LifePaint = () => false
  dragged = false
  private glide: LifeGlide | null = null
  private raf = 0
  private last = -1

  invalidate = (): void => {
    if (this.raf !== 0 || typeof requestAnimationFrame !== 'function') return
    this.raf = requestAnimationFrame(this.frame)
  }

  stop(): void {
    if (this.raf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf)
    this.raf = 0
    this.glide = null
  }

  set(camera: LifeCamera, glideMs = 0): void {
    if (!this.view) return
    const to = clampLifeCamera(camera, this.days, this.view)
    this.glide = glideMs > 0 && this.camera ? { from: this.camera, to, start: -1, ms: glideMs } : null
    if (!this.glide) this.camera = to
    this.invalidate()
  }

  fit(glideMs = 0): void {
    if (this.view) this.set(fitLifeCamera(this.days, this.view), glideMs)
  }

  /** Stops a glide where it is (a new press takes over). */
  hold(): void {
    this.glide = null
  }

  /**
   * A new size: the camera keeps the day in the middle and the stretch of days, and so do both ends
   * of a glide under way. The first size fits the whole life.
   */
  resize(view: LifeViewport): void {
    const from = this.view
    this.view = view
    if (this.camera && from) {
      this.camera = resizeLifeCamera(this.camera, from, view, this.days)
      if (this.glide) this.glide = resizeGlide(this.glide, from, view, this.days)
    } else {
      this.camera = fitLifeCamera(this.days, view)
      this.glide = null
    }
    this.invalidate()
  }

  private frame = (now: number): void => {
    this.raf = 0
    const { canvas, view } = this
    if (!canvas || !view || !this.camera) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dt = this.last < 0 ? 1000 / 60 : Math.min(64, Math.max(0, now - this.last))
    this.last = now
    const glide = this.glide
    if (glide) {
      if (glide.start < 0) glide.start = now
      const u = Math.min(1, (now - glide.start) / glide.ms)
      this.camera = glideCamera(glide, u, this.days, view)
      if (u >= 1) this.glide = null
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    const more = this.paint(ctx, view, this.camera, dt)
    if (more || this.glide) this.invalidate()
    else this.last = -1
  }
}

function pixelRatio(): number {
  return typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
}

export function useLifeCanvas(opts: LifeCanvasOptions): LifeCanvasHandle {
  const { days, top, ground, side, paint, fitKey } = opts
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [loop] = useState(() => new CanvasLoop())
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 })
  const view = useMemo<LifeViewport | null>(
    () => (size.width > 0 && size.height > 0 ? { width: size.width, height: size.height, top, ground, side } : null),
    [size, top, ground, side],
  )

  // the latest render's paint: a new one is a new frame (a theme switch, a new namer)
  useLayoutEffect(() => {
    loop.paint = paint
    loop.invalidate()
  }, [loop, paint])

  // the host's size, and the device pixel ratio, read again when it changes (a move to another screen)
  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    let media: MediaQueryList | null = null
    let watched = 0
    const measure = () => {
      const width = Math.max(0, Math.round(el.clientWidth))
      const height = Math.max(0, Math.round(el.clientHeight))
      const dpr = pixelRatio()
      setSize((prev) => (prev.width === width && prev.height === height && prev.dpr === dpr ? prev : { width, height, dpr }))
      if (dpr === watched || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
      media?.removeEventListener('change', measure)
      media = window.matchMedia(`(resolution: ${dpr}dppx)`)
      media.addEventListener('change', measure)
      watched = dpr
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(el)
    return () => {
      observer?.disconnect()
      media?.removeEventListener('change', measure)
    }
  }, [])

  // the backing store follows the view, and the camera (and a glide under way) keeps the day in the middle of it
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    loop.canvas = canvas
    if (!canvas || !view) return
    canvas.width = Math.max(1, Math.round(view.width * size.dpr))
    canvas.height = Math.max(1, Math.round(view.height * size.dpr))
    canvas.style.width = `${view.width}px`
    canvas.style.height = `${view.height}px`
    loop.dpr = size.dpr
    loop.resize(view)
  }, [loop, view, size.dpr])

  // a new life (or a new profile of the same length) starts fitted
  useLayoutEffect(() => {
    loop.days = Math.max(1, days)
    loop.hold()
    if (loop.view) loop.camera = fitLifeCamera(loop.days, loop.view)
    loop.invalidate()
  }, [loop, days, fitKey])

  // the camera's inputs, as native listeners: React's wheel listener is passive and cannot stop the page scrolling
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pointers = new Map<number, { x: number; y: number }>()
    let drag: { x: number; camera: LifeCamera; moved: boolean } | null = null
    let pinch: { dist: number; mid: number; camera: LifeCamera } | null = null
    const localX = (clientX: number) => clientX - canvas.getBoundingClientRect().left
    const startDrag = (x: number) => {
      drag = loop.camera ? { x, camera: loop.camera, moved: false } : null
    }
    const startPinch = () => {
      const [a, b] = [...pointers.values()]
      pinch = loop.camera ? { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: localX((a.x + b.x) / 2), camera: loop.camera } : null
      drag = null
    }

    const onWheel = (e: WheelEvent) => {
      const { view: v, camera } = loop
      if (!v || !camera) return
      e.preventDefault()
      loop.hold()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? v.height : 1
      const dx = e.deltaX * unit
      const dy = e.deltaY * unit
      if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) loop.set(panLifeCamera(camera, -dx, loop.days, v))
      else loop.set(zoomLifeCamera(camera, Math.exp(-dy * (e.ctrlKey ? PINCH_WHEEL_ZOOM : WHEEL_ZOOM)), localX(e.clientX), loop.days, v))
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (pointers.size === 0) loop.dragged = false
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      canvas.setPointerCapture?.(e.pointerId)
      loop.hold()
      if (pointers.size === 1) startDrag(e.clientX)
      else if (pointers.size === 2) startPinch()
    }
    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      const v = loop.view
      if (!p || !v) return
      p.x = e.clientX
      p.y = e.clientY
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
        const mid = localX((a.x + b.x) / 2)
        const zoomed = zoomLifeCamera(pinch.camera, dist / pinch.dist, pinch.mid, loop.days, v)
        loop.set(panLifeCamera(zoomed, mid - pinch.mid, loop.days, v))
        loop.dragged = true
        return
      }
      if (!drag) return
      const dx = e.clientX - drag.x
      if (!drag.moved && Math.abs(dx) < DRAG_PX) return
      drag.moved = true
      loop.dragged = true
      canvas.style.cursor = 'grabbing'
      loop.set(panLifeCamera(drag.camera, dx, loop.days, v))
    }
    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return
      pinch = null
      const rest = [...pointers.values()]
      if (rest.length === 1) startDrag(rest[0].x)
      else if (rest.length === 0) {
        drag = null
        canvas.style.cursor = ''
      }
    }
    const onDoubleClick = () => loop.fit(FIT_GLIDE_MS)
    const onKey = (e: KeyboardEvent) => {
      const { view: v, camera } = loop
      if (!v || !camera || e.altKey || e.ctrlKey || e.metaKey) return
      const centre = v.width / 2
      let next: LifeCamera | null = null
      if (e.key === 'ArrowLeft') next = panLifeCamera(camera, v.width * KEY_PAN, loop.days, v)
      else if (e.key === 'ArrowRight') next = panLifeCamera(camera, -v.width * KEY_PAN, loop.days, v)
      else if (e.key === '+' || e.key === '=') next = zoomLifeCamera(camera, KEY_ZOOM, centre, loop.days, v)
      else if (e.key === '-' || e.key === '_') next = zoomLifeCamera(camera, 1 / KEY_ZOOM, centre, loop.days, v)
      else if (e.key === '0') next = fitLifeCamera(loop.days, v)
      if (next === null) return
      e.preventDefault()
      loop.set(next, KEY_GLIDE_MS)
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('dblclick', onDoubleClick)
    canvas.addEventListener('keydown', onKey)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('dblclick', onDoubleClick)
      canvas.removeEventListener('keydown', onKey)
    }
  }, [loop])

  useEffect(
    () => () => {
      loop.stop()
      loop.canvas = null
    },
    [loop],
  )

  return useMemo<LifeCanvasHandle>(
    () => ({
      hostRef,
      canvasRef,
      view,
      getView: () => loop.view,
      getCamera: () => loop.camera,
      setCamera: (camera, glideMs) => loop.set(camera, glideMs),
      fit: (glideMs) => loop.fit(glideMs),
      invalidate: loop.invalidate,
      wasDrag: () => loop.dragged,
    }),
    [loop, view],
  )
}
