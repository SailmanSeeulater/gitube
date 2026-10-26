import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CacheEntry } from '../src/api/cachePolicy'
import {
  PROFILE_CACHE_FRESH_MS,
  PROFILE_CACHE_MAX,
  PROFILE_CACHE_VERSION,
  browserProfileStore,
  profileCacheKey,
  readProfile,
  rememberProfile,
  type ProfileStore,
} from '../src/api/profileCache'
import type { ProfileData } from '../src/types'

function memoryStore(): ProfileStore & { map: Map<string, CacheEntry<ProfileData>> } {
  const map = new Map<string, CacheEntry<ProfileData>>()
  return {
    map,
    get: async (key) => map.get(key),
    put: async (entry) => void map.set(entry.key, entry),
    all: async () => [...map.values()],
    delete: async (key) => void map.delete(key),
  }
}

/** A made-up public profile: no repos, nothing private. */
function profile(login: string, over: Partial<ProfileData> = {}): ProfileData {
  return {
    login,
    name: null,
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    createdAt: '2015-03-01T10:00:00Z',
    source: 'rest',
    repos: [],
    days: [],
    recent: [],
    recentFrom: '2026-09-21',
    milestones: [],
    restrictedContributions: 0,
    truncated: false,
    lostWindows: [],
    fallback: null,
    ...over,
  }
}

const graphqlProfile = (login: string) => profile(login, { source: 'graphql', recentFrom: null })

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 9, 21, 12)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('profile cache', () => {
  it('keeps profiles fresh for a day, a few at a time, versioned', () => {
    expect(PROFILE_CACHE_FRESH_MS).toBe(DAY)
    expect(PROFILE_CACHE_MAX).toBe(6)
    expect(PROFILE_CACHE_VERSION).toBe(1)
  })

  it('keys profiles by the lowercased login and the tier', () => {
    expect(profileCacheKey('OctoGarden', 'rest')).toBe('octogarden#rest')
    expect(profileCacheKey('OctoGarden', 'graphql')).toBe('octogarden#graphql')
  })

  it('serves a profile fetched within the day, under any casing of the login', async () => {
    const store = memoryStore()
    await rememberProfile(store, profile('OctoGarden'), 'rest', T0)
    expect([...store.map.keys()]).toEqual(['octogarden#rest'])
    const hit = await readProfile(store, 'octogarden', 'rest', T0 + DAY - 1)
    // the profile keeps GitHub's casing; only the key is lowercased
    expect(hit?.data.login).toBe('OctoGarden')
    expect(hit?.savedAt).toBe(new Date(T0).toISOString())
    expect((await readProfile(store, 'OCTOGARDEN', 'rest', T0))?.data.login).toBe('OctoGarden')
  })

  it('stops serving it once the day has passed, or when its version is stale', async () => {
    const store = memoryStore()
    await rememberProfile(store, profile('octo'), 'rest', T0)
    expect(await readProfile(store, 'octo', 'rest', T0 + DAY)).toBeNull()
    store.map.get('octo#rest')!.version = PROFILE_CACHE_VERSION + 1
    expect(await readProfile(store, 'octo', 'rest', T0)).toBeNull()
    expect(await readProfile(store, 'other', 'rest', T0)).toBeNull()
  })

  it('ignores an entry dated in the future (a clock that moved back)', async () => {
    const store = memoryStore()
    await rememberProfile(store, profile('octo'), 'rest', T0)
    expect(await readProfile(store, 'octo', 'rest', T0 - 60_000)).toBeNull()
  })

  it('never serves one tier for the other', async () => {
    const store = memoryStore()
    // a tokenless profile is not read once a token is set
    await rememberProfile(store, profile('rest-only'), 'rest', T0)
    expect(await readProfile(store, 'rest-only', 'graphql', T0)).toBeNull()
    // and a token profile is never served without the token
    await rememberProfile(store, graphqlProfile('token-only'), 'graphql', T0)
    expect(await readProfile(store, 'token-only', 'rest', T0)).toBeNull()
    // the same login can hold both, each read only by its own tier
    await rememberProfile(store, profile('both'), 'rest', T0)
    await rememberProfile(store, graphqlProfile('both'), 'graphql', T0)
    expect((await readProfile(store, 'both', 'rest', T0))?.data.source).toBe('rest')
    expect((await readProfile(store, 'both', 'graphql', T0))?.data.source).toBe('graphql')
  })

  it('does not store a profile REST filled after a GraphQL fallback', async () => {
    const store = memoryStore()
    const fallback = profile('octo', {
      fallback: { message: 'GraphQL rate limit reached', limit: 'graphql', resetAt: '2026-10-21T13:05:00Z' },
    })
    // the token run asks to keep it under its own tier: the source does not match
    await rememberProfile(store, fallback, 'graphql', T0)
    // nor is it kept as a REST profile: the next token run tries GraphQL again
    await rememberProfile(store, fallback, 'rest', T0)
    expect(store.map.size).toBe(0)
  })

  it('does not store a profile under a tier that did not fill it', async () => {
    const store = memoryStore()
    await rememberProfile(store, profile('octo'), 'graphql', T0)
    await rememberProfile(store, graphqlProfile('octo'), 'rest', T0)
    expect(store.map.size).toBe(0)
  })

  it('keeps the 6 most recently fetched profiles', async () => {
    const store = memoryStore()
    for (let i = 0; i < 9; i++) await rememberProfile(store, profile(`user${i}`), 'rest', T0 + i * 1000)
    expect(store.map.size).toBe(6)
    expect(store.map.has('user0#rest')).toBe(false)
    expect(store.map.has('user8#rest')).toBe(true)
    // fetching an old one again makes it the newest
    await rememberProfile(store, profile('user3'), 'rest', T0 + 100_000)
    await rememberProfile(store, profile('new'), 'rest', T0 + 200_000)
    expect(store.map.has('user3#rest')).toBe(true)
    expect(store.map.has('user4#rest')).toBe(false)
  })

  it('is null where IndexedDB does not exist', () => {
    expect(typeof indexedDB).toBe('undefined')
    expect(browserProfileStore()).toBeNull()
  })

  it("opens a database of its own, never the repo cache's", async () => {
    // an open that runs its upgrade, then fails: enough to see what was opened and created
    const opens: [string, number][] = []
    const created: [string, unknown][] = []
    vi.stubGlobal('indexedDB', {
      open(name: string, version: number) {
        opens.push([name, version])
        const request: { result?: unknown; error?: unknown; onupgradeneeded?: () => void; onerror?: () => void } = {}
        setTimeout(() => {
          request.result = {
            objectStoreNames: { contains: () => false },
            createObjectStore: (store: string, options: unknown) => void created.push([store, options]),
          }
          request.onupgradeneeded?.()
          request.error = new Error('open refused')
          request.onerror?.()
        })
        return request
      },
    })
    const store = browserProfileStore()!
    // storage errors are swallowed: the app then simply fetches
    expect(await store.get(profileCacheKey('octo', 'rest'))).toBeUndefined()
    expect(opens).toEqual([['repo-garden-profiles', 1]])
    expect(created).toEqual([['profiles', { keyPath: 'key' }]])
  })
})
