/**
 * Canvas drawing for the phosphor view: a green-phosphor CRT. The shared time axis (lifeAxis.ts)
 * in phosphor green, every repo as a stack of blocks rising from the ground at its root day (the
 * blocks brightening toward the top, dimmer through dormant stretches, a brighter head block on
 * top, bigger for starred repos, an archived repo dim), the milestones, the hover and the selection
 * as frames, then scanlines and a soft vignette over the whole screen. The labels go on top
 * (useLifeLabels), placed by phosphorAnchor, phosphorLabelOrder and phosphorKeepOut.
 *
 * A terminal screen keeps its own colours whatever the app's theme (PHOSPHOR, under src/theme), one
 * green hue shaded with globalAlpha only. It draws years and "today", never a repo name.
 */
import { PHOSPHOR, PHOSPHOR_DIM_ALPHA, phosphorInk } from '../theme/console/phosphor'
import { paintAxisBackdrop, paintAxisMilestones, paintCanvasFill, paintDayGuide, type LifeAxisPaint } from './lifeAxis'
import { horizonY } from './lifeGeometry'
import type { LifeViewport } from './lifeTypes'
import type { LifeViewPaintInput } from './lifeView'
import type { PhosphorLayout, PhosphorStack } from './phosphorLayout'
import { BLOCK_PX, GAP_PX, PITCH_PX, blocksAt, headTop, type PhosphorGeom } from './phosphorGeometry'

export type PhosphorPaintInput = LifeViewPaintInput<PhosphorLayout, PhosphorGeom>

/** Body blocks run from BODY_LOW alpha at the foot to BODY_HIGH at the top, in BODY_LEVELS steps. */
const BODY_LOW = 0.22
const BODY_HIGH = 0.85
const BODY_LEVELS = 6
/** A block in a dormant stretch, at this share of its alpha. */
const DORMANT = 0.35
/** An archived repo, at this share... */
const DRY = 0.5
/** ...a seedling at this... */
const SEEDLING = 0.6
/** ...and every stack but the selected one while a selection is held. */
const UNSELECTED = PHOSPHOR_DIM_ALPHA
/** A head's halo: this far round it, at this alpha (times the star size, at least HALO_MIN). */
const HALO_PX = 3
const HALO_ALPHA = 0.35
const HALO_MIN = 0.25
/** The hover's and the selection's frames, this far round a stack. */
const FRAME_GAP = 3
/** Scanlines: one SCAN_PX line every SCAN_EVERY px at SCAN_ALPHA. */
const SCAN_EVERY = 3
const SCAN_PX = 1
const SCAN_ALPHA = 0.22
/** The vignette: VIGNETTE_STEPS nested frames reaching VIGNETTE_REACH of the shorter side in, each at VIGNETTE_ALPHA. */
const VIGNETTE_STEPS = 10
const VIGNETTE_REACH = 0.22
const VIGNETTE_ALPHA = 0.05

const groundColour = () => PHOSPHOR.ground

/** A stack's colour on the label plate: its blocks' green, dim while archived (the screen's own, whatever the theme). */
export function phosphorColour(stack: Pick<PhosphorStack, 'dry'>): string {
  return stack.dry ? PHOSPHOR.dim : PHOSPHOR.phosphor
}

/** Whether a block at stack time t (0 ground .. 1 head) falls in a dormant stretch. */
function dormantAt(stack: PhosphorStack, t: number): boolean {
  for (const part of stack.parts) if (t >= part.t0 && t < part.t1) return part.kind === 'dormant'
  return false
}

/** One stack: its body blocks, brightening toward the top, then its head. */
function drawStack(ctx: CanvasRenderingContext2D, stack: PhosphorStack, g: PhosphorGeom, i: number, grown: number, alpha: number): void {
  const x = g.x[i]
  const n = g.blocks[i]
  const bx = Math.round(x - BLOCK_PX / 2)
  const colour = stack.dry ? PHOSPHOR.dim : PHOSPHOR.phosphor
  ctx.fillStyle = colour
  // blocks batched by brightness level, dormant ones apart
  for (const dormant of [false, true]) {
    for (let level = 0; level < BODY_LEVELS; level++) {
      ctx.beginPath()
      let count = 0
      for (let k = 0; k < grown; k++) {
        if (Math.min(BODY_LEVELS - 1, Math.floor(((k + 1) / grown) * BODY_LEVELS - 1e-9)) !== level) continue
        if (dormantAt(stack, (k + 0.5) / n) !== dormant) continue
        ctx.rect(bx, g.base - (k + 1) * PITCH_PX + GAP_PX, BLOCK_PX, BLOCK_PX)
        count++
      }
      if (count === 0) continue
      ctx.globalAlpha = alpha * (BODY_LOW + ((BODY_HIGH - BODY_LOW) * (level + 1)) / BODY_LEVELS) * (dormant ? DORMANT : 1)
      ctx.fill()
    }
  }

  // the head: a halo for a starred repo, then the block, hollow for a repo they only contributed to
  const side = g.head[i]
  const hx = Math.round(x - side / 2)
  const hy = Math.round(headTop(g, i, grown))
  if (stack.head > 0) {
    ctx.globalAlpha = alpha * HALO_ALPHA * Math.max(HALO_MIN, stack.head)
    ctx.fillStyle = colour
    ctx.fillRect(hx - HALO_PX, hy - HALO_PX, side + 2 * HALO_PX, side + 2 * HALO_PX)
  }
  ctx.globalAlpha = alpha
  const head = stack.dry ? PHOSPHOR.dim : PHOSPHOR.bright
  if (stack.visiting) {
    ctx.strokeStyle = head
    ctx.lineWidth = 1
    ctx.strokeRect(hx + 0.5, hy + 0.5, side - 1, side - 1)
  } else {
    ctx.fillStyle = head
    ctx.fillRect(hx, hy, side, side)
  }
}

