import type { Graph, RepoData, ViewMode } from '../types'
import { buildFullGraph } from './build'
import { collapseToSkeleton } from './collapse'
import { assignPalette } from './color'

export interface BuildOptions {
  /** Branch names to exclude from the graph entirely (their unique commits disappear). */
  hiddenBranches?: ReadonlySet<string>
}

/**
 * Pure: RepoData -> Graph. 'full' keeps every fetched commit; 'skeleton' keeps only
 * tips, forks, merges and roots and collapses linear runs into one link with collapsedCount.
 *
 * The palette covers every branch in the data, hidden ones included, so toggling a branch
 * never recolours the others.
 */
export function buildGraph(data: RepoData, mode: ViewMode, opts: BuildOptions = {}): Graph {
  const full = buildFullGraph(data, opts.hiddenBranches)
  const body = mode === 'skeleton' ? collapseToSkeleton(full) : full
  const palette = assignPalette(
    data.branches.map((branch) => branch.name),
    data.defaultBranch,
  )
  return { nodes: body.nodes, links: body.links, palette }
}

export { buildFullGraph, ownershipOrder, visibleBranches } from './build'
export type { GraphBody } from './build'
export { collapseToSkeleton, isSkeletonNode } from './collapse'
export { assignPalette, colorAt, rotateHue, shiftLightness, ACCENT_COLOR, BRANCH_COLORS } from './color'
export {
  metroLayout,
  shortBranchName,
  uniqueShortNames,
  skeletonRunColumns,
  laneRunColumns,
} from './metro'
export type {
  MetroBounds,
  MetroLabel,
  MetroLayout,
  MetroOptions,
  MetroPoint,
  MetroRoute,
  MetroRouteKind,
  MetroRun,
  MetroSegment,
  MetroStationKind,
  MetroStub,
} from './metro'
