/**
 * The shapes person mode's views share: the life garden's layout and geometry, its camera and
 * colours, what is hovered or brought into view, and a repo name as a view may show it. Types only,
 * so any person module can import them without pulling code along.
 *
 * Repos are named by key everywhere (repoKey in privacy.ts: the lowercased nameWithOwner), never by
 * index, so a refetch cannot retarget a hover or a selection. Hover and focus say 'repo', not
 * 'plant', so the life lines and constellation views can share the panel and the inspector.
 */
import type { LifeMilestone } from './timeline'
import type { GardenInk } from '../components/gardenPaint'
import type { Bloom } from '../components/gardenLook'

/** A repo name as a view may show it: PRIVATE_REPO_LABEL while a private name is hidden. */
export interface ShownName {
  text: string
  /** a private repo: drawn with a lock, whether its name is hidden or revealed */
  locked: boolean
}

/** Every repo name on screen, in the DOM or on canvas, goes through one (privacy.ts). */
export type RepoNamer = (nameWithOwner: string) => ShownName

/** What the pointer is over: a repo by key, or a day (a day number) with the milestone index there, if any. */
export type LifeHover = { kind: 'repo'; key: string } | { kind: 'day'; day: number; milestone: number | null } | null

/** A panel request to bring something into view; seq makes a repeat request a new one. */
export type LifeFocus = { kind: 'repo'; key: string; seq: number } | { kind: 'day'; day: number; seq: number } | null

/** A plant's head, drawn by drawTip. */
export type LifeTip = Bloom

/** A stretch of a stem, by stem time t (0 at the root, 1 at the tip). */
export interface LifeStemPart {
  kind: 'active' | 'dormant'
  t0: number
  t1: number
}

export interface LifeLeaf {
  /** stem time, 0..1 */
  t: number
  side: 1 | -1
  /** 0..1, against the heaviest span in the profile */
  size: number
  /** the first day of the span it marks, so the time-lapse can open it on that day */
  fromDay: number
}

/** One repo as the life garden draws it, in world units (days along x, shares of the plot along y). */
export interface LifePlant {
  /** index in timeline.lanes */
  lane: number
  /** repoKey(lane.repo) */
  key: string
  /** world x of the root: rootDay - startDay + 0.5 */
  x: number
  /** depth row, 0 at the front to LIFE_ROWS - 1 at the back */
  row: number
  /** 0..1 of the plot height, before the row scale */
  height: number
  /** stemWidthPx's input */
  reach: number
  /** from hash01(key), so nothing flickers between frames */
  bend: number
  lean: number
  turn: number
  /** 'wilted' for an archived repo, else 'bloom' with stars (a seedling's too, drawn smaller), else 'bud' */
  tip: LifeTip
  /** 0..1, log-scaled stars: the star signal on every tip, sizing a wilted head and a seedling's bloom too */
  bloom: number
  /** archived: drawn dry */
  dry: boolean
  /** a fork: drawn as a cutting */
  cutting: boolean
  /** a repo they only contributed to (isOwn false), rooted where they arrived */
  visiting: boolean
  /** days of backdated commits before the root (rootDay - startDay), 0 if none */
  backDays: number
  /** a token profile's lane GitHub counted no commits to (detailed false) */
  seedling: boolean
  parts: LifeStemPart[]
  leaves: LifeLeaf[]
  language: string | null
  /** the lane's first and last day numbers */
  startDay: number
  endDay: number
  /** progressAtDay(clock, startDay): when the time-lapse sows it (Phase 5) */
  appearAt: number
}

export interface LifeGardenLayout {
  /** day numbers: world x 0 is startDay */
  startDay: number
  todayDay: number
  /** todayDay - startDay + 1 */
  days: number
  rows: number
  /** in paint order: the back row first, then x, then lane order */
  plants: LifePlant[]
  /** key -> index in plants */
  byKey: ReadonlyMap<string, number>
  /** world x */
  years: Array<{ year: number; x0: number; x1: number }>
  languages: Array<{ language: string; x0: number; x1: number }>
  /** index in timeline.milestones; x1 ends a longest streak's bar, null for the other kinds */
  milestones: Array<{ index: number; kind: LifeMilestone['kind']; x: number; x1: number | null }>
}

/** An x-only camera in CSS px: screenX = tx + worldX * k. */
export interface LifeCamera {
  k: number
  tx: number
}

/** The canvas in CSS px: its size, the plot's top, the room under the horizon and the margin either side. */
export interface LifeViewport {
  width: number
  height: number
  top: number
  ground: number
  side: number
}

/** One plant in screen px; paint and hit test share it. */
export interface PlantGeom {
  /** the root */
  x0: number
  y0: number
  /** the stem's control point */
  cx: number
  cy: number
  /** the tip */
  x2: number
  y2: number
  /** the row's scale */
  scale: number
  /** stem width */
  width: number
  /** the tip's body radius */
  tipR: number
}

/** The life garden's colours for a theme (lifeInk.ts). */
export interface LifeInk {
  canvas: string
  text: string
  muted: string
  accent: string
  fallback: string
  rootRing: string
  eraBand: string
  horizon: string
  dry: string
  garden: GardenInk
  hoverRing: string
  inspectedRing: string
  textHalo: string
  labelPlateFill: string
  labelPlateRing: string
  dimAlpha: number
}
