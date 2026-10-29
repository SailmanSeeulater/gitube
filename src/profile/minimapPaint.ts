/**
 * Canvas drawing for the minimap view (a console view: a code editor's chrome, after VS Code's
 * Dark+). The shared time axis under a dark editor; a faint guide at each new year, like an indent
 * guide; the hovered row's current-line band and the selected row's selection band; every repo as a
 * line of code, its active spans rounded syntax tokens in its language's tone, its dormant spans
 * whitespace dots (while the rows are tall enough to show them) and a square in the accent, a
 * little taller than its tokens, on each day a pull request of theirs landed in it; the milestones and the hovered
 * day's guide; then the chrome over it all, in screen px whatever the camera: the gutter's line
 * numbers, the tab bar ("life.garden"), and the minimap strip at the right edge with a box over the
 * stretch of time on screen. The labels go on top (useLifeLabels) and are the only repo names on the
 * canvas: this draws none, only line numbers, the tab's file name, years and "today".
 *
 * Its colours are src/theme/console/minimap.ts's, whatever the app's theme, the shared labels'
 * plates and dots included (the view's ink, minimapInk, and its itemColour, rowColour).
 */
import { MINIMAP_DIM_ALPHA, MINIMAP_PALETTE as P, minimapInk } from '../theme/console/minimap'
import { screenToWorldX } from './lifeCamera'
import { horizonY } from './lifeGeometry'
import { paintAxisBackdrop, paintAxisMilestones, paintCanvasFill, paintDayGuide, type LifeAxisPaint } from './lifeAxis'
import type { LifeViewport } from './lifeTypes'
import type { LifeViewPaintInput } from './lifeView'
import {
  GUTTER_PAD_PX,
  TAB_BAR_PX,
  drawnTo,
  gutterWidth,
  rooted,
  rowY,
  sown,
  stripLeft,
  stripRowY,
  stripX,
  tokenSpan,
  type MinimapGeom,
  type MinimapLayout,
  type MinimapRow,
} from './minimapLayout'

export type MinimapPaintInput = LifeViewPaintInput<MinimapLayout, MinimapGeom>

/** The tab's file name: never a repo's. */
export const TAB_NAME = 'life.garden'
/** The tab's close mark. */
const TAB_CLOSE = '×'
const TAB_FONT = '11px ui-sans-serif, system-ui, -apple-system, sans-serif'
const TAB_PAD_PX = 12
const TAB_ICON_PX = 6
const TAB_ACCENT_PX = 1
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
/** A selection dims every other row to this. */
export const DIM_ALPHA = MINIMAP_DIM_ALPHA
/** The guides at each new year, at this alpha. */
const GUIDE_ALPHA = 0.9
/** Whitespace dots only on rows at least this far apart, this far apart along the row. */
export const DOTS_MIN_PITCH = 7
const DOT_GAP_PX = 6
const DOT_PX = 1.5
/** A token's corners. */
const TOKEN_RADIUS_PX = 3
/** A current-line band is at least this tall. */
const MIN_BAND_PX = 2
/** A landed pull request's square: this much taller than a token, and at least this wide. */
const LANDED_PAD_PX = 1
export const LANDED_MIN_PX = 3
/** The selected row's edge in the gutter. */
const SELECT_EDGE_PX = 2
/** Things this far off screen are skipped. */
const CULL_PX = 8

/** A tone's colour: its language's syntax colour, cycling; plain without a language. */
export function toneColour(tone: number): string {
  return tone < 0 ? P.plain : P.tokens[tone % P.tokens.length]
}

/** A row's token colour: a comment while archived, else its tone's. */
export function rowColour(row: Pick<MinimapRow, 'dry' | 'tone'>): string {
  return row.dry ? P.comment : toneColour(row.tone)
}

/** The row's label anchor: its root once rooted, else where it starts, on its centre line. */
export function minimapAnchor(layout: MinimapLayout, g: MinimapGeom, i: number, at: number | null, out: Float32Array): boolean {
  const row = layout.rows[i]
  if (row === undefined) return false
  out[0] = g.camera.tx + (rooted(row, at) ? row.x : row.x0) * g.camera.k
  out[1] = rowY(g, i)
  out[2] = Math.max(2, g.tokenH / 2)
  return true
}

