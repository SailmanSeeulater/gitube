/**
 * The time axis every person-mode view draws (lifeView.ts's LifeAxis): the canvas colour, bands for
 * alternate years, the horizon with its language ribbon, the year labels and today, the milestones
 * on the horizon, and the hovered day's guide. One camera means the same stretch of time in every
 * view, so the axis stays put when the view changes.
 *
 * Drawn in screen px under the device pixel transform, from LifeInk and the language palette only.
 * Everything after paintCanvasFill draws inside the caller's save(), with globalAlpha 1, as the
 * life garden always has.
 */
import type { LifeTimeline } from './timeline'
import type { LifeCamera, LifeHover, LifeInk, LifeViewport } from './lifeTypes'
import type { LifeAxis } from './lifeView'
import { horizonY } from './lifeGeometry'

/** Year labels: the repo garden's MONO_FONT at 10 px (pinned in tests/lifeGardenPaint.test.ts). */
export const LIFE_YEAR_FONT = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
/** A year label closer than this to the last one drawn is skipped. */
const YEAR_GAP_PX = 34
const HORIZON_PX = 1.5
/** the language ribbon under the horizon */
export const RIBBON_GAP_PX = 2
export const RIBBON_PX = 4
const DIAMOND_PX = 4
/** A landed pull request's mark: a filled diamond this far from its centre to each corner (before a row's scale). */
export const LANDED_PX = 3.2
const TWO_PI = Math.PI * 2

/** What the axis is drawn from. */
export interface LifeAxisPaint {
  axis: LifeAxis
  timeline: LifeTimeline
  camera: LifeCamera
  view: LifeViewport
  ink: LifeInk
  colourOf: (language: string | null) => string
  hover: LifeHover
  /** the time-lapse's day: milestones it has not reached are not drawn. null: fully grown. */
  at: number | null
}

/** The canvas colour over the whole backing store, so image and video captures are never black. */
export function paintCanvasFill(ctx: CanvasRenderingContext2D, ink: Pick<LifeInk, 'canvas'>): void {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.fillStyle = ink.canvas
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
}

/**
 * The mark of a landed pull request (a pull request of theirs merged into a repo they do not own)
 * in the life views: a filled diamond in the accent over a halo, r px from its centre to each
 * corner. The console views draw their own.
 */
export function drawLandedMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ink: Pick<LifeInk, 'accent' | 'textHalo'>): void {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r, y)
  ctx.closePath()
  ctx.strokeStyle = ink.textHalo
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.fillStyle = ink.accent
  ctx.fill()
}

/** A diamond on (x, y), r px from its centre to each corner; two-coloured for a language switch. */
export function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, left: string, right: string, ink: Pick<LifeInk, 'textHalo'>): void {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r, y)
  ctx.closePath()
  ctx.strokeStyle = ink.textHalo
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.fillStyle = left
  ctx.fill()
  if (right === left) return
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y)
  ctx.lineTo(x, y + r)
  ctx.closePath()
  ctx.fillStyle = right
  ctx.fill()
}

/**
 * Under everything a view draws: [faint bands in the sky for alternate years,] the horizon, a block
 * per language era in its colour under it, the year labels from each year's first day (thinned out
 * when the years crowd together), and today.
 */
