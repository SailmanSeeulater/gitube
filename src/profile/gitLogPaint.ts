/**
 * Canvas drawing for the git log view: `git log --graph` in One Dark, laid along the shared time
 * axis. Editor grey under everything, the axis (years, today, the language ribbon) in console ink, a
 * faint gridline at each new year, then every branch: a dotted connector up from the trunk, a short
 * diagonal into its lane, its line to its last activity, a commit on its active days (thinned where
 * they crowd), a merge dot in the tag colour on each day a pull request of theirs landed in it, an
 * archived branch's "*" terminal and, where its lane leaves room, its seven-digit
 * hash beside the fork. Then the trunk along the horizon, the milestones as tags on it, the hovered
 * day's guide, and the hovered and selected branches on top over a halo.
 *
 * The console look ignores the app's theme: every colour is GITLOG_PALETTE's (src/theme/console).
 * It draws no repo name: the "(branch-name)" refs are the shared labels, anchored at each fork. Its
 * only text is the axis's years and today and the hashes, which come from no name.
 */
import { GITLOG_PALETTE as P } from '../theme/console/gitlog'
import { horizonY } from './lifeGeometry'
import { paintAxisBackdrop, paintCanvasFill, paintDayGuide, type LifeAxisPaint } from './lifeAxis'
import type { LifeInk, LifeViewport } from './lifeTypes'
import type { LifeViewPaintInput } from './lifeView'
import type { GitBranch, GitLogLayout } from './gitLogLayout'
import { branchForked, branchReached, branchTo, commitReached, type GitLogGeom } from './gitLogGeometry'

export type GitLogPaintInput = LifeViewPaintInput<GitLogLayout, GitLogGeom>

/** The hashes: a small monospace, drawn only on lanes at least HASH_MIN_PITCH apart. */
export const HASH_FONT = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
export const HASH_MIN_PITCH = 9
/** A hash's width at HASH_FONT (seven digits), and the room kept round it. */
const HASH_W_PX = 38
const HASH_PAD_PX = 4
/** The connector from the trunk to a fork, at this alpha. */
export const CONNECTOR_ALPHA = 0.28
/** A selection dims every other branch to this. */
export const DIM_ALPHA = 0.3
/** Commits closer than this many radii are thinned out. */
const THIN_RADII = 2.4
const TRUNK_PX = 2
const TRUNK_DOT_PX = 3
/** A landed pull request's merge dot: this much larger than a commit. */
const LANDED_PAD_PX = 1
const TERMINAL_PAD_PX = 2
/** A tag on the trunk: half its width and its height, and how much larger while hovered. */
const TAG_HALF_PX = 3.5
const TAG_H_PX = 10
const TAG_HOVER = 1.4
const HALO_ALPHA = 0.5
const CULL_PX = 24
const TWO_PI = Math.PI * 2

/** A language's colour: its slot's, or the plain grey with no language. */
export function languageColourOf(layout: Pick<GitLogLayout, 'slots'>, language: string | null): string {
  const slot = language === null ? undefined : layout.slots.get(language)
  return slot === undefined ? P.plain : P.lanes[slot % P.lanes.length]
}

/** A branch's colour, by its language's slot. */
export function branchColour(branch: Pick<GitBranch, 'slot'>): string {
  return branch.slot < 0 ? P.plain : P.lanes[branch.slot % P.lanes.length]
}

const consoleInks = new WeakMap<LifeInk, LifeInk>()

/** The theme's ink with every colour the axis draws in swapped for the console's. */
export function consoleInk(ink: LifeInk): LifeInk {
  let out = consoleInks.get(ink)
  if (!out) {
    out = {
      ...ink,
      canvas: P.bg,
      text: P.fg,
      muted: P.comment,
      accent: P.tag,
      fallback: P.plain,
      rootRing: P.fg,
      eraBand: P.gutter,
      horizon: P.gutter,
      dry: P.comment,
      hoverRing: P.hover,
      inspectedRing: P.selected,
      textHalo: P.bg,
      labelPlateFill: P.plate,
      labelPlateRing: P.gutter,
      dimAlpha: DIM_ALPHA,
    }
    consoleInks.set(ink, out)
  }
  return out
}

