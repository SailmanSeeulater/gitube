import type { Graph, RepoData, ViewMode } from '../types'

export interface BuildOptions {
  /** Branch names to exclude from the graph entirely (their unique commits disappear). */
  hiddenBranches?: ReadonlySet<string>
}

/**
 * Pure: RepoData -> Graph. 'full' keeps every fetched commit; 'skeleton' keeps only
 * tips, forks, merges and roots and collapses linear runs into one link with collapsedCount.
 */
export function buildGraph(_data: RepoData, _mode: ViewMode, _opts: BuildOptions = {}): Graph {
  throw new Error('not implemented')
}
