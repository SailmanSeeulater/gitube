/**
 * Canvas drawing for the constellation (PROFILE_SPEC.md section 5, view 3): the shared time axis
 * (lifeAxis.ts), a faint fill behind every other language band, gridlines at the years, the links
 * between repos active at the same time, every repo as a star in its language's band (sized by
 * activity, glowing by stars, with a diamond in the accent at its upper left once a pull request of
 * theirs has landed in it), the bands' names, the milestones on the horizon, and the marks of the
 * hover and the selection. The labels go on top (useLifeLabels), placed by starAnchor,
 * starLabelOrder and constellationKeepOut.
 *
 * Positions come from constellationGeom, which hit testing shares, and colours from LifeInk and the
 * language palette, shaded with globalAlpha only, so every theme works. It draws years, "today" and
 * language names, never a repo name. Everything is drawn in screen px under the device pixel
 * transform, so a zoom spreads stars apart and never stretches them.
 */
import type { LifeInk, LifeViewport } from './lifeTypes'
import type { LifeViewPaintInput } from './lifeView'
import { LANDED_PX, LIFE_YEAR_FONT, drawLandedMark, paintAxisBackdrop, paintAxisMilestones, paintCanvasFill, paintDayGuide, type LifeAxisPaint } from './lifeAxis'
import { horizonY } from './lifeGeometry'
import type { ConstellationLayout, LifeStar } from './constellationLayout'
import { starPlotY, type ConstellationGeom } from './constellationGeometry'

export type ConstellationPaintInput = LifeViewPaintInput<ConstellationLayout, ConstellationGeom>

/** The year gridlines, in the muted colour at this alpha. */
const GRID_ALPHA = 0.18
/** The links, in the muted colour at this alpha, times LINK_DIM behind a selection... */
const LINK_ALPHA = 0.22
const LINK_DIM = 0.4
/** ...and the hovered or selected star's own links, in its colour. */
const LIT_LINK_ALPHA = 0.75
const LIT_LINK_PX = 1.25
/** The glow: discs this share of its reach beyond the core, at these alphas, the outermost faintest. */
const GLOW_DISCS: ReadonlyArray<readonly [number, number]> = [
  [1, 0.1],
  [0.66, 0.16],
  [0.33, 0.24],
]
/** A star just sown on the time-lapse is drawn at this share of its radius at least. */
const MIN_GROWN_R = 0.35
/** A contributed repo's hollow core: its ring's width. */
const HOLLOW_PX = 1.5
/** A fork's companion: this far beyond the core, up and to the right, TWIN_R of its radius. */
const TWIN_GAP_PX = 2.5
/** A landed pull request's diamond: this far beyond the core, up and to the left. */
const LANDED_GAP_PX = 3
const TWIN_R = 0.4
const TWIN_MIN_PX = 1
/** A repo with SPARKLE_STARS stars or more (as the legend says) gets a sparkle: a cross reaching SPARKLE_REACH of the glow past the core. */
const SPARKLE_STARS = 100
const SPARKLE_REACH = 0.9
const SPARKLE_ALPHA = 0.8
/** A seedling (no counted commits) is drawn faint. */
const SEEDLING_ALPHA = 0.55
/** A band's name: its dot and text from here, below the band's top... */
const BAND_NAME_X = 10
const BAND_NAME_DY = 4
const BAND_DOT_R = 3
const BAND_TEXT_X = BAND_NAME_X + 2 * BAND_DOT_R + 4
const BAND_HALO_PX = 3
/** ...in a band at least this tall; labels keep off a box this size round it. */
const BAND_NAME_MIN_PX = 12
const BAND_NAME_W = 120
const BAND_NAME_H = 16
/** The selection's and the hover's rings, this far beyond the core. */
const SELECTED_RING_GAP = 4
const HOVER_RING_GAP = 3
const TWO_PI = Math.PI * 2

/** A star's colour: its language's, or the dry colour of an archived repo. */
export function starColour(star: Pick<LifeStar, 'dry' | 'language'>, ink: Pick<LifeInk, 'dry'>, colourOf: (language: string | null) => string): string {
  return star.dry ? ink.dry : colourOf(star.language)
}

/** How much of a star has grown by the time-lapse's day (0..1), along its growth; 1 when fully grown. */
export function starGrownShare(star: Pick<LifeStar, 'growthDays' | 'growthShares'>, at: number | null): number {
  const days = star.growthDays
  const shares = star.growthShares
  const last = days.length - 1
  if (at === null || last < 0 || at >= days[last]) return 1
  if (!(at > days[0])) return 0
  // the last point on or before at
  let lo = 0
  let hi = last
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (days[mid] <= at) lo = mid
    else hi = mid - 1
  }
  return shares[lo] + ((shares[lo + 1] - shares[lo]) * (at - days[lo])) / (days[lo + 1] - days[lo])
}

/** A core's radius at a grown share: the full radius r shrunk by the share's square root, never under MIN_GROWN_R of it. */
export function grownRadius(r: number, share: number): number {
  return r * Math.max(MIN_GROWN_R, Math.sqrt(share))
}

