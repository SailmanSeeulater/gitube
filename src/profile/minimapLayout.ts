/**
 * The minimap view's layout and geometry (a console view: a code editor's chrome). Each lane of the
 * life timeline is a line of code, one row per repo in lane order, the timeline's own privacy-safe
 * order (by firstActiveAt, never by a name); along the shared time axis its active spans are syntax
 * tokens, coloured by its language's tone, and its dormant spans whitespace. A tab bar sits over the
 * rows, a gutter of line numbers at the canvas's left edge, and a minimap strip at its right edge,
 * an overview of every row with a box over the stretch of time the camera shows.
 *
 * World x is days since the timeline's start, the same x as every person view (a day's middle at
 * +0.5). The gutter, the tab bar and the strip are in screen px, fixed whatever the camera; the rows
 * are spread over the plot, thinner for a big profile (never past it), top-aligned like a file.
 *
 * Pure and deterministic: rows go in lane order, a language's tone by how many lanes use it (then
 * the language's name, never a repo's), so a drawing cannot confirm a guess at a private repo's name.
 */
import type { ProfileData } from '../types'
import { repoKey } from './privacy'
import { horizonY } from './lifeGeometry'
import { axisOf, type LifeViewItem, type LifeViewModel } from './lifeView'
import type { Lane, LifeTimeline } from './timeline'
import type { LifeCamera, LifeViewport } from './lifeTypes'

/** A stretch of a row in world x. */
export interface MinimapStretch {
  x0: number
  x1: number
}

/** One repo as the minimap draws it: a line of code. */
export interface MinimapRow extends LifeViewItem {
  /** world x of the lane's first day's start and of its last day's end */
  x0: number
  x1: number
  rootDay: number
  endDay: number
  language: string | null
  /** its language's rank by lanes using it (0: the most), -1 without a language */
  tone: number
  /** archived: drawn as a comment */
  dry: boolean
  /** a token profile's lane GitHub counted no commits to: its tokens drawn hollow */
  seedling: boolean
  /** counted commits with a token, active days without; labels go to the heaviest first */
  weight: number
  stars: number
  /** the active spans, in x order: the syntax tokens */
  tokens: MinimapStretch[]
  /** the dormant spans, in x order: whitespace */
  dormant: MinimapStretch[]
}

export interface MinimapLayout extends LifeViewModel {
  /** one per lane, in lane order: row i is line i + 1; byKey indexes it */
  rows: MinimapRow[]
  /** language -> its tone */
  toneOf: ReadonlyMap<string, number>
}

function laneWeight(lane: Lane, source: ProfileData['source']): number {
  if (source === 'graphql') return lane.commits
  let days = 0
  for (const span of lane.spans) if (span.kind === 'active') days += span.days
  return days
}

/** Each language's tone: by lanes using it, most first, then by the language's own name. */
export function minimapTones(lanes: ReadonlyArray<Lane>): Map<string, number> {
  const uses = new Map<string, number>()
  for (const lane of lanes) if (lane.language !== null) uses.set(lane.language, (uses.get(lane.language) ?? 0) + 1)
  const ranked = [...uses.keys()].sort((a, b) => uses.get(b)! - uses.get(a)! || (a < b ? -1 : a > b ? 1 : 0))
  return new Map(ranked.map((language, i) => [language, i]))
}

/** The minimap of a timeline; source says whether lanes weigh commits (graphql) or active days (rest). */
export function layoutMinimap(timeline: LifeTimeline, source: ProfileData['source']): MinimapLayout {
  const axis = axisOf(timeline)
  const { startDay, lanes } = timeline

  const toneOf = minimapTones(lanes)

  const rows = lanes.map((lane, i): MinimapRow => {
    const x0 = lane.startDay - startDay
    const x1 = lane.endDay + 1 - startDay
    const tokens: MinimapStretch[] = []
    const dormant: MinimapStretch[] = []
    lane.spans.forEach((span, s) => {
      const stretch = { x0: s === 0 ? x0 : span.fromDay - startDay, x1: s === lane.spans.length - 1 ? x1 : span.toDay + 1 - startDay }
      ;(span.kind === 'active' ? tokens : dormant).push(stretch)
    })
    return {
      lane: i,
      key: repoKey(lane.repo),
      startDay: lane.startDay,
      x: lane.rootDay - startDay + 0.5,
      x0,
      x1,
      rootDay: lane.rootDay,
      endDay: lane.endDay,
      language: lane.language,
      tone: lane.language === null ? -1 : toneOf.get(lane.language)!,
      dry: lane.isArchived,
      seedling: source === 'graphql' && !lane.detailed,
      weight: laneWeight(lane, source),
      stars: lane.stars,
      tokens,
      dormant,
    }
  })
  const byKey = new Map(rows.map((row, i) => [row.key, i]))
  return { ...axis, byKey, rows, toneOf }
}

// ---------- geometry: the editor's frame in screen px ----------

