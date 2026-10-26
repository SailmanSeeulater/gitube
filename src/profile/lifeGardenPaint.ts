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
import { leafGeom, subQuad } from './lifeGeometry'
import { paintAxisBackdrop, paintAxisMilestones, paintCanvasFill, paintDayGuide, type LifeAxisPaint } from './lifeAxis'

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

/** Year labels (lifeAxis.ts draws them for every view). */
export { LIFE_YEAR_FONT } from './lifeAxis'
/** a dormant part of a stem, against an active one */
const DORMANT_WIDTH = 0.45
/** the hollow ring at the root of a repo the person only contributed to */
const VISIT_RING_PX = 2.6
/** a fork's slanted cut at the base */
const CUT_PX = 7
const CUT_ANGLE = (-25 * Math.PI) / 180
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

/**
 * Paints the whole frame: the axis's backdrop (lifeAxis.ts) with bands for alternate years, the
 * plants, the axis's milestones and the hovered day's guide, then the rings. The context comes in
 * with the device pixel transform set; it is left as it came.
 */
export function paintLifeGarden(ctx: CanvasRenderingContext2D, input: LifePaintInput): void {
  const { layout, geoms, view, ink, hidden, hover, selected, at } = input
  const W = view.width
  const axis: LifeAxisPaint = {
    axis: layout,
    timeline: input.timeline,
    camera: input.camera,
    view,
    ink,
    colourOf: input.colourOf,
    hover,
    at,
  }

  paintCanvasFill(ctx, ink)
  ctx.save()
  ctx.globalAlpha = 1
  paintAxisBackdrop(ctx, axis, { yearBands: true })

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

  // milestones on the horizon, and the hovered day's guide
  paintAxisMilestones(ctx, axis)
  paintDayGuide(ctx, axis)

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