/** A band's name is drawn when the band is tall enough to hold it. */
function bandNameShown(top: number, foot: number): boolean {
  return foot - top >= BAND_NAME_MIN_PX
}

function drawStar(ctx: CanvasRenderingContext2D, star: LifeStar, x: number, y: number, r: number, glow: number, colour: string, alpha: number, ink: LifeInk, landed: boolean): void {
  ctx.fillStyle = colour
  if (glow > 0) {
    for (const [reach, a] of GLOW_DISCS) {
      ctx.globalAlpha = alpha * a
      ctx.beginPath()
      ctx.arc(x, y, r + glow * reach, 0, TWO_PI)
      ctx.fill()
    }
  }
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TWO_PI)
  if (star.visiting) {
    // a repo they only contributed to: hollow
    ctx.fillStyle = ink.canvas
    ctx.fill()
    ctx.strokeStyle = colour
    ctx.lineWidth = HOLLOW_PX
    ctx.stroke()
    ctx.fillStyle = colour
  } else {
    ctx.fill()
  }
  if (star.twin) {
    const d = (r + TWIN_GAP_PX) * Math.SQRT1_2
    ctx.beginPath()
    ctx.arc(x + d, y - d, Math.max(TWIN_MIN_PX, r * TWIN_R), 0, TWO_PI)
    ctx.fill()
  }
  if (landed) {
    const d = (r + LANDED_GAP_PX) * Math.SQRT1_2
    drawLandedMark(ctx, x - d, y - d, LANDED_PX, ink)
    ctx.fillStyle = colour
  }
  if (star.stars >= SPARKLE_STARS && glow > 0) {
    const arm = r + SPARKLE_REACH * glow
    ctx.globalAlpha = alpha * SPARKLE_ALPHA
    ctx.beginPath()
    ctx.moveTo(x - arm, y)
    ctx.lineTo(x + arm, y)
    ctx.moveTo(x, y - arm)
    ctx.lineTo(x, y + arm)
    ctx.strokeStyle = colour
    ctx.lineWidth = 1
    ctx.lineCap = 'round'
    ctx.stroke()
  }
}

