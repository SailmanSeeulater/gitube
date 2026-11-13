import { useEffect } from 'react'
import { fetchRateLimit } from '../api/rateLimit'
import { remainingNow, type RateInfo } from '../api/http'
import { useAppStore } from '../store/useAppStore'

export interface RateBudget {
  /** requests left this hour, or null while unknown */
  remaining: number | null
  /** the hour's allowance (60 without a token, 5000 with one), or null while unknown */
  limit: number | null
  /** when the budget refills (ISO), or null */
  resetAt: string | null
}

/**
 * The hourly request budget for the start screen: asked of GitHub on mount and whenever the token
 * changes (GET /rate_limit is free), then kept current by every fetch's own rate headers through
 * the store's noteRate.
 */
export function useRateBudget(): RateBudget {
  const token = useAppStore((s) => s.token)
  const rate: RateInfo | null = useAppStore((s) => s.rate)
  const noteRate = useAppStore((s) => s.noteRate)

  useEffect(() => {
    const controller = new AbortController()
    const ask = () => {
      void fetchRateLimit(token, { signal: controller.signal }).then((info) => {
        if (!controller.signal.aborted && info) noteRate(info)
      })
    }
    ask()
    // back on the tab after a while: the hour may have refilled, or another tab spent it
    const onVisible = () => {
      if (document.visibilityState === 'visible') ask()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      controller.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [token, noteRate])

  return { remaining: remainingNow(rate), limit: rate?.limit ?? null, resetAt: rate?.resetAt ?? null }
}
