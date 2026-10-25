/**
 * Sends person mode's grow events as the profile on show changes (the rules are in analytics.ts).
 * Returns noteGrow (stable), which the refresh button calls with the login on show before it
 * refetches; a new login or request from the router arms itself.
 */
import { useCallback, useEffect, useState } from 'react'
import { track } from '../analytics/umami'
import { PersonAnalytics, type PersonAnalyticsState } from './analytics'

export function usePersonAnalytics(input: PersonAnalyticsState): (login: string) => void {
  const { login, request, profile, fetchedAt, cachedAt, isFetching, error } = input
  const [analytics] = useState(() => new PersonAnalytics())
  useEffect(() => {
    for (const [event, data] of analytics.observe({ login, request, profile, fetchedAt, cachedAt, isFetching, error })) track(event, data)
  }, [analytics, login, request, profile, fetchedAt, cachedAt, isFetching, error])
  return useCallback((who: string) => analytics.noteGrow(who), [analytics])
}
