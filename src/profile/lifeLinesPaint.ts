/**
 * Canvas drawing for the life lines (PROFILE_SPEC.md section 5, view 2): the shared time axis, the
 * language eras as faint bands behind everything, a gridline at each new year, and every repo as a
 * line along its track, thick while active and thin while dormant, with its start marked, a fork's
 * branch stub, an archived repo's terminus, a filled station in the accent on each day a pull
 * request of theirs landed in it, and its milestones as stations (a station on a start marker rings
 * it, keeping the marker's dot in view; a landed station there rings it in the accent). Then the axis milestones, the hovered day's
 * guide, and the hovered and selected lines redrawn on top over a halo. The labels go on top of it
 * all (useLifeLabels), and are the only repo names on the canvas: this draws none.
 *
 * Positions come from lifeLinesGeometry, which the hit test and the labels share, and colours from
 * LifeInk, the language palette and globalAlpha only, so every theme works. Everything is drawn in
 * screen px under the device pixel transform, so a zoom spreads lines along x and never thickens them.
 */
import { horizonY } from './lifeGeometry'
import { paintAxisBackdrop, paintAxisMilestones, paintCanvasFill, paintDayGuide, type LifeAxisPaint } from './lifeAxis'
import type { LifeInk, LifeViewport } from './lifeTypes'
import type { LifeViewPaintInput } from './lifeView'
import type { LifeLine, LifeLinesLayout, LineStation } from './lifeLinesLayout'
import { MARKER_RING_PX, drawnTo, rooted, isReached, stationMark, stationRadius, stationReached, stationRingRadius, weightLevel, type LinesGeom } from './lifeLinesGeometry'

export type LinesPaintInput = LifeViewPaintInput<LifeLinesLayout, LinesGeom>

/** The language eras behind the lines, at this alpha over the canvas. */
export const ERA_BAND_ALPHA = 0.07
/** A gridline at each new year, in the muted ink at this alpha. */
export const GRID_ALPHA = 0.18
/** An uncounted repo's dotted line: dash and gap, in px. */
export const UNCOUNTED_DASH: readonly number[] = [1.5, 3]
/** Lines this far off screen are skipped. */
const CULL_PX = 24
/** A hovered station is ringed this far beyond it. */
const STATION_HOVER_RING_PX = 3
/** A fork's branch stub reaches between these many px back and up into the start. */
const STUB_MIN_PX = 3
const STUB_MAX_PX = 8
/** ...drawn this many times a dormant part's width. */
const STUB_WIDTH = 1.5
/** An archived line's terminus: this much taller than the line, this wide. */
const TERMINUS_PAD_PX = 4
const TERMINUS_PX = 1.5
/** The halo under a hovered or selected line, beyond its full active width... */
const SELECT_HALO_PX = 3
const HOVER_HALO_PX = 2
/** ...and the ring round its start marker. */
const RING_GAP_PX = 3
const TWO_PI = Math.PI * 2

/** A line's colour: its language's, or the dry colour of an archived repo. */
export function lineColour(line: Pick<LifeLine, 'dry' | 'language'>, ink: Pick<LifeInk, 'dry'>, colourOf: (language: string | null) => string): string {
  return line.dry ? ink.dry : colourOf(line.language)
}

/** The widest a line is drawn: its heaviest active part's width, or the light width. */
function fullWidth(line: LifeLine, g: LinesGeom): number {
  let level = 0
  for (const part of line.parts) if (part.kind === 'active') level = Math.max(level, weightLevel(part.weight))
  return g.activePx[level]
}

/** The line's label anchor: its start marker once rooted, else where it starts. */
export function linesAnchor(layout: LifeLinesLayout, g: LinesGeom, i: number, at: number | null, out: Float32Array): boolean {
  const line = layout.lines[i]
  if (line === undefined || !(line.track < g.trackY.length)) return false
  const y = g.trackY[line.track]
  out[0] = g.camera.tx + (rooted(line, at) ? line.x : line.x0) * g.camera.k
  out[1] = y
  out[2] = g.stationR
  return true
}

/** The heaviest lines' names first, then the most starred, then paint order. */
export function linesLabelOrder(layout: LifeLinesLayout): Int32Array {
  const lines = layout.lines
  return Int32Array.from(lines.keys()).sort((a, b) => lines[b].weight - lines[a].weight || lines[b].stars - lines[a].stars || a - b)
}

/** Labels keep off the ground under the horizon. */
export function linesKeepOut(_layout: LifeLinesLayout, view: LifeViewport): Float32Array {
  return Float32Array.of(0, horizonY(view) - 1, view.width, view.height)
}

