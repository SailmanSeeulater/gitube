/**
 * What the pointer is over in the git log: a branch (its line as far as the time-lapse has drawn it,
 * or its fork point), else whatever the shared axis says (a milestone's tag on the trunk, or a day).
 * Labels are hit before this, by the label placer that drew them.
 *
 * Only the lanes within reach of the pointer are searched, the nearest branch winning and the earlier
 * in paint order on a tie; branches in notDrawn (hidden, or not reached by the time-lapse) are skipped,
 * as they are not drawn. Geometry is gitLogGeometry's, the same the painter draws with.
 */
import type { LifeCamera, LifeHover, LifeViewport } from './lifeTypes'
import { axisHover, onCanvas } from './lifeView'
import type { GitBranch, GitLogLayout } from './gitLogLayout'
import { branchForked, branchTo, type GitLogGeom } from './gitLogGeometry'

/** A branch is hit this far beyond its commits' radius, and at least MIN_HIT_PX from its line. */
const SLOP_PX = 2.5
const MIN_HIT_PX = 4

/** The first index in branches (sorted by track) whose track is at least track. */
function firstOnTrack(branches: ReadonlyArray<GitBranch>, track: number): number {
  let lo = 0
  let hi = branches.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (branches[mid].track < track) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The hover at screen (sx, sy); g is gitLogGeom's for this camera and view. Null off the canvas or the life. */
export function hitGitLog(
  layout: GitLogLayout,
  g: GitLogGeom,
  camera: LifeCamera,
  view: LifeViewport,
  sx: number,
  sy: number,
  notDrawn: ReadonlySet<string>,
  at: number | null,
): LifeHover {
  if (!onCanvas(view, sx, sy)) return null
  const { branches } = layout
  const screenX = (x: number) => camera.tx + x * camera.k
  if (layout.tracks > 0 && g.pitch > 0) {
    const reach = Math.max(MIN_HIT_PX, g.dotR + SLOP_PX)
    const span = Math.ceil(reach / g.pitch)
    // lane 0 is lowest: its y minus the pointer, in pitches
    const track = Math.round((g.laneY[0] - sy) / g.pitch)
    const from = Math.max(0, track - span)
    const to = Math.min(layout.tracks - 1, track + span)
    let best = -1
    let bestD = Infinity
    for (let i = from <= to ? firstOnTrack(branches, from) : branches.length; i < branches.length && branches[i].track <= to; i++) {
      const branch = branches[i]
      if (notDrawn.has(branch.key)) continue
      const end = branchTo(branch, layout.startDay, at)
      const forked = branchForked(branch, at)
      if (!(end > branch.x0) && !forked) continue
      const y = g.laneY[branch.track]
      let d = Infinity
      if (end > branch.x0) {
        const a = screenX(branch.x0)
        const b = screenX(end)
        d = Math.hypot(sx < a ? a - sx : sx > b ? sx - b : 0, sy - y)
      }
      if (forked) d = Math.min(d, Math.hypot(sx - screenX(branch.x), sy - y))
      if (d <= reach && d < bestD) {
        best = i
        bestD = d
      }
    }
    if (best >= 0) return { kind: 'repo', key: branches[best].key }
  }
  return axisHover(layout, camera, view, sx, sy)
}
