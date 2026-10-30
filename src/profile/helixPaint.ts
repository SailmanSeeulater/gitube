/**
 * Canvas drawing for the helix view: an amber vector display. The shared time axis (lifeAxis.ts)
 * along the horizon, the axis coil wound over it one turn a year with a hoop at each January 1,
 * every repo as a thread on its ring (thick where busy, thin where dormant, dashed for a repo they
 * only contributed to, dim when archived, a dot where it is wound on, a bright diamond on each day
 * a pull request of theirs landed), the far side of the coil dimmer than the near side, the
 * milestones on the horizon, the hovered and the selected thread in halos, and the hovered day as a
 * ring on the coil. The labels go on top (useLifeLabels), placed by helixAnchor (on the start dots),
 * helixLabelOrder and helixKeepOut.
 *
 * A vector display keeps its own colours whatever the app's theme (HELIX_PALETTE, under src/theme),
 * one amber hue shaded with globalAlpha only. It draws years and "today", never a repo name.
 *
 * Strokes are batched: every span of every drawn thread goes into one path per style (colour,
 * width, alpha, dash) and side of the coil, the far side's paths first, so a frame of hundreds of
 * threads is a few dozen strokes.
 */
import { HELIX_PALETTE, HELIX_DIM_ALPHA, helixInk } from '../theme/console/helix'
import { paintAxisBackdrop, paintAxisMilestones, paintCanvasFill, paintDayGuide, type LifeAxisPaint } from './lifeAxis'
import { horizonY } from './lifeGeometry'
import type { LifeViewport } from './lifeTypes'
import type { LifeViewPaintInput } from './lifeView'
import { SAMPLE_DAYS, type HelixLayout, type HelixThread } from './helixLayout'
import { START_PX, drawnTo, markReached, pointAt, spanWidth, walkSpan, wound, type HelixGeom } from './helixGeometry'

export type HelixPaintInput = LifeViewPaintInput<HelixLayout, HelixGeom>

/** The far side of the coil, at this share of the near side's alpha. */
export const FAR_ALPHA = 0.45
/** A dormant span, at this share of a thread's alpha. */
const DORMANT_ALPHA = 0.5
/** An archived repo, at this share... */
const DRY = 0.7
/** ...an uncounted repo at this... */
const UNCOUNTED = 0.55
/** ...and every thread but the selected one while a selection is held. */
const UNSELECTED = HELIX_DIM_ALPHA
/** A repo they only contributed to is dashed: this on, this off. */
const DASH: readonly number[] = [4, 3]
/** The axis coil's width, and the year hoops'. */
const CAGE_PX = 1
/** The hovered thread's halo, this far round it, at this alpha... */
const HALO_PX = 4
const HALO_ALPHA = 0.4
/** ...and the selected thread's. */
const SELECTED_HALO_PX = 5
const SELECTED_HALO_ALPHA = 0.5
/** A landed pull request's diamond: this far from its centre to each corner. */
export const LANDED_PX = 3
/** The hovered day's ring on the axis coil. */
const DAY_RING_PX = 4
const TWO_PI = Math.PI * 2

const groundColour = () => HELIX_PALETTE.ground

/** A thread's colour on the label plate: amber, dim while archived (the display's own, whatever the theme). */
export function helixColour(thread: Pick<HelixThread, 'dry'>): string {
  return thread.dry ? HELIX_PALETTE.dim : HELIX_PALETTE.thread
}

/** One batch of strokes: the spans drawn in one style. */
interface Batch {
  colour: string
  width: number
  alpha: number
  dashed: boolean
  /** thread index, span index, pairs */
  spans: number[]
}

/**
 * Adds the drawn stretch of a span to the current path, on one side of the coil only (near: the
 * segments whose middle is on the near side), as runs of lineTo from a moveTo.
 */
function traceSide(layout: HelixLayout, g: HelixGeom, ctx: CanvasRenderingContext2D, thread: HelixThread, span: HelixThread['spans'][number], to: number, near: boolean): void {
  const r = g.ring[thread.track]
  let px = 0
  let py = 0
  let pd = 0
  let first = true
  let open = false
  walkSpan(layout, g, r, span, to, (x, y, d) => {
    if (!first) {
      const side = pd + d >= 0
      if (side === near) {
        if (!open) {
          ctx.moveTo(px, py)
          open = true
        }
        ctx.lineTo(x, y)
      } else open = false
    }
    px = x
    py = y
    pd = d
    first = false
  })
}

