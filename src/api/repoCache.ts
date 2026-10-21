/**
 * Remembers recently grown repos in this browser (IndexedDB), so growing one again within a day
 * shows it at once and spends no GitHub requests. Refresh (or Grow on the repo already shown)
 * always goes to GitHub.
 *
 * The policy (freshness, how many repos are kept, the recent list) works on any RepoStore; the
 * IndexedDB store degrades to "nothing cached" wherever storage is unavailable or fails.
 */
import type { RepoData } from '../types'
import type { RepoRef } from './parseRepoUrl'

/** A cached repo is used for this long after it was fetched; after that Grow fetches it again. */
export const CACHE_FRESH_MS = 24 * 60 * 60 * 1000
/** Most repos kept; the least recently fetched go first. */
export const CACHE_MAX_REPOS = 8
/** Bumped when RepoData changes shape, so older entries are ignored rather than misread. */
export const CACHE_VERSION = 1

export interface CachedRepo {
  /** cacheKey of the repo */
  key: string
  version: number
  /** ISO time it was fetched */
  savedAt: string
  data: RepoData
}

export interface RepoStore {
  get(key: string): Promise<CachedRepo | undefined>
  put(entry: CachedRepo): Promise<void>
  all(): Promise<CachedRepo[]>
  delete(key: string): Promise<void>
}

/** GitHub owner and repo names are case-insensitive. */
export function cacheKey(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`.toLowerCase()
}

function ageMs(entry: CachedRepo, now: number): number {
  const t = Date.parse(entry.savedAt)
  return Number.isFinite(t) ? now - t : Infinity
}

/** The cached copy of ref when it is fresh enough to show instead of fetching; null otherwise. */
export async function readFresh(store: RepoStore, ref: RepoRef, now: number): Promise<CachedRepo | null> {
  const entry = await store.get(cacheKey(ref))
  if (!entry || entry.version !== CACHE_VERSION) return null
  const age = ageMs(entry, now)
  return age >= 0 && age < CACHE_FRESH_MS ? entry : null
}

/** Stores a fresh fetch and drops the oldest repos beyond CACHE_MAX_REPOS. */
export async function remember(store: RepoStore, data: RepoData, now: number): Promise<void> {
  const key = cacheKey(data)
  await store.put({ key, version: CACHE_VERSION, savedAt: new Date(now).toISOString(), data })
  const entries = await store.all()
  if (entries.length <= CACHE_MAX_REPOS) return
  entries.sort((a, b) => ageMs(a, now) - ageMs(b, now))
  for (const old of entries.slice(CACHE_MAX_REPOS)) if (old.key !== key) await store.delete(old.key)
}

export interface RecentRepo {
  owner: string
  repo: string
  savedAt: string
}

/** Cached repos, most recently fetched first (fresh or not: growing a stale one simply refetches). */
export async function recentRepos(store: RepoStore, now: number): Promise<RecentRepo[]> {
  const entries = (await store.all()).filter((e) => e.version === CACHE_VERSION)
  entries.sort((a, b) => ageMs(a, now) - ageMs(b, now))
  return entries.map((e) => ({ owner: e.data.owner, repo: e.data.repo, savedAt: e.savedAt }))
}

// ---------- IndexedDB ----------

const DB_NAME = 'repo-garden'
const STORE = 'repos'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('IndexedDB blocked'))
    })
    // a failed open is retried on the next call rather than cached forever
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = body(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(request.result)
        tx.onerror = () => reject(tx.error ?? request.error)
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      }),
  )
}

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
  if (typeof indexedDB === 'undefined') return null
  return {
    get: (key) => run<CachedRepo | undefined>('readonly', (s) => s.get(key)).catch(() => undefined),
    put: (entry) => run('readwrite', (s) => s.put(entry)).then(() => undefined, () => undefined),
    all: () => run<CachedRepo[]>('readonly', (s) => s.getAll()).catch(() => []),
    delete: (key) => run('readwrite', (s) => s.delete(key)).then(() => undefined, () => undefined),
  }
}
