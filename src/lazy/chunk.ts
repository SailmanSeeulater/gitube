/**
 * Loading the optional parts of the app on demand (dynamic import()), and what happens when one
 * cannot be fetched. The usual cause is a dropped connection, which one more try may get past. A
 * deploy no longer causes it: the deploy keeps the hashed files of earlier builds for 30 days
 * (.github/workflows/deploy.yml), so a tab opened before a deploy still finds its own build's
 * chunks. Only a tab left open across deploys for longer than that gets a 404, and only a reload
 * helps there.
 *
 * A try after a failure has to use a URL the page has not imported yet. The browser keeps a failed
 * module fetch in the page's module map (Chromium does for the life of the page), so import() of
 * the same URL again rejects at once, with no request. So once an attempt has failed, every later
 * one imports the failed chunk's URL with ?retry=n added. That is a new key in the module map and
 * in the HTTP cache. The chunk's own imports (index-*.js, react-*.js, ...) resolve without the
 * query, so the modules it shares with the app are not loaded twice. The URL comes from the
 * browser's error message: Chromium and Firefox name it, Safari does not. Without a URL, a later
 * try calls the importer again, which may fail at once in the same way.
 *
 * Known limit: when the file that failed was a static dependency of the part (image-*.js under
 * TimelapseBar or exporters, say), the browser also remembers that dependency's failure. Its error
 * still names the part's own URL (checked in Chromium), so the new URL's import fails on the
 * dependency too, and only a reload helps.
 *
 * No React here, and no DOM beyond the page's origin (see components/LazyPart.tsx and
 * lazy/useChunk.ts for those).
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
  /** imports a module by its URL, for the attempts after a failure (tests pass a fake) */
  importUrl?: (url: string) => Promise<unknown>
  /** the page's origin: only a module of this origin is imported again under a new URL */
  origin?: string
}

export const DEFAULT_RETRIES = 1
export const DEFAULT_RETRY_DELAY_MS = 400

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const importByUrl = (url: string): Promise<unknown> => import(/* @vite-ignore */ url)

/**
 * The module URL that a failed import() names in its error, without any query (an earlier
 * ?retry=n). Chromium writes 'Failed to fetch dynamically imported module: <url>' and Firefox
 * 'error loading dynamically imported module: <url>'. Null when there is no URL (Safari), or when
 * the URL is on another origin.
 */
export function failedModuleUrl(error: unknown, origin: string | undefined): string | null {
  if (!(error instanceof TypeError) || origin === undefined) return null
  const match = /(https?:\/\/\S+?\.js)\b/.exec(error.message)
  if (!match) return null
  try {
    const url = new URL(match[1])
    return url.origin === origin ? url.href : null
  } catch {
    return null
  }
}

/**
 * importer, safe to call again after a failure. Once an attempt has failed on a module URL that
 * the browser named, every later attempt imports that URL with a new ?retry=n (see the top of this
 * file). Without a URL, a later attempt calls importer again. Each importer must resolve with the
 * whole module of the chunk it imports, as each one in lazy/parts.ts does, because the namespace
 * of the chunk's URL then stands in for it.
 */
function freshAfterFailure<T>(importer: () => Promise<T>, options: LoadOptions): () => Promise<T> {
  const { importUrl = importByUrl, origin = globalThis.location?.origin } = options
  let failedUrl: string | null = null
  let tries = 0
  return async () => {
    try {
      if (failedUrl === null) return await importer()
      tries += 1
      return (await importUrl(`${failedUrl}?retry=${tries}`)) as T
    } catch (error) {
      // a nested part's ChunkLoadError names no URL of its own (it had its own tries)
      failedUrl = failedModuleUrl(error, origin) ?? failedUrl
      throw error
    }
  }
}

/** attempt(), tried again after a pause when it fails (options.retries times). */
async function retrying<T>(attempt: () => Promise<T>, options: LoadOptions): Promise<T> {
  const { retries = DEFAULT_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS, wait = sleep } = options
  for (let n = 0; ; n++) {
    try {
      return await attempt()
    } catch (error) {
      if (error instanceof ChunkLoadError) throw error
      if (n >= retries) throw new ChunkLoadError(error)
      await wait(retryDelayMs)
    }
  }
}

/**
 * load(), tried again after a pause when it fails (options.retries times), each further try under
 * a new URL (see freshAfterFailure). Rejects with a ChunkLoadError that carries the last failure.
 * A ChunkLoadError from load() itself (a part made of other parts, which had their own tries) is
 * passed on at once.
 */
export function loadWithRetry<T>(load: () => Promise<T>, options: LoadOptions = {}): Promise<T> {
  return retrying(freshAfterFailure(load, options), options)
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
   * the next call tries again, under a new URL (see the top of this file). Rejects with a
   * ChunkLoadError.
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
export function defineChunk<T>(importer: () => Promise<T>, options: LoadOptions = {}): Chunk<T> {
  // one for the chunk's whole life: a later load() (the part opened again) also uses a new URL
  const attempt = freshAfterFailure(importer, options)
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
      pending = retrying(attempt, options).then(
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
  // a failure shows when the part is opened, which tries again
  chunk.load().catch(() => {})
}
