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
  /** a repo fetch's stage, or a person fetch's (api/profile.ts) */
  stage: FetchStage | ProfileFetchStage
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
      | 'not_a_user'
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
 * Where a pull request's review stands. 'waiting': no approval or change request stands yet, or a
 * branch rule still wants more approvals (PullSummary.reviewRequired tells the two apart).
 * 'unknown': not looked up yet (a visitor without a token pays 3 requests per pull request), or
 * GitHub did not answer for it.
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
  /**
   * true: GitHub reports REVIEW_REQUIRED (a rule still wants approvals); false: GraphQL found no
   * such rule outstanding; null: not known (REST cannot see branch rules)
   */
  reviewRequired: boolean | null
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
  /**
   * open pull requests whose head is in a fork (with GraphQL: everything open not drawn, so also
   * those from branches not loaded and from the unchecked branches)
   */
  fromForks: number
  /** same-repo pull requests whose head branch is not among the loaded branches */
  notOnGraph: number
  /**
   * not every open pull request was read: the REST listing stopped before the last page, or (GraphQL)
   * a branch has more pull requests than its pages read
   */
  truncated: boolean
  /** loaded branches GitHub did not answer for (GraphQL partial errors): their pull requests are not known; [] for REST */
  unchecked: string[]
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

// ---------- Person mode (a GitHub user's repos over time) ----------

export interface ProfileRepo {
  nameWithOwner: string
  /** ISO: when the repo was created on GitHub */
  createdAt: string
  /** ISO: when this person's part in it starts: createdAt for their own repos, their first counted (or landed, see ProfileData.landed) day otherwise */
  firstActiveAt: string
  /** ISO: max(createdAt, pushedAt) in tier 1; the last contribution or landed day (or pushedAt) in tier 2 */
  lastActiveAt: string
  /** owned by the user; false for a repo they only contributed to (tier 2) */
  isOwn: boolean
  language: string | null
  /** GitHub's linguist colour, tier 2 only. Not painted: views colour languages from the theme. */
  languageColor: string | null
  stars: number
  forks: number
  isFork: boolean
  isArchived: boolean
  isPrivate: boolean
  /** Tier 2: commits per day, ascending. Tier 1: empty. */
  activity: { date: string; commits: number }[]
}

export interface ProfileMilestone {
  kind: 'joined' | 'first-repo' | 'first-pr' | 'first-issue' | 'top-repo' | 'longest-streak' | 'language-switch'
  /** ISO */
  date: string
  label: string
  repo?: string
}

export interface ProfileData {
  /** as GitHub spells it */
  login: string
  name: string | null
  avatarUrl: string
  /** ISO */
  createdAt: string
  source: 'rest' | 'graphql'
  repos: ProfileRepo[]
  /** Tier 2: the contribution calendar, one entry per day from the first window's start (which can
   *  precede createdAt) through today, in GitHub's days; never a future day. Tier 1: empty. */
  days: { date: string; count: number }[]
  /** Tier 1: pushes per repo per day, from recentFrom to now. Tier 2: empty. */
  recent: { date: string; repo: string; pushes: number }[]
  /** Tier 1: the first day `recent` covers: the oldest event's day when the third (last) page of
   *  events was served (GitHub keeps 300, but live pages ran 99, 100 and 80, so the count cannot
   *  tell), else 30 days ago. Days before it are unknown, not zero. null in tier 2. */
  recentFrom: string | null
  /**
   * Tier 2: pull requests of theirs merged into repos they do not own ("landed elsewhere"), one
   * entry per pull request, by the GitHub (US Pacific) day it was merged, sorted by day then repo
   * (nameWithOwner). A repo named only here is in `repos` too (isOwn false, no activity). Private
   * repos are kept: the views hide their names like any other. Tier 1: empty.
   */
  landed: { day: string; repo: string }[]
  /** the ones the API states directly; derived ones come from the timeline model */
  milestones: ProfileMilestone[]
  /** Tier 2 only (0 in tier 1) */
  restrictedContributions: number
  /** a repo cap (500, or 100 in a window), a window still paging, or a window lost to an error */
  truncated: boolean
  /** Tier 2: windows lost to errors after their retry, as 'YYYYqN', for the legend. [] otherwise. */
  lostWindows: string[]
  /** a token was set but GraphQL failed and REST filled the profile: why, for the status strip */
  fallback: { message: string; limit: 'graphql' | 'secondary' | null; resetAt: string | null } | null
}

/** The person fetchers' stages. */
export type ProfileFetchStage = 'user' | 'repos' | 'events' | 'windows' | 'done'
