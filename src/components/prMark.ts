/**
 * The pull request mark: a ring round a branch tip split in two, review on the left and checks on
 * the right, in the theme's success (approved / passing), warn (running), danger (changes requested
 * / failing) or muted (waiting / no checks). A danger half is broken in its middle so it reads
 * without colour; a draft is dotted; a half not looked up yet is muted and faint.
 *
 * The ring takes the place of what the tip already draws there (organic: its outer ring; metro: the
 * station outline; garden: just inside the petals' reach), so the tip's footprint and the label
 * placer's discs stay as they are.
 *
 * Geometry (prRingArcs) is pure; drawPrRing paints it on the canvas, and PrGlyph.tsx as SVG.
 */
import type { ChecksState, PrMark, PullSummary, ReviewState } from '../types'
import type { Theme } from '../theme/themes'
import { relativeTime } from './gardenUtils'

export type PrTone = 'success' | 'warn' | 'danger' | 'muted'

export function reviewTone(review: ReviewState): PrTone {
  if (review === 'approved') return 'success'
  if (review === 'changes') return 'danger'
  return 'muted'
}

export function checksTone(checks: ChecksState): PrTone {
  if (checks === 'passing') return 'success'
  if (checks === 'running') return 'warn'
  if (checks === 'failing') return 'danger'
  return 'muted'
}

export function toneColour(theme: Pick<Theme, PrTone>, tone: PrTone): string {
  return theme[tone]
}

/** One drawn half (or piece of a broken half), angles in radians clockwise from 3 o'clock. */
export interface PrArc {
  side: 'review' | 'checks'
  a0: number
  a1: number
  tone: PrTone
  /** not looked up yet: drawn at half the node's alpha */
  faint: boolean
  /** a draft: round dots instead of a stroke */
  dotted: boolean
}

export interface PrRingOptions {
  /** gap at 12 and 6 o'clock, screen px */
  gapPx?: number
  /** the break in a danger half, screen px */
  breakPx?: number
  /** the halves to draw (both by default) */
  sides?: ReadonlyArray<'review' | 'checks'>
}

/** Below this radius on screen the ring is two plain halves: no gaps, breaks or dots. */
export const PR_RING_MIN_DETAIL_PX = 3
const GAP_PX = 3
const MAX_GAP = 0.35
const BREAK_PX = 3.6
const MAX_BREAK = 0.45
const HALF_PI = Math.PI / 2

/** Draft dots: this share of the ring's width across, one every DOT_PITCH widths. */
export const DOT_WIDTH = 0.9
export const DOT_PITCH = 1.35

type MarkLike = Pick<PrMark, 'review' | 'checks' | 'draft'>

/**
 * The arcs of a ring of centre radius R and width w (graph units; px = graph units per screen px).
 * Review is the left half (6 to 12 o'clock through 9), checks the right half.
 */
export function prRingArcs(R: number, _w: number, mark: MarkLike, px: number, opts: PrRingOptions = {}): PrArc[] {
  const plain = R / px < PR_RING_MIN_DETAIL_PX
  const gap = plain ? 0 : Math.min(((opts.gapPx ?? GAP_PX) * px) / R, MAX_GAP)
  const breakAngle = Math.min(((opts.breakPx ?? BREAK_PX) * px) / R, MAX_BREAK)
  const sides = opts.sides ?? ['review', 'checks']
  const arcs: PrArc[] = []
  for (const side of sides) {
    const state = side === 'review' ? mark.review : mark.checks
    const tone = side === 'review' ? reviewTone(mark.review) : checksTone(mark.checks)
    const faint = state === 'unknown'
    const dotted = !plain && mark.draft
    // checks: 12 -> 6 o'clock through 3; review: 6 -> 12 o'clock through 9
    const a0 = (side === 'checks' ? -HALF_PI : HALF_PI) + gap / 2
    const a1 = (side === 'checks' ? HALF_PI : 3 * HALF_PI) - gap / 2
    const broken = !plain && !dotted && tone === 'danger'
    if (broken) {
      const mid = (a0 + a1) / 2
      arcs.push({ side, a0, a1: mid - breakAngle / 2, tone, faint, dotted })
      arcs.push({ side, a0: mid + breakAngle / 2, a1, tone, faint, dotted })
    } else arcs.push({ side, a0, a1, tone, faint, dotted })
  }
  return arcs
}

/** Where each layout puts the ring, from the radius the tip already reaches (screen px offsets). */
export const PR_RING_LAYOUT = {
  /** organic tip: replaces the ring at outer + 2.5 px (1.5 px wide); the outer edge stays outer + 3.25 px */
  organic: { offsetPx: 2, widthPx: 2.5 },
  /** metro tip station: replaces the station outline, hugging the disc from outside */
  metro: { offsetPx: 0.8, widthPx: 2.2 },
  /** garden tip: just inside the petals, so the outer edge is their reach */
  garden: { offsetPx: -1.25, widthPx: 2.5 },
} as const

