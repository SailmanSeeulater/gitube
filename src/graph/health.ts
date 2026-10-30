/**
 * The repo's health in three signals, read from what the app already loaded (no new requests):
 * - bus factor: how concentrated the fetched commits are among the people who wrote them;
 * - branch lifetime: how long work lives on a branch (fork point to tip), and how many branches
 *   are merged or stale;
 * - open pull request hygiene: how many are green (checks passing) and reviewed (approved).
 *
 * Pure and deterministic (pass `now` to pin the stale cut-off). Each signal is null where there is
 * nothing to say: one contributor, no non-default branches, no pull request answer. Like the
 * leaderboard, the numbers describe the fetched window, not the repo's whole history.
 */
import type { PullIndex, RepoData } from '../types'
import type { ContributorIndex } from './contributors'
import { countPulls } from './pulls'
import type { CleanupReport } from './cleanup'
import { isStale } from '../components/graphUtils'

/** A branch with work on it whose tip is older than this counts as stale (the stale filter's 90d step). */
export const HEALTH_STALE_DAYS = 90

export interface BusFactor {
  /** people (bots left out) with a fetched commit */
  people: number
  /** share of the people's commits held by the most prolific, 0..1 */
  topShare: number
  /** share held by the top two together, 0..1 (equals topShare with one person) */
  topTwoShare: number
}

export interface BranchLife {
  /** non-default branches */
  count: number
  /**
   * median days from fork point (the merge-base commit's date) to tip date over the branches with
   * work on them (aheadBy > 0) whose fork point was fetched; null when none qualifies. A merged
   * branch's fork point is its own tip, so it says nothing about how long the work took.
   */
  medianDays: number | null
  /** branches the default branch has moved past with nothing left to merge (leftovers of kind 'merged') */
  merged: number
  /** branches with work on them left for HEALTH_STALE_DAYS, or diverged (far apart from the default branch on both sides) */
  stale: number
}

export interface PullHygiene {
  /** open pull requests from the loaded branches (fork pull requests have no branch here) */
  open: number
  /** of them, how many have passing checks; null when no pull request's checks were looked up */
  green: number | null
  /** of them, how many have an approving review; null when no pull request's review was looked up */
  reviewed: number | null
}

export interface RepoHealth {
  /** null with fewer than two people */
  busFactor: BusFactor | null
  /** null without a non-default branch */
  branches: BranchLife | null
  /** null without a pull request answer (no overlay yet, a saved file, an error) */
  pulls: PullHygiene | null
}

export interface HealthItem {
  /** the strip's words, lower-case and short */
  text: string
  /** what the signal means, for a title attribute */
  title: string
}

const DAY_MS = 86_400_000

