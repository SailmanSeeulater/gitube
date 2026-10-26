/**
 * What person mode's three views (PROFILE_SPEC.md section 5: the life garden, life lines and the
 * constellation) have in common, so one canvas host, one painter, one set of labels, one time-lapse
 * and one poster serve them all: the time axis they share, what each of their repos must say about
 * itself, and the scene a view hands the painter (lifePaint.ts's makeViewPaint).
 *
 * Every view lays its repos out along the same world x, days since the timeline's start (a day's
 * middle at +0.5), over the same days, in the same frame (lifeGeometry's VIEW_*), so one camera means
 * the same stretch of time in all of them and a switch keeps the zoom, the pan and the selected repo
 * in view. A view's paint never receives a namer: repo names reach the canvas only through the shared
 * labels, and a view draws only years, "today" and language names.
 *
 * Pure: types and three small helpers, no theme and no DOM.
 */
import type { ProfileData } from '../types'
import type { PersonView } from '../share/shareUrl'
import { screenToWorldX } from './lifeCamera'
import { horizonY } from './lifeGeometry'
import { dayNumber, type LifeMilestone, type LifeTimeline } from './timeline'
import type { LifeCamera, LifeHover, LifeInk, LifeViewport } from './lifeTypes'

/** The time axis every view shares, in world x. LifeGardenLayout satisfies it. */
export interface LifeAxis {
  /** day numbers: world x 0 is startDay */
  startDay: number
  todayDay: number
  /** todayDay - startDay + 1 */
  days: number
  years: Array<{ year: number; x0: number; x1: number }>
  languages: Array<{ language: string; x0: number; x1: number }>
  /** index in timeline.milestones; x1 ends a longest streak's bar, null for the other kinds */
  milestones: Array<{ index: number; kind: LifeMilestone['kind']; x: number; x1: number | null }>
}

/**
 * The axis of a timeline: its years and language eras as bands inside the life (never past today),
 * and its milestones, each in its day's middle, kept inside the life so every one can be hovered.
 */
export function axisOf(timeline: LifeTimeline): LifeAxis {
  const { startDay, todayDay } = timeline
  const days = todayDay - startDay + 1
  const clampX = (x: number) => Math.min(days, Math.max(0, x))

  // a marker sits in its day's middle, kept inside the life so every one can be hovered
  const at = (day: number) => Math.min(days - 0.5, Math.max(0.5, day - startDay + 0.5))
  const longest = timeline.streaks?.longest ?? null
  const milestones: LifeAxis['milestones'] = []
  timeline.milestones.forEach((milestone, index) => {
    const day = dayNumber(milestone.day)
    if (!Number.isFinite(day)) return
    const streak = milestone.kind === 'longest-streak' && longest !== null && longest.from === milestone.day
    milestones.push({ index, kind: milestone.kind, x: at(day), x1: streak ? at(longest.toDay) : null })
  })

  return {
    startDay,
    todayDay,
    days,
    years: timeline.eras
      .map((era) => ({ year: era.year, x0: clampX(era.fromDay - startDay), x1: clampX(era.toDay + 1 - startDay) }))
      .filter((year) => year.x1 > year.x0),
    languages: timeline.languageEras
      .map((era) => ({ language: era.language, x0: clampX(era.fromDay - startDay), x1: clampX(era.toDay + 1 - startDay) }))
      .filter((era) => era.x1 > era.x0),
    milestones,
  }
}

/** What the host, the labels, the time-lapse and the panel's focus need of any view's repo. LifePlant satisfies it. */
export interface LifeViewItem {
  /** index in timeline.lanes */
  lane: number
  /** repoKey(lane.repo) */
  key: string
  /** lane.startDay: nothing of it is drawn before it, and the time-lapse caption counts it from there */
  startDay: number
  /** the world x the panel's focus brings into view: its root, rootDay - startDay + 0.5 */
  x: number
}

/** A view's layout: the shared axis, and its items' indexes by repo key. */
export interface LifeViewModel extends LifeAxis {
  /** repo key -> index in the scene's items */
  byKey: ReadonlyMap<string, number>
}