export type PrRingLayout = keyof typeof PR_RING_LAYOUT

/** Centre radius and width of a layout's ring round a tip reaching `base` (graph units). */
export function prRingFor(layout: PrRingLayout, base: number, px: number): { R: number; w: number } {
  const g = PR_RING_LAYOUT[layout]
  const w = g.widthPx * px
  return { R: Math.max(base + g.offsetPx * px, w / 2), w }
}

/** How far a ring reaches from the centre. */
export function prRingOuterEdge(R: number, w: number): number {
  return R + w / 2
}

const NO_DASH: number[] = []

/**
 * Paints the ring at (x, y) at the context's current globalAlpha (the node's), leaving alpha, line
 * cap and dash as they were.
 */
export function drawPrRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  R: number,
  w: number,
  mark: MarkLike,
  theme: Pick<Theme, PrTone>,
  px: number,
): void {
  const alpha = ctx.globalAlpha
  const cap = ctx.lineCap
  for (const arc of prRingArcs(R, w, mark, px)) {
    ctx.beginPath()
    ctx.arc(x, y, R, arc.a0, arc.a1)
    ctx.strokeStyle = toneColour(theme, arc.tone)
    ctx.globalAlpha = arc.faint ? alpha * 0.5 : alpha
    if (arc.dotted) {
      ctx.lineWidth = w * DOT_WIDTH
      ctx.lineCap = 'round'
      ctx.setLineDash([0, w * DOT_PITCH])
    } else {
      ctx.lineWidth = w
      ctx.lineCap = 'butt'
      ctx.setLineDash(NO_DASH)
    }
    ctx.stroke()
  }
  ctx.setLineDash(NO_DASH)
  ctx.lineCap = cap
  ctx.globalAlpha = alpha
}

// ---------- words ----------

export function reviewWords(pr: Pick<PullSummary, 'review'>): string {
  switch (pr.review) {
    case 'approved':
      return 'approved'
    case 'changes':
      return 'changes requested'
    case 'waiting':
      return 'review required'
    default:
      return 'review ?'
  }
}

/**
 * The checks in few words, for the selected branch row's one line beside the review: "2/30 failing",
 * "3/30 running", "30 passing", "no checks", "checks ?". The half glyph beside it says it is checks.
 */
export function checksWordsShort(pr: Pick<PullSummary, 'checks' | 'checkCounts'>): string {
  const c = pr.checkCounts
  const known = c !== null && c.total > 0
  switch (pr.checks) {
    case 'failing':
      return known ? `${c.failing}/${c.total} failing` : 'failing'
    case 'running':
      return known ? `${c.running}/${c.total} running` : 'running'
    case 'passing':
      return known ? `${c.total} passing` : 'passing'
    default:
      return checksWords(pr)
  }
}

export function checksWords(pr: Pick<PullSummary, 'checks' | 'checkCounts'>): string {
  const c = pr.checkCounts
  switch (pr.checks) {
    case 'failing':
      return c && c.total > 0 ? `${c.failing} of ${c.total} checks failing` : 'checks failing'
    case 'running':
      return c && c.total > 0 ? `${c.running} of ${c.total} checks running` : 'checks running'
    case 'passing':
      return c && c.total > 0 ? `${c.total} check${c.total === 1 ? '' : 's'} passing` : 'checks passing'
    case 'none':
      return 'no checks'
    default:
      return 'checks ?'
  }
}

/** One pull request as a phrase: "open PR #12345: review required, 2 of 30 checks failing, draft". */
export function prPhrase(pr: Pick<PullSummary, 'number' | 'review' | 'checks' | 'checkCounts' | 'draft'>): string {
  return `open PR #${pr.number}: ${reviewWords(pr)}, ${checksWords(pr)}${pr.draft ? ', draft' : ''}`
}

/** The suffix a branch row's title and label gain: ", open PR #12345: ..." (and "+N more"). */
export function prRowSuffix(prs: ReadonlyArray<Parameters<typeof prPhrase>[0]>): string {
  if (prs.length === 0) return ''
  const more = prs.length > 1 ? ` (+${prs.length - 1} more)` : ''
  return `, ${prPhrase(prs[0])}${more}`
}

/** The inspector's meta line: "draft · conflicts with main · into feat/x · by login · updated 1d ago". */
export function prMeta(
  pr: Pick<PullSummary, 'draft' | 'conflict' | 'base' | 'author' | 'updatedAt'>,
  defaultBranch: string,
  now: number = Date.now(),
): string[] {
  const parts: string[] = []
  if (pr.draft) parts.push('draft')
  if (pr.conflict === true) parts.push(`conflicts with ${pr.base}`)
  // a stacked pull request: its base is another branch
  if (pr.base !== defaultBranch) parts.push(`into ${pr.base}`)
  if (pr.author) parts.push(`by ${pr.author}`)
  const when = relativeTime(pr.updatedAt, now)
  if (when) parts.push(`updated ${when}`)
  return parts
}
