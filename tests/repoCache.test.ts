import { describe, expect, it } from 'vitest'
import {
  CACHE_FRESH_MS,
  CACHE_MAX_REPOS,
  CACHE_VERSION,
  cacheKey,
  readFresh,
  recentRepos,
  remember,
  type CachedRepo,
  type RepoStore,
} from '../src/api/repoCache'
import { makeRepo } from './fixtures/repos'

function memoryStore(): RepoStore & { map: Map<string, CachedRepo> } {
  const map = new Map<string, CachedRepo>()
  return {
    map,
    get: async (key) => map.get(key),
    put: async (entry) => void map.set(entry.key, entry),
    all: async () => [...map.values()],
    delete: async (key) => void map.delete(key),
  }
}

const repo = (owner: string, name: string) =>
  makeRepo({ owner, repo: name, commits: [['c1'], ['c2', 'c1']], branches: [{ name: 'main', tip: 'c2', isDefault: true }] })

const T0 = Date.UTC(2026, 9, 21, 12)

describe('repo cache', () => {
  it('keys repos case-insensitively', () => {
    expect(cacheKey({ owner: 'ExpressJS', repo: 'Express' })).toBe('expressjs/express')
  })

  it('serves a repo fetched within the freshness window, under any casing of its name', async () => {
    const store = memoryStore()
    await remember(store, repo('octo', 'tracks'), T0)
    const hit = await readFresh(store, { owner: 'Octo', repo: 'Tracks' }, T0 + CACHE_FRESH_MS - 1)
    expect(hit?.data.repo).toBe('tracks')
    expect(hit?.savedAt).toBe(new Date(T0).toISOString())
  })

  it('stops serving it once the window has passed, or when its version is stale', async () => {
    const store = memoryStore()
    await remember(store, repo('octo', 'tracks'), T0)
    expect(await readFresh(store, { owner: 'octo', repo: 'tracks' }, T0 + CACHE_FRESH_MS)).toBeNull()
    store.map.get('octo/tracks')!.version = CACHE_VERSION + 1
    expect(await readFresh(store, { owner: 'octo', repo: 'tracks' }, T0)).toBeNull()
    expect(await readFresh(store, { owner: 'octo', repo: 'other' }, T0)).toBeNull()
  })

  it('ignores an entry dated in the future (a clock that moved back)', async () => {
    const store = memoryStore()
    await remember(store, repo('octo', 'tracks'), T0)
    expect(await readFresh(store, { owner: 'octo', repo: 'tracks' }, T0 - 60_000)).toBeNull()
  })

  it(`keeps the ${CACHE_MAX_REPOS} most recently fetched repos`, async () => {
    const store = memoryStore()
    for (let i = 0; i < CACHE_MAX_REPOS + 3; i++) await remember(store, repo('octo', `r${i}`), T0 + i * 1000)
    expect(store.map.size).toBe(CACHE_MAX_REPOS)
    expect(store.map.has('octo/r0')).toBe(false)
    expect(store.map.has(`octo/r${CACHE_MAX_REPOS + 2}`)).toBe(true)
    // fetching an old one again makes it the newest
    await remember(store, repo('octo', 'r3'), T0 + 100_000)
    await remember(store, repo('octo', 'new'), T0 + 200_000)
    expect(store.map.has('octo/r3')).toBe(true)
    expect(store.map.has('octo/r4')).toBe(false)
  })

  it('lists recent repos newest first', async () => {
    const store = memoryStore()
    await remember(store, repo('a', 'one'), T0)
    await remember(store, repo('b', 'two'), T0 + 5000)
    expect(await recentRepos(store, T0 + 10_000)).toEqual([
      { owner: 'b', repo: 'two', savedAt: new Date(T0 + 5000).toISOString() },
      { owner: 'a', repo: 'one', savedAt: new Date(T0).toISOString() },
    ])
  })
})
