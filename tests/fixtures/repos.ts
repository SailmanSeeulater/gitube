/**
 * Tiny DSL for readable RepoData fixtures.
 *
 *   makeRepo({
 *     commits: [['c1'], ['c2', 'c1'], ['f1', 'c2']],   // [sha, ...parents], first parent first
 *     branches: [{ name: 'main', tip: 'c2', isDefault: true }, { name: 'feature', tip: 'f1' }],
 *   })
 *
 * Messages, authors, urls and dates are generated; dates increase with the commit's index in
 * the list so a time ordering exists. Branch merge-base / aheadBy / behindBy / tipDate are
 * computed from the commit graph with a real best-common-ancestor search, so fixtures stay
 * consistent with what the GitHub compare endpoint would report.
 */
import type { Branch, Commit, RepoData } from '../../src/types'

/** [sha, ...parents] in git order (first parent first). Parents may reference absent shas. */
export type CommitSpec = [sha: string, ...parents: string[]]

export interface BranchSpec {
  name: string
  tip: string
  /** Exactly one branch should be the default; if none is marked, the first one is. */
  isDefault?: boolean
}

export interface RepoSpec {
  owner?: string
  repo?: string
  commits: CommitSpec[]
  branches: BranchSpec[]
  /** SHAs the (simulated) fetcher knows have parents it did not fetch. */
  truncatedAt?: string[]
}

const EPOCH_MS = Date.UTC(2024, 0, 1)
const HOUR_MS = 3_600_000

/** ISO date for the index-th commit: 2024-01-01T00:00:00Z plus index hours. */
export function dateAt(index: number): string {
  return new Date(EPOCH_MS + index * HOUR_MS).toISOString()
}

function has(commits: Record<string, Commit>, sha: string): boolean {
  return Object.hasOwn(commits, sha)
}

/** sha plus every ancestor present in commits (missing parents are not followed). */
export function ancestorsOf(sha: string, commits: Record<string, Commit>): Set<string> {
  const seen = new Set<string>()
  if (!has(commits, sha)) return seen
  seen.add(sha)
  const stack = [sha]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    for (const parent of commits[cur].parents) {
      if (has(commits, parent) && !seen.has(parent)) {
        seen.add(parent)
        stack.push(parent)
      }
    }
  }
  return seen
}

/**
 * Best common ancestor of a and b: a common ancestor that is not itself a proper ancestor
 * of another common ancestor. For criss-cross histories with several candidates the one
 * latest in the fixture's commit list wins, so the result is deterministic.
 */
export function mergeBase(
  a: string,
  b: string,
  commits: Record<string, Commit>,
  indexOf: ReadonlyMap<string, number>,
): string | null {
  const ancestorsA = ancestorsOf(a, commits)
  const ancestorsB = ancestorsOf(b, commits)
  const common = [...ancestorsA].filter((sha) => ancestorsB.has(sha))
  if (common.length === 0) return null

  // Everything that is a proper ancestor of some common ancestor is dominated. Ancestors of
  // a common ancestor are themselves common, so this walk stays inside `common`.
  const dominated = new Set<string>()
  const stack: string[] = []
  for (const sha of common) {
    for (const parent of commits[sha].parents) {
      if (has(commits, parent) && !dominated.has(parent)) {
        dominated.add(parent)
        stack.push(parent)
      }
    }
  }
  while (stack.length > 0) {
    const cur = stack.pop() as string
    for (const parent of commits[cur].parents) {
      if (has(commits, parent) && !dominated.has(parent)) {
        dominated.add(parent)
        stack.push(parent)
      }
    }
  }

  const best = common.filter((sha) => !dominated.has(sha))
  best.sort((x, y) => (indexOf.get(y) ?? 0) - (indexOf.get(x) ?? 0))
  return best[0] ?? null
}

function countNotIn(set: ReadonlySet<string>, other: ReadonlySet<string>): number {
  let n = 0
  for (const sha of set) if (!other.has(sha)) n += 1
  return n
}

