/**
 * Canvas drawing for the life garden (PROFILE_SPEC.md section 5, view 1): bands for alternate
 * years, the horizon with its language ribbon, year labels and today, every repo as a plant rooted
 * where the person's part in it starts, the milestones on the horizon, and the marks of the hover
 * and the selection. The labels go on top (useLifeLabels).
 *
 * Positions come from lifeGeometry, which hit testing shares, and colours from LifeInk and the
 * language palette, so every theme works. The glyphs are the repo garden's own (gardenPaint):
 * leaves, blooms, buds, wilted heads and roots. Everything is drawn in screen px under the device
 * pixel transform, so a zoom spreads plants apart and never stretches them.
 */
import { BLOOM_SCALE, drawLeaf, drawRoots, drawTip } from '../components/gardenPaint'
import type { LifeTimeline } from './timeline'
import type { LifeCamera, LifeGardenLayout, LifeHover, LifeInk, LifePlant, LifeViewport, PlantGeom } from './lifeTypes'
import { horizonY, leafGeom, subQuad } from './lifeGeometry'

export interface LifePaintInput {
  layout: LifeGardenLayout
  timeline: LifeTimeline
  /** plantGeom of every plant, index-aligned with layout.plants */
  geoms: ReadonlyArray<PlantGeom>
  camera: LifeCamera
  view: LifeViewport
  ink: LifeInk
  colourOf: (language: string | null) => string
  /** a colour turned leafy (leafColour), cached per theme by the caller */
  leafOf: (colour: string) => string
  /** repo keys */
  hidden: ReadonlySet<string>
  hover: LifeHover
  /** repo key */
  selected: string | null
  /** the time-lapse's day (a fractional day number): only what has grown by then is drawn. null: fully grown. */
  at: number | null
}

/** Year labels: the repo garden's MONO_FONT at 10 px (pinned in tests/lifeGardenPaint.test.ts). */
export const LIFE_YEAR_FONT = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
/** A year label closer than this to the last one drawn is skipped. */
const YEAR_GAP_PX = 34
const HORIZON_PX = 1.5
/** the language ribbon under the horizon */
const RIBBON_GAP_PX = 2
const RIBBON_PX = 4
/** a dormant part of a stem, against an active one */
const DORMANT_WIDTH = 0.45
/** the hollow ring at the root of a repo the person only contributed to */
const VISIT_RING_PX = 2.6
/** a fork's slanted cut at the base */
const CUT_PX = 7
const CUT_ANGLE = (-25 * Math.PI) / 180
const DIAMOND_PX = 4
/** the hover and selection rings, beyond a tip's petals */
const RING_GAP_PX = 3
const TWO_PI = Math.PI * 2

/** A plant's colour: its language's, or the dry colour of an archived repo. */
export function plantColour(plant: Pick<LifePlant, 'dry' | 'language'>, ink: Pick<LifeInk, 'dry'>, colourOf: (language: string | null) => string): string {
  return plant.dry ? ink.dry : colourOf(plant.language)
}

/** How much of a plant has grown by the time-lapse's day, in stem time (0..1); 1 when fully grown. */
export function grownShare(plant: Pick<LifePlant, 'startDay' | 'endDay'>, at: number | null): number {
  if (at === null) return 1
  const share = (at - plant.startDay) / (plant.endDay - plant.startDay + 1)
  return share >= 1 ? 1 : share > 0 ? share : 0
}

/** Where a plant's head is: its tip, or the end of its stem so far while the time-lapse grows it. */
export function headAt(g: PlantGeom, grown: number): [number, number] {
  if (grown >= 1) return [g.x2, g.y2]
  const q = subQuad(g, 0, grown)
  return [q[4], q[5]]
}

/** The radius the hover and selection rings are drawn at round a tip. */
export function ringRadius(g: Pick<PlantGeom, 'tipR'>): number {
  return g.tipR * BLOOM_SCALE + RING_GAP_PX
}

