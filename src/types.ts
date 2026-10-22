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
  /** GitHub login of the author; absent when GitHub could not link the commit to an account. */
  login?: string
  /** Avatar of that GitHub account; absent with login. */
  avatarUrl?: string
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
  /**
   * branch name -> colour hex in the theme buildGraph was given (Obsidian by default), stable for
   * the session. The UI paints with App's palette for the active theme instead (assignPalette),
   * so a theme switch never rebuilds the graph.
   */
  palette: Record<string, string>
}

export type ViewMode = 'skeleton' | 'full'

// ---------- Pull requests (the overlay; see api/pulls.ts and graph/pulls.ts) ----------

/**
 * Where a pull request's review stands. 'waiting': no decision yet (review required, or no review
 * rule). 'unknown': not looked up yet (a visitor without a token pays 3 requests per pull request).
 */
export type ReviewState = 'approved' | 'changes' | 'waiting' | 'unknown'

/** The rollup of a pull request head's check runs and commit statuses; 'unknown' = not looked up yet. */
export type ChecksState = 'passing' | 'running' | 'failing' | 'none' | 'unknown'

export interface CheckCounts {
  failing: number
  running: number
  passing: number
  skipped: number
  total: number
}

/** One open pull request from a branch of the repo itself (fork pull requests have no branch here). */
export interface PullSummary {
  number: number
  title: string
  /** html_url on github.com */
  url: string
  /** head branch name, a branch of this repo */
  head: string
  /** the head commit GitHub has; differs from the branch's tipSha when the branch moved since the graph was fetched */
  headSha: string
  /** base branch name */
  base: string
  draft: boolean
  /** author's login; null for a deleted account */
  author: string | null
  review: ReviewState
  checks: ChecksState
  /** per-state check counts, when known */
  checkCounts: CheckCounts | null
  /** reviewers (people and teams) asked for a review and not yet answered; null when unknown */
  reviewersAsked: number | null
  /** true: conflicts with its base; false: mergeable; null: not known (always null without a token) */
  conflict: boolean | null
  /** ISO 8601 */
  updatedAt: string
}

/** The open pull requests of a repo, by head branch. Never stored (not in the cache or saved files). */
export interface PullIndex {
  /** head branch name -> its open pull requests, most recently updated first */
  byBranch: Map<string, PullSummary[]>
  /** open pull requests into the default branch (null when not known) */
  intoBase: number | null
  /** open pull requests in the repo, from forks too (an estimate when truncated) */
  total: number | null
  /** open pull requests whose head is in a fork (or, with GraphQL, not on any loaded branch) */
  fromForks: number
  /** same-repo pull requests whose head branch is not among the loaded branches */
  notOnGraph: number
  /** the REST listing stopped before the last page */
  truncated: boolean
  /** how many pull requests the REST listing read (the most recently updated); 0 for GraphQL */
  listed: number
  source: 'graphql' | 'rest'
  /** ISO time of the fetch */
  fetchedAt: string
}

/** What the canvas draws round one tip: its pull requests combined, worst first. */
export interface PrMark {
  review: ReviewState
  checks: ChecksState
  /** every pull request on the node is a draft */
  draft: boolean
  /** any of them conflicts with its base */
  conflict: boolean
  /** how many pull requests the mark stands for */
  count: number
}
