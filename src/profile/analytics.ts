/**
 * Person mode's analytics rules (PROFILE_SPEC.md section 6, "Analytics"). They are pure: the data
 * is decided from the fetch result, and every event still goes out through track() in
 * analytics/umami.ts. Nothing sends them until the life garden can show a profile.
 */
import type { EventData } from '../analytics/umami'
import type { ProfileData } from '../types'

/**
 * The grow event for a profile on show. source is the tier that filled it, so 'rest' after a
 * GraphQL fallback. The login is named only for a live fetch without a token, as growEventData does
 * for a repo: a cached copy is never proof of a tokenless fetch, and track() dropping the login
 * under a token is only the backstop.
 */
export function personGrowEventData(profile: Pick<ProfileData, 'login' | 'source'>, cached: boolean, token: boolean): EventData {
  const event: EventData = { mode: 'person', source: profile.source, cached, token }
  if (!token && !cached) event.login = profile.login
  return event
}