/** The axis coil from world x 0 to `to`, on one side, as runs of lineTo; then a hoop at each January 1 reached. */
function traceCage(layout: HelixLayout, g: HelixGeom, ctx: CanvasRenderingContext2D, view: LifeViewport, to: number, near: boolean): void {
  const W = view.width
  const { camera } = g
  // only the stretch on the canvas, a turn either side
  const x0 = Math.max(0, Math.floor((-g.skew - camera.tx) / camera.k / SAMPLE_DAYS) * SAMPLE_DAYS)
  const x1 = Math.min(to, (W + g.skew - camera.tx) / camera.k)
  if (!(x1 > x0)) return
  let px = 0
  let py = 0
  let pd = 0
  let open = false
  let x = x0
  for (;;) {
    const [sx, sy, d] = pointAt(layout, g, g.R, x)
    if (x > x0) {
      if (pd + d >= 0 === near) {
        if (!open) {
          ctx.moveTo(px, py)
          open = true
        }
        ctx.lineTo(sx, sy)
      } else open = false
    }
    px = sx
    py = sy
    pd = d
    if (x >= x1) break
    x = Math.min(x1, x + SAMPLE_DAYS)
  }
}

/** Paints the whole frame. The context comes in with the device pixel transform set; it is left as it came. */
export function paintHelix(ctx: CanvasRenderingContext2D, input: HelixPaintInput): void {
  const { layout, timeline, geoms: g, camera, view, ink, hidden, hover, selected, at } = input
  const W = view.width
  const { threads } = layout
  const screen = helixInk(ink)
  const axis: LifeAxisPaint = { axis: layout, timeline, camera, view, ink: screen, colourOf: groundColour, hover, at }
  const atX = at === null ? layout.days : Math.min(layout.days, at - layout.startDay)

  paintCanvasFill(ctx, screen)
  ctx.save()
  ctx.globalAlpha = 1
  paintAxisBackdrop(ctx, axis)

  const sel = selected !== null ? (layout.byKey.get(selected) ?? -1) : -1
  const hov = hover?.kind === 'repo' ? (layout.byKey.get(hover.key) ?? -1) : -1
  const drawn = (i: number) => i >= 0 && !hidden.has(threads[i].key) && wound(threads[i], at)
  const onCanvas = (thread: HelixThread) => {
    const left = camera.tx + thread.x0 * camera.k - g.skew
    const right = camera.tx + drawnTo(thread, layout.startDay, at) * camera.k + g.skew
    return right >= -HALO_PX && left <= W + HALO_PX
  }
  const alphaOf = (i: number) => (sel >= 0 && sel !== i ? UNSELECTED : 1) * (threads[i].dry ? DRY : 1) * (threads[i].uncounted ? UNCOUNTED : 1)

  // the spans of every drawn thread, batched by style
  const batches = new Map<string, Batch>()
  const shown: number[] = []
  for (let i = 0; i < threads.length; i++) {
    if (!drawn(i) || !onCanvas(threads[i])) continue
    shown.push(i)
    const thread = threads[i]
    const to = drawnTo(thread, layout.startDay, at)
    const colour = i === sel ? HELIX_PALETTE.bright : helixColour(thread)
    const base = alphaOf(i)
    thread.spans.forEach((span, s) => {
      if (!(to > span.x0)) return
      const width = spanWidth(span, g)
      const alpha = base * (span.kind === 'dormant' ? DORMANT_ALPHA : 1)
      const key = `${colour}|${width}|${alpha}|${thread.visiting ? 1 : 0}`
      let batch = batches.get(key)
      if (!batch) {
        batch = { colour, width, alpha, dashed: thread.visiting, spans: [] }
        batches.set(key, batch)
      }
      batch.spans.push(i, s)
    })
  }

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const near of [false, true]) {
    const side = near ? 1 : FAR_ALPHA
    // the cage under the threads on each side
    ctx.beginPath()
    traceCage(layout, g, ctx, view, atX, near)
    ctx.strokeStyle = HELIX_PALETTE.cage
    ctx.lineWidth = CAGE_PX
    ctx.globalAlpha = side
    ctx.setLineDash([])
    ctx.stroke()

    // the hovered and the selected thread's halos, under the threads
    const halo = (i: number, colour: string, extra: number, alpha: number) => {
      if (!drawn(i) || !onCanvas(threads[i])) return
      const thread = threads[i]
      const to = drawnTo(thread, layout.startDay, at)
      ctx.strokeStyle = colour
      ctx.globalAlpha = alpha * side
      ctx.setLineDash([])
      for (const span of thread.spans) {
        if (!(to > span.x0)) break
        ctx.beginPath()
        traceSide(layout, g, ctx, thread, span, to, near)
        ctx.lineWidth = spanWidth(span, g) + 2 * extra
        ctx.stroke()
      }
    }
    halo(sel, HELIX_PALETTE.bright, SELECTED_HALO_PX, SELECTED_HALO_ALPHA)
    if (hov !== sel) halo(hov, HELIX_PALETTE.text, HALO_PX, HALO_ALPHA)

    for (const batch of batches.values()) {
      ctx.beginPath()
      for (let k = 0; k < batch.spans.length; k += 2) {
        const thread = threads[batch.spans[k]]
        traceSide(layout, g, ctx, thread, thread.spans[batch.spans[k + 1]], drawnTo(thread, layout.startDay, at), near)
      }
      ctx.strokeStyle = batch.colour
      ctx.lineWidth = batch.width
      ctx.globalAlpha = batch.alpha * side
      ctx.setLineDash(batch.dashed ? [...DASH] : [])
      ctx.stroke()
    }
    ctx.setLineDash([])

    // each thread's start dot, and its landed pull requests reached, on this side
    for (const i of shown) {
      const thread = threads[i]
      const r = g.ring[thread.track]
      const alpha = alphaOf(i) * side
      const [dx, dy, dd] = pointAt(layout, g, r, thread.x0)
      if (dd >= 0 === near) {
        ctx.beginPath()
        ctx.arc(dx, dy, START_PX, 0, TWO_PI)
        ctx.fillStyle = i === sel ? HELIX_PALETTE.bright : helixColour(thread)
        ctx.globalAlpha = alpha
        ctx.fill()
      }
      if (thread.landed.length === 0) continue
      ctx.fillStyle = HELIX_PALETTE.bright
      ctx.globalAlpha = alpha
      for (const lx of thread.landed) {
        if (!markReached(lx, layout.startDay, at)) break
        const [x, y, d] = pointAt(layout, g, r, lx)
        if (d >= 0 !== near) continue
        ctx.beginPath()
        ctx.moveTo(x, y - LANDED_PX)
        ctx.lineTo(x + LANDED_PX, y)
        ctx.lineTo(x, y + LANDED_PX)
        ctx.lineTo(x - LANDED_PX, y)
        ctx.closePath()
        ctx.fill()
      }
    }
  }

  // a hoop at each January 1 reached: the coil's cross-section
  ctx.strokeStyle = HELIX_PALETTE.cage
  ctx.lineWidth = CAGE_PX
  ctx.globalAlpha = FAR_ALPHA
  for (const yx of layout.yearStarts) {
    if (yx > atX) break
    if (yx < 0) continue
    const x = camera.tx + yx * camera.k
    if (x < -g.skew || x > W + g.skew) continue
    ctx.beginPath()
    ctx.ellipse(x, g.cy, Math.max(0.5, g.skew), g.R, 0, 0, TWO_PI)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  paintAxisMilestones(ctx, axis)
  paintDayGuide(ctx, axis)

  // the hovered day: a ring on the axis coil where the guide crosses it
  if (hover?.kind === 'day') {
    const x = hover.day - layout.startDay + 0.5
    if (x >= 0 && x <= atX) {
      const [dx, dy] = pointAt(layout, g, g.R, x)
      ctx.beginPath()
      ctx.arc(dx, dy, DAY_RING_PX, 0, TWO_PI)
      ctx.strokeStyle = screen.hoverRing
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Where thread i's label points: its start dot (where it is wound on: its own spot, where every live thread's end is today's), and the dot's radius plus a px. */
export function helixAnchor(layout: HelixLayout, g: HelixGeom, i: number, at: number | null, out: Float32Array): boolean {
  const thread = layout.threads[i]
  if (thread === undefined || !wound(thread, at)) return false
  const [x, y] = pointAt(layout, g, g.ring[thread.track], thread.x0)
  out[0] = x
  out[1] = y
  out[2] = START_PX + 1
  return true
}

/** Thread indexes, the heaviest first, then the most starred, then in paint order. */
export function helixLabelOrder(layout: HelixLayout): Int32Array {
  const { threads } = layout
  return Int32Array.from(threads.keys()).sort((a, b) => threads[b].weight - threads[a].weight || threads[b].stars - threads[a].stars || a - b)
}

/** What labels keep off: the ground under the horizon. */
export function helixKeepOut(_layout: HelixLayout, view: LifeViewport): Float32Array {
  return Float32Array.of(0, horizonY(view) - 1, view.width, view.height)
}
