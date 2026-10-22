import { describe, expect, it, vi } from 'vitest'
import {
  ChunkLoadError,
  DEFAULT_RETRY_DELAY_MS,
  defineChunk,
  failedModuleUrl,
  isChunkLoadError,
  loadWithRetry,
  preload,
} from './chunk'

/** an importer that fails `failures` times, naming no URL (as Safari does), and then resolves */
function flaky<T>(value: T, failures: number) {
  let calls = 0
  const importer = vi.fn(async () => {
    calls += 1
    if (calls <= failures) throw new TypeError(`Failed to fetch dynamically imported module (attempt ${calls})`)
    return value
  })
  return importer
}

const noWait = () => Promise.resolve()

const ORIGIN = 'https://repogarden.test'
const CHUNK_URL = `${ORIGIN}/assets/ThemePicker-B8x_d3-q.js`
const chromiumError = (url: string) => new TypeError(`Failed to fetch dynamically imported module: ${url}`)

/**
 * The importer as a browser runs it once its fetch has failed: the failure stays in the page's
 * module map, so every later call rejects at once, the same way, and nothing is fetched.
 */
function failedForGood(url = CHUNK_URL) {
  return vi.fn((): Promise<{ default: string }> => Promise.reject(chromiumError(url)))
}

/** import() of a URL, as a server that fails the first `failures` requests and then serves the file */
function server(failures: number) {
  let requests = 0
  return vi.fn(async (url: string) => {
    requests += 1
    if (requests <= failures) throw chromiumError(url)
    return { default: url }
  })
}

describe('failedModuleUrl', () => {
  it("reads the module URL from Chromium's and Firefox's messages", () => {
    expect(failedModuleUrl(chromiumError(CHUNK_URL), ORIGIN)).toBe(CHUNK_URL)
    expect(failedModuleUrl(new TypeError(`error loading dynamically imported module: ${CHUNK_URL}`), ORIGIN)).toBe(CHUNK_URL)
  })

  it('leaves off the query of an earlier try', () => {
    expect(failedModuleUrl(chromiumError(`${CHUNK_URL}?retry=2`), ORIGIN)).toBe(CHUNK_URL)
  })

  it('finds nothing without a URL, on another origin, or in an error that is not a TypeError', () => {
    expect(failedModuleUrl(new TypeError('Importing a module script failed.'), ORIGIN)).toBeNull()
    expect(failedModuleUrl(chromiumError('https://cdn.example.com/assets/x.js'), ORIGIN)).toBeNull()
    expect(failedModuleUrl(new ChunkLoadError(chromiumError(CHUNK_URL)), ORIGIN)).toBeNull()
    expect(failedModuleUrl(new Error(`Failed to fetch dynamically imported module: ${CHUNK_URL}`), ORIGIN)).toBeNull()
    expect(failedModuleUrl(chromiumError(CHUNK_URL), undefined)).toBeNull()
  })
})

