import type { Graph, RepoData, ViewMode } from '../types'
import type { PaletteScheme } from '../theme/themes'
import { buildFullGraph } from './build'
import { collapseToSkeleton } from './collapse'
import { assignPalette } from './color'

export interface BuildOptions {
  /** Branch names to exclude from the graph entirely (their unique commits disappear). */
  hiddenBranches?: ReadonlySet<string>
  /** Theme whose accent and branch colours make up Graph.palette; the default theme (Obsidian) when omitted. */
  scheme?: PaletteScheme
}

/**
 * Pure: RepoData -> Graph. 'full' keeps every fetched commit; 'skeleton' keeps only
 * tips, forks, merges and roots and collapses linear runs into one link with collapsedCount.
 *
 * The palette covers every branch in the data, hidden ones included, so toggling a branch
 * never recolours the others. The app recolours for its active theme with assignPalette instead
 * of passing opts.scheme, so a theme switch never rebuilds the graph (or resets its layout).
 */
export function buildGraph(data: RepoData, mode: ViewMode, opts: BuildOptions = {}): Graph {
  const full = buildFullGraph(data, opts.hiddenBranches)
  const body = mode === 'skeleton' ? collapseToSkeleton(full) : full
  const palette = assignPalette(
    data.branches.map((branch) => branch.name),
    data.defaultBranch,
    opts.scheme,
  )
  return { nodes: body.nodes, links: body.links, palette }
}

export { buildFullGraph, ownershipOrder, visibleBranches } from './build'
export type { GraphBody } from './build'
export { collapseToSkeleton, isSkeletonNode } from './collapse'
export { assignPalette, colorAt, rotateHue, shiftLightness, ACCENT_COLOR, BRANCH_COLORS } from './color'
export { ACTIVITY_BUCKETS, buildContributors, contributorFocus, linkKey } from './contributors'
export type { Contributor, ContributorBranch, ContributorFocus, ContributorIndex } from './contributors'
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
