/**
 * Person mode's profile query (src/profile/useProfileData.ts): its key, its query function, and the
 * retry and network rules it shares with the repo garden's query, observed through TanStack's
 * QueryObserver with the app's defaults, as tests/offline-network-mode.test.ts does for repos.
 * GitHub is replayed from the recordings (tests/helpers/profileReplay.ts).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query'
import type { CacheEntry } from '../src/api/cachePolicy'
import { profileCacheKey, type ProfileStore } from '../src/api/profileCache'
import { REPO_QUERY_NETWORK_MODE, toFetchError } from '../src/hooks/useRepoData'
import {
  PROFILE_QUERY_NETWORK_MODE,
  profileQueryFn,
  profileQueryKey,
  profileQueryOptions,
  type ProfileQueryDeps,
  type ProfileResult,
} from '../src/profile/useProfileData'
import type { RateInfo } from '../src/api/http'
import type { FetchProgress, ProfileData } from '../src/types'
import vercel from './fixtures/github/profile-vercel.json'
import { GAEARON_NOW, KEPANO_NOW, gaearonRouter, kepanoRouter, makeFetch } from './helpers/profileReplay'

const TOKEN = 'ghp_TEST_TOKEN_not_a_real_one_0000'

function memoryStore(): ProfileStore & { map: Map<string, CacheEntry<ProfileData>>; asked: string[] } {
  const map = new Map<string, CacheEntry<ProfileData>>()
  const asked: string[] = []
  return {
    map,
    asked,
    get: async (key) => {
      asked.push(key)
      return map.get(key)
    },
    put: async (entry) => void map.set(entry.key, entry),
    all: async () => [...map.values()],
    delete: async (key) => void map.delete(key),
  }
}

/** Query deps that record what the query function hands the app. */
function deps(over: Partial<ProfileQueryDeps> = {}) {
  const progress: Array<FetchProgress | null> = []
  const rates: Array<RateInfo | null> = []
  const lives: boolean[] = []
  let live = false
  const d: ProfileQueryDeps = {
    token: '',
    setProgress: (p) => progress.push(p),
    noteRate: (r) => rates.push(r),
    store: () => null,
    takeLive: () => {
      lives.push(live)
      const was = live
      live = false
      return was
    },
    now: () => GAEARON_NOW,
    ...over,
  }
  return { deps: d, progress, rates, lives, askLive: () => void (live = true) }
}

const run = (login: string, d: ProfileQueryDeps, signal = new AbortController().signal): Promise<ProfileResult> =>
  profileQueryFn(login, d)({ signal })

/** gaearon over REST, from the Phase 1 recording. */
const gaearonRest = () => makeFetch(gaearonRouter(() => undefined))

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('profileQueryKey', () => {
  it('keys by the lowercased login and the tier, never the token', () => {
    expect(profileQueryKey('OctoCat', '')).toEqual(['profile', 'octocat', 'rest'])
    expect(profileQueryKey('octocat', TOKEN)).toEqual(['profile', 'octocat', 'graphql'])
    expect(JSON.stringify(profileQueryKey('octocat', TOKEN))).not.toContain(TOKEN)
    // a login typed in another case is the same query
    expect(profileQueryKey('SailmanSeeulater', TOKEN)).toEqual(profileQueryKey('sailmanseeulater', TOKEN))
    // what loadProfile reads as no token is no token here either
    expect(profileQueryKey('octocat', '   ')).toEqual(['profile', 'octocat', 'rest'])
  })

  it('cannot meet a repo query', () => {
    expect(profileQueryKey('expressjs', '')[0]).toBe('profile')
  })
})