function timeOf(date: string | undefined): number {
  const t = date === undefined ? NaN : Date.parse(date)
  return Number.isFinite(t) ? t : NaN
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function busFactorOf(contributors: ContributorIndex): BusFactor | null {
  // the list is sorted most commits first, so the top two are the first two people
  const counts = contributors.list.filter((c) => !c.isBot).map((c) => c.commits)
  const total = counts.reduce((sum, n) => sum + n, 0)
  if (counts.length < 2 || total === 0) return null
  return { people: counts.length, topShare: counts[0] / total, topTwoShare: (counts[0] + counts[1]) / total }
}

function branchLifeOf(data: RepoData, cleanup: CleanupReport, now: number): BranchLife | null {
  const others = data.branches.filter((b) => !b.isDefault && b.name !== data.defaultBranch)
  if (others.length === 0) return null
  const leftoverNames = new Set(cleanup.leftovers.map((w) => w.name))
  const lives: number[] = []
  let stale = 0
  for (const b of others) {
    if (leftoverNames.has(b.name)) continue
    if (cleanup.spikes.has(b.name) || isStale(b.tipDate, HEALTH_STALE_DAYS, now)) stale += 1
    if (b.aheadBy <= 0 || b.mergeBaseSha === null) continue
    const forked = timeOf(data.commits[b.mergeBaseSha]?.date)
    const tip = timeOf(b.tipDate)
    if (Number.isNaN(forked) || Number.isNaN(tip)) continue
    lives.push(Math.max(0, tip - forked) / DAY_MS)
  }
  return {
    count: others.length,
    medianDays: median(lives),
    merged: cleanup.leftovers.filter((w) => w.kind === 'merged').length,
    stale,
  }
}

function pullHygieneOf(pulls: PullIndex | null): PullHygiene | null {
  if (!pulls) return null
  const seen = new Set<number>()
  let checksKnown = 0
  let green = 0
  let reviewKnown = 0
  let reviewed = 0
  for (const prs of pulls.byBranch.values()) {
    for (const pr of prs) {
      if (seen.has(pr.number)) continue
      seen.add(pr.number)
      if (pr.checks !== 'unknown') checksKnown += 1
      if (pr.checks === 'passing') green += 1
      if (pr.review !== 'unknown') reviewKnown += 1
      if (pr.review === 'approved') reviewed += 1
    }
  }
  return { open: countPulls(pulls), green: checksKnown > 0 ? green : null, reviewed: reviewKnown > 0 ? reviewed : null }
}

/**
 * The three signals from the data on hand. `pulls` is the overlay's index, or null while it has
 * no answer. `now` fixes the stale cut-off (tests pin it).
 */
export function repoHealth(
  data: RepoData,
  contributors: ContributorIndex,
  cleanup: CleanupReport,
  pulls: PullIndex | null,
  now: number = Date.now(),
): RepoHealth {
  return { busFactor: busFactorOf(contributors), branches: branchLifeOf(data, cleanup, now), pulls: pullHygieneOf(pulls) }
}

const pct = (share: number): string => `${Math.round(share * 100)}%`
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The signals worded for the status strip, each with its explanation; signals without data are left out. */
export function healthItems(h: RepoHealth): HealthItem[] {
  const items: HealthItem[] = []
  if (h.busFactor) {
    const { people, topShare, topTwoShare } = h.busFactor
    // one person's share when it is already a majority, else the top two's
    const text = topShare >= 0.5 ? `1 of ${people} people holds ${pct(topShare)} of commits` : `2 of ${people} people hold ${pct(topTwoShare)} of commits`
    items.push({
      text,
      title: `Bus factor: how the ${people} people who wrote the loaded commits share them (bots left out). The more one or two hold, the more the repo depends on them.`,
    })
  }
  if (h.branches) {
    const { medianDays, merged, stale } = h.branches
    if (medianDays !== null) {
      const days = Math.round(medianDays)
      // a branch forked and last touched the same day lives "0 days" by the arithmetic
      items.push({
        text: `branches live ${days < 1 ? 'under a day' : plural(days, 'day')} (median)`,
        title: 'Branch lifetime: the median time from a branch’s fork point to its last commit, over the branches with work on them.',
      })
    }
    // "5 merged, 3 stale branches", "1 merged branch", "3 stale branches"; nothing when both are 0
    const parts: string[] = []
    if (merged > 0) parts.push(`${merged} merged`)
    if (stale > 0) parts.push(`${stale} stale`)
    if (parts.length > 0) {
      items.push({
        text: `${parts.join(', ')} branch${merged + stale === 1 ? '' : 'es'}`,
        title: `Merged: the default branch has moved past them with nothing left to merge. Stale: work on them has waited over ${HEALTH_STALE_DAYS} days, or they drifted far from the default branch on both sides.`,
      })
    }
  }
  if (h.pulls) {
    const { open, green, reviewed } = h.pulls
    let text: string
    if (open === 0) text = 'no open prs on these branches'
    else {
      const prs = `${open} open pr${open === 1 ? '' : 's'}`
      text = green !== null ? `${green} of ${prs} green` : prs
      if (reviewed !== null) text += `, ${reviewed} reviewed`
    }
    items.push({
      text,
      title: 'Open pull requests from the loaded branches: green ones have passing checks, reviewed ones an approving review. Counts not looked up yet are left out.',
    })
  }
  return items
}

/** The strip's words alone, one per signal with data. */
export function healthLine(h: RepoHealth): string[] {
  return healthItems(h).map((item) => item.text)
}
