/**
 * Loading the optional parts of the app on demand (dynamic import()), and what happens when one
 * cannot be fetched. The usual cause is a deploy: it replaces the hashed chunks (rsync --delete),
 * so a tab opened before it gets a 404 for any part it has not loaded yet, and only a reload helps.
 * A dropped connection is the other cause, which one more try may get past.
 *
 * Pure: no DOM, no React (see components/LazyPart.tsx and lazy/useChunk.ts for those).
 */

/** A part of the app could not be loaded. `cause` is the error the last attempt failed with. */
export class ChunkLoadError extends Error {
  constructor(cause: unknown) {
    super(`couldn't load part of the app (${cause instanceof Error ? cause.message : String(cause)})`, { cause })
    this.name = 'ChunkLoadError'
  }
}

export function isChunkLoadError(error: unknown): error is ChunkLoadError {
  return error instanceof ChunkLoadError
}

export interface LoadOptions {
  /** further attempts after the first one fails */
  retries?: number
  /** pause before each further attempt, in ms */
  retryDelayMs?: number
  /** how to pause (tests pass one that does not wait) */
  wait?: (ms: number) => Promise<void>
}

export const DEFAULT_RETRIES = 1
export const DEFAULT_RETRY_DELAY_MS = 400

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * load(), tried again after a pause when it fails (options.retries times), rejecting with a
 * ChunkLoadError that carries the last failure. A ChunkLoadError from load() itself (a part made of
 * other parts, which had their own tries) is passed on at once.
 */
export async function loadWithRetry<T>(load: () => Promise<T>, options: LoadOptions = {}): Promise<T> {
  const { retries = DEFAULT_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS, wait = sleep } = options
  for (let attempt = 0; ; attempt++) {
    try {
      return await load()
    } catch (error) {
      if (error instanceof ChunkLoadError) throw error
      if (attempt >= retries) throw new ChunkLoadError(error)
      await wait(retryDelayMs)
    }
  }
}

export type ChunkState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'failed'; readonly error: ChunkLoadError }

/**
 * One lazily loaded module. The methods use no `this`, so they can be handed around on their own
 * (useSyncExternalStore(chunk.subscribe, chunk.state)).
 */
export interface Chunk<T> {
  /**
   * Starts loading, or joins the load under way, and resolves with the module. After a failure
   * the next call tries again. Rejects with a ChunkLoadError.
   */
  load: () => Promise<T>
  /** the module once loaded, else undefined */
  peek: () => T | undefined
  /** where loading stands: the same object until it changes */
  state: () => ChunkState<T>
  /** listener runs on every change of state(); returns the unsubscribe */
  subscribe: (listener: () => void) => () => void
}

const IDLE = { status: 'idle' } as const
const LOADING = { status: 'loading' } as const

/** A chunk loaded by importer (a () => import('...')), on its first load() and never before. */
export function defineChunk<T>(importer: () => Promise<T>, options?: LoadOptions): Chunk<T> {
  let current: ChunkState<T> = IDLE
  let pending: Promise<T> | null = null
  const listeners = new Set<() => void>()
  const set = (next: ChunkState<T>) => {
    current = next
    for (const listener of [...listeners]) listener()
  }

  return {
    load: () => {
      if (current.status === 'ready') return Promise.resolve(current.value)
      if (pending) return pending
      set(LOADING)
      pending = loadWithRetry(importer, options).then(
        (value) => {
          pending = null
          set({ status: 'ready', value })
          return value
        },
        (error: unknown) => {
          pending = null
          const failure = error instanceof ChunkLoadError ? error : new ChunkLoadError(error)
          set({ status: 'failed', error: failure })
          throw failure
        },
      )
      return pending
    },
    peek: () => (current.status === 'ready' ? current.value : undefined),
    state: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Starts loading a chunk without waiting for it, e.g. when the pointer heads for its button. */
export function preload(chunk: Chunk<unknown>): void {
  // a failure shows when the part is opened (its load() rejects again or tries afresh)
  chunk.load().catch(() => {})
}
