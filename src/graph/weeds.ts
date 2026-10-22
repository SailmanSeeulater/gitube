/**
 * Garden upkeep from the compare data every branch already has (aheadBy / behindBy against the
 * default branch):
 * - weeds: branches with nothing the default branch lacks, so deleting them loses no commits;
 * - thorns: branches far apart from the default branch on both sides, where a merge or rebase is
 *   likely to hurt.
 *
 * Pure. Squash- and rebase-merged branches keep counting commits ahead (their commits were copied,
 * not merged), so they cannot be told apart from live work here.
 */
import type { Branch, RepoData } from '../types'

export type WeedKind =
  /** the default branch has moved on past it */
  | 'merged'
  /** it points at the default branch's own tip */
  | 'same'

export interface Weed {
  name: string
  kind: WeedKind
  behindBy: number
  tipDate: string
  /** the name reads like a branch kept on purpose (a release or version line): not ticked for deletion */
  keep: boolean
}

export type ThornLevel = 0 | 1 | 2 | 3

export interface Thorny {
  name: string
  aheadBy: number
  behindBy: number
  level: 1 | 2 | 3
}

export interface WeedReport {
  /** oldest tip first: the longest-forgotten go first */
  weeds: Weed[]
  /** most tangled first */
  thorny: Thorny[]
  /** branch name -> thorn level, thorny branches only */
  thorns: Map<string, 1 | 2 | 3>
}

/** aheadBy x behindBy at which a branch grows 1, 2 or 3 thorns. */
export const THORN_STEPS = [200, 2000, 10000] as const
/** Fewer commits behind than this never counts as drifting, however much is ahead. */
export const THORN_MIN_BEHIND = 20

/**
 * How tangled a branch is with the default branch: both sides moved since they split, so both
 * have to be reconciled. A branch that only fell behind (nothing ahead) is a weed, not thorny.
 */
export function thornLevel(aheadBy: number, behindBy: number): ThornLevel {
  if (aheadBy < 1 || behindBy < THORN_MIN_BEHIND) return 0
  const tangle = aheadBy * behindBy
  if (tangle >= THORN_STEPS[2]) return 3
  if (tangle >= THORN_STEPS[1]) return 2
  if (tangle >= THORN_STEPS[0]) return 1
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

export function findWeeds(data: RepoData): WeedReport {
  const weeds: Weed[] = []
  const thorny: Thorny[] = []
  const thorns = new Map<string, 1 | 2 | 3>()
  const others = data.branches.filter((b) => !b.isDefault && b.name !== data.defaultBranch)

  for (const b of [...others].sort((a, c) => timeOf(a) - timeOf(c) || (a.name < c.name ? -1 : a.name > c.name ? 1 : 0))) {
    if (b.aheadBy === 0) {
      weeds.push({ name: b.name, kind: b.behindBy > 0 ? 'merged' : 'same', behindBy: b.behindBy, tipDate: b.tipDate, keep: looksKept(b.name) })
    }
  }
  for (const b of others) {
    const level = thornLevel(b.aheadBy, b.behindBy)
    if (level === 0) continue
    thorny.push({ name: b.name, aheadBy: b.aheadBy, behindBy: b.behindBy, level })
    thorns.set(b.name, level)
  }
  thorny.sort((a, c) => c.aheadBy * c.behindBy - a.aheadBy * a.behindBy || (a.name < c.name ? -1 : a.name > c.name ? 1 : 0))
  return { weeds, thorny, thorns }
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
 * The weeds ticked for the delete command at first: all of them but the ones that look kept on
 * purpose (keep) and the ones with an open pull request, since deleting its branch closes it.
 */
export function defaultWeedPicks(weeds: ReadonlyArray<Pick<Weed, 'name' | 'keep'>>, hasOpenPr: (name: string) => boolean = () => false): Set<string> {
  return new Set(weeds.filter((w) => !w.keep && !hasOpenPr(w.name)).map((w) => w.name))
}
