/**
 * Share links: the page URL names the repo on show and what is selected in it, so a copied link
 * opens the same garden. ?repo=owner/repo, plus &branch=<name> or &by=<login> (a contributor
 * without a GitHub account: &by=name:<author name>).
 *
 * Pure: reads and writes query strings only.
 */
import { parseRepoUrl, type RepoRef } from '../api/parseRepoUrl'

export interface ShareState {
  repo: RepoRef | null
  branch: string | null
  /** Contributor.key ('login:<login>' or 'name:<name>') */
  person: string | null
}

const NAME_PREFIX = 'name:'
const LOGIN_PREFIX = 'login:'

/** Reads a location.search string. Anything malformed is dropped, never thrown. */
export function readShareState(search: string): ShareState {
  const params = new URLSearchParams(search)
  const repoParam = params.get('repo')
  const repo = repoParam ? parseRepoUrl(repoParam) : null
  if (!repo) return { repo: null, branch: null, person: null }
  const branch = params.get('branch') || null
  const by = params.get('by')?.trim() || null
  let person: string | null = null
  if (by !== null) person = by.toLowerCase().startsWith(NAME_PREFIX) ? by.toLowerCase() : `${LOGIN_PREFIX}${by.toLowerCase()}`
  // one selection at a time, as in the app
  return { repo, branch, person: branch !== null ? null : person }
}

/**
 * The query string for a state, '' when no repo is on show. Other parameters in `current` are kept,
 * so links carrying something else (a campaign tag, say) still work.
 */
export function writeShareState(state: ShareState, current = ''): string {
  const params = new URLSearchParams(current)
  params.delete('repo')
  params.delete('branch')
  params.delete('by')
  if (state.repo) {
    params.set('repo', `${state.repo.owner}/${state.repo.repo}`)
    if (state.branch !== null) params.set('branch', state.branch)
    else if (state.person !== null) {
      params.set('by', state.person.startsWith(LOGIN_PREFIX) ? state.person.slice(LOGIN_PREFIX.length) : state.person)
    }
  }
  // owner/repo and branch names read better with their slashes left alone
  const query = params.toString().replace(/%2F/gi, '/').replace(/%3A/gi, ':')
  return query ? `?${query}` : ''
}