/** A line's body from x0 to its drawn end: its parts, or an uncounted repo's dots. */
function drawBody(ctx: CanvasRenderingContext2D, line: LifeLine, y: number, g: LinesGeom, colour: string, to: number, W: number): void {
  const { k, tx } = g.camera
  const clip = (x: number) => Math.min(W + CULL_PX, Math.max(-CULL_PX, tx + x * k))
  ctx.strokeStyle = colour
  if (line.uncounted) {
    ctx.beginPath()
    ctx.moveTo(clip(line.x0), y)
    ctx.lineTo(clip(to), y)
    ctx.setLineDash([...UNCOUNTED_DASH])
    ctx.lineCap = 'butt'
    ctx.lineWidth = Math.max(1, g.dormantPx * 1.4)
    ctx.stroke()
    ctx.setLineDash([])
    return
  }
  // one path for the dormant parts, then one per active weight level
  for (let pass = -1; pass < 3; pass++) {
    let any = false
    ctx.beginPath()
    for (const part of line.parts) {
      if (part.x0 >= to) break
      if (pass < 0 ? part.kind !== 'dormant' : part.kind !== 'active' || weightLevel(part.weight) !== pass) continue
      const a = clip(part.x0)
      const b = clip(Math.min(part.x1, to))
      if (b <= -CULL_PX || a >= W + CULL_PX) continue
      ctx.moveTo(a, y)
      ctx.lineTo(b, y)
      any = true
    }
    if (!any) continue
    ctx.lineCap = pass < 0 ? 'butt' : 'round'
    ctx.lineWidth = pass < 0 ? g.dormantPx : g.activePx[pass]
    ctx.stroke()
  }
}

