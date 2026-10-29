/**
 * Canvas drawing for the htop view: a system monitor's screen whatever the app theme. A header strip
 * of years at the top, a dim gridline at each new year, then one row per repo, its meter a run of
 * "|" ticks along the time axis between "[" and "]": active stretches lit in the language's colour
 * (brighter the busier), dormant ones a dim baseline, and a cell in the accent, full height, on each
 * day a pull request of theirs landed in the repo. A dim PID gutter numbers the rows at the left;
 * the selected row gets htop's cursor bar, the hovered one a fainter bar. Under the rows the horizon,
 * the language ribbon, today, the milestones and the hovered day's guide, from the shared axis.
 *
 * The rows' names are the shared labels, anchored at each meter's left bracket; this draws no repo
 * name, only years, "PID", row numbers and "today". Colours come only from HTOP_PALETTE (and
 * htopInk), never from the theme's ink or language palette. Everything is drawn in screen px under
 * the device pixel transform.
 */
import { HTOP_DIM_ALPHA, HTOP_PALETTE, htopInk } from '../theme/console/htop'
import { horizonY } from './lifeGeometry'
import { LIFE_YEAR_FONT, RIBBON_GAP_PX, RIBBON_PX, paintAxisMilestones, paintCanvasFill, paintDayGuide, type LifeAxisPaint } from './lifeAxis'
import type { LifeViewport } from './lifeTypes'
import type { LifeViewPaintInput } from './lifeView'
import type { HtopLayout, HtopRow } from './htopLayout'
import { HTOP_CELL_PX, HTOP_GUTTER_PX, HTOP_HEADER_PX, HTOP_TICK_PX, htopDrawnTo, htopSown, rowY, type HtopGeom } from './htopGeometry'

export type HtopPaintInput = LifeViewPaintInput<HtopLayout, HtopGeom>

/** A meter's stretch at each level: dormant (a dim baseline), then quiet to busy ticks. */
export const LEVEL_ALPHA: readonly [number, number, number, number] = [0.3, 0.45, 0.72, 1]
/** The dormant baseline's height, as a share of a tick's, at least 1 px. */
const BASELINE_SHARE = 0.18
/** The year gridlines' alpha. */
const GRID_ALPHA = 0.6
/** The selected row's cursor bar and the hovered row's. */
const SELECT_BAR_ALPHA = 0.28
const HOVER_BAR_ALPHA = 0.16
/** Other rows while one is selected. */
const DIM_ALPHA = HTOP_DIM_ALPHA
/** A bracket's arms reach this far along x, and stand this share of the pitch tall. */
const BRACKET_ARM_PX = 2
const BRACKET_SHARE = 0.8
/** Brackets sit this far outside the meter. */
export const BRACKET_GAP_PX = 2
/** The gutter's numbers and the header's years. */
const GUTTER_FONT = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const YEAR_GAP_PX = 34
/** Rows this far off screen are skipped. */
const CULL_PX = 8
/** A landed pull request's cell: this wide, and this share of the pitch tall. */
export const LANDED_CELL_PX = HTOP_CELL_PX
const LANDED_SHARE = 0.9

/** A language's colour on the console: its slot's, or the no-language colour. */
export function htopLanguageColour(layout: Pick<HtopLayout, 'slots'>, language: string | null): string {
  const slot = language !== null ? layout.slots.get(language) : undefined
  return slot === undefined ? HTOP_PALETTE.none : HTOP_PALETTE.languages[slot % HTOP_PALETTE.languages.length]
}

/** A row's colour: its language's, or the dry colour of an archived repo. */
export function htopRowColour(row: Pick<HtopRow, 'dry' | 'slot'>): string {
  if (row.dry) return HTOP_PALETTE.dry
  return row.slot < 0 ? HTOP_PALETTE.none : HTOP_PALETTE.languages[row.slot % HTOP_PALETTE.languages.length]
}

