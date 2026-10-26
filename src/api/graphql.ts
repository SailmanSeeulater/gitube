/**
 * What the GraphQL clients share (api/pulls.ts for the pull request overlay, api/profileGraphql.ts
 * for person mode): how long a query may take and the abort that enforces it. It lives on its own so
 * that person mode can use it without loading the whole pull request client; its only importers are
 * lazy, so it stays out of the first download (lazy/parts.test.ts).
 */

/** A GraphQL query slower than this is given up on (then retried in halves). */
export const GRAPHQL_TIMEOUT_MS = 15_000

/** The caller's signal joined with a timeout; the timeout half tells the two apart. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal | undefined; timedOut: () => boolean } {
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any
  const timeoutFn = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout
  if (!timeoutFn) return { signal, timedOut: () => false }
  const timeout = timeoutFn(ms)
  const joined = signal && anyFn ? anyFn([signal, timeout]) : signal ? signal : timeout
  return { signal: joined, timedOut: () => timeout.aborted && !signal?.aborted }
}
