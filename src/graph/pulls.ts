/**
 * Pure pull request logic for the overlay: which tip gets which mark, the worst state of several
 * pull requests on one tip, and merging a looked-up pull request into the index. No network (that
 * is api/pulls.ts), no drawing (components/prMark.ts).
 */
import type { Branch, ChecksState, Graph, PrMark, PullIndex, PullSummary, ReviewState } from '../types'

/** Worst first: a request for changes outweighs waiting, waiting outweighs an approval. */
const REVIEW_ORDER: readonly ReviewState[] = ['changes', 'waiting', 'approved', 'unknown']
/** Worst first: failing, running, passing, no checks, not looked up. */
const CHECKS_ORDER: readonly ChecksState[] = ['failing', 'running', 'passing', 'none', 'unknown']

export function worstReview(a: ReviewState, b: ReviewState): ReviewState {
  return REVIEW_ORDER.indexOf(a) <= REVIEW_ORDER.indexOf(b) ? a : b
}

export function worstChecks(a: ChecksState, b: ChecksState): ChecksState {
  return CHECKS_ORDER.indexOf(a) <= CHECKS_ORDER.indexOf(b) ? a : b
}

/** One mark for several pull requests: the worst review and checks, dotted only if every one is a draft. */
export function combineMarks(prs: ReadonlyArray<PullSummary>): PrMark | null {
  if (prs.length === 0) return null
  let review: ReviewState = 'unknown'
  let checks: ChecksState = 'unknown'
  let draft = true
  let conflict = false
  for (const pr of prs) {
    review = worstReview(review, pr.review)
    checks = worstChecks(checks, pr.checks)
    draft = draft && pr.draft
    conflict = conflict || pr.conflict === true
  }
  return { review, checks, draft, conflict, count: prs.length }
}

/** The open pull requests from this branch (most recently updated first); empty without an index. */
export function branchPrs(index: PullIndex | null | undefined, branch: string): readonly PullSummary[] {
  return index?.byBranch.get(branch) ?? []
}

/** Every pull request from the branches whose tip this node is. */
export function nodePrs(index: PullIndex | null | undefined, tips: ReadonlyArray<string>): PullSummary[] {
  if (!index) return []
  const out: PullSummary[] = []
  for (const tip of tips) out.push(...branchPrs(index, tip))
  return out
}

/**
 * node id -> mark, for the tips on show. Built from the graph's tips, so a hidden branch (or one
 * whose tip is not drawn) gets no mark.
 */
export function prMarks(graph: Pick<Graph, 'nodes'> | null, index: PullIndex | null | undefined): Map<string, PrMark> {
  const marks = new Map<string, PrMark>()
  if (!graph || !index || index.byBranch.size === 0) return marks
  for (const node of graph.nodes) {
    if (!node.isTip || node.tips.length === 0) continue
    const mark = combineMarks(nodePrs(index, node.tips))
    if (mark) marks.set(node.id, mark)
  }
  return marks
}

/** The pull request's head is not the tip the graph shows: the branch moved on since it was fetched. */
export function headMoved(branch: Pick<Branch, 'tipSha'>, pr: Pick<PullSummary, 'headSha'>): boolean {
  return pr.headSha !== '' && pr.headSha !== branch.tipSha
}

/** How many branches have an open pull request in the index. */
export function branchesWithPrs(index: PullIndex | null | undefined): number {
  return index ? index.byBranch.size : 0
}

/**
 * A short stable hash of the branch list (name and tip of each, in order): FNV-1a, 32 bits, as 8
 * hex digits. It keys the pull request query, so a refetched graph whose branches moved asks again.
 */
export function branchSignature(branches: ReadonlyArray<Pick<Branch, 'name' | 'tipSha'>>): string {
  let h = 0x811c9dc5
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  for (const b of branches) {
    feed(b.name)
    feed('@')
    feed(b.tipSha)
    feed('\n')
  }
  return h.toString(16).padStart(8, '0')
}

/** The index with one pull request's looked-up review and checks laid in (a new index; the old one is untouched). */
export function withLookup(
  index: PullIndex,
  branch: string,
  number: number,
  found: Pick<PullSummary, 'review' | 'checks' | 'checkCounts'>,
): PullIndex {
  const prs = index.byBranch.get(branch)
  if (!prs || !prs.some((pr) => pr.number === number)) return index
  const byBranch = new Map(index.byBranch)
  byBranch.set(
    branch,
    prs.map((pr) => (pr.number === number ? { ...pr, review: found.review, checks: found.checks, checkCounts: found.checkCounts } : pr)),
  )
  return { ...index, byBranch }
}

/** True when the review or checks of this pull request still have to be looked up. */
export function needsLookup(pr: Pick<PullSummary, 'review' | 'checks'>): boolean {
  return pr.review === 'unknown' || pr.checks === 'unknown'
}

/** What the default branch's tip says about the repo's pull requests. */
export interface DefaultTipSummary {
  /** open pull requests into the default branch; null when not known (a truncated listing) */
  into: number | null
  /** open pull requests in the repo (an estimate when the listing was truncated) */
  total: number | null
  /** open pull requests with no branch on the graph (forks, and branches not loaded) */
  notDrawn: number
  /** notDrawn is forks alone */
  onlyForks: boolean
  /** pull requests from branches on the graph */
  mapped: number
  /** of those, with failing checks */
  failing: number
  /** of those, drafts */
  drafts: number
}

export function defaultTipSummary(index: PullIndex): DefaultTipSummary {
  const seen = new Set<number>()
  let failing = 0
  let drafts = 0
  for (const prs of index.byBranch.values()) {
    for (const pr of prs) {
      if (seen.has(pr.number)) continue
      seen.add(pr.number)
      if (pr.checks === 'failing') failing += 1
      if (pr.draft) drafts += 1
    }
  }
  return {
    into: index.intoBase,
    total: index.total,
    notDrawn: index.fromForks + index.notOnGraph,
    // GraphQL counts everything not drawn together (total less what the branches have)
    onlyForks: index.source === 'rest' && index.notOnGraph === 0,
    mapped: seen.size,
    failing,
    drafts,
  }
}

/** Where looking a pull request's review and checks up stands, for the inspector and the selected row. */
export type LookupPlan =
  /** nothing to look up (GraphQL answered, or a lookup did) */
  | 'done'
  /** under way */
  | 'running'
  /** the last try failed: offer a retry */
  | 'failed'
  /** it runs by itself once the pull request has been on show a moment */
  | 'auto'
  /** too few requests left this hour for an automatic lookup: offer it as a link */
  | 'ask'

export function lookupPlan(
  pr: Pick<PullSummary, 'number' | 'review' | 'checks'>,
  state: { lookingUp: ReadonlySet<number>; lookupErrors: ReadonlyMap<number, string>; canAutoLookup: boolean },
): LookupPlan {
  if (!needsLookup(pr)) return 'done'
  if (state.lookingUp.has(pr.number)) return 'running'
  if (state.lookupErrors.has(pr.number)) return 'failed'
  return state.canAutoLookup ? 'auto' : 'ask'
}

/** Distinct pull requests in the index (one can head two branches only in theory; counted once). */
export function countPulls(index: PullIndex | null | undefined): number {
  if (!index) return 0
  const seen = new Set<number>()
  for (const prs of index.byBranch.values()) for (const pr of prs) seen.add(pr.number)
  return seen.size
}
