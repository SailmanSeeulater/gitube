/**
 * Canvas drawing for the garden layout: blooms, buds and wilted heads on tips, small flowers on
 * merges, leaves along stems and on plain commits, roots under cut-off history. Sizes are in graph
 * units (they grow with zoom, like the plant they draw); the caller sets globalAlpha.
 */
import type { Theme } from '../theme/themes'
import { blendHex } from '../theme/colour'
import { petalAngles, rootTendrils, type Bloom } from './gardenLook'

const TWO_PI = Math.PI * 2

/** How far a flower reaches beyond a tip's body radius (petals spread to about this many radii). */
export const BLOOM_SCALE = 1.65

/** The garden's own colours for a theme: flower centres, dead leaves and roots, and the leaf green. */
export interface GardenInk {
  centre: string
  wilt: string
  wiltCore: string
  root: string
  /** green mixed into a branch colour for its leaves */
  green: string
}

export function gardenInk(theme: Theme): GardenInk {
  return {
    centre: theme.warn,
    wilt: theme.derived.gardenWilt,
    wiltCore: theme.derived.gardenWiltCore,
    root: theme.derived.gardenRoot,
    green: theme.derived.gardenLeafGreen,
  }
}

/** A branch colour turned leafy: the theme's green laid over it. */
export function leafColour(branch: string, ink: GardenInk): string {
  return blendHex(ink.green, branch, 0.45)
}

/** A leaf from (x, y) pointing along angle: two arcs meeting at the tip. */
export function drawLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, width: number, colour: string): void {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const tx = x + dx * length
  const ty = y + dy * length
  // control points either side of the midrib
  const mx = x + dx * length * 0.5
  const my = y + dy * length * 0.5
  const nx = -dy * width
  const ny = dx * width
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.quadraticCurveTo(mx + nx, my + ny, tx, ty)
  ctx.quadraticCurveTo(mx - nx, my - ny, x, y)
  ctx.fillStyle = colour
  ctx.fill()
}

/** Petals around (x, y): ellipses whose long axis points outward. */
function petals(ctx: CanvasRenderingContext2D, x: number, y: number, angles: ReadonlyArray<number>, reach: number, long: number, short: number, colour: string): void {
  ctx.beginPath()
  for (const a of angles) {
    const cx = x + Math.cos(a) * reach
    const cy = y + Math.sin(a) * reach
    ctx.moveTo(cx + Math.cos(a) * long, cy + Math.sin(a) * long)
    ctx.ellipse(cx, cy, long, short, a, 0, TWO_PI)
  }
  ctx.fillStyle = colour
  ctx.fill()
}

/**
 * A branch tip by its bloom: open petals round a warm centre, a closed bud pointing up from two
 * sepals, or a wilted head of brown petals hanging down. r is the tip's body radius.
 */
export function drawTip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  bloom: Bloom,
  turn: number,
  colour: string,
  ink: GardenInk,
): void {
  if (bloom === 'bloom') {
    petals(ctx, x, y, petalAngles('bloom', turn), r * 0.9, r * 0.75, r * 0.42, colour)
    ctx.beginPath()
    ctx.arc(x, y, r * 0.55, 0, TWO_PI)
    ctx.fillStyle = ink.centre
    ctx.fill()
    return
  }
  if (bloom === 'bud') {
    const leaf = leafColour(colour, ink)
    drawLeaf(ctx, x, y + r * 0.4, Math.PI * 0.25, r * 1.1, r * 0.35, leaf)
    drawLeaf(ctx, x, y + r * 0.4, Math.PI * 0.75, r * 1.1, r * 0.35, leaf)
    ctx.beginPath()
    ctx.moveTo(x, y - r * 1.5)
    ctx.quadraticCurveTo(x + r * 1.1, y - r * 0.2, x, y + r * 0.6)
    ctx.quadraticCurveTo(x - r * 1.1, y - r * 0.2, x, y - r * 1.5)
    ctx.fillStyle = colour
    ctx.fill()
    return
  }
  petals(ctx, x, y, petalAngles('wilted', turn), r * 0.75, r * 0.65, r * 0.3, ink.wilt)
  ctx.beginPath()
  ctx.arc(x, y, r * 0.45, 0, TWO_PI)
  ctx.fillStyle = ink.wiltCore
  ctx.fill()
}

/** A merge: a small five-petal flower. */
export function drawMergeFlower(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number, colour: string, ink: GardenInk): void {
  const angles = Array.from({ length: 5 }, (_, i) => (i / 5) * TWO_PI + turn * TWO_PI)
  petals(ctx, x, y, angles, r * 0.85, r * 0.6, r * 0.38, colour)
  ctx.beginPath()
  ctx.arc(x, y, r * 0.45, 0, TWO_PI)
  ctx.fillStyle = ink.centre
  ctx.fill()
}

/** Roots fanning down from (x, y), `length` long, shaped by seed. */
export function drawRoots(ctx: CanvasRenderingContext2D, x: number, y: number, length: number, seed: number, lineWidth: number, colour: string): void {
  ctx.beginPath()
  for (const [cx, cy, ex, ey] of rootTendrils(seed)) {
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + cx * length, y + cy * length, x + ex * length, y + ey * length)
  }
  ctx.strokeStyle = colour
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.stroke()
}