/** Paints the whole frame. The context comes in with the device pixel transform set; it is left as it came. */
export function paintConstellation(ctx: CanvasRenderingContext2D, input: ConstellationPaintInput): void {
  const { layout, timeline, geoms: g, camera, view, ink, colourOf, hidden, hover, selected, at } = input
  const W = view.width
  const horizon = horizonY(view)
  const { stars, bands, links } = layout
  const axis: LifeAxisPaint = { axis: layout, timeline, camera, view, ink, colourOf, hover, at }

  paintCanvasFill(ctx, ink)
  ctx.save()
  ctx.globalAlpha = 1
  paintAxisBackdrop(ctx, axis, { yearBands: false })

  // every other band filled faintly across the plot, then a gridline at each new year
  ctx.fillStyle = ink.eraBand
  for (let i = 1; i < bands.length; i += 2) {
    const top = g.bandTop[i]
    const foot = g.bandFoot[i]
    if (foot > top) ctx.fillRect(0, top, W, foot - top)
  }
  ctx.beginPath()
  let gridlines = 0
  for (const year of layout.years) {
    if (!(year.x0 > 0)) continue
    const x = Math.round(camera.tx + year.x0 * camera.k) + 0.5
    if (x < 0 || x > W) continue
    ctx.moveTo(x, 0)
    ctx.lineTo(x, horizon)
    gridlines++
  }
  if (gridlines > 0) {
    ctx.globalAlpha = GRID_ALPHA
    ctx.strokeStyle = ink.muted
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // what is drawn: neither hidden nor waiting to be sown by the time-lapse, and how far it has grown
  const drawn = new Uint8Array(stars.length)
  const share = new Float64Array(stars.length)
  stars.forEach((star, i) => {
    if (hidden.has(star.key) || (at !== null && star.startDay > at)) return
    drawn[i] = 1
    share[i] = starGrownShare(star, at)
  })
  const sel = selected !== null ? (layout.byKey.get(selected) ?? -1) : -1
  const hov = hover?.kind === 'repo' ? (layout.byKey.get(hover.key) ?? -1) : -1

  // the links whose two stars are drawn and which the time-lapse has reached, in one faint path
  const shown = (a: number, b: number, fromDay: number) =>
    drawn[a] === 1 && drawn[b] === 1 && (at === null || at >= fromDay) && !(Math.max(g.x[a], g.x[b]) < 0 || Math.min(g.x[a], g.x[b]) > W)
  ctx.beginPath()
  let linked = 0
  for (const link of links) {
    if (!shown(link.a, link.b, link.fromDay)) continue
    ctx.moveTo(g.x[link.a], g.y[link.a])
    ctx.lineTo(g.x[link.b], g.y[link.b])
    linked++
  }
  if (linked > 0) {
    ctx.globalAlpha = LINK_ALPHA * (sel >= 0 ? LINK_DIM : 1)
    ctx.strokeStyle = ink.muted
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  // the selected and the hovered star's own links, in its colour
  const lightLinks = (i: number) => {
    if (i < 0 || drawn[i] !== 1) return
    ctx.beginPath()
    let lit = 0
    for (const link of links) {
      if ((link.a !== i && link.b !== i) || !shown(link.a, link.b, link.fromDay)) continue
      ctx.moveTo(g.x[link.a], g.y[link.a])
      ctx.lineTo(g.x[link.b], g.y[link.b])
      lit++
    }
    if (lit === 0) return
    ctx.globalAlpha = LIT_LINK_ALPHA
    ctx.strokeStyle = starColour(stars[i], ink, colourOf)
    ctx.lineWidth = LIT_LINK_PX
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  lightLinks(sel)
  if (hov !== sel) lightLinks(hov)

  // the stars, the smallest first; a selection dims every other star
  for (let i = 0; i < stars.length; i++) {
    if (drawn[i] !== 1) continue
    const star = stars[i]
    const x = g.x[i]
    const r = grownRadius(g.r[i], share[i])
    const glow = g.glow[i] * share[i]
    const reach = r * (1 + TWIN_R) + Math.max(TWIN_GAP_PX, LANDED_GAP_PX + LANDED_PX) + glow + TWIN_MIN_PX
    if (x + reach < 0 || x - reach > W) continue
    const alpha = (sel >= 0 && sel !== i ? ink.dimAlpha : 1) * (star.seedling ? SEEDLING_ALPHA : 1)
    // the landed mark once the time-lapse has reached the first day a pull request landed
    const landed = star.landed.length > 0 && (at === null || star.landed[0] <= at)
    drawStar(ctx, star, x, g.y[i], r, glow, starColour(star, ink, colourOf), alpha, ink, landed)
  }
  ctx.globalAlpha = 1

  // each band's name at its top left, a named language with its colour's dot
  ctx.font = LIFE_YEAR_FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'
  bands.forEach((band, i) => {
    if (!bandNameShown(g.bandTop[i], g.bandFoot[i])) return
    const top = g.bandTop[i] + BAND_NAME_DY
    if (band.kind === 'language') {
      ctx.beginPath()
      ctx.arc(BAND_NAME_X + BAND_DOT_R, top + 5, BAND_DOT_R, 0, TWO_PI)
      ctx.fillStyle = colourOf(band.language)
      ctx.fill()
    }
    ctx.strokeStyle = ink.textHalo
    ctx.lineWidth = BAND_HALO_PX
    ctx.strokeText(band.label, BAND_TEXT_X, top)
    ctx.fillStyle = ink.muted
    ctx.fillText(band.label, BAND_TEXT_X, top)
  })

  paintAxisMilestones(ctx, axis)
  paintDayGuide(ctx, axis)

  // rings round the selected and the hovered star
  const ring = (i: number, colour: string, gap: number, lineWidth: number) => {
    if (i < 0 || drawn[i] !== 1) return
    ctx.beginPath()
    ctx.arc(g.x[i], g.y[i], grownRadius(g.r[i], share[i]) + gap, 0, TWO_PI)
    ctx.strokeStyle = colour
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }
  ring(sel, ink.inspectedRing, SELECTED_RING_GAP, 2)
  if (hov !== sel) ring(hov, ink.hoverRing, HOVER_RING_GAP, 1.5)

  ctx.restore()
}

/** Where star i's label points: its centre, and its core's radius as grown by then, plus a px. */
export function starAnchor(layout: ConstellationLayout, g: ConstellationGeom, i: number, at: number | null, out: Float32Array): boolean {
  const star = layout.stars[i]
  if (star === undefined || (at !== null && star.startDay > at)) return false
  out[0] = g.x[i]
  out[1] = g.y[i]
  out[2] = grownRadius(g.r[i], starGrownShare(star, at)) + 1
  return true
}

/** Star indexes, the most starred first, then the largest, then in paint order. */
export function starLabelOrder(layout: ConstellationLayout): Int32Array {
  const { stars } = layout
  const order = stars.map((_star, i) => i)
  order.sort((a, b) => stars[b].stars - stars[a].stars || stars[b].size - stars[a].size || a - b)
  return Int32Array.from(order)
}

/** What labels keep off: the ground under the horizon, and each band's name. */
export function constellationKeepOut(layout: ConstellationLayout, view: LifeViewport): Float32Array {
  const boxes: number[] = [0, horizonY(view) - 1, view.width, view.height]
  for (const band of layout.bands) {
    const top = starPlotY(view, band.y0)
    if (!bandNameShown(top, starPlotY(view, band.y1))) continue
    const y = top + BAND_NAME_DY - 2
    boxes.push(BAND_NAME_X - 2, y, BAND_NAME_X - 2 + BAND_NAME_W, y + BAND_NAME_H)
  }
  return Float32Array.from(boxes)
}
