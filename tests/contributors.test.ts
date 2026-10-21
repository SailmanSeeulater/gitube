import { describe, expect, it } from 'vitest'
import type { RepoData } from '../src/types'
import { ACTIVITY_BUCKETS, buildContributors, buildFullGraph, buildGraph, contributorFocus, linkKey } from '../src/graph'
import { makeRepo } from './fixtures/repos'

/** Rewrites authors on a fixture: sha -> [author name, login?, avatar?]. */
function withAuthors(data: RepoData, authors: Record<string, [string, string?, string?]>): RepoData {
  for (const [sha, [name, login, avatar]] of Object.entries(authors)) {
    const commit = data.commits[sha]
    commit.author = name
    if (login) commit.login = login
    if (avatar) commit.avatarUrl = avatar
  }
  return data
}

/**
 * main: c1..c5. feature forks at c3 with f1, f2, f3.
 * Ann wrote c1, c2, f1, f2 (f2 linked to no account), Bob wrote c3, c4, c5 and f3.
 */
function twoPeople(): RepoData {
  const data = makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['c3', 'c2'], ['c4', 'c3'], ['c5', 'c4'], ['f1', 'c3'], ['f2', 'f1'], ['f3', 'f2']],
    branches: [
      { name: 'main', tip: 'c5', isDefault: true },
      { name: 'feature', tip: 'f3' },
    ],
  })
  return withAuthors(data, {
    c1: ['Ann Lee', 'ann', 'https://avatars.example/ann'],
    c2: ['Ann Lee', 'Ann'],
    f1: ['Ann Lee', 'ann'],
    f2: ['Ann Lee'],
    c3: ['Bob', 'bob'],
    c4: ['Bob', 'bob'],
    c5: ['Bob', 'bob'],
    f3: ['Bob', 'bob'],
  })
}

describe('buildContributors', () => {
  it('ranks people by commits, folding logins case-insensitively and unlinked commits by name', () => {
    const { list, keyBySha } = buildContributors(twoPeople())

    expect(list.map((c) => [c.key, c.commits]).sort()).toEqual([
      ['login:ann', 4],
      ['login:bob', 4],
    ])
    const ann = list.find((c) => c.key === 'login:ann')!
    expect(ann.name).toBe('Ann Lee')
    expect(ann.login).toBe('ann')
    expect(ann.avatarUrl).toBe('https://avatars.example/ann')
    expect(ann.isBot).toBe(false)
    expect(keyBySha.get('f2')).toBe('login:ann')
    expect(keyBySha.size).toBe(8)
  })

  it('ranks by commits first and breaks a tie by the most recent commit', () => {
    // 4 each: Bob's f3 is the newest commit in the fixture
    expect(buildContributors(twoPeople()).list.map((c) => c.key)).toEqual(['login:bob', 'login:ann'])
    const data = twoPeople()
    data.commits.c3.author = 'Ann Lee'
    data.commits.c3.login = 'ann'
    expect(buildContributors(data).list.map((c) => [c.key, c.commits])).toEqual([
      ['login:ann', 5],
      ['login:bob', 3],
    ])
  })

  it('counts commits per owning branch and records first and last dates', () => {
    const { list } = buildContributors(twoPeople())
    const ann = list.find((c) => c.key === 'login:ann')!
    const bob = list.find((c) => c.key === 'login:bob')!

    expect(ann.branches).toEqual([
      { name: 'feature', commits: 2 },
      { name: 'main', commits: 2 },
    ])
    expect(bob.branches).toEqual([
      { name: 'main', commits: 3 },
      { name: 'feature', commits: 1 },
    ])
    const data = twoPeople()
    expect(ann.firstDate).toBe(data.commits.c1.date)
    expect(ann.lastDate).toBe(data.commits.f2.date)
  })

  it('spreads activity over one shared window', () => {
    const { list } = buildContributors(twoPeople())
    for (const c of list) {
      expect(c.activity).toHaveLength(ACTIVITY_BUCKETS)
      expect(c.activity.reduce((a, b) => a + b, 0)).toBe(c.commits)
    }
    // c1 is the oldest commit and f3 the newest
    const data = twoPeople()
    expect(buildContributors(data)).toMatchObject({ windowStart: data.commits.c1.date, windowEnd: data.commits.f3.date })
    expect(list.find((c) => c.key === 'login:ann')!.activity[0]).toBe(1)
    expect(list.find((c) => c.key === 'login:bob')!.activity[ACTIVITY_BUCKETS - 1]).toBe(1)
  })

  it('keeps unlinked authors apart by name, and does not guess when a name has two logins', () => {
    const data = makeRepo({
      commits: [['a'], ['b', 'a'], ['c', 'b'], ['d', 'c']],
      branches: [{ name: 'main', tip: 'd', isDefault: true }],
    })
    withAuthors(data, {
      a: ['Sam', 'sam-one'],
      b: ['Sam', 'sam-two'],
      c: ['Sam'],
      d: ['  Pat '],
    })
    const { list } = buildContributors(data)
    expect(list.map((c) => c.key).sort()).toEqual(['login:sam-one', 'login:sam-two', 'name:pat', 'name:sam'])
    expect(list.find((c) => c.key === 'name:pat')!.login).toBeNull()
  })

  it('flags bot accounts', () => {
    const data = makeRepo({
      commits: [['a'], ['b', 'a']],
      branches: [{ name: 'main', tip: 'b', isDefault: true }],
    })
    withAuthors(data, { a: ['dependabot[bot]', 'dependabot[bot]'], b: ['Renovate Bot'] })
    const { list } = buildContributors(data)
    expect(list.find((c) => c.key === 'login:dependabot[bot]')!.isBot).toBe(true)
    expect(list.find((c) => c.key === 'name:renovate bot')!.isBot).toBe(false)
  })

  it('handles undated commits and a single-instant window', () => {
    const data = makeRepo({
      commits: [['a'], ['b', 'a']],
      branches: [{ name: 'main', tip: 'b', isDefault: true }],
    })
    data.commits.a.date = ''
    const { list } = buildContributors(data)
    expect(list).toHaveLength(1)
    expect(list[0].commits).toBe(2)
    expect(list[0].firstDate).toBe(data.commits.b.date)
    expect(list[0].activity[ACTIVITY_BUCKETS - 1]).toBe(1)
  })
})