describe('profileQueryFn', () => {
  it('runs in the network mode the repo garden runs in', () => {
    expect(PROFILE_QUERY_NETWORK_MODE).toBe(REPO_QUERY_NETWORK_MODE)
    expect(profileQueryOptions('octocat', deps().deps).networkMode).toBe(REPO_QUERY_NETWORK_MODE)
  })

  it('clears the last progress first, streams the new one, and notes the core budget as it goes', async () => {
    const { fetch } = gaearonRest()
    const { deps: d, progress, rates } = deps({ fetch })
    const { profile, cachedAt } = await run('gaearon', d)
    expect(profile.login).toBe('gaearon')
    expect(profile.source).toBe('rest')
    expect(cachedAt).toBeNull()
    expect(progress[0]).toBeNull()
    expect(progress.length).toBeGreaterThan(2)
    expect(progress.at(-1)?.stage).toBe('done')
    const known = progress.filter((p): p is FetchProgress => p !== null && p.rateLimitRemaining !== null)
    expect(rates).toEqual(known.map((p) => ({ remaining: p.rateLimitRemaining, limit: null, resetAt: p.rateLimitResetAt })))
    expect(rates.length).toBeGreaterThan(0)
  })

  it('notes no budget when GitHub sends none', async () => {
    const user = { login: 'quiet-sprout', name: null, avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4', created_at: '2020-02-01T00:00:00Z', type: 'User' }
    const fetch: typeof globalThis.fetch = async (input) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname
      const body = path === '/users/quiet-sprout' ? user : []
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const { deps: d, progress, rates } = deps({ fetch })
    const { profile } = await run('quiet-sprout', d)
    expect(profile.repos).toEqual([])
    expect(progress.filter((p) => p !== null).length).toBeGreaterThan(0)
    expect(rates).toEqual([])
  })

  it('shows a fresh cached copy at no cost, and takes the live request once', async () => {
    const store = memoryStore()
    const { fetch, calls } = gaearonRest()
    const { deps: d, lives, askLive } = deps({ fetch, store: () => store })

    const first = await run('gaearon', d)
    expect(first.cachedAt).toBeNull()
    const fetched = calls.length
    expect(fetched).toBeGreaterThan(0)
    expect([...store.map.keys()]).toEqual([profileCacheKey('gaearon', 'rest')])

    const again = await run('GAEARON', d)
    expect(calls).toHaveLength(fetched)
    expect(again.cachedAt).toBe(new Date(GAEARON_NOW).toISOString())
    expect(again.profile).toEqual(first.profile)

    // refetch asks for GitHub: that run skips the cache, the one after it reads it again
    askLive()
    const live = await run('gaearon', d)
    expect(live.cachedAt).toBeNull()
    expect(calls.length).toBe(fetched * 2)
    await run('gaearon', d)
    expect(calls.length).toBe(fetched * 2)
    expect(lives).toEqual([false, false, true, false])
  })

  it('reads and fills only the GraphQL tier with a token', async () => {
    const store = memoryStore()
    const { fetch } = makeFetch(kepanoRouter())
    const { deps: d } = deps({ token: TOKEN, fetch, store: () => store, now: () => KEPANO_NOW })
    const { profile, cachedAt } = await run('kepano', d)
    expect(profile.source).toBe('graphql')
    expect(cachedAt).toBeNull()
    expect(store.asked).toEqual([profileCacheKey('kepano', 'graphql')])
    expect([...store.map.keys()]).toEqual([profileCacheKey('kepano', 'graphql')])
  })

  it("hands TanStack's signal to the fetch", async () => {
    const { fetch, calls } = gaearonRest()
    const controller = new AbortController()
    controller.abort()
    await expect(run('gaearon', deps({ fetch }).deps, controller.signal)).rejects.toMatchObject({ code: 'aborted' })
    expect(calls).toHaveLength(0)
  })
})

// ---------- the query as TanStack runs it ----------

type Result = ReturnType<QueryObserver<ProfileResult, Error>['getCurrentResult']>

/** Same defaults as src/main.tsx. */
function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 } } })
}

/** Subscribes (which starts the fetch) and resolves with the first result that satisfies until. */
function observe(observer: QueryObserver<ProfileResult, Error>, until: (r: Result) => boolean): Promise<Result> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`query did not settle: ${JSON.stringify(observer.getCurrentResult().status)}`))
    }, 3000)
    const unsubscribe = observer.subscribe((r) => {
      if (!until(r)) return
      clearTimeout(timer)
      unsubscribe()
      resolve(r)
    })
  })
}

/** Runs the hook's own query options (with a short retry delay) over fetch until it settles. */
async function settle(login: string, fetch: typeof globalThis.fetch) {
  const urls: string[] = []
  const counted: typeof globalThis.fetch = (input, init) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return fetch(input, init)
  }
  const client = makeClient()
  const observer = new QueryObserver<ProfileResult, Error>(client, { ...profileQueryOptions(login, deps({ fetch: counted }).deps), retryDelay: 10 })
  const result = await observe(observer, (r) => r.status !== 'pending' && !r.isFetching)
  client.clear()
  return { result, urls }
}

describe('the profile query, as TanStack runs it', () => {
  it('fails fast offline with a network error, after one retry', async () => {
    onlineManager.setOnline(false)
    const failing: typeof globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    const { result, urls } = await settle('octocat', failing)
    expect(result.isPaused).toBe(false)
    expect(toFetchError(result.error)?.code).toBe('network')
    // the identity call, then once more
    expect(urls).toHaveLength(2)
  })

  it('does not retry a user that is not there, or is not a user', async () => {
    const missing = await settle('nobody-here', makeFetch(() => ({ status: 404, body: { message: 'Not Found' } })).fetch)
    expect(toFetchError(missing.result.error)?.code).toBe('not_found')
    expect(missing.urls).toHaveLength(1)

    const org = await settle('vercel', makeFetch((call) => (call.url.pathname.toLowerCase() === '/users/vercel' ? vercel.user : undefined)).fetch)
    expect(toFetchError(org.result.error)?.code).toBe('not_a_user')
    expect(org.urls).toHaveLength(1)
  })

  it('lands a profile', async () => {
    const { result } = await settle('gaearon', gaearonRest().fetch)
    expect(result.data?.profile.login).toBe('gaearon')
    expect(result.data?.cachedAt).toBeNull()
  })
})
