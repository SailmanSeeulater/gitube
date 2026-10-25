/**
 * Person mode's words for a failed profile fetch, and for a token run that GraphQL could not fill.
 * ErrorCard keeps its own copy for every code; person mode overrides its title and hint only where
 * a repo's words would be wrong for a user, and says whether a token would help.
 */
import type { GitHubFetchError, ProfileData } from '../types'
import { formatClock } from '../components/gardenUtils'

export interface PersonErrorCopy {
  /** in place of ErrorCard's title; undefined keeps its own */
  title?: string
  /** in place of ErrorCard's hint; undefined keeps its own */
  hint?: string
  /** a token would help: PersonApp then gives ErrorCard its token action */
  tokenAction: boolean
}

/**
 * The error card's copy for a profile that could not be fetched. login is the one asked for, as
 * typed; hasToken says whether the visitor has one set, which changes what a rate limit means.
 */
export function personErrorCopy(error: GitHubFetchError, login: string, hasToken: boolean): PersonErrorCopy {
  const reset = formatClock(error.resetAt)
  switch (error.code) {
    case 'not_found':
      // Every GitHub user is public, so a token finds no one a visitor cannot.
      return { title: 'user not found', hint: `GitHub has no user called ${login}. check the spelling.`, tokenAction: false }
    case 'rate_limited':
      // A secondary limit is about pace, not the hourly budget: a token does not lift it.
      if (/secondary/i.test(error.message)) {
        return {
          title: 'GitHub asked for a short pause',
          hint: `too many requests in a short time (a secondary rate limit). ${reset ? `try again after ${reset}.` : 'wait a minute and press Grow again.'}`,
          tokenAction: false,
        }
      }
      // With a token set, the token's own hourly budget ran out (a core limit on the identity
      // call ends the fetch, as REST would hit the same wall): another token is not the answer.
      if (hasToken) {
        return { hint: `${reset ? `resets at ${reset}. ` : ''}this token's 5000 requests an hour are used up.`, tokenAction: false }
      }
      return { tokenAction: true }
    case 'unauthorized':
      if (hasToken) return { hint: 'it may be expired or revoked. edit or clear it and try again.', tokenAction: true }
      return { title: 'GitHub refused the request', hint: 'press Grow to try again in a while.', tokenAction: false }
    default:
      return { tokenAction: false }
  }
}

/** Anything with a slash in it: a repo is named owner/name, and links can name one too. */
const SLASHED = /\S*\/\S*/g

/**
 * The status strip's note on a token run that GraphQL could not fill, so REST did. The words are
 * set, from the limit hit and when it resets. GitHub's own message goes only into the title, and
 * without anything slashed in it: it is GitHub's text, verbatim, and a private repo name must not
 * reach the page even there.
 */
export function fallbackNote(fallback: NonNullable<ProfileData['fallback']>): { text: string; title: string } {
  const reset = formatClock(fallback.resetAt)
  const until = reset ? ` until ${reset}` : ''
  const text =
    fallback.limit === 'graphql'
      ? `GraphQL limit reached${until}; showing the public profile`
      : fallback.limit === 'secondary'
        ? `GraphQL paused by a secondary rate limit${until}; showing the public profile`
        : 'GraphQL failed; showing the public profile'
  const said = fallback.message.replace(SLASHED, '…').trim()
  const title =
    'With a token, person mode reads commits and contributions over GraphQL. That failed, so this is the public profile, ' +
    `without commit counts.${said ? ` GitHub said: ${said}` : ''}`
  return { text, title }
}