/** A line's marks: its body, a fork's branch stub, its start marker and an archived line's terminus. */
function drawLine(ctx: CanvasRenderingContext2D, line: LifeLine, g: LinesGeom, input: LinesPaintInput): void {
  const { layout, ink, at, view } = input
  const { k, tx } = g.camera
  const y = g.trackY[line.track]
  const colour = lineColour(line, ink, input.colourOf)
  drawBody(ctx, line, y, g, colour, drawnTo(line, layout.startDay, at), view.width)

  const pad = STUB_MAX_PX + g.stationR + RING_GAP_PX
  const x = tx + line.x * k
  if (rooted(line, at) && x >= -pad && x <= view.width + pad) {
    if (line.branch) {
      const s = Math.min(STUB_MAX_PX, Math.max(STUB_MIN_PX, g.pitch))
      ctx.beginPath()
      ctx.moveTo(x - s, y - s)
      ctx.lineTo(x, y)
      ctx.strokeStyle = colour
      ctx.lineWidth = Math.max(1, g.dormantPx * STUB_WIDTH)
      ctx.lineCap = 'round'
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(x, y, g.stationR, 0, TWO_PI)
    ctx.lineWidth = MARKER_RING_PX
    if (line.visiting) {
      // a repo they only contributed to starts hollow
      ctx.fillStyle = ink.canvas
      ctx.fill()
      ctx.strokeStyle = colour
      ctx.stroke()
    } else {
      ctx.fillStyle = colour
      ctx.fill()
      ctx.strokeStyle = ink.canvas
      ctx.stroke()
    }
  }

  // a landed pull request: a filled station in the accent on its day (round the start marker where
  // it would cover its dot), once the time-lapse has reached it
  for (const lx of line.landed) {
    if (!stationReached(lx, layout.startDay, at)) continue
    const { x: mx, y: my, ring } = stationMark(line, { x: lx }, g, at)
    if (mx < -pad || mx > view.width + pad) continue
    ctx.beginPath()
    ctx.arc(mx, my, ring ? stationRingRadius(g) : stationRadius(g), 0, TWO_PI)
    ctx.lineWidth = MARKER_RING_PX
    if (ring) {
      ctx.strokeStyle = ink.accent
      ctx.stroke()
    } else {
      ctx.fillStyle = ink.accent
      ctx.fill()
      ctx.strokeStyle = ink.canvas
      ctx.stroke()
    }
  }

  const end = tx + line.x1 * k
  if (line.dry && (at === null || at >= line.endDay) && end >= -pad && end <= view.width + pad) {
    const h = g.activePx[2] + TERMINUS_PAD_PX
    ctx.beginPath()
    ctx.moveTo(end, y - h / 2)
    ctx.lineTo(end, y + h / 2)
    ctx.strokeStyle = ink.dry
    ctx.lineWidth = TERMINUS_PX
    ctx.lineCap = 'butt'
    ctx.stroke()
  }
}

/** Whether any of the line, up to its drawn end, can reach the screen. */
function onScreen(line: LifeLine, g: LinesGeom, to: number, W: number): boolean {
  const pad = CULL_PX + g.stationR
  return g.camera.tx + to * g.camera.k + pad >= 0 && g.camera.tx + line.x0 * g.camera.k - pad <= W
}

/** Paints the whole frame. The context comes in with the device pixel transform set; it is left as it came. */
export function paintLifeLines(ctx: CanvasRenderingContext2D, input: LinesPaintInput): void {
  const { layout, timeline, geoms: g, camera, view, ink, colourOf, hidden, hover, selected, at } = input
  const W = view.width
  const horizon = horizonY(view)
  const sx = (x: number) => camera.tx + x * camera.k
  const axis: LifeAxisPaint = { axis: layout, timeline, camera, view, ink, colourOf, hover, at }

  paintCanvasFill(ctx, ink)
  ctx.save()
  ctx.globalAlpha = 1
  paintAxisBackdrop(ctx, axis, { yearBands: false })

  // the language eras behind the lines, as far as the time-lapse has reached
  const reached = at === null ? Infinity : at - layout.startDay
  ctx.globalAlpha = ERA_BAND_ALPHA
  for (const era of layout.languages) {
    const x0 = Math.max(0, sx(era.x0))
    const x1 = Math.min(W, sx(Math.min(era.x1, reached)))
    if (x1 <= x0) continue
    ctx.fillStyle = colourOf(era.language)
    ctx.fillRect(x0, 0, x1 - x0, horizon)
  }

  // a gridline at each new year
  ctx.globalAlpha = GRID_ALPHA
  ctx.beginPath()
  let grid = false
  for (const year of layout.years) {
    if (!(year.x0 > 0)) continue
    const x = Math.round(sx(year.x0)) + 0.5
    if (x < 0 || x > W) continue
    ctx.moveTo(x, 0)
    ctx.lineTo(x, horizon)
    grid = true
  }
  if (grid) {
    ctx.strokeStyle = ink.muted
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // the lines, track by track; a selection dims every other line
  const sel = selected !== null ? (layout.byKey.get(selected) ?? -1) : -1
  const hov = hover?.kind === 'repo' ? (layout.byKey.get(hover.key) ?? -1) : -1
  const lines = layout.lines
  const shown = (line: LifeLine | undefined): line is LifeLine => line !== undefined && !hidden.has(line.key) && isReached(line, at)
  const alphaOf = (i: number) => (sel >= 0 && sel !== i ? ink.dimAlpha : 1)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!shown(line) || !onScreen(line, g, drawnTo(line, layout.startDay, at), W)) continue
    ctx.globalAlpha = alphaOf(i)
    drawLine(ctx, line, g, input)
  }

  // the stations the time-lapse has reached on the lines drawn
  const hoverMilestone = hover?.kind === 'day' ? hover.milestone : null
  const drawStation = (station: LineStation, line: LifeLine) => {
    if (!stationReached(station.x, layout.startDay, at)) return
    const { x, y, ring } = stationMark(line, station, g, at)
    const hovered = hoverMilestone === station.index
    const r = ring ? stationRingRadius(g, hovered) : stationRadius(g, hovered)
    if (x < -r - STATION_HOVER_RING_PX || x > W + r + STATION_HOVER_RING_PX) return
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TWO_PI)
    // on a start marker: a ring round it, its dot left as drawn; elsewhere a hollow disc on the line
    if (!ring) {
      ctx.fillStyle = ink.canvas
      ctx.fill()
    }
    ctx.strokeStyle = ink.text
    ctx.lineWidth = MARKER_RING_PX
    ctx.stroke()
    if (!hovered) return
    ctx.beginPath()
    ctx.arc(x, y, r + STATION_HOVER_RING_PX, 0, TWO_PI)
    ctx.strokeStyle = ink.hoverRing
    ctx.lineWidth = MARKER_RING_PX
    ctx.stroke()
  }
  /** The stations on the lines drawn, or on line `only`; a hovered one over any other on the same day. */
  const drawStations = (only = -1) => {
    for (const hovered of [false, true]) {
      for (const station of layout.stations) {
        const line = lines[station.line]
        if ((only >= 0 && station.line !== only) || (hoverMilestone === station.index) !== hovered || !shown(line)) continue
        ctx.globalAlpha = only >= 0 ? 1 : alphaOf(station.line)
        drawStation(station, line)
      }
    }
    ctx.globalAlpha = 1
  }
  drawStations()

  paintAxisMilestones(ctx, axis)
  paintDayGuide(ctx, axis)

  // the selected and the hovered line on top, over a halo, with a ring round the start
  const mark = (i: number, colour: string, halo: number, ring: number) => {
    const line = lines[i]
    if (!shown(line)) return
    const to = drawnTo(line, layout.startDay, at)
    if (!onScreen(line, g, to, W)) return
    const y = g.trackY[line.track]
    ctx.beginPath()
    ctx.moveTo(Math.max(-CULL_PX, sx(line.x0)), y)
    ctx.lineTo(Math.min(W + CULL_PX, sx(to)), y)
    ctx.strokeStyle = colour
    ctx.lineWidth = fullWidth(line, g) + halo
    ctx.lineCap = 'round'
    ctx.stroke()
    drawLine(ctx, line, g, input)
    drawStations(i)
    if (!rooted(line, at)) return
    ctx.beginPath()
    ctx.arc(sx(line.x), y, g.stationR + RING_GAP_PX, 0, TWO_PI)
    ctx.strokeStyle = colour
    ctx.lineWidth = ring
    ctx.stroke()
  }
  if (sel >= 0) mark(sel, ink.inspectedRing, SELECT_HALO_PX, 2)
  if (hov >= 0 && hov !== sel) mark(hov, ink.hoverRing, HOVER_HALO_PX, 1.5)

  ctx.restore()
}
