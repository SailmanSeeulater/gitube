/**
 * Garden battle: two repos' gardens measured side by side, with a winner per measure and a final
 * score. Pure. Every measure comes from the fetched data, so counts describe the loaded window
 * (FetchOptions caps), the same for both sides.
 */
import type { RepoData } from '../types'
import { buildContributors } from './contributors'
import { findWeeds } from './weeds'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
/** A branch quiet this long counts as stale: about six months. */
export const STALE_DAYS = 180

export interface GardenStats {
  /** 'owner/repo' */
  name: string
  branches: number
  /** contributors in the loaded commits, bots left out */
  people: number
  commits: number
  /** loaded commits per week of the loaded window */
  perWeek: number
  merges: number
  /** days since the newest loaded commit; NaN when none is dated */
  lastCommitDays: number
  weeds: number
  thorny: number
  /** branches other than the default quiet for STALE_DAYS or more */
  stale: number
}

export function gardenStats(data: RepoData, now: number): GardenStats {
  const commits = Object.values(data.commits)
  let first = Infinity
  let last = -Infinity
  let merges = 0
  for (const c of commits) {
    if (c.parents.length > 1) merges += 1
    const t = Date.parse(c.date)
    if (!Number.isFinite(t)) continue
    if (t < first) first = t
    if (t > last) last = t
  }
  const weeks = Number.isFinite(first) ? Math.max(1, (last - first) / WEEK_MS) : 1
  const weeds = findWeeds(data)
  const stale = data.branches.filter((b) => {
    if (b.isDefault || b.name === data.defaultBranch) return false
    const t = Date.parse(b.tipDate)
    return Number.isFinite(t) && now - t >= STALE_DAYS * DAY_MS
  }).length
  return {
    name: `${data.owner}/${data.repo}`,
    branches: data.branches.length,
    people: buildContributors(data).list.filter((c) => !c.isBot).length,
    commits: commits.length,
    perWeek: commits.length / weeks,
    merges,
    lastCommitDays: Number.isFinite(last) ? Math.max(0, (now - last) / DAY_MS) : Number.NaN,
    weeds: weeds.weeds.length,
    thorny: weeds.thorny.length,
    stale,
  }
}

export type Side = 'a' | 'b'

export interface BattleRow {
  key: keyof Omit<GardenStats, 'name'>
  label: string
  /** what winning this row means */
  hint: string
  a: number
  b: number
  /** null for a draw (or a side without a value) */
  winner: Side | null
}

interface Measure {
  key: BattleRow['key']
  label: string
  hint: string
  better: 'more' | 'less'
}

/** The face-off, in the order shown. */
export const MEASURES: ReadonlyArray<Measure> = [
  { key: 'branches', label: 'branches', hint: 'bushier: more live branches', better: 'more' },
  { key: 'people', label: 'people', hint: 'more gardeners in the loaded commits (bots left out)', better: 'more' },
  { key: 'perWeek', label: 'commits / week', hint: 'busier: loaded commits per week of the loaded window', better: 'more' },
  { key: 'merges', label: 'merges', hint: 'more merge commits: work flowing back together', better: 'more' },
  { key: 'lastCommitDays', label: 'last commit', hint: 'fresher: the newest commit is more recent', better: 'less' },
  { key: 'weeds', label: 'weeds', hint: 'tidier: fewer merged branches left undeleted', better: 'less' },
  { key: 'thorny', label: 'thorns', hint: 'smoother: fewer branches far apart from the default one', better: 'less' },
  { key: 'stale', label: 'stale', hint: `livelier: fewer branches quiet for ${STALE_DAYS}+ days`, better: 'less' },
]

/** Values this close count as a draw (commits per week and days are fractional). */
const DRAW = 1e-6

export interface Battle {
  rows: BattleRow[]
  /** rows won by each side */
  score: Record<Side, number>
  /** null for a draw */
  winner: Side | null
}

export function battle(a: GardenStats, b: GardenStats): Battle {
  const score: Record<Side, number> = { a: 0, b: 0 }
  const rows = MEASURES.map((m): BattleRow => {
    const va = a[m.key]
    const vb = b[m.key]
    let winner: Side | null = null
    if (Number.isFinite(va) && Number.isFinite(vb) && Math.abs(va - vb) > DRAW) {
      const aAhead = m.better === 'more' ? va > vb : va < vb
      winner = aAhead ? 'a' : 'b'
      score[winner] += 1
    }
    return { key: m.key, label: m.label, hint: m.hint, a: va, b: vb, winner }
  })
  return { rows, score, winner: score.a === score.b ? null : score.a > score.b ? 'a' : 'b' }
}
