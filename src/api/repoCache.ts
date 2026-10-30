/**
 * Remembers recently loaded repos in this browser (IndexedDB), so loading one again within a day
 * shows it at once and spends no GitHub requests. Refresh (or Go on the repo already shown)
 * always goes to GitHub.
 *
 * The policy (freshness, how many repos are kept, the recent list) is cachePolicy.ts's, shared with
 * the profile cache, and works on any RepoStore; the IndexedDB store degrades to "nothing cached"
 * wherever storage is unavailable or fails.
 */
import type { RepoData } from '../types'
import {
  currentEntries,
  indexedDbStore,
  readFreshEntry,
  rememberEntry,
  type CacheEntry,
  type CachePolicy,
  type EntryStore,
} from './cachePolicy'
import type { RepoRef } from './parseRepoUrl'

/** A cached repo is used for this long after it was fetched; after that Go fetches it again. */
export const CACHE_FRESH_MS = 24 * 60 * 60 * 1000
/** Most repos kept; the least recently fetched go first. */
export const CACHE_MAX_REPOS = 8
/** Bumped when RepoData changes shape, so older entries are ignored rather than misread. */
export const CACHE_VERSION = 1

const POLICY: CachePolicy = { freshMs: CACHE_FRESH_MS, maxEntries: CACHE_MAX_REPOS, version: CACHE_VERSION }

/** A cached repo, keyed by cacheKey of the repo. */
export type CachedRepo = CacheEntry<RepoData>

export type RepoStore = EntryStore<RepoData>

/** GitHub owner and repo names are case-insensitive. */
export function cacheKey(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`.toLowerCase()
}

/** The cached copy of ref when it is fresh enough to show instead of fetching; null otherwise. */
export async function readFresh(store: RepoStore, ref: RepoRef, now: number): Promise<CachedRepo | null> {
  return readFreshEntry(store, cacheKey(ref), POLICY, now)
}

/** Stores a fresh fetch and drops the oldest repos beyond CACHE_MAX_REPOS. */
export async function remember(store: RepoStore, data: RepoData, now: number): Promise<void> {
  await rememberEntry(store, cacheKey(data), data, POLICY, now)
}

export interface RecentRepo {
  owner: string
  repo: string
  savedAt: string
}

/** Cached repos, most recently fetched first (fresh or not: loading a stale one simply refetches). */
export async function recentRepos(store: RepoStore, now: number): Promise<RecentRepo[]> {
  const entries = await currentEntries(store, POLICY, now)
  return entries.map((e) => ({ owner: e.data.owner, repo: e.data.repo, savedAt: e.savedAt }))
}

// ---------- IndexedDB ----------

let shared: RepoStore | null | undefined

/** The page's one browser store (see browserRepoStore), made on first use. */
export function sharedRepoStore(): RepoStore | null {
  if (shared === undefined) shared = browserRepoStore()
  return shared
}

/**
 * This browser's store, or null where IndexedDB does not exist (tests, some private modes).
 * Every operation swallows storage errors (quota, a blocked database): the app then simply fetches.
 */
export function browserRepoStore(): RepoStore | null {
  return indexedDbStore<RepoData>('gitube', 'repos')
}
