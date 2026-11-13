import type { RateInfo } from './http'

const RATE_LIMIT_URL = 'https://api.github.com/rate_limit'

/**
 * The hourly core (REST) budget, from GET /rate_limit. GitHub does not count this request against
 * the budget, so the start screen can ask on every visit. null when it cannot be read (offline, a
 * rejected token, an unexpected answer): the screen then says nothing rather than guess.
 */
export async function fetchRateLimit(
  token: string,
  opts: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {},
): Promise<RateInfo | null> {
  const doFetch = opts.fetch ?? globalThis.fetch
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await doFetch(RATE_LIMIT_URL, { headers, signal: opts.signal, cache: 'no-store' })
    if (!res.ok) return null
    return parseRateLimit(await res.json())
  } catch {
    return null
  }
}

/** The core budget out of a /rate_limit body, or null when it is not shaped as GitHub documents it. */
export function parseRateLimit(body: unknown): RateInfo | null {
  const core = (body as { resources?: { core?: unknown } } | null)?.resources?.core as
    | { limit?: unknown; remaining?: unknown; reset?: unknown }
    | undefined
  if (!core || typeof core.remaining !== 'number' || !Number.isFinite(core.remaining)) return null
  const limit = typeof core.limit === 'number' && Number.isFinite(core.limit) ? core.limit : null
  const reset = typeof core.reset === 'number' && Number.isFinite(core.reset) && core.reset > 0 ? new Date(core.reset * 1000).toISOString() : null
  return { remaining: Math.max(0, Math.floor(core.remaining)), limit, resetAt: reset }
}