describe('contributorFocus', () => {
  it('in full view, lights their commits and the links leaving them', () => {
    const data = twoPeople()
    const { keyBySha } = buildContributors(data)
    const graph = buildGraph(data, 'full')
    const focus = contributorFocus(graph, graph, keyBySha, 'login:ann', ['feature', 'main'])

    expect([...focus.nodes].sort()).toEqual(['c1', 'c2', 'f1', 'f2'])
    expect([...focus.links].sort()).toEqual([linkKey('c2', 'c1'), linkKey('f1', 'c3'), linkKey('f2', 'f1')].sort())
    // labels: their commits plus both branch tips
    expect([...focus.labels].sort()).toEqual(['c1', 'c2', 'c5', 'f1', 'f2', 'f3'])
  })

  it('in skeleton view, lights a collapsed link when its hidden run holds one of their commits', () => {
    const data = twoPeople()
    const { keyBySha } = buildContributors(data)
    const skeleton = buildGraph(data, 'skeleton')
    const full = buildFullGraph(data)
    const shownLinks = skeleton.links.map((l) => linkKey(l.source, l.target)).sort()
    // tips c5 and f3, fork c3, root c1: c5->c3 hides c4, f3->c3 hides f2 and f1, c3->c1 hides c2
    expect(shownLinks).toEqual([linkKey('c3', 'c1'), linkKey('c5', 'c3'), linkKey('f3', 'c3')].sort())

    const ann = contributorFocus(skeleton, full, keyBySha, 'login:ann', ['feature', 'main'])
    expect([...ann.nodes]).toEqual(['c1'])
    expect([...ann.links].sort()).toEqual([linkKey('c3', 'c1'), linkKey('f3', 'c3')].sort())

    const bob = contributorFocus(skeleton, full, keyBySha, 'login:bob', ['main'])
    expect([...bob.nodes].sort()).toEqual(['c3', 'c5', 'f3'])
    // c3 -> c1 starts at Bob's c3, so it stays lit even though the run it hides is Ann's
    expect([...bob.links].sort()).toEqual([linkKey('c3', 'c1'), linkKey('c5', 'c3'), linkKey('f3', 'c3')].sort())
    expect([...bob.labels].sort()).toEqual(['c3', 'c5', 'f3'])
  })

  it('lights nothing for someone with no commits in the shown graph', () => {
    const data = twoPeople()
    const { keyBySha } = buildContributors(data)
    const graph = buildGraph(data, 'full')
    const focus = contributorFocus(graph, graph, keyBySha, 'login:nobody', [])
    expect(focus.nodes.size).toBe(0)
    expect(focus.links.size).toBe(0)
    expect(focus.labels.size).toBe(0)
  })
})