/** The row's label anchor: its meter's left bracket, r the half row (kept between 2 and 5 px). */
export function htopAnchor(layout: HtopLayout, g: HtopGeom, i: number, _at: number | null, out: Float32Array): boolean {
  const row = layout.rows[i]
  if (row === undefined) return false
  out[0] = g.camera.tx + row.x0 * g.camera.k
  out[1] = rowY(g, i)
  out[2] = Math.max(2, Math.min(5, g.pitch / 2))
  return true
}

/** The heaviest rows' names first, then the most starred, then row order. */
export function htopLabelOrder(layout: HtopLayout): Int32Array {
  const rows = layout.rows
  return Int32Array.from(rows.keys()).sort((a, b) => rows[b].weight - rows[a].weight || rows[b].stars - rows[a].stars || a - b)
}

/** Labels keep off the header strip, the gutter and the ground under the horizon. */
export function htopKeepOut(_layout: HtopLayout, view: LifeViewport): Float32Array {
  const horizon = horizonY(view)
  return Float32Array.of(
    0, view.top, view.width, view.top + HTOP_HEADER_PX,
    0, view.top, HTOP_GUTTER_PX, horizon,
    0, horizon - 1, view.width, view.height,
  )
}

/**
 * One row's meter: its dormant baseline, its ticks by level, its landed cells and its brackets,
 * filled to the screen x `end`; nothing past `limit` (the time-lapse's day, `reached` in world x).
 */
function drawMeter(ctx: CanvasRenderingContext2D, row: HtopRow, g: HtopGeom, y: number, end: number, limit: number, reached: number, W: number, alpha: number): void {
  const { k, tx } = g.camera
  const sx = (x: number) => tx + x * k
  const colour = htopRowColour(row)
  const left = sx(row.x0)
  const lo = Math.max(-CULL_PX, left)
  const hi = Math.min(W + CULL_PX, end)
  const h = g.tickPx
  const tick = g.detail ? HTOP_TICK_PX : HTOP_CELL_PX
  ctx.fillStyle = colour

  for (let level = 0; level <= 3; level++) {
    ctx.globalAlpha = alpha * LEVEL_ALPHA[level]
    ctx.beginPath()
    let any = false
    for (const cell of row.cells) {
      if (cell.level !== level) continue
      const a = Math.max(lo, sx(cell.x0))
      const b = Math.min(hi, sx(cell.x1))
      if (b <= a) continue
      if (level === 0) {
        const bh = Math.max(1, h * BASELINE_SHARE)
        ctx.rect(a, y - bh / 2, b - a, bh)
        any = true
        continue
      }
      // a tick per cell of the screen's grid the stretch covers, cut at its ends; a sliver gets 1 px
      const c0 = Math.floor((a - tx) / HTOP_CELL_PX)
      const c1 = Math.ceil((b - tx) / HTOP_CELL_PX)
      let drew = false
      for (let c = c0; c < c1; c++) {
        const x0 = Math.max(a, tx + c * HTOP_CELL_PX)
        const x1 = Math.min(b, tx + c * HTOP_CELL_PX + tick)
        if (x1 - x0 < 0.5) continue
        ctx.rect(x0, y - h / 2, x1 - x0, h)
        drew = true
      }
      if (!drew) ctx.rect(a, y - h / 2, Math.min(1, hi - a), h)
      any = true
    }
    if (any) ctx.fill()
  }

  // a landed pull request: a cell in the accent, full height, on its day, once reached
  if (row.landed.length > 0) {
    ctx.globalAlpha = alpha
    ctx.fillStyle = HTOP_PALETTE.accent
    ctx.beginPath()
    const lh = Math.max(1, g.pitch * LANDED_SHARE)
    let any = false
    for (const lx of row.landed) {
      if (Math.floor(lx) > reached) break
      const cx = sx(lx)
      if (cx < -CULL_PX || cx > W + CULL_PX) continue
      ctx.rect(Math.round(cx - LANDED_CELL_PX / 2), y - lh / 2, LANDED_CELL_PX, lh)
      any = true
    }
    if (any) ctx.fill()
  }

  if (!g.detail) return
  // [ at the meter's start and ] where it is filled to
  ctx.globalAlpha = alpha
  ctx.strokeStyle = HTOP_PALETTE.bracket
  ctx.lineWidth = 1
  const bh = (g.pitch * BRACKET_SHARE) / 2
  ctx.beginPath()
  const l = Math.round(left - BRACKET_GAP_PX) + 0.5
  if (l >= -CULL_PX && l <= W + CULL_PX) {
    ctx.moveTo(l + BRACKET_ARM_PX, y - bh)
    ctx.lineTo(l, y - bh)
    ctx.lineTo(l, y + bh)
    ctx.lineTo(l + BRACKET_ARM_PX, y + bh)
  }
  const r = Math.min(Math.round(end + BRACKET_GAP_PX), Math.floor(limit)) - 0.5
  if (r >= -CULL_PX && r <= W + CULL_PX && end > left) {
    ctx.moveTo(r - BRACKET_ARM_PX, y - bh)
    ctx.lineTo(r, y - bh)
    ctx.lineTo(r, y + bh)
    ctx.lineTo(r - BRACKET_ARM_PX, y + bh)
  }
  ctx.stroke()
}