export function makeRepo(spec: RepoSpec): RepoData {
  const owner = spec.owner ?? 'octo'
  const repo = spec.repo ?? 'garden'
  const commits: Record<string, Commit> = {}
  const indexOf = new Map<string, number>()

  spec.commits.forEach(([sha, ...parents], index) => {
    if (has(commits, sha)) throw new Error(`fixture: duplicate sha ${sha}`)
    indexOf.set(sha, index)
    commits[sha] = {
      sha,
      parents,
      message: `commit ${sha}`,
      author: 'dev',
      date: dateAt(index),
      url: `https://github.com/${owner}/${repo}/commit/${sha}`,
    }
  })

  if (spec.branches.length === 0) throw new Error('fixture: at least one branch is required')
  const defaultSpec = spec.branches.find((b) => b.isDefault) ?? spec.branches[0]
  for (const b of spec.branches) {
    if (!has(commits, b.tip)) throw new Error(`fixture: branch ${b.name} tip ${b.tip} is not a commit`)
  }
  const defaultAncestors = ancestorsOf(defaultSpec.tip, commits)

  const branches: Branch[] = spec.branches.map((b) => {
    const isDefault = b === defaultSpec
    if (isDefault) {
      return {
        name: b.name,
        tipSha: b.tip,
        isDefault: true,
        mergeBaseSha: null,
        aheadBy: 0,
        behindBy: 0,
        tipDate: commits[b.tip].date,
      }
    }
    const tipAncestors = ancestorsOf(b.tip, commits)
    return {
      name: b.name,
      tipSha: b.tip,
      isDefault: false,
      mergeBaseSha: mergeBase(defaultSpec.tip, b.tip, commits, indexOf),
      aheadBy: countNotIn(tipAncestors, defaultAncestors),
      behindBy: countNotIn(defaultAncestors, tipAncestors),
      tipDate: commits[b.tip].date,
    }
  })

  const truncatedAt = spec.truncatedAt ?? []
  const anyMissingParent = Object.values(commits).some((c) => c.parents.some((p) => !has(commits, p)))

  return {
    owner,
    repo,
    defaultBranch: defaultSpec.name,
    branches,
    commits,
    truncated: truncatedAt.length > 0 || anyMissingParent,
    truncatedAt,
  }
}

// ---------- fixtures ----------

/** (1) Linear trunk of 5. */
export const linear = (): RepoData =>
  makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['c3', 'c2'], ['c4', 'c3'], ['c5', 'c4']],
    branches: [{ name: 'main', tip: 'c5', isDefault: true }],
  })

/** (2) Single fork: feature off c3 with 2 unique commits. */
export const singleFork = (): RepoData =>
  makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['c3', 'c2'], ['c4', 'c3'], ['c5', 'c4'], ['f1', 'c3'], ['f2', 'f1']],
    branches: [
      { name: 'main', tip: 'c5', isDefault: true },
      { name: 'feature', tip: 'f2' },
    ],
  })

/** (3) Merge: feature merged back into main via a 2-parent merge commit; feature ref still present. */
export const merge = (): RepoData =>
  makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['c3', 'c2'], ['f1', 'c2'], ['f2', 'f1'], ['c4', 'c3'], ['m', 'c4', 'f2']],
    branches: [
      { name: 'main', tip: 'm', isDefault: true },
      { name: 'feature', tip: 'f2' },
    ],
  })

/** (4) Diamond: feature-a and feature-b both off c3; feature-a merged into main. */
export const diamond = (): RepoData =>
  makeRepo({
    commits: [
      ['c1'],
      ['c2', 'c1'],
      ['c3', 'c2'],
      ['a1', 'c3'],
      ['a2', 'a1'],
      ['b1', 'c3'],
      ['b2', 'b1'],
      ['m', 'c3', 'a2'],
    ],
    branches: [
      { name: 'main', tip: 'm', isDefault: true },
      { name: 'feature-a', tip: 'a2' },
      { name: 'feature-b', tip: 'b2' },
    ],
  })

/**
 * (5) Truncated: c2's parent c0 and f1's parent f0 were never fetched, and the fetcher also
 * flagged c3 in truncatedAt (its parent c2 is present, so isRoot there comes from the flag alone).
 */
export const truncated = (): RepoData =>
  makeRepo({
    commits: [['c2', 'c0'], ['c3', 'c2'], ['c4', 'c3'], ['c5', 'c4'], ['f1', 'f0'], ['f2', 'f1']],
    branches: [
      { name: 'main', tip: 'c5', isDefault: true },
      { name: 'feature', tip: 'f2' },
    ],
    truncatedAt: ['c3'],
  })