describe('loadWithRetry', () => {
  it('resolves on the first try without waiting', async () => {
    const wait = vi.fn(noWait)
    const importer = flaky('mod', 0)
    await expect(loadWithRetry(importer, { wait })).resolves.toBe('mod')
    expect(importer).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it('tries once more after a pause under a new URL, which gets past a dropped connection', async () => {
    const wait = vi.fn(noWait)
    const importer = failedForGood()
    const importUrl = server(0)
    await expect(loadWithRetry(importer, { wait, importUrl, origin: ORIGIN })).resolves.toEqual({ default: `${CHUNK_URL}?retry=1` })
    // the failed URL itself is never imported again: the browser would reject at once
    expect(importer).toHaveBeenCalledTimes(1)
    expect(importUrl).toHaveBeenCalledExactlyOnceWith(`${CHUNK_URL}?retry=1`)
    expect(wait).toHaveBeenCalledExactlyOnceWith(DEFAULT_RETRY_DELAY_MS)
  })

  it('uses a new URL for every further try', async () => {
    const importUrl = server(1)
    await expect(loadWithRetry(failedForGood(), { retries: 2, wait: noWait, importUrl, origin: ORIGIN })).resolves.toEqual({
      default: `${CHUNK_URL}?retry=2`,
    })
    expect(importUrl.mock.calls).toEqual([[`${CHUNK_URL}?retry=1`], [`${CHUNK_URL}?retry=2`]])
  })

  it('calls the importer again when the error names no URL of this origin', async () => {
    const importUrl = server(0)
    const importer = failedForGood('https://cdn.example.com/assets/x.js')
    await expect(loadWithRetry(importer, { wait: noWait, importUrl, origin: ORIGIN })).rejects.toBeInstanceOf(ChunkLoadError)
    expect(importer).toHaveBeenCalledTimes(2)
    expect(importUrl).not.toHaveBeenCalled()
  })

  it('gives up with a ChunkLoadError carrying the last failure', async () => {
    const importer = flaky('mod', 5)
    const error = await loadWithRetry(importer, { retries: 2, retryDelayMs: 10, wait: noWait }).catch((e: unknown) => e)
    expect(importer).toHaveBeenCalledTimes(3)
    expect(isChunkLoadError(error)).toBe(true)
    expect((error as ChunkLoadError).cause).toBeInstanceOf(TypeError)
    expect((error as ChunkLoadError).message).toContain('attempt 3')
  })

  it('makes no further attempts with retries: 0', async () => {
    const importer = failedForGood()
    const importUrl = server(0)
    await expect(loadWithRetry(importer, { retries: 0, wait: noWait, importUrl, origin: ORIGIN })).rejects.toBeInstanceOf(ChunkLoadError)
    expect(importer).toHaveBeenCalledTimes(1)
    expect(importUrl).not.toHaveBeenCalled()
  })

  it('passes a ChunkLoadError from a nested part on without trying again', async () => {
    const inner = new ChunkLoadError(chromiumError(CHUNK_URL))
    const importer = vi.fn(() => Promise.reject(inner))
    const importUrl = server(0)
    await expect(loadWithRetry(importer, { wait: noWait, importUrl, origin: ORIGIN })).rejects.toBe(inner)
    expect(importer).toHaveBeenCalledTimes(1)
    expect(importUrl).not.toHaveBeenCalled()
  })
})

describe('isChunkLoadError', () => {
  it('only recognises ChunkLoadError', () => {
    expect(isChunkLoadError(new ChunkLoadError('x'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError('ChunkLoadError')).toBe(false)
  })
})

describe('defineChunk', () => {
  it('does nothing until loaded, then shares one import between callers', async () => {
    const importer = flaky({ default: 'Part' }, 0)
    const chunk = defineChunk(importer, { wait: noWait })
    expect(importer).not.toHaveBeenCalled()
    expect(chunk.state()).toEqual({ status: 'idle' })
    expect(chunk.peek()).toBeUndefined()

    const a = chunk.load()
    const b = chunk.load()
    expect(a).toBe(b)
    expect(chunk.state().status).toBe('loading')
    await expect(a).resolves.toEqual({ default: 'Part' })
    expect(importer).toHaveBeenCalledTimes(1)
    expect(chunk.state()).toEqual({ status: 'ready', value: { default: 'Part' } })
    expect(chunk.peek()).toEqual({ default: 'Part' })

    // loaded: later calls resolve with the same module and import nothing
    await expect(chunk.load()).resolves.toBe(chunk.peek())
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('keeps state() the same object until it changes', async () => {
    const chunk = defineChunk(flaky('mod', 0), { wait: noWait })
    expect(chunk.state()).toBe(chunk.state())
    const loading = chunk.load()
    expect(chunk.state()).toBe(chunk.state())
    await loading
    const ready = chunk.state()
    expect(chunk.state()).toBe(ready)
  })

  it('reports a failure, and the next load tries again under a URL not used before', async () => {
    const importer = failedForGood()
    // the server is down for the first two requests (the first try and its retry)
    const importUrl = server(1)
    const chunk = defineChunk(importer, { retries: 1, wait: noWait, importUrl, origin: ORIGIN })
    await expect(chunk.load()).rejects.toBeInstanceOf(ChunkLoadError)
    const failed = chunk.state()
    expect(failed.status).toBe('failed')
    expect(failed.status === 'failed' && isChunkLoadError(failed.error)).toBe(true)
    expect(chunk.peek()).toBeUndefined()

    // opened again: the URLs that failed stay failed, so this one is new
    await expect(chunk.load()).resolves.toEqual({ default: `${CHUNK_URL}?retry=2` })
    expect(importer).toHaveBeenCalledTimes(1)
    expect(importUrl.mock.calls).toEqual([[`${CHUNK_URL}?retry=1`], [`${CHUNK_URL}?retry=2`]])
    expect(chunk.state().status).toBe('ready')
  })

  it('tries afresh on the next load when the error names no URL', async () => {
    const importer = flaky('mod', 2)
    const chunk = defineChunk(importer, { retries: 1, wait: noWait })
    await expect(chunk.load()).rejects.toBeInstanceOf(ChunkLoadError)
    expect(importer).toHaveBeenCalledTimes(2)
    await expect(chunk.load()).resolves.toBe('mod')
    expect(importer).toHaveBeenCalledTimes(3)
  })

  it('a part made of parts tries again only the part that failed', async () => {
    const menuImporter = failedForGood()
    const menuUrl = server(1)
    const menu = defineChunk(menuImporter, { wait: noWait, importUrl: menuUrl, origin: ORIGIN })
    const encoders = defineChunk(flaky('encoders', 0), { wait: noWait })
    const both = defineChunk(async () => {
      const [m] = await Promise.all([menu.load(), encoders.load()])
      return m
    })
    await expect(both.load()).rejects.toBeInstanceOf(ChunkLoadError)
    expect(encoders.state().status).toBe('ready')
    await expect(both.load()).resolves.toEqual({ default: `${CHUNK_URL}?retry=2` })
    expect(menuImporter).toHaveBeenCalledTimes(1)
    expect(menuUrl).toHaveBeenCalledTimes(2)
  })

  it('tells subscribers about every change until they unsubscribe', async () => {
    const chunk = defineChunk(flaky('mod', 1), { retries: 0, wait: noWait })
    const seen: string[] = []
    const unsubscribe = chunk.subscribe(() => seen.push(chunk.state().status))
    await chunk.load().catch(() => {})
    await chunk.load()
    expect(seen).toEqual(['loading', 'failed', 'loading', 'ready'])
    unsubscribe()
    await chunk.load()
    expect(seen).toHaveLength(4)
  })

  it('preload starts the load and swallows its failure', async () => {
    const importUrl = server(0)
    const chunk = defineChunk(failedForGood(), { retries: 0, wait: noWait, importUrl, origin: ORIGIN })
    preload(chunk)
    expect(chunk.state().status).toBe('loading')
    // let the rejected import settle; an unhandled rejection would fail the run
    await vi.waitFor(() => expect(chunk.state().status).toBe('failed'))
    preload(chunk)
    await vi.waitFor(() => expect(chunk.state().status).toBe('ready'))
    expect(importUrl).toHaveBeenCalledExactlyOnceWith(`${CHUNK_URL}?retry=1`)
  })
})
