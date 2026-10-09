/**
 * Full graph construction: RepoData -> every fetched commit reachable from a visible
 * branch tip, as nodes + child->parent links, with flags, reach and ownership.
 *
 * Pure and deterministic. No React, no dependencies beyond ../types.
 */
import type { Branch, Commit, GraphLink, GraphNode, RepoData } from '../types'

/** nodes + links without the palette; index.ts attaches the palette. */
export interface GraphBody {
  nodes: GraphNode[]
  links: GraphLink[]
}

/** Code-point order: locale independent, hence deterministic everywhere. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function isDefaultBranch(branch: Branch, data: RepoData): boolean {
  return branch.isDefault || branch.name === data.defaultBranch
}

/** data.branches minus the hidden ones, in data order. */
export function visibleBranches(data: RepoData, hiddenBranches?: ReadonlySet<string>): Branch[] {
  if (!hiddenBranches || hiddenBranches.size === 0) return data.branches.slice()
  return data.branches.filter((b) => !hiddenBranches.has(b.name))
}

/**
 * The order in which branches claim commits for colouring:
 *   1. the default branch (if visible),
 *   2. the other visible branches sorted by aheadBy ascending, then by name.
 *
 * Shorter branches go first so that a long-lived branch does not swallow the few commits
 * that a small branch forked from it. Hiding the default branch simply removes it from the
 * list: the first remaining branch then owns the shared trunk.
 */
export function ownershipOrder(data: RepoData, hiddenBranches?: ReadonlySet<string>): Branch[] {
  const visible = visibleBranches(data, hiddenBranches)
  const defaults = visible.filter((b) => isDefaultBranch(b, data))
  const others = visible
    .filter((b) => !isDefaultBranch(b, data))
    .sort((a, b) => a.aheadBy - b.aheadBy || compareStrings(a.name, b.name))
  return [...defaults, ...others]
}

/**
 * Build the full (uncollapsed) graph.
 *
 * - Commit set: everything reachable from any visible tip by walking parents within
 *   data.commits. Parents we did not fetch are simply not followed.
 * - Links: child -> parent for every parent present in the set, in git parent order.
 * - Flags: isFork = 2+ children inside the set; isMerge = 2+ parents; isRoot = a parent
 *   is missing from data.commits, the commit has no parents at all (the real initial
 *   commit), or the sha is listed in data.truncatedAt; isTip/tips = visible branches whose
 *   tipSha is this commit.
 * - reach: number of visible branches whose tip reaches the commit.
 * - owner: see ownershipOrder and the two passes below.
 *
 * After the commit set is known, everything works on dense integer indices (typed arrays,
 * stamp-based visited marks) so a 20k-commit repo with dozens of branches builds in a few
 * tens of milliseconds.
 */