/** Scanlines and a soft vignette over the whole screen. */
function paintScreen(ctx: CanvasRenderingContext2D, view: LifeViewport): void {
  const W = view.width
  const H = view.height
  ctx.fillStyle = PHOSPHOR.shade
  ctx.globalAlpha = SCAN_ALPHA
  ctx.beginPath()
  for (let y = 0; y < H; y += SCAN_EVERY) ctx.rect(0, y, W, SCAN_PX)
  ctx.fill()

  const reach = Math.min(W, H) * VIGNETTE_REACH
  ctx.globalAlpha = VIGNETTE_ALPHA
  for (let s = 1; s <= VIGNETTE_STEPS; s++) {
    const d = (reach * s) / VIGNETTE_STEPS
    if (W - 2 * d <= 0 || H - 2 * d <= 0) break
    ctx.beginPath()
    ctx.rect(0, 0, W, H)
    ctx.rect(d, d, W - 2 * d, H - 2 * d)
    ctx.fill('evenodd')
  }
  ctx.globalAlpha = 1
}

/** Paints the whole frame. The context comes in with the device pixel transform set; it is left as it came. */
export function paintPhosphor(ctx: CanvasRenderingContext2D, input: PhosphorPaintInput): void {
  const { layout, timeline, geoms: g, camera, view, ink, hidden, hover, selected, at } = input
  const W = view.width
  const { stacks } = layout
  const screen = phosphorInk(ink)
  const axis: LifeAxisPaint = { axis: layout, timeline, camera, view, ink: screen, colourOf: groundColour, hover, at }

  paintCanvasFill(ctx, screen)
  ctx.save()
  ctx.globalAlpha = 1
  paintAxisBackdrop(ctx, axis, { yearBands: true })

  const sel = selected !== null ? (layout.byKey.get(selected) ?? -1) : -1
  const hov = hover?.kind === 'repo' ? (layout.byKey.get(hover.key) ?? -1) : -1
  const drawn = (i: number) => i >= 0 && !hidden.has(stacks[i].key) && !(at !== null && stacks[i].startDay > at)

  // the stacks, the tallest first
  for (let i = 0; i < stacks.length; i++) {
    if (!drawn(i)) continue
    const stack = stacks[i]
    const reach = g.head[i] / 2 + HALO_PX + 1
    if (g.x[i] + reach < 0 || g.x[i] - reach > W) continue
    const alpha = (sel >= 0 && sel !== i ? UNSELECTED : 1) * (stack.dry ? DRY : 1) * (stack.seedling ? SEEDLING : 1)
    drawStack(ctx, stack, g, i, blocksAt(stack, g.blocks[i], at), alpha)
  }
  ctx.globalAlpha = 1

  paintAxisMilestones(ctx, axis)
  paintDayGuide(ctx, axis)

  // frames round the selected and the hovered stack
  const frame = (i: number, colour: string, lineWidth: number) => {
    if (!drawn(i)) return
    const half = Math.max(g.head[i], BLOCK_PX) / 2 + FRAME_GAP
    const top = headTop(g, i, blocksAt(stacks[i], g.blocks[i], at)) - FRAME_GAP
    ctx.strokeStyle = colour
    ctx.lineWidth = lineWidth
    ctx.strokeRect(Math.round(g.x[i] - half) + 0.5, Math.round(top) + 0.5, Math.round(2 * half), Math.round(g.base - top))
  }
  frame(sel, PHOSPHOR.bright, 1.5)
  if (hov !== sel) frame(hov, PHOSPHOR.text, 1)

  paintScreen(ctx, view)
  ctx.restore()
}

/** Where stack i's label points: its head block's centre, and half its side plus a px. */
export function phosphorAnchor(layout: PhosphorLayout, g: PhosphorGeom, i: number, at: number | null, out: Float32Array): boolean {
  const stack = layout.stacks[i]
  if (stack === undefined || (at !== null && stack.startDay > at)) return false
  const side = g.head[i]
  out[0] = g.x[i]
  out[1] = headTop(g, i, blocksAt(stack, g.blocks[i], at)) + side / 2
  out[2] = side / 2 + 1
  return true
}

/** Stack indexes, the most starred first, then the tallest, then in paint order. */
export function phosphorLabelOrder(layout: PhosphorLayout): Int32Array {
  const { stacks } = layout
  const order = stacks.map((_stack, i) => i)
  order.sort((a, b) => stacks[b].stars - stacks[a].stars || stacks[b].height - stacks[a].height || a - b)
  return Int32Array.from(order)
}

/** What labels keep off: the ground under the horizon. */
export function phosphorKeepOut(_layout: PhosphorLayout, view: LifeViewport): Float32Array {
  return Float32Array.from([0, horizonY(view) - 1, view.width, view.height])
}