/** The heaviest rows' names first, then the most starred, then line order. */
export function minimapLabelOrder(layout: MinimapLayout): Int32Array {
  const rows = layout.rows
  return Int32Array.from(rows.keys()).sort((a, b) => rows[b].weight - rows[a].weight || rows[b].stars - rows[a].stars || a - b)
}

/** Labels keep off the ground, the tab bar over the rows, the gutter and the minimap strip. */
export function minimapKeepOut(_layout: MinimapLayout, view: LifeViewport): Float32Array {
  const horizon = horizonY(view)
  return Float32Array.of(
    0, horizon - 1, view.width, view.height,
    0, 0, view.width, view.top + TAB_BAR_PX,
    0, 0, gutterWidth(view), horizon,
    stripLeft(view), 0, view.width, view.height,
  )
}

/** A rounded rectangle's path, added to the current one. */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** A row: its whitespace dots, then its tokens, then its landed squares, up to `to`, between the gutter and the strip. */
function drawRow(ctx: CanvasRenderingContext2D, row: MinimapRow, y: number, to: number, g: MinimapGeom): void {
  const { k, tx } = g.camera
  const left = g.gutterW - CULL_PX
  const right = g.strip.x0 + CULL_PX
  const sx = (x: number) => tx + x * k

  if (g.pitch >= DOTS_MIN_PITCH && row.dormant.length > 0) {
    ctx.beginPath()
    let any = false
    for (const d of row.dormant) {
      if (d.x0 >= to) break
      const a = Math.max(left, sx(d.x0) + DOT_GAP_PX / 2)
      const b = Math.min(right, sx(Math.min(d.x1, to)) - DOT_GAP_PX / 2)
      if (b <= a) continue
      ctx.moveTo(a, y)
      ctx.lineTo(b, y)
      any = true
    }
    if (any) {
      ctx.setLineDash([DOT_PX, DOT_GAP_PX - DOT_PX])
      ctx.lineCap = 'butt'
      ctx.lineWidth = DOT_PX
      ctx.strokeStyle = P.whitespace
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  const h = g.tokenH
  ctx.beginPath()
  let any = false
  for (const t of row.tokens) {
    if (t.x0 > to) break
    const [a, b] = tokenSpan(sx(t.x0), sx(Math.min(t.x1, to)))
    if (b < left || a > right) continue
    const x0 = Math.max(left, a)
    const x1 = Math.min(right, b)
    roundRect(ctx, x0, y - h / 2, x1 - x0, h, TOKEN_RADIUS_PX)
    any = true
  }
  if (any) {
    const colour = rowColour(row)
    if (row.seedling && h >= 3) {
      ctx.strokeStyle = colour
      ctx.lineWidth = 1
      ctx.stroke()
    } else {
      ctx.fillStyle = colour
      ctx.fill()
    }
  }

  // a landed pull request: a square in the accent on its day, once reached
  if (row.landed.length > 0) {
    const side = Math.max(LANDED_MIN_PX, h + 2 * LANDED_PAD_PX)
    ctx.fillStyle = P.accent
    ctx.beginPath()
    let landed = false
    for (const lx of row.landed) {
      if (Math.floor(lx) > to) break
      const cx = sx(lx)
      if (cx + side / 2 < left || cx - side / 2 > right) continue
      ctx.rect(cx - side / 2, y - side / 2, side, side)
      landed = true
    }
    if (landed) ctx.fill()
  }
}

/** The gutter: its background over anything under it, the line numbers, the active ones bright. */
function drawGutter(ctx: CanvasRenderingContext2D, layout: MinimapLayout, g: MinimapGeom, shown: (i: number) => boolean, active: number[], horizon: number): void {
  ctx.fillStyle = P.background
  ctx.fillRect(0, g.tabBottom, g.gutterW, Math.max(0, horizon - 1 - g.tabBottom))
  ctx.font = `${g.numberPx}px ${MONO}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const x = g.gutterW - GUTTER_PAD_PX
  ctx.fillStyle = P.lineNumber
  for (let i = 0; i < layout.rows.length; i++) {
    if ((i + 1) % g.numberStep !== 0 && i !== 0) continue
    if (!shown(i) || active.includes(i)) continue
    ctx.fillText(String(i + 1), x, rowY(g, i))
  }
  for (const i of active) {
    const y = rowY(g, i)
    const h = Math.max(g.pitch, g.numberPx + 2)
    ctx.fillStyle = P.background
    ctx.fillRect(0, y - h / 2, g.gutterW, h)
    ctx.fillStyle = P.lineNumberActive
    ctx.fillText(String(i + 1), x, y)
  }
}

/** The tab bar: one active tab, the file "life.garden". */
function drawTabBar(ctx: CanvasRenderingContext2D, g: MinimapGeom, view: LifeViewport): void {
  const top = g.tabTop
  ctx.fillStyle = P.tabBar
  ctx.fillRect(0, top, view.width, TAB_BAR_PX)
  ctx.fillStyle = P.tabBorder
  ctx.fillRect(0, g.tabBottom - 1, view.width, 1)

  ctx.font = TAB_FONT
  const nameW = ctx.measureText(TAB_NAME).width
  const closeW = ctx.measureText(TAB_CLOSE).width
  const x0 = Math.max(0, g.gutterW - TAB_PAD_PX)
  const w = TAB_PAD_PX + TAB_ICON_PX + 6 + nameW + 10 + closeW + TAB_PAD_PX
  ctx.fillStyle = P.tabActive
  ctx.fillRect(x0, top, w, TAB_BAR_PX)
  ctx.fillStyle = P.tabAccent
  ctx.fillRect(x0, top, w, TAB_ACCENT_PX)

  const mid = top + TAB_BAR_PX / 2
  let x = x0 + TAB_PAD_PX
  ctx.fillStyle = toneColour(0)
  ctx.fillRect(x, mid - TAB_ICON_PX / 2, TAB_ICON_PX, TAB_ICON_PX)
  x += TAB_ICON_PX + 6
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = P.tabText
  ctx.fillText(TAB_NAME, x, mid)
  x += nameW + 10
  ctx.fillStyle = P.tabMuted
  ctx.fillText(TAB_CLOSE, x, mid)
}

/** The minimap strip: every row shown as bars, the box over what is on screen, the active rows marked. */
function drawStrip(
  ctx: CanvasRenderingContext2D,
  input: MinimapPaintInput,
  shown: (i: number) => boolean,
  alphaOf: (i: number) => number,
  active: number[],
  horizon: number,
): void {
  const { layout, geoms: g, camera, at } = input
  const s = g.strip
  ctx.globalAlpha = 1
  ctx.fillStyle = P.stripBackground
  ctx.fillRect(s.x0, g.tabBottom, s.x1 - s.x0, Math.max(0, horizon - 1 - g.tabBottom))
  ctx.fillStyle = P.stripShadow
  ctx.fillRect(s.x0, g.tabBottom, 1, Math.max(0, horizon - 1 - g.tabBottom))

  const rows = layout.rows
  for (let i = 0; i < rows.length; i++) {
    if (!shown(i)) continue
    const row = rows[i]
    const to = drawnTo(row, layout.startDay, at)
    const y = stripRowY(s, i)
    ctx.globalAlpha = alphaOf(i)
    ctx.fillStyle = rowColour(row)
    // tokens closer than a pixel merge into one bar
    let a = Number.NaN
    let b = Number.NaN
    for (const t of row.tokens) {
      if (t.x0 > to) break
      const ta = stripX(s, t.x0)
      const tb = Math.max(ta + 1, stripX(s, Math.min(t.x1, to)))
      if (b === b && ta - b < 1) {
        b = Math.max(b, tb)
        continue
      }
      if (a === a) ctx.fillRect(a, y, b - a, s.barH)
      a = ta
      b = tb
    }
    if (a === a) ctx.fillRect(a, y, b - a, s.barH)
  }
  ctx.globalAlpha = 1

  // the stretch of time between the gutter and the strip
  const v0 = Math.max(0, screenToWorldX(camera, g.gutterW))
  const v1 = Math.min(s.days, screenToWorldX(camera, s.x0))
  if (v1 > v0) {
    ctx.fillStyle = P.stripSlider
    const a = stripX(s, v0)
    ctx.fillRect(a, s.y0, Math.max(1, stripX(s, v1) - a), s.y1 - s.y0)
  }

  for (const i of active) {
    ctx.fillStyle = P.stripMark
    ctx.fillRect(s.x0 + 1, stripRowY(s, i) + s.barH / 2 - 0.5, s.x1 - s.x0 - 1, 1)
  }
}

/** Paints the whole frame. The context comes in with the device pixel transform set; it is left as it came. */
export function paintMinimap(ctx: CanvasRenderingContext2D, input: MinimapPaintInput): void {
  const { layout, timeline, geoms: g, camera, view, hidden, hover, selected, at } = input
  const ink = minimapInk(input.ink)
  const colourOf = (language: string | null) => (language === null ? P.plain : toneColour(layout.toneOf.get(language) ?? -1))
  const horizon = horizonY(view)
  const sx = (x: number) => camera.tx + x * camera.k
  const axis: LifeAxisPaint = { axis: layout, timeline, camera, view, ink, colourOf, hover, at }
  const rows = layout.rows

  paintCanvasFill(ctx, ink)
  ctx.save()
  ctx.globalAlpha = 1
  paintAxisBackdrop(ctx, axis, { yearBands: false })

  // a guide at each new year, over the rows
  ctx.globalAlpha = GUIDE_ALPHA
  ctx.beginPath()
  let guides = false
  for (const year of layout.years) {
    if (!(year.x0 > 0)) continue
    const x = Math.round(sx(year.x0)) + 0.5
    if (x < g.gutterW || x > g.strip.x0) continue
    ctx.moveTo(x, g.rowsTop)
    ctx.lineTo(x, horizon)
    guides = true
  }
  if (guides) {
    ctx.strokeStyle = P.indentGuide
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  const shown = (i: number) => {
    const row = rows[i]
    return row !== undefined && !hidden.has(row.key) && sown(row, at)
  }
  const sel = selected !== null ? (layout.byKey.get(selected) ?? -1) : -1
  const hov = hover?.kind === 'repo' ? (layout.byKey.get(hover.key) ?? -1) : -1
  const active = [sel, hov].filter((i, n, all) => i >= 0 && shown(i) && all.indexOf(i) === n)
  const alphaOf = (i: number) => (sel >= 0 && shown(sel) && sel !== i ? DIM_ALPHA : 1)

  // the current line and the selection, across the editor
  const band = (i: number, colour: string) => {
    const h = Math.max(MIN_BAND_PX, g.pitch)
    ctx.fillStyle = colour
    ctx.fillRect(g.gutterW, rowY(g, i) - h / 2, g.strip.x0 - g.gutterW, h)
  }
  if (hov >= 0 && hov !== sel && shown(hov)) band(hov, P.lineHighlight)
  if (sel >= 0 && shown(sel)) band(sel, P.selection)

  // the lines of code
  for (let i = 0; i < rows.length; i++) {
    if (!shown(i)) continue
    const row = rows[i]
    const to = drawnTo(row, layout.startDay, at)
    if (sx(to) < g.gutterW - CULL_PX || sx(row.x0) > g.strip.x0 + CULL_PX) continue
    ctx.globalAlpha = alphaOf(i)
    drawRow(ctx, row, rowY(g, i), to, g)
  }
  ctx.globalAlpha = 1

  paintAxisMilestones(ctx, axis)
  paintDayGuide(ctx, axis)

  // the chrome over it all
  drawGutter(ctx, layout, g, shown, active, horizon)
  if (sel >= 0 && shown(sel)) {
    const h = Math.max(MIN_BAND_PX, g.pitch)
    ctx.fillStyle = P.selectionEdge
    ctx.fillRect(g.gutterW - SELECT_EDGE_PX, rowY(g, sel) - h / 2, SELECT_EDGE_PX, h)
  }
  drawTabBar(ctx, g, view)
  drawStrip(ctx, input, shown, alphaOf, active, horizon)

  ctx.restore()
}
