/**
 * Person mode's repo labels, for every view. Each repo's anchor (a line's start, a star, a stack's
 * head) is a node for repo mode's LabelPlacer (labelPlacement.ts), so names settle beside
 * their anchors without covering each other or an anchor, appear once the camera rests, fade and
 * crossfade, and the hovered and the selected repo show theirs on a plate (the hovered one's also
 * lists the hidden names round it). It wraps the placer itself, not the useLabelPlacer hook, which
 * reads the repo store and graph nodes; the views' painter (lifePaint.ts) builds a set per layout
 * and names, taking over the spots of the one before while the view is the same.
 *
 * A set knows its repos only by key and importance; each frame the view says where every anchor
 * is (or that it has none: hidden, not sown yet) and which boxes labels keep off.
 *
 * Every text is a ShownName from the view's RepoNamer and is measured as it is shown, so no drawn
 * label, plate or box width carries a hidden private name or its length. A locked name keeps room
 * for its lock in every width.
 */
import { endEllipsis } from '../components/graphUtils'
import { LabelPlacer, type LabelSpec } from '../components/labelPlacement'
import { measureLabel } from '../components/useLabelPlacer'
import type { LifeTimeline } from './timeline'
import type { LifeInk, LifeViewport, RepoNamer, ShownName } from './lifeTypes'
import { drawLock } from './drawLock'

/**
 * The font labels are drawn in: the one measureLabel measures with (useLabelPlacer.ts), so a drawn
 * label fits the box it was placed in. Pinned in tests/lifeLabels.test.ts.
 */
export const LIFE_LABEL_FONT = '12px Inter, ui-sans-serif, system-ui, sans-serif'
/** Room before a locked name for its lock. */
export const LOCK_PX = 10
const LOCK_SIZE = 8
/** a label's widest form, and its compact one when that saves enough */
const WIDE_MAX_PX = 200
const COMPACT_MAX_PX = 120
const COMPACT_MIN_SAVING_PX = 8
/** the canvas colour stroked behind label text, so a stem passing under it never runs into the letters */
const HALO_PX = 3
const PLATE_RADIUS = 4
/** the backing plate of a label pinned over another head */
const LEADER_PLATE_RADIUS = 3
const DOT_RADIUS = 3

type Measure = (text: string) => number

type LaneItems = ReadonlyArray<{ lane: number }>

/**
 * The names the labels show, index-aligned with a view's items: each lane's repo through the namer,
 * without the owner when that is the person (their own repos), which every label would otherwise
 * repeat.
 */
export function labelNames(items: LaneItems, timeline: Pick<LifeTimeline, 'lanes'>, name: RepoNamer, login: string): ShownName[] {
  const own = `${login.toLowerCase()}/`
  return items.map((item) => {
    const shown = name(timeline.lanes[item.lane].repo)
    const text = shown.text.toLowerCase().startsWith(own) ? shown.text.slice(own.length) : shown.text
    return text === shown.text ? shown : { text, locked: shown.locked }
  })
}

/** A repo's label: its name, cut to a wide and maybe a compact form; the full name goes on its plate. */
export function lifeLabelSpec(node: number, name: ShownName, measure: Measure): LabelSpec {
  const lock = name.locked ? LOCK_PX : 0
  const full = name.text
  const fullWidth = measure(full) + lock
  const wide = endEllipsis(full, WIDE_MAX_PX - lock, measure)
  const texts = [wide]
  const widths = [measure(wide) + lock]
  const compact = endEllipsis(full, COMPACT_MAX_PX - lock, measure)
  const compactWidth = measure(compact) + lock
  if (compactWidth <= widths[0] - COMPACT_MIN_SAVING_PX) {
    texts.push(compact)
    widths.push(compactWidth)
  }
  return { node, texts, widths, fullText: full, fullWidth, names: [full], nameWidths: [fullWidth] }
}

/** The repos a set labels: their keys, index-aligned with a view's items, and the order labels are placed in. */
export interface LifeLabelItems {
  keys: readonly string[]
  /** item indexes, the most important label first */
  order: Int32Array
}

/** What one frame of labels needs. */
export interface LifeLabelFrame {
  /**
   * writes item i's anchor into out as [x, y, r] in screen px (the label keeps r clear round it);
   * false for none (hidden, or not sown by the time-lapse yet): its label drops at once and blocks nothing
   */
  anchor: (i: number, out: Float32Array) => boolean
  /** boxes labels keep off, as [x0, y0, x1, y1]* in screen px */
  keepOut: Float32Array
  view: LifeViewport
  dtMs: number
  cameraMoving: boolean
  /** item indexes shown on a plate: the hovered and the selected one */
  forced: readonly number[]
  /** the hovered item, whose plate also lists the hidden names round it; -1 for none */
  explore: number
}

