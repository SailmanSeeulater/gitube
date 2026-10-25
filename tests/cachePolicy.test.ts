import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentEntries,
  indexedDbStore,
  readFreshEntry,
  rememberEntry,
  type CacheEntry,
  type CachePolicy,
  type EntryStore,
} from '../src/api/cachePolicy'

function memoryStore<T>(): EntryStore<T> & { map: Map<string, CacheEntry<T>> } {
  const map = new Map<string, CacheEntry<T>>()
  return {
    map,
    get: async (key) => map.get(key),
    put: async (entry) => void map.set(entry.key, entry),
    all: async () => [...map.values()],
    delete: async (key) => void map.delete(key),
  }
}

const POLICY: CachePolicy = { freshMs: 60_000, maxEntries: 3, version: 2 }
const T0 = Date.UTC(2026, 9, 21, 12)

interface OpenRequest {
  result?: unknown
  error?: unknown
  onupgradeneeded?: () => void
  onsuccess?: () => void
  onerror?: () => void
}

/**
 * Just enough of IndexedDB for the store: databases that persist across opens (each open records
 * its name and version), stores keyed by entry.key, and transactions that complete on the next
 * tick. With fail set, every open is refused.
 */
function fakeIndexedDb(fail = false) {
  const opens: [string, number][] = []
  const created: [string, string, unknown][] = []
  const databases = new Map<string, Map<string, Map<string, unknown>>>()
  const indexedDB = {
    open(name: string, version: number) {
      opens.push([name, version])
      const request: OpenRequest = {}
      setTimeout(() => {
        if (fail) {
          request.error = new Error('open refused')
          request.onerror?.()
          return
        }
        const isNew = !databases.has(name)
        const stores = databases.get(name) ?? new Map<string, Map<string, unknown>>()
        databases.set(name, stores)
        request.result = {
          objectStoreNames: { contains: (store: string) => stores.has(store) },
          createObjectStore(store: string, options: unknown) {
            created.push([name, store, options])
            stores.set(store, new Map())
          },
          transaction(store: string) {
            const rows = stores.get(store)
            if (!rows) throw new Error(`no store ${store}`)
            const req: { result?: unknown } = {}
            const tx: { oncomplete?: () => void; objectStore: () => unknown } = {
              objectStore: () => ({
                get: (key: string) => ((req.result = rows.get(key)), req),
                getAll: () => ((req.result = [...rows.values()]), req),
                put: (entry: { key: string }) => (rows.set(entry.key, entry), (req.result = entry.key), req),
                delete: (key: string) => (rows.delete(key), (req.result = undefined), req),
              }),
            }
            setTimeout(() => tx.oncomplete?.())
            return tx
          },
        }
        if (isNew) request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
  vi.stubGlobal('indexedDB', indexedDB)
  return { opens, created }
}

/** A fresh copy of the module, so no connection opened by an earlier test is reused. */
async function freshModule() {
  vi.resetModules()
  return import('../src/api/cachePolicy')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cache policy', () => {
  it('serves an entry of the current version while it is fresh', async () => {
    const store = memoryStore<string>()
    await rememberEntry(store, 'k', 'data', POLICY, T0)
    expect(await readFreshEntry(store, 'k', POLICY, T0 + POLICY.freshMs - 1)).toEqual({
      key: 'k',
      version: 2,
      savedAt: new Date(T0).toISOString(),
      data: 'data',
    })
    expect(await readFreshEntry(store, 'k', POLICY, T0 + POLICY.freshMs)).toBeNull()
    expect(await readFreshEntry(store, 'k', { ...POLICY, version: 3 }, T0)).toBeNull()
    expect(await readFreshEntry(store, 'missing', POLICY, T0)).toBeNull()
  })

  it('ignores an entry whose time cannot be read', async () => {
    const store = memoryStore<string>()
    store.map.set('k', { key: 'k', version: 2, savedAt: 'not a date', data: 'data' })
    expect(await readFreshEntry(store, 'k', POLICY, T0)).toBeNull()
  })

  it('keeps the entry it just stored, even when the others are dated later (a clock that moved back)', async () => {
    const store = memoryStore<string>()
    for (let i = 0; i < POLICY.maxEntries; i++) await rememberEntry(store, `later${i}`, 'x', POLICY, T0 + (i + 1) * 1000)
    await rememberEntry(store, 'now', 'x', POLICY, T0)
    expect(store.map.has('now')).toBe(true)
    expect(store.map.size).toBe(POLICY.maxEntries + 1)
  })

  it('lists entries of the current version only, most recently fetched first', async () => {
    const store = memoryStore<string>()
    await rememberEntry(store, 'a', 'x', POLICY, T0)
    await rememberEntry(store, 'b', 'x', POLICY, T0 + 5000)
    await rememberEntry(store, 'old', 'x', { ...POLICY, version: 1 }, T0 + 9000)
    expect((await currentEntries(store, POLICY, T0 + POLICY.freshMs * 10)).map((e) => e.key)).toEqual(['b', 'a'])
  })
})

describe('IndexedDB store', () => {
  it('is null where IndexedDB does not exist', () => {
    expect(typeof indexedDB).toBe('undefined')
    expect(indexedDbStore('db', 'store')).toBeNull()
  })

  it('stores entries in the named database and store, keyed by entry.key', async () => {
    const { opens, created } = fakeIndexedDb()
    const { indexedDbStore: make } = await freshModule()
    const store = make<string>('garden-test', 'things')!
    const entry: CacheEntry<string> = { key: 'k', version: 1, savedAt: new Date(T0).toISOString(), data: 'data' }
    await store.put(entry)
    expect(await store.get('k')).toEqual(entry)
    expect(await store.all()).toEqual([entry])
    await store.delete('k')
    expect(await store.get('k')).toBeUndefined()
    expect(opens).toEqual([['garden-test', 1]])
    expect(created).toEqual([['garden-test', 'things', { keyPath: 'key' }]])
  })

  it('opens each database once, and separate databases separately', async () => {
    const { opens } = fakeIndexedDb()
    const { indexedDbStore: make } = await freshModule()
    await make('one', 's')!.all()
    await make('one', 's')!.all()
    await make('two', 's')!.all()
    expect(opens).toEqual([
      ['one', 1],
      ['two', 1],
    ])
  })

  it('swallows storage errors, and tries to open again on the next call', async () => {
    const { opens } = fakeIndexedDb(true)
    const { indexedDbStore: make } = await freshModule()
    const store = make<string>('garden-test', 'things')!
    expect(await store.get('k')).toBeUndefined()
    expect(await store.all()).toEqual([])
    await expect(store.put({ key: 'k', version: 1, savedAt: '', data: 'x' })).resolves.toBeUndefined()
    await expect(store.delete('k')).resolves.toBeUndefined()
    expect(opens).toHaveLength(4)
  })
})
