/**
 * The cache policy the repo and profile caches share (repoCache.ts, profileCache.ts): an entry is
 * served while it is fresh and of the current version, and only the most recently fetched entries
 * are kept.
 *
 * The policy works on any EntryStore; the IndexedDB store degrades to "nothing cached" wherever
 * storage is unavailable or fails.
 */

export interface CacheEntry<T> {
  /** the entry's key in its store, made by the cache that owns it */
  key: string
  version: number
  /** ISO time it was fetched */
  savedAt: string
  data: T
}

export interface EntryStore<T> {
  get(key: string): Promise<CacheEntry<T> | undefined>
  put(entry: CacheEntry<T>): Promise<void>
  all(): Promise<CacheEntry<T>[]>
  delete(key: string): Promise<void>
}

/** One cache's rules. */
export interface CachePolicy {
  /** an entry is used for this long after it was fetched; after that it is fetched again */
  freshMs: number
  /** most entries kept; the least recently fetched go first */
  maxEntries: number
  /** bumped when the data changes shape, so older entries are ignored rather than misread */
  version: number
}

function ageMs(entry: CacheEntry<unknown>, now: number): number {
  const t = Date.parse(entry.savedAt)
  return Number.isFinite(t) ? now - t : Infinity
}

/** The entry under key when it is fresh enough to show instead of fetching; null otherwise. */
export async function readFreshEntry<T>(
  store: EntryStore<T>,
  key: string,
  policy: CachePolicy,
  now: number,
): Promise<CacheEntry<T> | null> {
  const entry = await store.get(key)
  if (!entry || entry.version !== policy.version) return null
  const age = ageMs(entry, now)
  return age >= 0 && age < policy.freshMs ? entry : null
}

/** Stores a fresh fetch under key and drops the oldest entries beyond policy.maxEntries. */
export async function rememberEntry<T>(
  store: EntryStore<T>,
  key: string,
  data: T,
  policy: CachePolicy,
  now: number,
): Promise<void> {
  await store.put({ key, version: policy.version, savedAt: new Date(now).toISOString(), data })
  const entries = await store.all()
  if (entries.length <= policy.maxEntries) return
  entries.sort((a, b) => ageMs(a, now) - ageMs(b, now))
  for (const old of entries.slice(policy.maxEntries)) if (old.key !== key) await store.delete(old.key)
}

/** Entries of the current version, most recently fetched first (fresh or not). */
export async function currentEntries<T>(store: EntryStore<T>, policy: CachePolicy, now: number): Promise<CacheEntry<T>[]> {
  const entries = (await store.all()).filter((e) => e.version === policy.version)
  entries.sort((a, b) => ageMs(a, now) - ageMs(b, now))
  return entries
}

// ---------- IndexedDB ----------

/**
 * One open connection per database, shared by every store made for it. Each cache has a database
 * of its own holding one store at version 1: adding a second store to a database needs a version
 * bump, after which an open at version 1 fails (PROFILE_SPEC.md, section 6).
 */
const databases = new Map<string, Promise<IDBDatabase>>()

function openDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  const open = databases.get(dbName)
  if (open) return open
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('IndexedDB blocked'))
  })
  databases.set(dbName, db)
  // a failed open is retried on the next call rather than cached forever
  db.catch(() => {
    if (databases.get(dbName) === db) databases.delete(dbName)
  })
  return db
}

function run<R>(
  dbName: string,
  storeName: string,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<R>,
): Promise<R> {
  return openDb(dbName, storeName).then(
    (db) =>
      new Promise<R>((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const request = body(tx.objectStore(storeName))
        tx.oncomplete = () => resolve(request.result)
        tx.onerror = () => reject(tx.error ?? request.error)
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      }),
  )
}

/**
 * The store storeName in this browser's database dbName, or null where IndexedDB does not exist
 * (tests, some private modes). Every operation swallows storage errors (quota, a blocked
 * database): the app then simply fetches.
 */
export function indexedDbStore<T>(dbName: string, storeName: string): EntryStore<T> | null {
  if (typeof indexedDB === 'undefined') return null
  return {
    get: (key) => run<CacheEntry<T> | undefined>(dbName, storeName, 'readonly', (s) => s.get(key)).catch(() => undefined),
    put: (entry) => run(dbName, storeName, 'readwrite', (s) => s.put(entry)).then(() => undefined, () => undefined),
    all: () => run<CacheEntry<T>[]>(dbName, storeName, 'readonly', (s) => s.getAll()).catch(() => []),
    delete: (key) => run(dbName, storeName, 'readwrite', (s) => s.delete(key)).then(() => undefined, () => undefined),
  }
}