/**
 * The labels of one view's items and one set of names. A new set (a new profile, or the privacy
 * toggle flipped) takes over the spots of the one before it by repo key, so labels stay where they
 * were.
 */
export class LifeLabelSet {
  readonly placer: LabelPlacer
  /** repo keys, index-aligned with the view's items and the labels */
  readonly keys: readonly string[]
  private readonly locked: Uint8Array
  private readonly sx: Float32Array
  private readonly sy: Float32Array
  private readonly sr: Float32Array
  private readonly speed: Float32Array
  private readonly spot = new Float32Array(3)
  private readonly shortened = new Map<string, string>()

  constructor(
    items: LifeLabelItems,
    names: readonly ShownName[],
    private readonly measure: Measure = measureLabel,
    prev: LifeLabelSet | null = null,
  ) {
    const n = items.keys.length
    this.keys = items.keys
    this.locked = Uint8Array.from(items.keys, (_, i) => (names[i]?.locked ? 1 : 0))
    const specs = items.keys.map((_, i) => lifeLabelSpec(i, names[i] ?? { text: '', locked: false }, measure))
    this.placer = new LabelPlacer(specs, { measure })
    this.sx = new Float32Array(n)
    this.sy = new Float32Array(n)
    this.sr = new Float32Array(n)
    // items never move in the world: only the camera does
    this.speed = new Float32Array(n)
    this.placer.setOrder(items.order, [])
    if (prev) {
      const before = new Map<string, number>()
      prev.keys.forEach((key, i) => before.set(key, i))
      this.placer.inheritFrom(prev.placer, (i) => before.get(this.keys[i]) ?? -1)
    }
  }

  /** Places the labels for a frame; true while they still need frames (appearing, fading, settling). */
  update(frame: LifeLabelFrame): boolean {
    const { view, anchor } = frame
    const n = this.keys.length
    const spot = this.spot
    for (let i = 0; i < n; i++) {
      // an item with no anchor reads as one with no position: its label drops at once and blocks nothing
      if (!anchor(i, spot) || !Number.isFinite(spot[0]) || !Number.isFinite(spot[1])) {
        this.sx[i] = Number.NaN
        this.sy[i] = Number.NaN
        this.sr[i] = 0
        continue
      }
      this.sx[i] = spot[0]
      this.sy[i] = spot[1]
      this.sr[i] = spot[2]
    }
    const shown = (i: number) => i >= 0 && i < n && Number.isFinite(this.sx[i])
    this.placer.setForced(frame.forced.filter(shown), shown(frame.explore) ? frame.explore : -1)
    this.placer.update({
      sx: this.sx,
      sy: this.sy,
      sr: this.sr,
      speed: this.speed,
      nodeCount: n,
      width: view.width,
      height: view.height,
      dtMs: frame.dtMs,
      cameraMoving: frame.cameraMoving,
      boxes: frame.keepOut,
      boxCount: frame.keepOut.length >> 2,
    })
    return this.placer.busy
  }

  /** The item whose label or plate is at (x, y), keeping the hovered one (current) while still on it; -1 for none. */
  hit(x: number, y: number, current = -1): number {
    return this.placer.hoverTest(x, y, current)
  }

  /** The item a click at (x, y) picks: like hit, but a plate row naming another item picks that one. */
  click(x: number, y: number): number {
    return this.placer.clickTest(x, y)
  }