/** The branch's label anchor: its fork once forked, else where it starts. */
export function gitLogAnchor(layout: GitLogLayout, g: GitLogGeom, i: number, at: number | null, out: Float32Array): boolean {
  const branch = layout.branches[i]
  if (branch === undefined || !(branch.track < g.laneY.length)) return false
  out[0] = g.camera.tx + (branchForked(branch, at) ? branch.x : branch.x0) * g.camera.k
  out[1] = g.laneY[branch.track]
  out[2] = g.dotR + 1
  return true
}

/** The heaviest branches' names first, then the most starred, then paint order. */
export function gitLogLabelOrder(layout: GitLogLayout): Int32Array {
  const b = layout.branches
  return Int32Array.from(b.keys()).sort((x, y) => b[y].weight - b[x].weight || b[y].stars - b[x].stars || x - y)
}

/** Labels keep off the trunk's tags and the ground under it. */
export function gitLogKeepOut(_layout: GitLogLayout, view: LifeViewport): Float32Array {
  return Float32Array.of(0, horizonY(view) - TAG_H_PX / 2, view.width, view.height)
}

/** An asterisk of three strokes centred on (x, y), r px from its centre to each point. */
function asterisk(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  for (const a of [Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6]) {
    const dx = Math.cos(a) * r
    const dy = Math.sin(a) * r
    ctx.moveTo(x - dx, y - dy)
    ctx.lineTo(x + dx, y + dy)
  }
  ctx.stroke()
}

/** Whether any of the branch up to to (world x), with its fork and hash, can reach the screen. */
function onScreen(branch: GitBranch, g: GitLogGeom, to: number, W: number): boolean {
  const pad = CULL_PX + g.forkPx + HASH_W_PX + HASH_PAD_PX
  return g.camera.tx + Math.max(to, branch.x) * g.camera.k + pad >= 0 && g.camera.tx + Math.min(branch.x0, branch.x) * g.camera.k - pad <= W
}

