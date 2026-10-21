import { describe, expect, it } from 'vitest'
import { GardenFileError, gardenFileName, parseGardenFile, serializeGarden } from '../src/export/gardenFile'
import type { RepoData } from '../src/types'
import { fixtures, makeRepo } from './fixtures/repos'

/** Fixture shas are short words; real ones are hex. */
function hexRepo() {
  const data = makeRepo({
    commits: [['aaa1'], ['aaa2', 'aaa1'], ['aaa3', 'aaa2'], ['bbb1', 'aaa2']],
    branches: [
      { name: 'main', tip: 'aaa3', isDefault: true },
      { name: 'feature', tip: 'bbb1' },
    ],
  })
  data.commits.aaa1.login = 'ann'
  data.commits.aaa1.avatarUrl = 'https://avatars.githubusercontent.com/u/1?v=4'
  return data
}

function roundTrip(mutate: (file: Record<string, any>) => void): () => unknown {
  const file = JSON.parse(serializeGarden(hexRepo()))
  mutate(file)
  return () => parseGardenFile(JSON.stringify(file))
}

describe('garden files', () => {
  it('round-trips the repo data exactly', () => {
    const data = hexRepo()
    const now = new Date('2026-10-21T12:00:00Z')
    const file = parseGardenFile(serializeGarden(data, now))
    expect(file.savedAt).toBe('2026-10-21T12:00:00.000Z')
    expect(file.data).toEqual(data)
  })

  it('round-trips every graph fixture (merges, octopus, truncated history) once its shas are hex', () => {
    const hex = (s: string) => [...s].map((ch) => ch.charCodeAt(0).toString(16)).join('').padEnd(8, '0')
    for (const make of Object.values(fixtures)) {
      const raw = make()
      const data: RepoData = {
        ...raw,
        branches: raw.branches.map((b) => ({ ...b, tipSha: hex(b.tipSha), mergeBaseSha: b.mergeBaseSha && hex(b.mergeBaseSha) })),
        commits: Object.fromEntries(
          Object.values(raw.commits).map((c) => [
            hex(c.sha),
            { ...c, sha: hex(c.sha), parents: c.parents.map(hex), url: `https://github.com/octo/garden/commit/${hex(c.sha)}` },
          ]),
        ),
        truncatedAt: raw.truncatedAt.map(hex),
      }
      expect(parseGardenFile(serializeGarden(data)).data).toEqual(data)
    }
  })

  it('explains files it cannot read', () => {
    expect(() => parseGardenFile('not json')).toThrow('not a JSON file')
    expect(() => parseGardenFile('{"hello":1}')).toThrow('not saved by repo-garden')
    expect(roundTrip((f) => (f.version = 2))).toThrow('newer repo-garden')
    expect(roundTrip((f) => delete f.data.commits.aaa1.parents)).toThrow('no parent list')
    expect(roundTrip((f) => (f.data.defaultBranch = 'nope'))).toThrow('default branch')
    expect(roundTrip((f) => (f.data.branches = []))).toThrow('no branches')
    expect(roundTrip((f) => (f.data.owner = '../evil'))).toThrow('repository name')
    expect(roundTrip((f) => (f.data.branches[1].aheadBy = -1))).toThrow('aheadBy')
    expect(roundTrip((f) => (f.data.commits.aaa2.sha = 'aaa3'))).toThrow('another sha')
    expect(roundTrip((f) => (f.data.truncatedAt = ['zz']))).toThrow(GardenFileError)
  })

  it('rejects keys that are not commit shas, so nothing lands on the prototype', () => {
    const run = roundTrip((f) => {
      f.data.commits = JSON.parse('{"__proto__": {"sha": "__proto__", "parents": [], "message": "", "author": "", "date": "", "url": ""}}')
    })
    expect(run).toThrow('not a commit sha')
  })

  it('keeps only github.com links and GitHub avatars, and drops fields it does not know', () => {
    const file = parseGardenFile(
      JSON.stringify(
        (() => {
          const f = JSON.parse(serializeGarden(hexRepo()))
          f.data.commits.aaa1.url = 'javascript:alert(1)'
          f.data.commits.aaa1.avatarUrl = 'https://evil.example/pixel.png'
          f.data.commits.aaa2.login = 'not a login!'
          f.data.commits.aaa2.avatarUrl = 'https://avatars.githubusercontent.com/u/2'
          f.data.commits.aaa3.extra = 'ignored'
          f.data.extra = 'ignored'
          return f
        })(),
      ),
    )
    expect(file.data.commits.aaa1.url).toBe('https://github.com/octo/garden/commit/aaa1')
    expect(file.data.commits.aaa1.login).toBe('ann')
    expect(file.data.commits.aaa1).not.toHaveProperty('avatarUrl')
    expect(file.data.commits.aaa2).not.toHaveProperty('login')
    expect(file.data.commits.aaa2).not.toHaveProperty('avatarUrl')
    expect(file.data.commits.aaa3).not.toHaveProperty('extra')
    expect(file.data).not.toHaveProperty('extra')
  })

  it('names files after the repo and the local date', () => {
    expect(gardenFileName({ owner: 'expressjs', repo: 'express' }, 'png', new Date(2026, 9, 21, 23, 30))).toBe(
      'expressjs-express-garden-2026-10-21.png',
    )
  })
})
