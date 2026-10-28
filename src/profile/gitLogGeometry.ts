/**
 * The git log in screen px: the trunk on the horizon, each lane's y above it (lane 0 nearest), and
 * the sizes of the branches, their commits and their forks, from the viewport alone, so a zoom moves
 * commits apart along x and never makes them bigger. The painter, the labels and the hit test all
 * read the same geometry, and the time-lapse helpers here, so what is hovered is what is drawn.
 */
import { horizonY } from './lifeGeometry'
import type { LifeCamera, LifeViewport } from './lifeTypes'
import type { GitBranch, GitLogLayout } from './gitLogLayout'

/** Room between the lane nearest the trunk and the trunk, for the forks' diagonals. */
export const GITLOG_FOOT_PX = 12
/** Lanes are never further apart than this. */
export const GITLOG_MAX_PITCH = 18
/** A commit's radius: this share of the pitch, kept between these. */
const DOT_SHARE = 0.3
const DOT_MIN_PX = 1.25
const DOT_MAX_PX = 3.5
/** A branch's line: this share of the pitch, kept between these. */
const LINE_SHARE = 0.18
const LINE_MIN_PX = 1
const LINE_MAX_PX = 2.25
/** A fork's diagonal rises this many px (the pitch, kept between these). */
const FORK_MIN_PX = 3
const FORK_MAX_PX = 8

export interface GitLogGeom {
  /** the camera it was made under: screen x = camera.tx + world x * camera.k */
  camera: LifeCamera
  /** the trunk's y: the horizon */
  trunkY: number
  /** each lane's y, by track */
  laneY: Float32Array
  /** px from one lane to the next */
  pitch: number
  /** a commit's radius */
  dotR: number
  /** a branch's line width */
  linePx: number
  /** a fork's diagonal: this many px across and up into the lane */
  forkPx: number
}

/** The plot's top and bottom, where the lanes go. */
export function gitLogPlot(view: LifeViewport): { top: number; bottom: number } {
  const top = view.top
  return { top, bottom: Math.max(top, horizonY(view) - GITLOG_FOOT_PX) }
}

export function gitLogGeom(layout: Pick<GitLogLayout, 'tracks'>, camera: LifeCamera, view: LifeViewport): GitLogGeom {
  const { top, bottom } = gitLogPlot(view)
  const plotH = bottom - top
  const tracks = Math.max(1, layout.tracks)
  const pitch = Math.min(GITLOG_MAX_PITCH, plotH / tracks)
  const laneY = new Float32Array(layout.tracks)
  for (let t = 0; t < layout.tracks; t++) laneY[t] = bottom - pitch / 2 - t * pitch
  return {
    camera,
    trunkY: horizonY(view),
    laneY,
    pitch,
    dotR: Math.min(DOT_MAX_PX, Math.max(DOT_MIN_PX, pitch * DOT_SHARE)),
    linePx: Math.min(LINE_MAX_PX, Math.max(LINE_MIN_PX, pitch * LINE_SHARE)),
    forkPx: Math.min(FORK_MAX_PX, Math.max(FORK_MIN_PX, pitch)),
  }
}

// ---------- the time-lapse: what of a branch is drawn by its day (paint, hit and labels agree) ----------

/** World x the branch is drawn to by the time-lapse's day: its tip's end, or the day reached. */
export function branchTo(branch: Pick<GitBranch, 'x1'>, startDay: number, at: number | null): number {
  return at === null ? branch.x1 : Math.min(branch.x1, at - startDay)
}

/** Whether the time-lapse has sown the branch (any of it is drawn). */
export function branchSown(branch: Pick<GitBranch, 'startDay'>, at: number | null): boolean {
  return at === null || branch.startDay <= at
}

/** Whether the time-lapse has reached the branch's root, where it forks off the trunk. */
export function branchForked(branch: Pick<GitBranch, 'rootDay'>, at: number | null): boolean {
  return at === null || at >= branch.rootDay
}

/** Whether the time-lapse has reached a commit (a day's middle in world x). */
export function commitReached(x: number, startDay: number, at: number | null): boolean {
  return at === null || at - startDay >= Math.floor(x)
}

/** The branch's fork point (where its diagonal meets its lane) in screen px. */
export function forkPoint(branch: Pick<GitBranch, 'x' | 'track'>, g: GitLogGeom): { x: number; y: number } {
  return { x: g.camera.tx + branch.x * g.camera.k, y: g.laneY[branch.track] ?? Number.NaN }
}