  /**
   * Draws the labels placed by the last update: the least important first, so the important ones
   * end up on top, then the plates. dotOf colours a plate row's item; selected dims every other label.
   */
  draw(ctx: CanvasRenderingContext2D, ink: LifeInk, dotOf: (item: number) => string, selected = -1): void {
    const placer = this.placer
    const o = placer.o
    const order = placer.order
    const mid = o.lineH / 2
    ctx.save()
    ctx.font = LIFE_LABEL_FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    const label = (text: string, x: number, y: number, locked: boolean) => {
      let tx = x
      if (locked) {
        drawLock(ctx, x + LOCK_SIZE / 2, y, LOCK_SIZE, ink.text)
        tx += LOCK_PX
      }
      ctx.strokeStyle = ink.textHalo
      ctx.lineWidth = HALO_PX
      ctx.strokeText(text, tx, y)
      ctx.fillStyle = ink.text
      ctx.fillText(text, tx, y)
    }
    for (let q = placer.n - 1; q >= 0; q--) {
      const i = order[q]
      if (placer.forcedNow[i]) continue
      const fade = placer.alpha[i]
      const ghost = placer.fromAlpha[i]
      if (fade <= 0.01 && ghost <= 0.01) continue
      const dim = selected >= 0 && selected !== i ? ink.dimAlpha : 1
      const locked = this.locked[i] === 1
      if (ghost > 0.01) {
        ctx.globalAlpha = ghost * dim
        label(placer.variantText(i, placer.fromVariant[i]), placer.fromX0[i] + o.padX, placer.fromY0[i] + mid, locked)
      }
      if (fade > 0.01) {
        if (placer.leader[i]) this.drawLeader(ctx, i, fade * dim, ink)
        ctx.globalAlpha = fade * dim
        label(placer.textOf(i), placer.x0[i] + o.padX, placer.y0[i] + mid, locked)
      }
    }
    ctx.globalAlpha = 1
    for (const i of placer.forcedLabels) {
      const plate = placer.plates[i]
      if (!placer.forcedNow[i] || plate === null) continue
      const x0 = placer.x0[i]
      const y0 = placer.y0[i]
      const w = placer.w[i]
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x0, y0, w, placer.h[i], PLATE_RADIUS)
      else ctx.rect(x0, y0, w, placer.h[i])
      ctx.fillStyle = ink.labelPlateFill
      ctx.fill()
      ctx.strokeStyle = ink.labelPlateRing
      ctx.lineWidth = 1
      ctx.stroke()
      const inner = w - 2 * o.platePadX
      plate.rows.forEach((row, r) => {
        const cy = y0 + r * o.lineH + mid
        let tx = x0 + o.platePadX
        let room = inner
        let locked = row.kind === 'name' && this.locked[i] === 1
        if (row.kind === 'neighbour') {
          ctx.beginPath()
          ctx.arc(tx + DOT_RADIUS, cy, DOT_RADIUS, 0, Math.PI * 2)
          ctx.fillStyle = row.label >= 0 ? dotOf(row.label) : ink.fallback
          ctx.fill()
          tx += o.plateIndent
          room -= o.plateIndent
          locked = row.label >= 0 && this.locked[row.label] === 1
        }
        if (locked) {
          drawLock(ctx, tx + LOCK_SIZE / 2, cy, LOCK_SIZE, ink.text)
          tx += LOCK_PX
          room -= LOCK_PX
        }
        let text = row.text
        if (row.width - (locked ? LOCK_PX : 0) > room + 0.5) {
          const key = `${Math.round(room)}\u0000${text}`
          let short = this.shortened.get(key)
          if (short === undefined) {
            short = endEllipsis(text, room, this.measure)
            this.shortened.set(key, short)
          }
          text = short
        }
        ctx.fillStyle = row.kind === 'more' ? ink.muted : ink.text
        ctx.fillText(text, tx, cy)
      })
    }
    ctx.restore()
  }

  /**
   * The backing plate and leader line of a label pinned over (or nearer to) another anchor, so it
   * does not read as that one's name.
   */
  private drawLeader(ctx: CanvasRenderingContext2D, i: number, alpha: number, ink: LifeInk): void {
    const placer = this.placer
    const x0 = placer.x0[i]
    const y0 = placer.y0[i]
    const w = placer.w[i]
    const h = placer.h[i]
    ctx.globalAlpha = alpha
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x0, y0, w, h, LEADER_PLATE_RADIUS)
    else ctx.rect(x0, y0, w, h)
    ctx.fillStyle = ink.labelPlateFill
    ctx.fill()
    const cx = this.sx[i]
    const cy = this.sy[i]
    const cr = this.sr[i]
    const px = Math.min(Math.max(cx, x0), x0 + w)
    const py = Math.min(Math.max(cy, y0), y0 + h)
    const d = Math.hypot(px - cx, py - cy)
    if (!(Number.isFinite(d) && d > cr + 0.5)) return
    ctx.globalAlpha = alpha * 0.6
    ctx.beginPath()
    ctx.moveTo(px, py)
    ctx.lineTo(cx + ((px - cx) / d) * cr, cy + ((py - cy) / d) * cr)
    ctx.strokeStyle = ink.text
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