export function buildFullGraph(data: RepoData, hiddenBranches?: ReadonlySet<string>): GraphBody {
  const commits = data.commits
  const get = (sha: string): Commit | undefined =>
    Object.hasOwn(commits, sha) ? commits[sha] : undefined
  const order = ownershipOrder(data, hiddenBranches)
  const truncatedAt = new Set(data.truncatedAt)

  // ---- tips: which visible branches end at each sha (data order; several may share one)
  const tipsBySha = new Map<string, string[]>()
  for (const branch of visibleBranches(data, hiddenBranches)) {
    if (!get(branch.tipSha)) continue
    const list = tipsBySha.get(branch.tipSha)
    if (list) list.push(branch.name)
    else tipsBySha.set(branch.tipSha, [branch.name])
  }

  // ---- 1. commit set: reachable from any visible tip through fetched parents
  const inSet = new Set<string>()
  const shaStack: string[] = []
  for (const branch of order) {
    const tip = branch.tipSha
    if (!get(tip) || inSet.has(tip)) continue
    inSet.add(tip)
    shaStack.push(tip)
    while (shaStack.length > 0) {
      const sha = shaStack.pop() as string
      for (const parent of commits[sha].parents) {
        if (!inSet.has(parent) && get(parent)) {
          inSet.add(parent)
          shaStack.push(parent)
        }
      }
    }
  }

  // ---- 2. stable node order: by commit date, then sha. Index i below refers to shas[i].
  const shas = [...inSet].sort(
    (a, b) => compareStrings(commits[a].date, commits[b].date) || compareStrings(a, b),
  )
  const n = shas.length
  const indexOf = new Map<string, number>()
  for (let i = 0; i < n; i += 1) indexOf.set(shas[i], i)

  // ---- 3. parent indices inside the set, first-parent index, child counts (fork detection)
  const parentIdx: number[][] = new Array<number[]>(n)
  const firstParentIdx = new Int32Array(n).fill(-1)
  const childCount = new Int32Array(n)
  for (let i = 0; i < n; i += 1) {
    const parents = commits[shas[i]].parents
    const inside: number[] = []
    for (const parent of parents) {
      const j = indexOf.get(parent)
      if (j !== undefined) {
        inside.push(j)
        childCount[j] += 1
      }
    }
    parentIdx[i] = inside
    // The first parent in git order, only if it was fetched; otherwise there is none.
    if (parents.length > 0) firstParentIdx[i] = indexOf.get(parents[0]) ?? -1
  }

  const tipIdx = order.map((branch) => indexOf.get(branch.tipSha) ?? -1)

  // ---- 4. ownership pass 1: first-parent walks.
  // For each branch in ownership order, start at its tip and follow FIRST parents only,
  // claiming every commit until we hit one that is already owned. Following only the first
  // parent means a merge commit on main claims the trunk below it but never the side
  // branch it merged in, so the side branch (still in ownership order) keeps its own
  // unique commits. A stale branch whose tip is already owned claims nothing.
  const ownerIdx = new Int32Array(n).fill(-1)
  for (let b = 0; b < order.length; b += 1) {
    let cursor = tipIdx[b]
    while (cursor >= 0 && ownerIdx[cursor] < 0) {
      ownerIdx[cursor] = b
      cursor = firstParentIdx[cursor]
    }
  }

  // ---- 5. reach + ownership pass 2.
  // One traversal per visible tip, in ownership order, over ALL parents. Every visited
  // commit gains one reach. Anything pass 1 left unowned is reachable only through a
  // non-first parent (typically a merged-in side branch whose ref was deleted): the first
  // branch whose traversal reaches it becomes its owner, which for a deleted side branch
  // is the branch that absorbed it. `stamp` replaces a per-branch visited set: a node is
  // seen during branch b's traversal when stamp[node] === b + 1.
  const reach = new Int32Array(n)
  const stamp = new Int32Array(n)
  const stack: number[] = []
  for (let b = 0; b < order.length; b += 1) {
    const tip = tipIdx[b]
    if (tip < 0) continue
    const mark = b + 1
    stamp[tip] = mark
    stack.push(tip)
    while (stack.length > 0) {
      const i = stack.pop() as number
      reach[i] += 1
      if (ownerIdx[i] < 0) ownerIdx[i] = b
      for (const j of parentIdx[i]) {
        if (stamp[j] !== mark) {
          stamp[j] = mark
          stack.push(j)
        }
      }
    }
  }

  // ---- 6. nodes and links
  const nodes: GraphNode[] = new Array<GraphNode>(n)
  const links: GraphLink[] = []
  for (let i = 0; i < n; i += 1) {
    const sha = shas[i]
    const commit = commits[sha]
    const tips = tipsBySha.get(sha) ?? []
    const ownerName = ownerIdx[i] >= 0 ? order[ownerIdx[i]].name : ''
    const hasMissingParent = commit.parents.some((parent) => !get(parent))
    nodes[i] = {
      id: sha,
      commit,
      tips,
      owner: ownerName,
      isTip: tips.length > 0,
      isFork: childCount[i] >= 2,
      isMerge: commit.parents.length >= 2,
      isRoot: commit.parents.length === 0 || hasMissingParent || truncatedAt.has(sha),
      reach: reach[i],
    }
    for (const j of parentIdx[i]) {
      links.push({ source: sha, target: shas[j], collapsedCount: 0, owner: ownerName })
    }
  }

  return { nodes, links }
}