/** (6) Stale branch whose tip is a trunk commit (aheadBy 0). */
export const stale = (): RepoData =>
  makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['c3', 'c2'], ['c4', 'c3'], ['c5', 'c4']],
    branches: [
      { name: 'main', tip: 'c5', isDefault: true },
      { name: 'old', tip: 'c3' },
    ],
  })

/** (7) Nested: feature-b branched from feature-a's first commit. */
export const nested = (): RepoData =>
  makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['c3', 'c2'], ['a1', 'c3'], ['a2', 'a1'], ['b1', 'a1']],
    branches: [
      { name: 'main', tip: 'c3', isDefault: true },
      { name: 'feature-a', tip: 'a2' },
      { name: 'feature-b', tip: 'b1' },
    ],
  })

/** (8) Octopus merge with 3 parents; both side refs still present. */
export const octopus = (): RepoData =>
  makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['x1', 'c2'], ['y1', 'c2'], ['o', 'c2', 'x1', 'y1']],
    branches: [
      { name: 'main', tip: 'o', isDefault: true },
      { name: 'x', tip: 'x1' },
      { name: 'y', tip: 'y1' },
    ],
  })

/** (9) Two branches sharing the same tip sha. */
export const sharedTip = (): RepoData =>
  makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['c3', 'c2'], ['f1', 'c3'], ['f2', 'f1']],
    branches: [
      { name: 'main', tip: 'c3', isDefault: true },
      { name: 'alpha', tip: 'f2' },
      { name: 'beta', tip: 'f2' },
    ],
  })

/** (10) A side branch merged into main whose ref was deleted: only reachable via a second parent. */
export const mergedDeleted = (): RepoData =>
  makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['f1', 'c2'], ['f2', 'f1'], ['c3', 'c2'], ['m', 'c3', 'f2']],
    branches: [{ name: 'main', tip: 'm', isDefault: true }],
  })

/** (11) A branch legally named '__proto__': palette and lookups must treat it as an ordinary key. */
export const protoBranch = (): RepoData =>
  makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['c3', 'c2'], ['p1', 'c2']],
    branches: [
      { name: 'main', tip: 'c3', isDefault: true },
      { name: '__proto__', tip: 'p1' },
    ],
  })

export const fixtures = {
  linear,
  singleFork,
  merge,
  diamond,
  truncated,
  stale,
  nested,
  octopus,
  sharedTip,
  mergedDeleted,
  protoBranch,
} as const

export type FixtureName = keyof typeof fixtures

/**
 * Fast generator for the performance test: a linear chain of `commitCount` commits with
 * `branchCount` stale branches whose tips are spread evenly along the chain, plus main at
 * the end. Built directly (no merge-base search) so fixture setup stays out of the timing.
 */
export function linearRepo(commitCount: number, branchCount: number): RepoData {
  const commits: Record<string, Commit> = {}
  const shaOf = (i: number) => `s${i.toString(16).padStart(8, '0')}`
  for (let i = 0; i < commitCount; i += 1) {
    const sha = shaOf(i)
    commits[sha] = {
      sha,
      parents: i === 0 ? [] : [shaOf(i - 1)],
      message: `commit ${i}`,
      author: 'dev',
      date: dateAt(i),
      url: `https://github.com/octo/big/commit/${sha}`,
    }
  }
  const lastIndex = commitCount - 1
  const branches: Branch[] = [
    {
      name: 'main',
      tipSha: shaOf(lastIndex),
      isDefault: true,
      mergeBaseSha: null,
      aheadBy: 0,
      behindBy: 0,
      tipDate: commits[shaOf(lastIndex)].date,
    },
  ]
  const step = Math.floor(commitCount / (branchCount + 1))
  for (let k = 1; k <= branchCount; k += 1) {
    const index = Math.min(k * step, lastIndex - 1)
    const tipSha = shaOf(index)
    branches.push({
      name: `branch-${k.toString().padStart(3, '0')}`,
      tipSha,
      isDefault: false,
      mergeBaseSha: tipSha,
      aheadBy: 0,
      behindBy: lastIndex - index,
      tipDate: commits[tipSha].date,
    })
  }
  return {
    owner: 'octo',
    repo: 'big',
    defaultBranch: 'main',
    branches,
    commits,
    truncated: false,
    truncatedAt: [],
  }
}