/**
 * A small padlock centred on (x, y), size px tall: the shackle stroked, the body filled. Marks a
 * private repo wherever its name or "private repo" is drawn.
 */
export function drawLock(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colour: string): void {
  const bodyW = size * 0.72
  const bodyH = size * 0.56
  const bodyTop = y + size / 2 - bodyH
  const r = size * 0.22
  ctx.beginPath()
  ctx.moveTo(x - r, bodyTop)
  ctx.lineTo(x - r, bodyTop - size * 0.1)
  ctx.arc(x, bodyTop - size * 0.1, r, Math.PI, 0)
  ctx.lineTo(x + r, bodyTop)
  ctx.strokeStyle = colour
  ctx.lineWidth = Math.max(1, size * 0.14)
  ctx.lineCap = 'round'
  ctx.stroke()
  ctx.beginPath()
  ctx.rect(x - bodyW / 2, bodyTop, bodyW, bodyH)
  ctx.fillStyle = colour
  ctx.fill()
}

/** A diamond on (x, y), r px from its centre to each corner; two-coloured for a language switch. */
function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, left: string, right: string, ink: LifeInk): void {
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

function drawPlant(ctx: CanvasRenderingContext2D, plant: LifePlant, g: PlantGeom, input: LifePaintInput, grown: number): void {
  const { ink, at } = input
  const colour = plantColour(plant, ink, input.colourOf)
  // roots under every plant but a cutting, reaching deeper for backdated history
  if (plant.cutting) {
    const dx = (Math.cos(CUT_ANGLE) * CUT_PX) / 2
    const dy = (Math.sin(CUT_ANGLE) * CUT_PX) / 2
    ctx.beginPath()
    ctx.moveTo(g.x0 - dx, g.y0 + 1 - dy)
    ctx.lineTo(g.x0 + dx, g.y0 + 1 + dy)
    ctx.strokeStyle = ink.horizon
    ctx.lineWidth = 1.5
    ctx.lineCap = 'round'
    ctx.stroke()
  } else {
    const length = (4 + Math.min(12, 3 * Math.log2(1 + plant.backDays / 30))) * g.scale
    drawRoots(ctx, g.x0, g.y0, length, Math.floor(plant.turn * 1e6), Math.max(1, g.width * 0.45), ink.garden.root)
  }

  // the stem: active parts full width, dormant ones thin, cut short by the time-lapse
  ctx.strokeStyle = colour
  ctx.lineCap = 'round'
  for (const part of plant.parts) {
    if (part.t0 >= grown) break
    const [x0, y0, cx, cy, x2, y2] = subQuad(g, part.t0, Math.min(part.t1, grown))
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.quadraticCurveTo(cx, cy, x2, y2)
    ctx.lineWidth = part.kind === 'active' ? g.width : g.width * DORMANT_WIDTH
    ctx.stroke()
  }

  // a leaf for each active span, once the time-lapse has reached it
  const leaf = plant.dry ? ink.dry : input.leafOf(colour)
  for (const l of plant.leaves) {
    if (at !== null && (l.fromDay > at || l.t > grown)) continue
    const lg = leafGeom(g, l, plant.turn)
    drawLeaf(ctx, lg.x, lg.y, lg.angle, lg.length, lg.width, leaf)
  }

  // the head: a bloom for stars, a bud without, a wilted head on an archived repo
  const [hx, hy] = headAt(g, grown)
  drawTip(ctx, hx, hy, g.tipR, plant.tip, plant.turn, colour, ink.garden)

  if (plant.visiting) {
    ctx.beginPath()
    ctx.arc(g.x0, g.y0, VISIT_RING_PX, 0, TWO_PI)
    ctx.fillStyle = ink.canvas
    ctx.fill()
    ctx.strokeStyle = ink.rootRing
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
}

/** Whether any of the plant can reach the screen: its curve, petals and leaves lie within pad of its points. */
function onScreen(g: PlantGeom, width: number): boolean {
  const pad = g.tipR * BLOOM_SCALE + 24
  return Math.max(g.x0, g.cx, g.x2) + pad >= 0 && Math.min(g.x0, g.cx, g.x2) - pad <= width
}

/** Paints the whole frame. The context comes in with the device pixel transform set; it is left as it came. */
export function paintLifeGarden(ctx: CanvasRenderingContext2D, input: LifePaintInput): void {
  const { layout, timeline, geoms, camera, view, ink, colourOf, hidden, hover, selected, at } = input
  const W = view.width
  const horizon = horizonY(view)
  const sx = (x: number) => camera.tx + x * camera.k
  /** world x of a day number's middle */
  const dayX = (day: number) => day - layout.startDay + 0.5

  // the canvas colour over the whole backing store, so image and video captures are never black
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.fillStyle = ink.canvas
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = 1

  // alternate years get a faint band in the sky
  ctx.fillStyle = ink.eraBand
  for (const year of layout.years) {
    if (year.year % 2 === 0) continue
    const x0 = Math.max(0, sx(year.x0))
    const x1 = Math.min(W, sx(year.x1))
    if (x1 > x0) ctx.fillRect(x0, 0, x1 - x0, horizon)
  }

  // the horizon, and under it a block per language era in its colour
  ctx.beginPath()
  ctx.moveTo(0, horizon)
  ctx.lineTo(W, horizon)
  ctx.strokeStyle = ink.horizon
  ctx.lineWidth = HORIZON_PX
  ctx.stroke()
  for (const era of layout.languages) {
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
  for (const year of layout.years) {
    const x = Math.max(sx(year.x0), sx(0))
    if (x - lastLabel < YEAR_GAP_PX || x > W) continue
    lastLabel = x
    if (x + YEAR_GAP_PX < 0) continue
    ctx.fillText(String(year.year), x + 2, labelY)
  }
  const todayX = sx(layout.days)
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

  // the plants, back row first; a selection dims every other plant
  const sel = selected !== null ? (layout.byKey.get(selected) ?? -1) : -1
  const plants = layout.plants
  for (let i = 0; i < plants.length; i++) {
    const plant = plants[i]
    const g = geoms[i]
    if (g === undefined || hidden.has(plant.key) || (at !== null && plant.startDay > at) || !onScreen(g, W)) continue
    ctx.globalAlpha = sel >= 0 && sel !== i ? ink.dimAlpha : 1
    drawPlant(ctx, plant, g, input, grownShare(plant, at))
  }
  ctx.globalAlpha = 1

  // milestones on the horizon: a streak's bar, then the diamonds, a language switch in both colours
  const hoverMilestone = hover?.kind === 'day' ? hover.milestone : null
  for (const m of layout.milestones) {
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

  // the hovered day's guide, from the sky to the horizon
  if (hover?.kind === 'day') {
    const x = Math.round(sx(dayX(hover.day))) + 0.5
    if (x >= 0 && x <= W) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, horizon)
      ctx.strokeStyle = ink.hoverRing
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  // rings round the selected and the hovered plant
  const ring = (i: number, colour: string, lineWidth: number) => {
    const plant = plants[i]
    const g = geoms[i]
    if (plant === undefined || g === undefined || hidden.has(plant.key) || (at !== null && plant.startDay > at)) return
    const [x, y] = headAt(g, grownShare(plant, at))
    ctx.beginPath()
    ctx.arc(x, y, ringRadius(g), 0, TWO_PI)
    ctx.strokeStyle = colour
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }
  if (sel >= 0) ring(sel, ink.inspectedRing, 2)
  const hov = hover?.kind === 'repo' ? (layout.byKey.get(hover.key) ?? -1) : -1
  if (hov >= 0 && hov !== sel) ring(hov, ink.hoverRing, 1.5)

  ctx.restore()
}
