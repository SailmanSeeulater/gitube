/**
 * Person mode's words for a failed profile fetch, for a token run that GraphQL could not fill, and
 * for a life with nothing to draw. ErrorCard keeps its own copy for every code; person mode
 * overrides its title and hint only where a repo's words would be wrong for a user, and says
 * whether a token would help.
 */
import type { GitHubFetchError, ProfileData } from '../types'
import { formatClock } from '../components/gardenUtils'
import { repoKey } from './privacy'

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
    case 'not_a_user':
      // ErrorCard's own copy is the organization's; a token cannot turn any of these into a user.
      return { ...notAUserCopy(accountType(error.message)), tokenAction: false }
    case 'rate_limited':
      // A secondary limit is about pace, not the hourly budget: a token does not lift it.
      if (/secondary/i.test(error.message)) {
        return {
          title: 'GitHub asked for a short pause',
          hint: `too many requests in a short time (a secondary rate limit). ${reset ? `try again after ${reset}.` : 'wait a minute and press Go again.'}`,
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
      return { title: 'GitHub refused the request', hint: 'press Go to try again in a while.', tokenAction: false }
    default:
      return { tokenAction: false }
  }
}

/**
 * The account type a not_a_user error names: the identity call (api/profile.ts's fetchIdentity)
 * says "<login> is a GitHub <type> account, not a user." A login holds no space, so the type is the
 * word before " account". null when the message says no type.
 */
export function accountType(message: string): string | null {
  return / is a GitHub (\S+) account, not a user\.?$/.exec(message)?.[1] ?? null
}

/** not_a_user's title and hint by the account's type: ErrorCard's own (an organization's) unless it is something else. */
function notAUserCopy(type: string | null): Pick<PersonErrorCopy, 'title' | 'hint'> {
  if (type === null || type === 'Organization') return {}
  if (type === 'Bot') return { title: "that's a bot", hint: 'person mode shows people: try a repo it works on as owner/repo.' }
  return { title: "that's not a user account", hint: 'person mode shows users: try a login, or a repo as owner/repo.' }
}

/** What the canvas says when it has nothing to draw, and the one thing that would change that. */
export interface EmptyLifeNote {
  title: string
  hint?: string
  /** token: opens the token panel; show-all: shows every repo the eye toggles hid */
  action?: { kind: 'token' | 'show-all'; label: string }
}

/**
 * The note over a life with nothing drawn, or null while anything is: a profile with no repos,
 * worded for the tier that filled it (with the token nudge only where a token would show more,
 * never with one set), or one whose every repo the eye toggles hid. hidden holds repo keys.
 */
export function emptyLifeNote(
  profile: Pick<ProfileData, 'login' | 'source' | 'fallback'>,
  lanes: ReadonlyArray<{ repo: string }>,
  hidden: ReadonlySet<string>,
  hasToken: boolean,
): EmptyLifeNote | null {
  if (lanes.length === 0) {
    if (profile.source === 'graphql') {
      return { title: `${profile.login} has no repos to show yet`, hint: 'GitHub lists no repos of theirs, and counted no commits of theirs to other repos.' }
    }
    // a token is set, so REST filled the profile only because GraphQL failed: the strip says so
    if (hasToken || profile.fallback !== null) return { title: `${profile.login} has no public repos yet` }
    return {
      title: `${profile.login} has no public repos yet`,
      hint: 'with a token, repos they contributed to show too.',
      action: { kind: 'token', label: 'add a token' },
    }
  }
  if (lanes.every((lane) => hidden.has(repoKey(lane.repo)))) {
    const one = lanes.length === 1
    return {
      title: one ? 'its only repo is hidden' : `all ${lanes.length} repos are hidden`,
      hint: 'hidden with the eye in the repo list.',
      action: { kind: 'show-all', label: one ? 'show it' : 'show all' },
    }
  }
  return null
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