/** What a view's paint reads for one frame. */
export interface LifeViewPaintInput<L, G> {
  layout: L
  timeline: LifeTimeline
  /** the scene's geoms for this camera and view */
  geoms: G
  camera: LifeCamera
  view: LifeViewport
  ink: LifeInk
  colourOf: (language: string | null) => string
  /** repo keys */
  hidden: ReadonlySet<string>
  hover: LifeHover
  /** repo key */
  selected: string | null
  /** the time-lapse's day (dayAt(clock, progress), a fractional day number): only what has grown by then is drawn. null: fully grown. */
  at: number | null
}

/**
 * A view's drawing, hit test and label anchors, over its own layout L and its own screen geometry
 * G. The painter (makeViewPaint) drives any scene the same way.
 */
export interface LifeScene<L extends LifeViewModel, G> {
  /** in paint order; layout.byKey indexes it */
  items(layout: L): ReadonlyArray<LifeViewItem>
  /** the screen geometry for a camera and a view (the painter keeps it while both are the same objects) */
  geoms(layout: L, camera: LifeCamera, view: LifeViewport): G
  /** the whole frame, the canvas fill first; never a repo name */
  paint(ctx: CanvasRenderingContext2D, input: LifeViewPaintInput<L, G>): void
  /** what is under (sx, sy): an item not in notDrawn, a milestone or a day; null off the life or the canvas */
  hit(layout: L, geoms: G, camera: LifeCamera, view: LifeViewport, sx: number, sy: number, notDrawn: ReadonlySet<string>, at: number | null): LifeHover
  /** writes item i's label anchor into out as [x, y, r] (screen px); false for no label */
  anchor(layout: L, geoms: G, i: number, at: number | null, out: Float32Array): boolean
  /** item indexes, the most important label first */
  labelOrder(layout: L): Int32Array
  /** boxes labels keep off, as [x0, y0, x1, y1]* in screen px */
  keepOut(layout: L, view: LifeViewport): Float32Array
  /** an item's colour, for a plate row's dot */
  itemColour(layout: L, i: number, ink: LifeInk, colourOf: (language: string | null) => string): string
}

/** One of person mode's views: its id (the share link's view), its name, its layout and its scene. */
export interface LifeViewDef<L extends LifeViewModel = any, G = any> {
  id: PersonView
  /** 'life garden', 'life lines' or 'constellation': the canvas is labelled "<title> of <login>: N repos, Y to Z" */
  title: string
  /** pure and deterministic: the same timeline gives the same layout */
  layout(timeline: LifeTimeline, source: ProfileData['source']): L
  scene: LifeScene<L, G>
}

/** A milestone marker on the horizon is hit within this distance of its centre. */
export const MILESTONE_HIT_PX = 6

/** Whether screen (sx, sy) is on the canvas. */
export function onCanvas(view: LifeViewport, sx: number, sy: number): boolean {
  return sx >= 0 && sx <= view.width && sy >= 0 && sy <= view.height
}

/**
 * The axis under screen (sx, sy), once no item is: the nearest milestone marker on the horizon
 * within MILESTONE_HIT_PX (the earliest on a tie) as its day and index, else the day under x inside
 * the life, else null (also off the canvas).
 */
export function axisHover(axis: LifeAxis, camera: LifeCamera, view: LifeViewport, sx: number, sy: number): LifeHover {
  if (!onCanvas(view, sx, sy)) return null
  const y = horizonY(view)
  let marker: LifeAxis['milestones'][number] | null = null
  let nearest = Infinity
  for (const m of axis.milestones) {
    const d = Math.hypot(sx - (camera.tx + m.x * camera.k), sy - y)
    if (d <= MILESTONE_HIT_PX && d < nearest) {
      marker = m
      nearest = d
    }
  }
  if (marker) return { kind: 'day', day: axis.startDay + Math.floor(marker.x), milestone: marker.index }

  const x = screenToWorldX(camera, sx)
  if (!(x >= 0 && x < axis.days)) return null
  return { kind: 'day', day: Math.min(axis.todayDay, axis.startDay + Math.floor(x)), milestone: null }
}
