import { describe, expect, it, vi } from 'vitest'
import { ChunkLoadError, DEFAULT_RETRY_DELAY_MS, defineChunk, isChunkLoadError, loadWithRetry, preload } from './chunk'

/** an importer that fails `failures` times (a 404 after a deploy, say) and then resolves */
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

describe('loadWithRetry', () => {
  it('resolves on the first try without waiting', async () => {
    const wait = vi.fn(noWait)
    const importer = flaky('mod', 0)
    await expect(loadWithRetry(importer, { wait })).resolves.toBe('mod')
    expect(importer).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it('tries once more after a pause by default, which gets past a dropped connection', async () => {
    const wait = vi.fn(noWait)
    const importer = flaky('mod', 1)
    await expect(loadWithRetry(importer, { wait })).resolves.toBe('mod')
    expect(importer).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledExactlyOnceWith(DEFAULT_RETRY_DELAY_MS)
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
    const importer = flaky('mod', 1)
    await expect(loadWithRetry(importer, { retries: 0, wait: noWait })).rejects.toBeInstanceOf(ChunkLoadError)
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('passes a ChunkLoadError from a nested part on without trying again', async () => {
    const inner = new ChunkLoadError(new Error('404'))
    const importer = vi.fn(() => Promise.reject(inner))
    await expect(loadWithRetry(importer, { wait: noWait })).rejects.toBe(inner)
    expect(importer).toHaveBeenCalledTimes(1)
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

  it('reports a failure, and tries afresh on the next load', async () => {
    const importer = flaky('mod', 2)
    const chunk = defineChunk(importer, { retries: 1, wait: noWait })
    await expect(chunk.load()).rejects.toBeInstanceOf(ChunkLoadError)
    const failed = chunk.state()
    expect(failed.status).toBe('failed')
    expect(failed.status === 'failed' && isChunkLoadError(failed.error)).toBe(true)
    expect(chunk.peek()).toBeUndefined()
    expect(importer).toHaveBeenCalledTimes(2)

    await expect(chunk.load()).resolves.toBe('mod')
    expect(importer).toHaveBeenCalledTimes(3)
    expect(chunk.state().status).toBe('ready')
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
    const importer = flaky('mod', 1)
    const chunk = defineChunk(importer, { retries: 0, wait: noWait })
    preload(chunk)
    expect(chunk.state().status).toBe('loading')
    // let the rejected import settle; an unhandled rejection would fail the run
    await vi.waitFor(() => expect(chunk.state().status).toBe('failed'))
    preload(chunk)
    await vi.waitFor(() => expect(chunk.state().status).toBe('ready'))
    expect(importer).toHaveBeenCalledTimes(2)
  })
})