export function paintAxisBackdrop(ctx: CanvasRenderingContext2D, a: LifeAxisPaint, opts: { yearBands?: boolean } = {}): void {
  const { axis, camera, view, ink, colourOf } = a
  const W = view.width
  const horizon = horizonY(view)
  const sx = (x: number) => camera.tx + x * camera.k

  // alternate years get a faint band in the sky
  if (opts.yearBands) {
    ctx.fillStyle = ink.eraBand
    for (const year of axis.years) {
      if (year.year % 2 === 0) continue
      const x0 = Math.max(0, sx(year.x0))
      const x1 = Math.min(W, sx(year.x1))
      if (x1 > x0) ctx.fillRect(x0, 0, x1 - x0, horizon)
    }
  }

  // the horizon, and under it a block per language era in its colour
  ctx.beginPath()
  ctx.moveTo(0, horizon)
  ctx.lineTo(W, horizon)
  ctx.strokeStyle = ink.horizon
  ctx.lineWidth = HORIZON_PX
  ctx.stroke()
  for (const era of axis.languages) {
    const x0 = Math.max(0, sx(era.x0))
    const x1 = Math.min(W, sx(era.x1))
    if (x1 <= x0) continue
    ctx.fillStyle = colourOf(era.language)
    ctx.fillRect(x0, horizon + RIBBON_GAP_PX, x1 - x0, RIBBON_PX)
  }

  // year labels from each year's first day, thinned out when the years crowd together, and today
  ctx.font = LIFE_YEAR_FONT
  ctx.fillStyle = ink.muted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const labelY = horizon + RIBBON_GAP_PX + RIBBON_PX + 4
  let lastLabel = -Infinity
  for (const year of axis.years) {
    const x = Math.max(sx(year.x0), sx(0))
    if (x - lastLabel < YEAR_GAP_PX || x > W) continue
    lastLabel = x
    if (x + YEAR_GAP_PX < 0) continue
    ctx.fillText(String(year.year), x + 2, labelY)
  }
  const todayX = sx(axis.days)
  if (todayX >= 0 && todayX <= W) {
    ctx.beginPath()
    ctx.moveTo(todayX, horizon - 4)
    ctx.lineTo(todayX, horizon + RIBBON_GAP_PX + RIBBON_PX + 2)
    ctx.strokeStyle = ink.muted
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.textAlign = 'right'
    ctx.fillText('today', todayX, labelY + 13)
  }
}

/**
 * The milestones on the horizon the time-lapse has reached: a longest streak's bar, then the
 * diamonds, a language switch in both its colours, the hovered one larger and ringed.
 */
export function paintAxisMilestones(ctx: CanvasRenderingContext2D, a: LifeAxisPaint): void {
  const { axis, timeline, camera, view, ink, colourOf, hover, at } = a
  const W = view.width
  const horizon = horizonY(view)
  const sx = (x: number) => camera.tx + x * camera.k
  /** world x of a day number's middle */
  const dayX = (day: number) => day - axis.startDay + 0.5
  const hoverMilestone = hover?.kind === 'day' ? hover.milestone : null
  for (const m of axis.milestones) {
    if (at !== null && m.x > dayX(at)) continue
    const x = sx(m.x)
    if (m.kind === 'longest-streak' && m.x1 !== null) {
      const x1 = Math.min(W, sx(m.x1))
      if (x1 > 0 && x < W) {
        ctx.fillStyle = ink.accent
        ctx.fillRect(Math.max(0, x), horizon - 1, x1 - Math.max(0, x), 2)
      }
    }
    if (x < -DIAMOND_PX * 2 || x > W + DIAMOND_PX * 2) continue
    let left = ink.accent
    let right = ink.accent
    const milestone = timeline.milestones[m.index]
    if (m.kind === 'language-switch' && milestone) {
      const k = timeline.languageEras.findIndex((era) => era.from === milestone.day)
      if (k > 0) {
        left = colourOf(timeline.languageEras[k - 1].language)
        right = colourOf(timeline.languageEras[k].language)
      }
    }
    const hovered = hoverMilestone === m.index
    drawDiamond(ctx, x, horizon, hovered ? DIAMOND_PX + 2 : DIAMOND_PX, left, right, ink)
    if (hovered) {
      ctx.beginPath()
      ctx.arc(x, horizon, DIAMOND_PX + 5, 0, TWO_PI)
      ctx.strokeStyle = ink.hoverRing
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }
}

/** The hovered day's guide, from the top of the canvas to the horizon. */
export function paintDayGuide(ctx: CanvasRenderingContext2D, a: LifeAxisPaint): void {
  const { axis, camera, view, ink, hover } = a
  if (hover?.kind !== 'day') return
  const x = Math.round(camera.tx + (hover.day - axis.startDay + 0.5) * camera.k) + 0.5
  if (x < 0 || x > view.width) return
  ctx.beginPath()
  ctx.moveTo(x, 0)
  ctx.lineTo(x, horizonY(view))
  ctx.strokeStyle = ink.hoverRing
  ctx.lineWidth = 1
  ctx.stroke()
}