/** A branch's marks: connector and fork, line, commits, terminal and hash. globalAlpha is the caller's. */
function drawBranch(ctx: CanvasRenderingContext2D, branch: GitBranch, g: GitLogGeom, input: GitLogPaintInput, alpha: number): void {
  const { layout, at, view } = input
  const W = view.width
  const { k, tx } = g.camera
  const sx = (x: number) => tx + x * k
  const clip = (x: number) => Math.min(W + CULL_PX, Math.max(-CULL_PX, x))
  const y = g.laneY[branch.track]
  const colour = branchColour(branch)
  const to = branchTo(branch, layout.startDay, at)
  const f = g.forkPx
  const rootX = sx(branch.x)
  const forked = branchForked(branch, at)

  ctx.lineCap = 'round'
  if (forked && rootX + CULL_PX >= 0 && rootX - f - CULL_PX <= W) {
    // the connector up from the trunk, faint and dotted, then the diagonal into the lane
    ctx.globalAlpha = alpha * CONNECTOR_ALPHA
    ctx.beginPath()
    ctx.moveTo(rootX - f, g.trunkY)
    ctx.lineTo(rootX - f, y + f)
    ctx.setLineDash([1, 2])
    ctx.strokeStyle = colour
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.moveTo(rootX - f, y + f)
    ctx.lineTo(rootX, y)
    ctx.lineWidth = g.linePx
    ctx.stroke()
  }
  ctx.globalAlpha = alpha

  if (to > branch.x0) {
    ctx.beginPath()
    ctx.moveTo(clip(sx(branch.x0)), y)
    ctx.lineTo(clip(sx(to)), y)
    ctx.strokeStyle = colour
    ctx.lineWidth = g.linePx
    ctx.stroke()
  }

  // the commits reached, thinned where they crowd; the last one reached always shows
  const r = g.dotR
  const min = r * THIN_RADII
  const c = branch.commits
  let last = -Infinity
  let n = c.length
  while (n > 0 && !commitReached(c[n - 1], layout.startDay, at)) n--
  ctx.beginPath()
  let any = false
  for (let j = 0; j < n; j++) {
    const x = sx(c[j])
    if (x < -CULL_PX) continue
    if (x > W + CULL_PX) break
    if (x - last < min && j !== n - 1) continue
    ctx.moveTo(x + r, y)
    ctx.arc(x, y, r, 0, TWO_PI)
    last = x
    any = true
  }
  if (any) {
    if (branch.visiting) {
      ctx.fillStyle = P.bg
      ctx.fill()
      ctx.strokeStyle = colour
      ctx.lineWidth = 1
      ctx.stroke()
    } else {
      ctx.fillStyle = colour
      ctx.fill()
    }
  }

  // a landed pull request: a merge dot in the tag colour on its day, once reached
  const lr = r + LANDED_PAD_PX
  ctx.beginPath()
  let landed = false
  for (let j = 0; j < branch.landed.length; j++) {
    const lx = branch.landed[j]
    if (!commitReached(lx, layout.startDay, at)) break
    const x = sx(lx)
    if (x < -CULL_PX) continue
    if (x > W + CULL_PX) break
    ctx.moveTo(x + lr, y)
    ctx.arc(x, y, lr, 0, TWO_PI)
    landed = true
  }
  if (landed) {
    ctx.fillStyle = P.tag
    ctx.fill()
    ctx.strokeStyle = P.bg
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // an archived branch ends in a terminal on its last commit
  if (branch.archived && (at === null || at >= branch.tipDay)) {
    const x = sx(branch.tipDay - layout.startDay + 0.5)
    if (x >= -CULL_PX && x <= W + CULL_PX) {
      const tr = r + TERMINAL_PAD_PX
      ctx.beginPath()
      ctx.arc(x, y, tr, 0, TWO_PI)
      ctx.fillStyle = P.bg
      ctx.fill()
      ctx.strokeStyle = colour
      ctx.lineWidth = 1.5
      asterisk(ctx, x, y, tr)
    }
  }

  // its hash beside the fork, where the lane leaves room for it
  if (forked && g.pitch >= HASH_MIN_PITCH && branch.room * k >= HASH_W_PX + f + HASH_PAD_PX * 2) {
    const x = rootX - f - HASH_PAD_PX
    if (x >= 0 && x - HASH_W_PX <= W) {
      ctx.font = HASH_FONT
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = P.comment
      ctx.fillText(branch.hash, x, y)
    }
  }
}

/** Paints the whole frame. The context comes in with the device pixel transform set; it is left as it came. */
export function paintGitLog(ctx: CanvasRenderingContext2D, input: GitLogPaintInput): void {
  const { layout, timeline, geoms: g, camera, view, hidden, hover, selected, at } = input
  const ink = consoleInk(input.ink)
  const colourOf = (language: string | null) => languageColourOf(layout, language)
  const W = view.width
  const horizon = horizonY(view)
  const sx = (x: number) => camera.tx + x * camera.k
  const axis: LifeAxisPaint = { axis: layout, timeline, camera, view, ink, colourOf, hover, at }

  paintCanvasFill(ctx, ink)
  ctx.save()
  ctx.globalAlpha = 1
  paintAxisBackdrop(ctx, axis, { yearBands: false })

  // a dotted gridline at each new year
  ctx.beginPath()
  let grid = false
  for (const year of layout.years) {
    if (!(year.x0 > 0)) continue
    const x = Math.round(sx(year.x0)) + 0.5
    if (x < 0 || x > W) continue
    ctx.moveTo(x, view.top)
    ctx.lineTo(x, horizon)
    grid = true
  }
  if (grid) {
    ctx.setLineDash([2, 4])
    ctx.strokeStyle = P.gutter
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
  }

  // the branches; a selection dims every other one
  const branches = layout.branches
  const sel = selected !== null ? (layout.byKey.get(selected) ?? -1) : -1
  const hov = hover?.kind === 'repo' ? (layout.byKey.get(hover.key) ?? -1) : -1
  const shown = (b: GitBranch | undefined): b is GitBranch => b !== undefined && !hidden.has(b.key) && branchReached(b, at)
  for (let i = 0; i < branches.length; i++) {
    const b = branches[i]
    if (!shown(b) || !onScreen(b, g, branchTo(b, layout.startDay, at), W)) continue
    drawBranch(ctx, b, g, input, sel >= 0 && sel !== i ? DIM_ALPHA : 1)
  }
  ctx.globalAlpha = 1

  // the trunk, from their start to today (or the time-lapse's day), a commit at each end
  const reached = at === null ? layout.days : Math.min(layout.days, Math.max(0, at - layout.startDay))
  if (layout.days > 0 && (at === null || at >= layout.startDay)) {
    const x0 = Math.max(-CULL_PX, sx(0))
    const x1 = Math.min(W + CULL_PX, sx(reached))
    ctx.lineCap = 'round'
    if (x1 > x0) {
      ctx.beginPath()
      ctx.moveTo(x0, g.trunkY)
      ctx.lineTo(x1, g.trunkY)
      ctx.strokeStyle = P.fg
      ctx.lineWidth = TRUNK_PX
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(sx(0.5), g.trunkY, TRUNK_DOT_PX, 0, TWO_PI)
    if (at === null || reached >= layout.days - 0.5) {
      ctx.moveTo(sx(layout.days - 0.5) + TRUNK_DOT_PX, g.trunkY)
      ctx.arc(sx(layout.days - 0.5), g.trunkY, TRUNK_DOT_PX, 0, TWO_PI)
    }
    ctx.fillStyle = P.fg
    ctx.fill()
  }

  // the milestones as tags on the trunk: a longest streak's bar, then the tags, the hovered one larger
  const hoverMilestone = hover?.kind === 'day' ? hover.milestone : null
  for (const m of layout.milestones) {
    if (at !== null && m.x > at - layout.startDay + 0.5) continue
    const x = sx(m.x)
    if (m.kind === 'longest-streak' && m.x1 !== null) {
      const x1 = Math.min(W, sx(m.x1))
      if (x1 > 0 && x < W) {
        ctx.fillStyle = P.tag
        ctx.fillRect(Math.max(0, x), g.trunkY - 1.5, x1 - Math.max(0, x), 3)
      }
    }
    if (x < -CULL_PX || x > W + CULL_PX) continue
    const hovered = hoverMilestone === m.index
    const s = hovered ? TAG_HOVER : 1
    const half = TAG_HALF_PX * s
    const top = g.trunkY - TAG_H_PX * s
    ctx.beginPath()
    ctx.moveTo(x, g.trunkY - 1)
    ctx.lineTo(x - half, g.trunkY - 1 - half)
    ctx.lineTo(x - half, top)
    ctx.lineTo(x + half, top)
    ctx.lineTo(x + half, g.trunkY - 1 - half)
    ctx.closePath()
    let fill = P.tag
    const milestone = timeline.milestones[m.index]
    if (m.kind === 'language-switch' && milestone) {
      const era = timeline.languageEras.find((e) => e.from === milestone.day)
      if (era) fill = colourOf(era.language)
    }
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = P.bg
    ctx.lineWidth = 1
    ctx.stroke()
    // the tag's hole
    ctx.beginPath()
    ctx.arc(x, top + 2.5 * s, 1 * s, 0, TWO_PI)
    ctx.fillStyle = P.bg
    ctx.fill()
    if (hovered) {
      ctx.beginPath()
      ctx.arc(x, g.trunkY - TAG_H_PX * s * 0.5, TAG_H_PX * s * 0.5 + 3, 0, TWO_PI)
      ctx.strokeStyle = P.hover
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }

  paintDayGuide(ctx, axis)

  // the selected and the hovered branch on top, over a halo, with a ring round the fork
  const mark = (i: number, colour: string) => {
    const b = branches[i]
    if (!shown(b)) return
    const to = branchTo(b, layout.startDay, at)
    if (!onScreen(b, g, to, W)) return
    const y = g.laneY[b.track]
    ctx.globalAlpha = HALO_ALPHA
    ctx.beginPath()
    ctx.moveTo(Math.max(-CULL_PX, sx(b.x0)), y)
    ctx.lineTo(Math.min(W + CULL_PX, sx(Math.max(to, b.x0))), y)
    ctx.strokeStyle = colour
    ctx.lineWidth = g.dotR * 2 + 3
    ctx.lineCap = 'round'
    ctx.stroke()
    drawBranch(ctx, b, g, input, 1)
    ctx.globalAlpha = 1
    if (!branchForked(b, at)) return
    ctx.beginPath()
    ctx.arc(sx(b.x), y, g.dotR + 3, 0, TWO_PI)
    ctx.strokeStyle = colour
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  if (sel >= 0) mark(sel, P.selected)
  if (hov >= 0 && hov !== sel) mark(hov, P.hover)

  ctx.restore()
}
