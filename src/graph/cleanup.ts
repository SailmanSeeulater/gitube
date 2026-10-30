/**
 * Branch cleanup from the compare data every branch already has (aheadBy / behindBy against the
 * default branch):
 * - leftovers: branches with nothing the default branch lacks, so deleting them loses no commits;
 * - diverged: branches far apart from the default branch on both sides, where a merge or rebase is
 *   likely to hurt.
 *
 * Pure. Squash- and rebase-merged branches keep counting commits ahead (their commits were copied,
 * not merged), so they cannot be told apart from live work here.
 */
import type { Branch, RepoData } from '../types'

export type LeftoverKind =
  /** the default branch has moved on past it */
  | 'merged'
  /** it points at the default branch's own tip */
  | 'same'

export interface Leftover {
  name: string
  kind: LeftoverKind
  behindBy: number
  tipDate: string
  /** the name reads like a branch kept on purpose (a release or version line): not ticked for deletion */
  keep: boolean
}

export type SpikeLevel = 0 | 1 | 2 | 3

export interface Diverged {
  name: string
  aheadBy: number
  behindBy: number
  level: 1 | 2 | 3
}

export interface CleanupReport {
  /** oldest tip first: the longest-forgotten go first */
  leftovers: Leftover[]
  /** most tangled first */
  diverged: Diverged[]
  /** branch name -> spike level, diverged branches only */
  spikes: Map<string, 1 | 2 | 3>
}

/** aheadBy x behindBy at which a branch gets 1, 2 or 3 spikes. */
export const SPIKE_STEPS = [200, 2000, 10000] as const
/** Fewer commits behind than this never counts as drifting, however much is ahead. */
export const DIVERGE_MIN_BEHIND = 20

/**
 * How tangled a branch is with the default branch: both sides moved since they split, so both
 * have to be reconciled. A branch that only fell behind (nothing ahead) is a leftover, not diverged.
 */
export function spikeLevel(aheadBy: number, behindBy: number): SpikeLevel {
  if (aheadBy < 1 || behindBy < DIVERGE_MIN_BEHIND) return 0
  const tangle = aheadBy * behindBy
  if (tangle >= SPIKE_STEPS[2]) return 3
  if (tangle >= SPIKE_STEPS[1]) return 2
  if (tangle >= SPIKE_STEPS[0]) return 1
  return 0
}

/** Names usually kept on purpose: version and release lines, long-lived integration branches. */
const KEEP_RE =
  /^(?:v?\d+(?:\.(?:\d+|x))*|release(?:s)?(?:[/_-].*)?|main|master|trunk|develop|dev|next|canary|beta|alpha|stable|latest|production|prod|staging|gh-pages|lts(?:[/_-].*)?)$/i

export function looksKept(name: string): boolean {
  return KEEP_RE.test(name)
}

function timeOf(branch: Branch): number {
  const t = Date.parse(branch.tipDate)
  return Number.isFinite(t) ? t : Infinity
}

export function findCleanup(data: RepoData): CleanupReport {
  const leftovers: Leftover[] = []
  const diverged: Diverged[] = []
  const spikes = new Map<string, 1 | 2 | 3>()
  const others = data.branches.filter((b) => !b.isDefault && b.name !== data.defaultBranch)

  for (const b of [...others].sort((a, c) => timeOf(a) - timeOf(c) || (a.name < c.name ? -1 : a.name > c.name ? 1 : 0))) {
    if (b.aheadBy === 0) {
      leftovers.push({ name: b.name, kind: b.behindBy > 0 ? 'merged' : 'same', behindBy: b.behindBy, tipDate: b.tipDate, keep: looksKept(b.name) })
    }
  }
  for (const b of others) {
    const level = spikeLevel(b.aheadBy, b.behindBy)
    if (level === 0) continue
    diverged.push({ name: b.name, aheadBy: b.aheadBy, behindBy: b.behindBy, level })
    spikes.set(b.name, level)
  }
  diverged.sort((a, c) => c.aheadBy * c.behindBy - a.aheadBy * a.behindBy || (a.name < c.name ? -1 : a.name > c.name ? 1 : 0))
  return { leftovers, diverged, spikes }
}

/** Plain enough for any shell unquoted; anything else gets quoted. */
const SAFE_RE = /^[A-Za-z0-9._/+=@%-]+$/

/**
 * A branch name as a shell word. Single quotes keep it literal in bash, zsh and PowerShell alike;
 * a quote inside the name is written the POSIX way ('\'' ), which PowerShell does not read (git
 * allows such names, but they are rare).
 */
export function shellQuote(name: string): string {
  if (SAFE_RE.test(name)) return name
  return `'${name.replace(/'/g, `'\\''`)}'`
}

/** One `git push <remote> --delete ...` for all the names; '' for none. */
export function deleteCommand(names: ReadonlyArray<string>, remote = 'origin'): string {
  if (names.length === 0) return ''
  return `git push ${remote} --delete ${names.map(shellQuote).join(' ')}`
}

/**
 * The leftovers ticked for the delete command at first: all of them but the ones that look kept on
 * purpose (keep) and the ones with an open pull request, since deleting its branch closes it.
 */
export function defaultLeftoverPicks(leftovers: ReadonlyArray<Pick<Leftover, 'name' | 'keep'>>, hasOpenPr: (name: string) => boolean = () => false): Set<string> {
  return new Set(leftovers.filter((w) => !w.keep && !hasOpenPr(w.name)).map((w) => w.name))
}