/** The tab bar's height, at the plot's top. */
export const TAB_BAR_PX = 22
/** Room kept between the last row and the horizon. */
export const ROWS_FOOT_PX = 6
/** Rows are never further apart than this (an editor's line height)... */
export const MAX_PITCH = 18
/** ...and a token takes this share of the pitch, at least MIN_TOKEN_H_PX. */
const TOKEN_SHARE = 0.62
export const MIN_TOKEN_H_PX = 1
/** A token is never narrower than this. */
export const MIN_TOKEN_W_PX = 2
/** The gutter and the strip take the plot's side margin, at least these. */
const MIN_GUTTER_PX = 16
const MIN_STRIP_PX = 20
/** The strip stands this far inside the side margin, so a fitted life ends clear of it. */
const STRIP_INSET_PX = 2
/** A row in the strip is never taller than this. */
const STRIP_MAX_PITCH = 3
/** The strip maps the life's days between its edges, this far in. */
const STRIP_PAD_PX = 3
/** Line numbers: between these sizes, so the most digits fit the gutter. */
const NUMBER_MAX_PX = 11
const NUMBER_MIN_PX = 6
const DIGIT_SHARE = 0.62
export const GUTTER_PAD_PX = 4
/** Every line number while they fit, else every step-th. */
const NUMBER_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

export interface MinimapStrip {
  x0: number
  x1: number
  y0: number
  y1: number
  /** px from one row's bar to the next */
  pitch: number
  barH: number
  /** world x 0 and the life's end (days) map to these */
  ix0: number
  ix1: number
  days: number
}

export interface MinimapGeom {
  /** the camera it was made under: screen x = camera.tx + world x * camera.k */
  camera: LifeCamera
  tabTop: number
  tabBottom: number
  rowsTop: number
  rowsBottom: number
  /** px from one row to the next */
  pitch: number
  tokenH: number
  /** the gutter's right edge; the editor runs from it to the strip */
  gutterW: number
  numberPx: number
  /** every step-th line number is drawn */
  numberStep: number
  strip: MinimapStrip
}

/** The gutter's width for a viewport. */
export function gutterWidth(view: LifeViewport): number {
  return Math.max(MIN_GUTTER_PX, view.side - STRIP_INSET_PX)
}

/** The strip's left edge for a viewport. */
export function stripLeft(view: LifeViewport): number {
  return view.width - Math.max(MIN_STRIP_PX, view.side - STRIP_INSET_PX)
}

export function minimapGeom(layout: Pick<MinimapLayout, 'rows' | 'days'>, camera: LifeCamera, view: LifeViewport): MinimapGeom {
  const n = layout.rows.length
  const tabTop = view.top
  const tabBottom = tabTop + TAB_BAR_PX
  const rowsTop = tabBottom
  const rowsBottom = Math.max(rowsTop, horizonY(view) - ROWS_FOOT_PX)
  const plotH = rowsBottom - rowsTop
  const pitch = Math.min(MAX_PITCH, plotH / Math.max(1, n))
  const tokenH = Math.max(MIN_TOKEN_H_PX, pitch * TOKEN_SHARE)

  const gutterW = gutterWidth(view)
  const digits = String(Math.max(1, n)).length
  const numberPx = Math.max(NUMBER_MIN_PX, Math.min(NUMBER_MAX_PX, (gutterW - GUTTER_PAD_PX - 2) / (digits * DIGIT_SHARE)))
  const numberStep = NUMBER_STEPS.find((step) => step * pitch >= numberPx + 1) ?? NUMBER_STEPS.at(-1)!

  const x0 = stripLeft(view)
  const x1 = view.width
  const stripPitch = n > 0 ? Math.min(STRIP_MAX_PITCH, plotH / n) : 0
  const strip: MinimapStrip = {
    x0,
    x1,
    y0: rowsTop,
    y1: rowsBottom,
    pitch: stripPitch,
    barH: Math.max(1, stripPitch >= 2 ? stripPitch - 1 : stripPitch),
    ix0: x0 + STRIP_PAD_PX,
    ix1: Math.max(x0 + STRIP_PAD_PX, x1 - STRIP_PAD_PX),
    days: Math.max(1, layout.days),
  }
  return { camera, tabTop, tabBottom, rowsTop, rowsBottom, pitch, tokenH, gutterW, numberPx, numberStep, strip }
}

/** Row i's centre line. */
export function rowY(g: Pick<MinimapGeom, 'rowsTop' | 'pitch'>, i: number): number {
  return g.rowsTop + (i + 0.5) * g.pitch
}

/** World x in the strip. */
export function stripX(s: MinimapStrip, x: number): number {
  return s.ix0 + (Math.min(s.days, Math.max(0, x)) / s.days) * (s.ix1 - s.ix0)
}

/** Row i's bar's top in the strip. */
export function stripRowY(s: MinimapStrip, i: number): number {
  return s.y0 + i * s.pitch
}

// ---------- the time-lapse: what of a row is drawn by its day (paint, hit and labels agree) ----------

/** World x the row is drawn to by the time-lapse's day: its end, or the day reached. */
export function drawnTo(row: Pick<MinimapRow, 'x1'>, startDay: number, at: number | null): number {
  return at === null ? row.x1 : Math.min(row.x1, at - startDay)
}

/** Whether the time-lapse has sown the row (any of it is drawn). */
export function sown(row: Pick<MinimapRow, 'startDay'>, at: number | null): boolean {
  return at === null || row.startDay <= at
}

/** Whether the time-lapse has reached the row's root, where its label is anchored. */
export function rooted(row: Pick<MinimapRow, 'rootDay'>, at: number | null): boolean {
  return at === null || at >= row.rootDay
}

/** A token's screen extent from a and b, widened about its middle to MIN_TOKEN_W_PX. */
export function tokenSpan(a: number, b: number): [number, number] {
  if (b - a >= MIN_TOKEN_W_PX) return [a, b]
  const m = (a + b) / 2
  return [m - MIN_TOKEN_W_PX / 2, m + MIN_TOKEN_W_PX / 2]
}
