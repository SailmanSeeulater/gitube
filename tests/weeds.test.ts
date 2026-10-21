import { describe, expect, it } from 'vitest'
import type { Branch, RepoData } from '../src/types'
import { deleteCommand, findWeeds, looksKept, shellQuote, thornLevel } from '../src/graph/weeds'

function branch(name: string, aheadBy: number, behindBy: number, tipDate: string, isDefault = false): Branch {
  return { name, tipSha: 'aaaa', isDefault, mergeBaseSha: isDefault ? null : 'bbbb', aheadBy, behindBy, tipDate }
}

/** The shape of expressjs/express on 2026-10-21, trimmed. */
function expressLike(): RepoData {
  return {
    owner: 'expressjs',
    repo: 'express',
    defaultBranch: 'master',
    branches: [
      branch('master', 0, 0, '2026-10-17T00:00:00Z', true),
      branch('4.x', 38, 325, '2026-10-06T00:00:00Z'),
      branch('5.x', 0, 66, '2026-01-16T00:00:00Z'),
      branch('5.0', 0, 203, '2024-09-10T00:00:00Z'),
      branch('feat/list-routes-subapps', 1, 0, '2026-10-17T00:00:00Z'),
      branch('release/4.22.3', 36, 325, '2026-09-11T00:00:00Z'),
      branch('release-branch-diagram', 1, 380, '2024-05-13T00:00:00Z'),
      branch('throw-redirect', 2, 145, '2025-03-18T00:00:00Z'),
      branch('old-fix', 0, 12, '2023-01-02T00:00:00Z'),
      branch('fresh', 0, 0, '2026-10-17T00:00:00Z'),
      branch('ulises/release-dependencies', 1, 142, '2025-03-23T00:00:00Z'),
    ],
    commits: {},
    truncated: false,
    truncatedAt: [],
  }
}

describe('weeds', () => {
  it('lists branches with nothing ahead of the default branch, oldest first', () => {
    const { weeds } = findWeeds(expressLike())
    expect(weeds.map((w) => [w.name, w.kind])).toEqual([
      ['old-fix', 'merged'],
      ['5.0', 'merged'],
      ['5.x', 'merged'],
      ['fresh', 'same'],
    ])
  })

  it('leaves release and version lines unticked', () => {
    const { weeds } = findWeeds(expressLike())
    expect(Object.fromEntries(weeds.map((w) => [w.name, w.keep]))).toEqual({ 'old-fix': false, '5.0': true, '5.x': true, fresh: false })
    // anything starting release/release-/release_ is kept: wrongly keeping a weed costs a click
    for (const name of ['v2', '1.2.x', 'release', 'release/4.22.3', 'releases-2024', 'release-notes', 'develop', 'gh-pages', 'LTS/hydrogen', 'main']) {
      expect(looksKept(name)).toBe(true)
    }
    for (const name of ['feature/x', 'fix-release-notes', 'v2-rewrite', 'old-fix']) {
      expect(looksKept(name)).toBe(false)
    }
  })

  it('never lists the default branch', () => {
    const data = expressLike()
    data.branches[0].isDefault = false // a default named only by data.defaultBranch
    expect(findWeeds(data).weeds.map((w) => w.name)).not.toContain('master')
  })
})

describe('thorns', () => {
  it('grow with how far apart both sides are', () => {
    expect(thornLevel(0, 500)).toBe(0) // only behind: a weed, not tangled
    expect(thornLevel(30, 10)).toBe(0) // barely behind
    expect(thornLevel(1, 142)).toBe(0)
    expect(thornLevel(2, 145)).toBe(1)
    expect(thornLevel(1, 380)).toBe(1)
    expect(thornLevel(10, 250)).toBe(2)
    expect(thornLevel(38, 325)).toBe(3)
  })

  it('are reported most tangled first, with a level per branch', () => {
    const { thorny, thorns } = findWeeds(expressLike())
    expect(thorny.map((t) => [t.name, t.level])).toEqual([
      ['4.x', 3],
      ['release/4.22.3', 3],
      ['release-branch-diagram', 1],
      ['throw-redirect', 1],
    ])
    expect(thorns.get('4.x')).toBe(3)
    expect(thorns.has('ulises/release-dependencies')).toBe(false)
  })
})

describe('delete command', () => {
  it('deletes every name in one push', () => {
    expect(deleteCommand(['old-fix', 'feat/a.b'])).toBe('git push origin --delete old-fix feat/a.b')
    expect(deleteCommand(['x'], 'upstream')).toBe('git push upstream --delete x')
    expect(deleteCommand([])).toBe('')
  })

  it('quotes names a shell would read into', () => {
    expect(shellQuote('fix/#12')).toBe("'fix/#12'")
    expect(shellQuote('a&b')).toBe("'a&b'")
    expect(shellQuote('$HOME')).toBe("'$HOME'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
    expect(shellQuote('plain-name_1.2')).toBe('plain-name_1.2')
  })
})