/** Paints the whole frame. The context comes in with the device pixel transform set; it is left as it came. */
export function paintHtop(ctx: CanvasRenderingContext2D, input: HtopPaintInput): void {
  const { layout, timeline, geoms: g, camera, view, hidden, hover, selected, at } = input
  const P = HTOP_PALETTE
  const ink = htopInk(input.ink)
  const colourOf = (language: string | null) => htopLanguageColour(layout, language)
  const W = view.width
  const horizon = horizonY(view)
  const sx = (x: number) => camera.tx + x * camera.k
  const reached = at === null ? Infinity : at - layout.startDay
  const rows = layout.rows

  paintCanvasFill(ctx, ink)
  ctx.save()
  ctx.globalAlpha = 1

  // the header strip, with each year from its first day (thinned out when they crowd)
  ctx.fillStyle = P.header
  ctx.fillRect(0, g.headerTop, W, HTOP_HEADER_PX)
  ctx.font = LIFE_YEAR_FONT
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = P.headerText
  const headerMid = g.headerTop + HTOP_HEADER_PX / 2
  let lastYear = -Infinity
  for (const year of layout.years) {
    if (year.x0 > reached) break
    const x = Math.max(sx(year.x0), sx(0))
    if (x - lastYear < YEAR_GAP_PX || x > W) continue
    lastYear = x
    if (x + YEAR_GAP_PX < HTOP_GUTTER_PX) continue
    ctx.fillText(String(year.year), Math.max(HTOP_GUTTER_PX, x) + 2, headerMid)
  }

  // a dim gridline at each new year
  ctx.strokeStyle = P.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  let grid = false
  for (const year of layout.years) {
    if (!(year.x0 > 0) || year.x0 > reached) continue
    const x = Math.round(sx(year.x0)) + 0.5
    if (x < HTOP_GUTTER_PX || x > W) continue
    ctx.moveTo(x, g.top)
    ctx.lineTo(x, horizon)
    grid = true
  }
  if (grid) {
    ctx.globalAlpha = GRID_ALPHA
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  const shown = (row: HtopRow | undefined): row is HtopRow => row !== undefined && !hidden.has(row.key) && htopSown(row, at)
  const sel = selected !== null ? (layout.byKey.get(selected) ?? -1) : -1
  const hov = hover?.kind === 'repo' ? (layout.byKey.get(hover.key) ?? -1) : -1

  // htop's cursor bar under the selected row, a fainter one under the hovered
  const bar = (i: number, colour: string, alpha: number) => {
    if (!shown(rows[i])) return
    ctx.globalAlpha = alpha
    ctx.fillStyle = colour
    const h = Math.max(1, g.pitch)
    const w = Math.min(W, sx(reached))
    if (w > 0) ctx.fillRect(0, rowY(g, i) - h / 2, w, h)
  }
  if (hov >= 0 && hov !== sel) bar(hov, P.hover, HOVER_BAR_ALPHA)
  if (sel >= 0) bar(sel, P.select, SELECT_BAR_ALPHA)

  // the meters, the rows on screen only
  if (rows.length > 0 && g.pitch > 0) {
    const first = Math.max(0, Math.floor((0 - g.top) / g.pitch) - 1)
    const last = Math.min(rows.length - 1, Math.ceil((view.height - g.top) / g.pitch))
    for (let i = first; i <= last; i++) {
      const row = rows[i]
      if (!shown(row)) continue
      const end = sx(htopDrawnTo(row, layout.startDay, at))
      if (end < -CULL_PX || sx(row.x0) > W + CULL_PX) continue
      const alpha = sel >= 0 && sel !== i && hov !== i ? DIM_ALPHA : 1
      drawMeter(ctx, row, g, rowY(g, i), end, sx(reached), reached, W, alpha)
    }
  }

  // the PID gutter over everything to its right that panned under it
  ctx.globalAlpha = 1
  ctx.fillStyle = P.gutter
  ctx.fillRect(0, g.headerTop, HTOP_GUTTER_PX, horizon - g.headerTop)
  ctx.font = GUTTER_FONT
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = P.gutterText
  ctx.fillText('PID', HTOP_GUTTER_PX - 3, headerMid)
  if (rows.length > 0 && g.pitch > 0) {
    for (let i = 0; i < rows.length; i += g.pidEvery) {
      if (!shown(rows[i])) continue
      ctx.fillText(String(i + 1), HTOP_GUTTER_PX - 3, rowY(g, i))
    }
    // the selected and hovered rows' own numbers, lit
    for (const [i, colour] of [[hov, P.hover], [sel, P.select]] as const) {
      if (i < 0 || !shown(rows[i])) continue
      const h = Math.max(1, Math.min(12, g.pitch))
      ctx.fillStyle = P.gutter
      ctx.fillRect(0, rowY(g, i) - h / 2, HTOP_GUTTER_PX, h)
      ctx.fillStyle = colour
      ctx.fillText(String(i + 1), HTOP_GUTTER_PX - 3, rowY(g, i))
    }
  }

  // the horizon, the language ribbon under it as far as the time-lapse has reached, and today
  ctx.strokeStyle = P.grid
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, horizon)
  ctx.lineTo(W, horizon)
  ctx.stroke()
  for (const era of layout.languages) {
    const x0 = Math.max(0, sx(era.x0))
    const x1 = Math.min(W, sx(Math.min(era.x1, reached)))
    if (x1 <= x0) continue
    ctx.fillStyle = colourOf(era.language)
    ctx.fillRect(x0, horizon + RIBBON_GAP_PX, x1 - x0, RIBBON_PX)
  }
  const todayX = sx(layout.days)
  if (at === null && todayX >= 0 && todayX <= W) {
    ctx.strokeStyle = P.muted
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(todayX, horizon - 4)
    ctx.lineTo(todayX, horizon + RIBBON_GAP_PX + RIBBON_PX + 2)
    ctx.stroke()
    ctx.font = LIFE_YEAR_FONT
    ctx.fillStyle = P.muted
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText('today', todayX, horizon + RIBBON_GAP_PX + RIBBON_PX + 4)
  }

  const axis: LifeAxisPaint = { axis: layout, timeline, camera, view, ink, colourOf, hover, at }
  paintAxisMilestones(ctx, axis)
  paintDayGuide(ctx, axis)

  ctx.restore()
}
