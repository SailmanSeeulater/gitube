/**
 * What the GraphQL clients share (src/api/graphql.ts): withTimeout, which joins the caller's signal
 * with a timeout and tells the two kinds of abort apart, and how it falls back on a runtime without
 * AbortSignal.timeout or AbortSignal.any. Real timers, a few milliseconds long.
 */
import { describe, expect, it } from 'vitest'
import { GRAPHQL_TIMEOUT_MS, withTimeout } from '../src/api/graphql'
import { GRAPHQL_TIMEOUT_MS as PULLS_TIMEOUT_MS } from '../src/api/pulls'

/** Resolves once signal aborts (at once when it already has). */
function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

/** Resolves once check() holds, polling every few milliseconds; fails after a second. */
async function eventually(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met within 1 s')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** Runs fn while AbortSignal lacks the static method name, as an older runtime would, then puts it back. */
function without<T>(name: 'timeout' | 'any', fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, name)
  Object.defineProperty(AbortSignal, name, { value: undefined, configurable: true, writable: true })
  try {
    return fn()
  } finally {
    if (original) Object.defineProperty(AbortSignal, name, original)
    else delete (AbortSignal as unknown as Record<string, unknown>)[name]
  }
}

describe('GRAPHQL_TIMEOUT_MS', () => {
  it('is 15 s, and pulls.ts still exports the same value', () => {
    expect(GRAPHQL_TIMEOUT_MS).toBe(15_000)
    expect(PULLS_TIMEOUT_MS).toBe(GRAPHQL_TIMEOUT_MS)
  })
})

describe('withTimeout', () => {
  it("joins the caller's signal: aborting it aborts the joined one, and that is no timeout", async () => {
    const controller = new AbortController()
    const timer = withTimeout(controller.signal, 60_000)
    expect(timer.signal).toBeDefined()
    expect(timer.signal).not.toBe(controller.signal)
    expect(timer.signal?.aborted).toBe(false)
    expect(timer.timedOut()).toBe(false)

    controller.abort()
    await aborted(timer.signal as AbortSignal)
    expect(timer.signal?.aborted).toBe(true)
    expect(timer.timedOut()).toBe(false)
  })

  it('aborts the joined signal when the time runs out, and says it timed out', async () => {
    const controller = new AbortController()
    const timer = withTimeout(controller.signal, 5)
    await aborted(timer.signal as AbortSignal)
    expect(timer.signal?.aborted).toBe(true)
    expect(controller.signal.aborted).toBe(false)
    expect(timer.timedOut()).toBe(true)
  })

  it('tells a caller abort after the timeout from a timeout alone', async () => {
    const controller = new AbortController()
    const timer = withTimeout(controller.signal, 5)
    await aborted(timer.signal as AbortSignal)
    expect(timer.timedOut()).toBe(true)
    // The caller giving up as well wins: a fetch it aborted is its abort, not a slow GitHub.
    controller.abort()
    expect(timer.timedOut()).toBe(false)
  })

  it('uses the timeout alone when the caller passes no signal', async () => {
    const timer = withTimeout(undefined, 5)
    expect(timer.signal).toBeDefined()
    expect(timer.timedOut()).toBe(false)
    await aborted(timer.signal as AbortSignal)
    expect(timer.timedOut()).toBe(true)
  })

  it("falls back to the caller's signal, with no timeout, when AbortSignal.timeout is missing", async () => {
    const controller = new AbortController()
    const timer = without('timeout', () => withTimeout(controller.signal, 1))
    expect(timer.signal).toBe(controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(timer.signal?.aborted).toBe(false)
    expect(timer.timedOut()).toBe(false)
    controller.abort()
    expect(timer.timedOut()).toBe(false)

    const bare = without('timeout', () => withTimeout(undefined, 1))
    expect(bare.signal).toBeUndefined()
    expect(bare.timedOut()).toBe(false)
  })

  it("keeps the caller's signal when AbortSignal.any is missing, and still reports the timeout", async () => {
    const controller = new AbortController()
    const timer = without('any', () => withTimeout(controller.signal, 5))
    // Without AbortSignal.any the two cannot be joined: the caller's signal is the one passed on.
    expect(timer.signal).toBe(controller.signal)
    await eventually(timer.timedOut)
    expect(controller.signal.aborted).toBe(false)

    // With no caller signal there is nothing to join, so the timeout is used as it is.
    const alone = without('any', () => withTimeout(undefined, 5))
    await aborted(alone.signal as AbortSignal)
    expect(alone.timedOut()).toBe(true)
  })
})
