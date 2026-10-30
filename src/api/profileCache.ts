/**
 * Remembers recently loaded profiles in this browser (IndexedDB), on the repo cache's policy
 * (cachePolicy.ts): a profile loaded again within a day shows at once and spends no GitHub requests.
 *
 * Entries are keyed by login and tier, so a tokenless run reads only what REST fetched and a token
 * run only what GraphQL fetched: adding a token never keeps serving a REST profile, and a profile
 * fetched with a token is never served without one. The profiles live in a database of their own,
 * never in the repo cache's 'gitube' (see cachePolicy.ts).
 */
import type { ProfileData } from '../types'
import { indexedDbStore, readFreshEntry, rememberEntry, type CacheEntry, type CachePolicy, type EntryStore } from './cachePolicy'

/** Which fetcher filled a profile: REST without a token, GraphQL with one. */
export type ProfileTier = 'rest' | 'graphql'

export type ProfileStore = EntryStore<ProfileData>

/** A cached profile is used for this long after it was fetched; after that it is fetched again. */
export const PROFILE_CACHE_FRESH_MS = 24 * 60 * 60 * 1000
/** Most profiles kept (each tier's copy counts as one); the least recently fetched go first. */
export const PROFILE_CACHE_MAX = 6
/** Bumped when ProfileData changes shape, so older entries are ignored rather than misread. */
export const PROFILE_CACHE_VERSION = 2

const POLICY: CachePolicy = { freshMs: PROFILE_CACHE_FRESH_MS, maxEntries: PROFILE_CACHE_MAX, version: PROFILE_CACHE_VERSION }

/** GitHub logins are case-insensitive; the tier keeps REST and GraphQL copies apart. */
export function profileCacheKey(login: string, tier: ProfileTier): string {
  return `${login.toLowerCase()}#${tier}`
}

/** The cached profile of login from tier when it is fresh enough to show instead of fetching; null otherwise. */
export async function readProfile(
  store: ProfileStore,
  login: string,
  tier: ProfileTier,
  now: number,
): Promise<CacheEntry<ProfileData> | null> {
  return readFreshEntry(store, profileCacheKey(login, tier), POLICY, now)
}

/**
 * Stores a fresh fetch under tier and drops the oldest profiles beyond PROFILE_CACHE_MAX. Only a
 * profile the tier itself filled is stored: one REST filled after a GraphQL fallback is not, so
 * the next token run tries GraphQL again.
 */
export async function rememberProfile(store: ProfileStore, profile: ProfileData, tier: ProfileTier, now: number): Promise<void> {
  if (profile.source !== tier || profile.fallback !== null) return
  await rememberEntry(store, profileCacheKey(profile.login, tier), profile, POLICY, now)
}

/**
 * This browser's profile store, or null where IndexedDB does not exist (tests, some private modes).
 * Every operation swallows storage errors: the app then simply fetches.
 */
export function browserProfileStore(): ProfileStore | null {
  return indexedDbStore<ProfileData>('gitube-profiles', 'profiles')
}
