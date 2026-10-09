/**
 * Shared contracts for repo-garden.
 * api/github.ts produces RepoData; graph/* turns RepoData into a Graph;
 * components render the Graph. Keep this file the single source of truth.
 */

export interface Commit {
  sha: string
  /** Parent SHAs in git order (first parent first). */
  parents: string[]
  /** First line of the commit message. */
  message: string
  author: string
  /** ISO 8601 committer date. */
  date: string
  /** html_url on github.com */
  url: string
}

export interface Branch {
  name: string
  tipSha: string
  isDefault: boolean
  /** merge-base with the default branch; null for the default branch itself or if unknown. */
  mergeBaseSha: string | null
  aheadBy: number
  behindBy: number
  /** ISO date of the tip commit, for stale-branch filtering. */
  tipDate: string
}

export interface RepoData {
  owner: string
  repo: string
  defaultBranch: string
  branches: Branch[]
  /** Every commit we fetched, keyed by sha. */
  commits: Record<string, Commit>
  /** True if any branch history was cut short by fetch caps. */
  truncated: boolean
  /** Which SHAs are known to have parents we did not fetch. */
  truncatedAt: string[]
}

export type FetchStage = 'repo' | 'branches' | 'compare' | 'trunk' | 'done'

export interface FetchProgress {
  stage: FetchStage
  done: number
  total: number
  message: string
  requestsUsed: number
  rateLimitRemaining: number | null
  rateLimitResetAt: string | null
}

export interface FetchOptions {
  token?: string
  /** Max commits to walk on the default branch. Default 500. */
  trunkLimit?: number
  /** Max unique commits per non-default branch (compare returns up to 250). Default 250. */
  branchLimit?: number
  /** Max branches to fetch. Default 200. */
  maxBranches?: number
  onProgress?: (p: FetchProgress) => void
  signal?: AbortSignal
  /** Fetch implementation handed to Octokit; defaults to globalThis.fetch. Tests inject a fake. */
  fetch?: typeof globalThis.fetch
}

export class GitHubFetchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'not_found'
      | 'rate_limited'
      | 'unauthorized'
      | 'network'
      | 'invalid_url'
      | 'aborted'
      | 'empty_repo'
      | 'unknown',
    public readonly resetAt?: string | null,
  ) {
    super(message)
    this.name = 'GitHubFetchError'
  }
}

// ---------- Graph ----------

export interface GraphNode {
  /** commit sha; also the force-graph node id */
  id: string
  commit: Commit
  /** Branch names whose tip is exactly this commit. */
  tips: string[]
  /** The branch that "owns" this commit for colouring (first tip to reach it). */
  owner: string
  isTip: boolean
  /** 2+ children in the fetched set. */
  isFork: boolean
  /** 2+ parents. */
  isMerge: boolean
  /** Has a parent we did not fetch (history truncated here). */
  isRoot: boolean
  /** Number of branches whose history contains this commit. Drives node size. */
  reach: number
  // populated by react-force-graph at runtime
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
}

export interface GraphLink {
  /** child sha */
  source: string
  /** parent sha */
  target: string
  /** 0 in full view; in skeleton view, the number of commits hidden on this edge. */
  collapsedCount: number
  /** owner branch of the child end, for colouring */
  owner: string
}

export interface Graph {
  nodes: GraphNode[]
  links: GraphLink[]
  /** branch name -> colour hex, stable for the session */
  palette: Record<string, string>
}

export type ViewMode = 'skeleton' | 'full'
