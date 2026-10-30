import { describe, expect, it } from 'vitest'
import type { RepoData } from '../src/types'
import { MEASURES, STALE_DAYS, versus, repoStats, type RepoStats } from '../src/graph/versus'
import { makeRepo } from './fixtures/repos'

const NOW = Date.parse('2026-10-21T12:00:00Z')

/** main c1..c3 and a feature merged back at m; the fixture dates are 2024-01-01 plus an hour each. */
function merged(): RepoData {
  const data = makeRepo({
    owner: 'octo',
    repo: 'a',
    commits: [['c1'], ['c2', 'c1'], ['f1', 'c1'], ['m', 'c2', 'f1'], ['c3', 'm']],
    branches: [
      { name: 'main', tip: 'c3', isDefault: true },
      { name: 'feature', tip: 'f1' },
    ],
  })
  data.commits.c1.login = 'ann'
  data.commits.c2.login = 'bob'
  data.commits.c2.author = 'Bob'
  data.commits.f1.login = 'dependabot[bot]'
  data.commits.f1.author = 'dependabot[bot]'
  return data
}

describe('repo stats', () => {
  it('counts a map from its loaded data', () => {
    const s = repoStats(merged(), NOW)
    expect(s.name).toBe('octo/a')
    expect(s.branches).toBe(2)
    expect(s.commits).toBe(5)
    expect(s.merges).toBe(1)
    expect(s.people).toBe(2) // ann and bob; the bot is left out
    expect(s.leftovers).toBe(1) // feature is merged
    expect(s.diverged).toBe(0)
    expect(s.stale).toBe(1) // feature's tip is from 2024
    // 5 commits within hours of each other: the window counts as a week
    expect(s.perWeek).toBe(5)
    expect(s.lastCommitDays).toBeGreaterThan(STALE_DAYS)
  })
})

const stats = (over: Partial<RepoStats>): RepoStats => ({
  name: 'x/y',
  branches: 10,
  people: 5,
  commits: 100,
  perWeek: 3,
  merges: 20,
  lastCommitDays: 2,
  leftovers: 1,
  diverged: 1,
  stale: 2,
  ...over,
})

describe('versus', () => {
  it('awards each measure to the better side, more or less as the measure wants', () => {
    const fight = versus(stats({ branches: 12, leftovers: 4 }), stats({ branches: 3, leftovers: 0 }))
    const row = (key: string) => fight.rows.find((r) => r.key === key)!
    expect(row('branches').winner).toBe('a')
    expect(row('leftovers').winner).toBe('b')
    expect(row('people').winner).toBeNull() // a draw
    expect(fight.score).toEqual({ a: 1, b: 1 })
    expect(fight.winner).toBeNull()
  })

  it('names the side with more wins, and keeps the measures in order', () => {
    const fight = versus(stats({ lastCommitDays: 1, stale: 0, diverged: 0 }), stats({ lastCommitDays: 40 }))
    expect(fight.rows.map((r) => r.key)).toEqual(MEASURES.map((m) => m.key))
    expect(fight.score).toEqual({ a: 3, b: 0 })
    expect(fight.winner).toBe('a')
  })

  it('awards nothing for a measure one side cannot be measured on', () => {
    const fight = versus(stats({ lastCommitDays: Number.NaN }), stats({}))
    expect(fight.rows.find((r) => r.key === 'lastCommitDays')!.winner).toBeNull()
  })
})
