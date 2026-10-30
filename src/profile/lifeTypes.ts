/**
 * The shapes person mode's views share: a lane's stretches and landed pull requests, the camera
 * and colours, what is hovered or brought into view, and a repo name as a view may show it. Types
 * only, so any person module can import them without pulling code along.
 *
 * Repos are named by key everywhere (repoKey in privacy.ts: the lowercased nameWithOwner), never by
 * index, so a refetch cannot retarget a hover or a selection. Hover and focus say 'repo', so every
 * view shares the panel and the inspector.
 */

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

/** A stretch of a lane, by its own time t (0 on its first day, 1 after its last). */
export interface LifeLanePart {
  kind: 'active' | 'dormant'
  t0: number
  t1: number
}

/** A pull request landed in the repo: the day it was merged, and where that day is along the lane. */
export interface LifeLanded {
  /** lane time, 0..1: the day's middle */
  t: number
  /** day number */
  day: number
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

/** Person mode's colours for a theme (lifeInk.ts; a console view maps them to its own). */
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
  hoverRing: string
  inspectedRing: string
  textHalo: string
  labelPlateFill: string
  labelPlateRing: string
  dimAlpha: number
}
